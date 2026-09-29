import { Injectable } from '@nestjs/common';
import type { Agent, AgentRunResult } from '../agent.interface';
import type { AuditContext, FindingDraft } from './audit-context';
import { runAlertChecks, runGlobalChecks } from './checks';

/**
 * Agent-audytor (etap 1, tasks-2026-09-27/05): mapuje deterministyczne checki z `checks.ts` na szkice
 * findingów. `AMBIGUOUS` → finding INFO `<checkId>_AMBIGUOUS` (warstwa LLM dopiero w 04).
 * Zero DB, zero Telegrama, zero LLM — czysta funkcja nad AuditContext opakowana w provider.
 */
@Injectable()
export class AuditorAgent implements Agent {
  readonly name = 'AUDITOR' as const;

  run(ctx: AuditContext): AgentRunResult {
    const outcome = runAlertChecks(ctx);
    const ambiguousDrafts: FindingDraft[] = outcome.ambiguous.map((checkId) => ({
      checkId: `${checkId}_AMBIGUOUS`,
      severity: 'INFO',
      alertId: ctx.alert.id,
      ticker: ctx.alert.symbol,
      accessionNumber: ctx.filing?.accessionNumber ?? null,
      summary: `${checkId}: nierozstrzygalne deterministycznie (brak dopasowania w danych) — kandydat do warstwy LLM (task 04)`,
      evidence: { checkId, tradesInWindow: ctx.trades.length },
    }));
    return {
      findings: [...outcome.findings, ...ambiguousDrafts, ...runGlobalChecks(ctx)],
      checksRun: outcome.checksRun,
      ambiguous: outcome.ambiguous,
      checkErrors: outcome.checkErrors,
    };
  }
}
