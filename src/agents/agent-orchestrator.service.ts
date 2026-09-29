import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import type { AgentName } from '../entities/agent-finding.entity';
import type { Agent, AgentRunResult } from './agent.interface';
import type { AuditContext, FindingDraft } from './auditor/audit-context';
import { Logged } from '../common/decorators/logged.decorator';
import { errMsg } from '../common/utils/error-message.util';
import { AgentFinding, Alert, InsiderTrade, SecFiling } from '../entities';
import { AuditorAgent } from './auditor/auditor.agent';

/**
 * Orkiestrator agentów (tasks-2026-09-27/05) — shadow-mode.
 *
 * Trigger: CRON co 15 min (brak eventu po emisji alertu — `ALERT_TRIGGERED` nieużywany, a podpięcie
 * wymagałoby edycji dispatchera = ścieżka decyzyjna). Skanuje `alerts` bez markera `_AUDITED`,
 * buduje AuditContext (filing wg reguły w oknie 3d, insider_trades w oknie 14d) i zapisuje findingi.
 *
 * Inwarianty:
 * - read-only na alerts/sec_filings/insider_trades; JEDYNY zapis: INSERT do agent_findings
 *   (`ON CONFLICT DO NOTHING` na unique (alertId, checkId); globalne deduplikowane po (agent, checkId));
 * - marker `_AUDITED` per (alert, agent) = idempotencja; błąd w trakcie alertu → brak markera → retry;
 * - `AUDITOR_ENABLED=false` (domyślnie) → CRON loguje „disabled" i nic nie pisze;
 * - zero importów Telegrama/formattera/pipeline'ów.
 */

export const AUDITED_MARKER = '_AUDITED';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ALERTS_PER_RUN = 50;
const MAX_ALERTS_PER_RUN_CAP = 500;
const DEFAULT_SINCE_DAYS = 30;
const FILING_WINDOW_DAYS = 3;
const TRADES_WINDOW_DAYS = 14;
/** Transakcja wyzwalająca alert Form 4 jest zbierana minuty przed wysyłką — 3h to szeroki margines. */
const TRIGGER_COLLECTED_WINDOW_MS = 3 * 60 * 60 * 1000;
const FILING_CANDIDATES = 10;

export interface RunOptions {
  /** Max alertów w przebiegu (domyślnie AUDITOR_MAX_ALERTS_PER_RUN, twardy sufit 500). */
  readonly limit?: number;
  /** Tylko alerty z zakończonym price outcome (CRON: true; shadow-run 06: false). */
  readonly requireOutcomeDone?: boolean;
  /** Okno wstecz po sentAt w dniach; null = bez ograniczenia. Domyślnie 30. */
  readonly sinceDays?: number | null;
  readonly order?: 'ASC' | 'DESC';
  /** Tylko wskazane alerty (shadow-run `--ids`); nadal z pominięciem już zaudytowanych. Pusta lista = nic. */
  readonly alertIds?: readonly number[];
}

export interface OrchestratorRunSummary {
  readonly skipped: 'disabled' | 'busy' | null;
  readonly alertsScanned: number;
  readonly findingsInserted: number;
  readonly findingsDuplicate: number;
  /** Liczba WSTAWIONYCH findingów per checkId (bez duplikatów). */
  readonly perCheck: Record<string, number>;
  readonly errors: number;
  readonly durationMs: number;
}

/** Filing dobierany wg reguły alertu: 8-K% → '8-K', Form 4% → '4', inne (Correlated Signal) → brak. */
export function filingTypeForRule(ruleName: string): '8-K' | '4' | null {
  if (ruleName.startsWith('8-K')) return '8-K';
  if (ruleName.startsWith('Form 4')) return '4';
  return null;
}

export function parseEnabled(raw: unknown): boolean {
  return raw === true || (typeof raw === 'string' && raw.trim().toLowerCase() === 'true');
}

export function parseMaxAlertsPerRun(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_ALERTS_PER_RUN;
  return Math.min(Math.floor(n), MAX_ALERTS_PER_RUN_CAP);
}

function emptySummary(skipped: 'disabled' | 'busy'): OrchestratorRunSummary {
  return { skipped, alertsScanned: 0, findingsInserted: 0, findingsDuplicate: 0, perCheck: {}, errors: 0, durationMs: 0 };
}

/** Data (UTC, YYYY-MM-DD) przesunięta o `days` — do porównań z kolumnami typu `date`. */
function dateOnly(base: Date, days: number): string {
  return new Date(base.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function markerDraft(ctx: AuditContext, result: AgentRunResult, durationMs: number): FindingDraft {
  return {
    checkId: AUDITED_MARKER,
    severity: 'INFO',
    alertId: ctx.alert.id,
    ticker: ctx.alert.symbol,
    accessionNumber: ctx.filing?.accessionNumber ?? null,
    summary: 'Audyt zakończony — marker idempotencji (nie jest findingiem)',
    evidence: {
      checksRun: [...result.checksRun],
      findings: result.findings.filter((f) => f.alertId !== null).map((f) => f.checkId),
      ambiguous: [...result.ambiguous],
      checkErrors: [...result.checkErrors],
      filingId: ctx.filing?.id ?? null,
      tradesInWindow: ctx.trades.length,
      durationMs,
    },
  };
}

@Injectable()
export class AgentOrchestratorService {
  private readonly logger = new Logger(AgentOrchestratorService.name);
  private readonly enabled: boolean;
  private readonly maxAlertsPerRun: number;
  private readonly agents: readonly Agent[];
  private running = false;

  constructor(
    @InjectRepository(Alert) private readonly alertRepo: Repository<Alert>,
    @InjectRepository(SecFiling) private readonly filingRepo: Repository<SecFiling>,
    @InjectRepository(InsiderTrade) private readonly tradeRepo: Repository<InsiderTrade>,
    @InjectRepository(AgentFinding) private readonly findingRepo: Repository<AgentFinding>,
    config: ConfigService,
    auditor: AuditorAgent,
  ) {
    this.enabled = parseEnabled(config.get<unknown>('AUDITOR_ENABLED'));
    this.maxAlertsPerRun = parseMaxAlertsPerRun(config.get<unknown>('AUDITOR_MAX_ALERTS_PER_RUN'));
    this.agents = [auditor];
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Jednolinijkowy opis konfiguracji — log startowy w AgentsModule.onModuleInit. */
  describe(): string {
    return (
      `audytor ${this.enabled ? 'AKTYWNY (CRON */15 min UTC)' : 'WYŁĄCZONY (AUDITOR_ENABLED=false — CRON zarejestrowany, zero zapisów)'}; ` +
      `agenci: ${this.agents.map((a) => a.name).join(', ')}; max ${this.maxAlertsPerRun} alertów/przebieg; zapis tylko agent_findings`
    );
  }

  /** CRON co 15 min (UTC). Przy AUDITOR_ENABLED=false nic nie czyta i nic nie pisze. */
  @Cron('*/15 * * * *', { timeZone: 'UTC' })
  @Logged('agents')
  async runScheduled(): Promise<OrchestratorRunSummary> {
    if (!this.enabled) {
      this.logger.debug('AgentOrchestrator: AUDITOR_ENABLED=false — pomijam cykl (disabled)');
      return emptySummary('disabled');
    }
    return this.runOnce();
  }

  /**
   * Jeden przebieg: dla każdego agenta alerty bez markera → kontekst → run → INSERT findingów + marker.
   * Używany przez CRON i przez shadow-run (06) z własnymi opcjami; `AUDITOR_ENABLED` tu nie obowiązuje.
   */
  async runOnce(opts: RunOptions = {}): Promise<OrchestratorRunSummary> {
    if (this.running) {
      this.logger.warn('AgentOrchestrator: poprzedni przebieg jeszcze trwa — pomijam (busy)');
      return emptySummary('busy');
    }
    this.running = true;
    const started = Date.now();
    const perCheck: Record<string, number> = {};
    let alertsScanned = 0;
    let findingsInserted = 0;
    let findingsDuplicate = 0;
    let errors = 0;

    try {
      for (const agent of this.agents) {
        const alerts = await this.findPendingAlerts(agent.name, opts);
        for (const alert of alerts) {
          alertsScanned++;
          try {
            const ctx = await this.buildContext(alert);
            const t0 = Date.now();
            const result = await agent.run(ctx);
            const drafts = [...result.findings, markerDraft(ctx, result, Date.now() - t0)];
            for (const draft of drafts) {
              const outcome = await this.persist(agent.name, draft);
              if (outcome === 'inserted') {
                findingsInserted++;
                perCheck[draft.checkId] = (perCheck[draft.checkId] ?? 0) + 1;
              } else {
                findingsDuplicate++;
              }
            }
          } catch (err) {
            errors++;
            this.logger.error(`AgentOrchestrator: ${agent.name} alert #${alert.id} ${alert.symbol} — ${errMsg(err)}`);
          }
        }
      }
    } finally {
      this.running = false;
    }

    const summary: OrchestratorRunSummary = {
      skipped: null,
      alertsScanned,
      findingsInserted,
      findingsDuplicate,
      perCheck,
      errors,
      durationMs: Date.now() - started,
    };
    if (alertsScanned > 0) {
      this.logger.log(
        `AgentOrchestrator: ${alertsScanned} alertów, +${findingsInserted} findingów (${findingsDuplicate} dupl., ${errors} błędów) w ${summary.durationMs} ms`,
      );
    }
    return summary;
  }

  /** Alerty bez markera `_AUDITED` danego agenta (read-only). */
  private async findPendingAlerts(agentName: AgentName, opts: RunOptions): Promise<Alert[]> {
    if (opts.alertIds?.length === 0) return [];
    const limit = Math.min(opts.limit ?? this.maxAlertsPerRun, MAX_ALERTS_PER_RUN_CAP);
    const sinceDays = opts.sinceDays === undefined ? DEFAULT_SINCE_DAYS : opts.sinceDays;
    const qb = this.alertRepo
      .createQueryBuilder('a')
      .where(
        'NOT EXISTS (SELECT 1 FROM agent_findings f WHERE f."alertId" = a.id AND f.agent = :agent AND f."checkId" = :marker)',
        { agent: agentName, marker: AUDITED_MARKER },
      )
      .orderBy('a.id', opts.order ?? 'ASC')
      .take(limit);
    if (sinceDays !== null) {
      qb.andWhere('a.sentAt > :since', { since: new Date(Date.now() - sinceDays * DAY_MS) });
    }
    if (opts.requireOutcomeDone ?? true) {
      qb.andWhere('a.priceOutcomeDone = :done', { done: true });
    }
    if (opts.alertIds !== undefined) {
      qb.andWhere('a.id IN (:...ids)', { ids: [...opts.alertIds] });
    }
    return qb.getMany();
  }

  private async buildContext(alert: Alert): Promise<AuditContext> {
    const sentAt = new Date(alert.sentAt);
    const [filing, trades] = await Promise.all([this.loadFiling(alert, sentAt), this.loadTrades(alert.symbol, sentAt)]);
    return { alert, filing, trades, now: new Date() };
  }

  /** Najnowszy filing typu wg reguły w oknie [sentAt−3d, sentAt]; preferuje wiersz z gptAnalysis. */
  private async loadFiling(alert: Alert, sentAt: Date): Promise<SecFiling | null> {
    const formType = filingTypeForRule(alert.ruleName);
    if (formType === null) return null;
    const candidates = await this.filingRepo
      .createQueryBuilder('f')
      .where('f.symbol = :symbol', { symbol: alert.symbol })
      .andWhere('f.formType = :formType', { formType })
      .andWhere('f.filingDate BETWEEN :from AND :to', {
        from: dateOnly(sentAt, -FILING_WINDOW_DAYS),
        to: dateOnly(sentAt, 0),
      })
      .orderBy('f.filingDate', 'DESC')
      .addOrderBy('f.id', 'DESC')
      .take(FILING_CANDIDATES)
      .getMany();
    // Filing WYZWALAJĄCY jest zbierany minuty przed alertem — preferuj zebrany w [sentAt−3h, sentAt]
    // (SEM #2441 miał 20 filingów w oknie 3d; sam symbol+data wskazywałby cudzy filing), potem z gptAnalysis.
    const collectedFrom = sentAt.getTime() - TRIGGER_COLLECTED_WINDOW_MS;
    const trigger = candidates.find((f) => {
      const c = new Date(f.collectedAt).getTime();
      return c >= collectedFrom && c <= sentAt.getTime();
    });
    if (trigger !== undefined) return trigger;
    const withGpt = candidates.find((f) => f.gptAnalysis !== null);
    if (withGpt !== undefined) return withGpt;
    return candidates.length > 0 ? candidates[0] : null;
  }

  /**
   * insider_trades symbolu: transactionDate w oknie 14d LUB collectedAt w [sentAt−3h, sentAt].
   * Drugi warunek łapie transakcję WYZWALAJĄCĄ alert przy spóźnionym Form 4 (CAI #2443: transactionDate
   * 59 dni przed zebraniem) — bez niego TRANSACTION_TYPE_MISMATCH widziałby tylko inne transakcje insidera.
   */
  private loadTrades(symbol: string, sentAt: Date): Promise<InsiderTrade[]> {
    return this.tradeRepo
      .createQueryBuilder('t')
      .where('t.symbol = :symbol', { symbol })
      .andWhere(
        '(t.transactionDate BETWEEN :from AND :to OR t.collectedAt BETWEEN :collectedFrom AND :collectedTo)',
        {
          from: dateOnly(sentAt, -TRADES_WINDOW_DAYS),
          to: dateOnly(sentAt, 0),
          collectedFrom: new Date(sentAt.getTime() - TRIGGER_COLLECTED_WINDOW_MS),
          collectedTo: sentAt,
        },
      )
      .orderBy('t.id', 'ASC')
      .getMany();
  }

  /** INSERT ... ON CONFLICT DO NOTHING; globalne (alertId=null) deduplikowane po (agent, checkId). */
  private async persist(agent: AgentName, draft: FindingDraft): Promise<'inserted' | 'duplicate'> {
    if (draft.alertId === null) {
      const exists = await this.findingRepo.exists({ where: { agent, checkId: draft.checkId, alertId: IsNull() } });
      if (exists) return 'duplicate';
    }
    // QueryDeepPartialEntity TypeORM nie przyjmuje wartości `unknown` w jsonb (Record<string, unknown>) —
    // rzutowanie dotyczy wyłącznie typu, wartość to zwykły obiekt JSON.
    const evidence = { ...draft.evidence } as QueryDeepPartialEntity<AgentFinding>['evidence'];
    const result = await this.findingRepo
      .createQueryBuilder()
      .insert()
      .into(AgentFinding)
      .values({
        alertId: draft.alertId,
        ticker: draft.ticker,
        accessionNumber: draft.accessionNumber,
        agent,
        checkId: draft.checkId,
        severity: draft.severity,
        source: 'DETERMINISTIC',
        summary: draft.summary,
        evidence,
        status: 'OPEN',
        pipelineVersion: null,
      })
      .orIgnore()
      .execute();
    const raw: unknown = result.raw;
    return Array.isArray(raw) && raw.length > 0 ? 'inserted' : 'duplicate';
  }
}
