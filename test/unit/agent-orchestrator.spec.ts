/**
 * Testy orkiestratora agentów (tasks-2026-09-27/05) — bez DB: repozytoria zamockowane,
 * agent_findings symulowane w pamięci z unique (alertId, checkId) (= ON CONFLICT DO NOTHING).
 * Alerty/filingi/trades z realnych fixture test/fixtures/auditor (SEM #2441, KURA #2479).
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  AgentOrchestratorService,
  AUDITED_MARKER,
  filingTypeForRule,
  parseEnabled,
  parseMaxAlertsPerRun,
} from '../../src/agents/agent-orchestrator.service';
import { AuditorAgent } from '../../src/agents/auditor/auditor.agent';

interface Fixture {
  _meta: { alertId: number; symbol: string; expectedFindings: string[] };
  alert: Record<string, unknown>;
  filing: Record<string, unknown> | null;
  trades: Record<string, unknown>[];
}

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'auditor');
const load = (file: string): Fixture => JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8')) as Fixture;
const SEM = load('SEM-2441.json');
const KURA = load('KURA-2479.json');
const alertOf = (fx: Fixture): Record<string, unknown> => ({ ...fx.alert, sentAt: new Date(fx.alert.sentAt as string) });

type Chain = Record<string, jest.Mock>;

/** Łańcuch QueryBuilder dla SELECT: getMany zwraca wiersze dla symbolu z `.where(..., { symbol })`. */
function selectChain(rowsBySymbol: Record<string, unknown[]> | (() => Promise<unknown[]>)): Chain {
  const c: Chain = {};
  let symbol = '';
  for (const m of ['andWhere', 'orderBy', 'addOrderBy', 'take']) c[m] = jest.fn().mockReturnValue(c);
  c.where = jest.fn((_sql: string, params?: { symbol?: string }) => {
    symbol = params?.symbol ?? '';
    return c;
  });
  c.getMany = jest.fn(() =>
    typeof rowsBySymbol === 'function' ? rowsBySymbol() : Promise.resolve(rowsBySymbol[symbol] ?? []),
  );
  return c;
}

/** In-memory agent_findings: unique (alertId, checkId) WHERE alertId IS NOT NULL + exists() dla globalnych. */
function findingStore() {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const chain: Chain = {};
  let pending: Record<string, unknown> = {};
  for (const m of ['insert', 'into', 'orIgnore']) chain[m] = jest.fn().mockReturnValue(chain);
  chain.values = jest.fn((v: Record<string, unknown>) => {
    pending = v;
    return chain;
  });
  chain.execute = jest.fn(() => {
    const key = `${String(pending.alertId)}|${String(pending.checkId)}`;
    if (pending.alertId !== null && seen.has(key)) return Promise.resolve({ raw: [] });
    seen.add(key);
    rows.push({ ...pending });
    return Promise.resolve({ raw: [{ id: rows.length }] });
  });
  const repo = {
    createQueryBuilder: jest.fn(() => chain),
    exists: jest.fn(({ where }: { where: { agent: string; checkId: string } }) =>
      Promise.resolve(rows.some((r) => r.alertId === null && r.agent === where.agent && r.checkId === where.checkId)),
    ),
  };
  return { repo, rows, chain };
}

function build(opts: {
  env?: Record<string, unknown>;
  alerts?: unknown[] | (() => Promise<unknown[]>);
  filings?: Record<string, unknown[]>;
  trades?: Record<string, unknown[]>;
  agent?: unknown;
} = {}) {
  const alertQb = selectChain(typeof opts.alerts === 'function' ? opts.alerts : { '': opts.alerts ?? [] });
  const alertRepo = { createQueryBuilder: jest.fn(() => alertQb) };
  const filingRepo = { createQueryBuilder: jest.fn(() => selectChain(opts.filings ?? {})) };
  const tradeRepo = { createQueryBuilder: jest.fn(() => selectChain(opts.trades ?? {})) };
  const store = findingStore();
  const config = { get: jest.fn((key: string) => opts.env?.[key]) };
  const service = new AgentOrchestratorService(
    alertRepo as any,
    filingRepo as any,
    tradeRepo as any,
    store.repo as any,
    config as any,
    (opts.agent ?? new AuditorAgent()) as AuditorAgent,
  );
  return { service, alertQb, alertRepo, filingRepo, tradeRepo, store };
}

const twoAlerts = () => ({
  alerts: [alertOf(SEM), alertOf(KURA)],
  filings: { SEM: [SEM.filing], KURA: [KURA.filing] },
  trades: { SEM: SEM.trades, KURA: KURA.trades },
});

describe('konfiguracja', () => {
  it('parseEnabled: tylko true / "true" włącza', () => {
    expect(parseEnabled(true)).toBe(true);
    expect(parseEnabled('true')).toBe(true);
    expect(parseEnabled(' TRUE ')).toBe(true);
    for (const v of [false, 'false', '', undefined, null, 1, 'yes']) expect(parseEnabled(v)).toBe(false);
  });
  it('parseMaxAlertsPerRun: default 50, string, sufit 500, śmieci → default', () => {
    expect(parseMaxAlertsPerRun(undefined)).toBe(50);
    expect(parseMaxAlertsPerRun('20')).toBe(20);
    expect(parseMaxAlertsPerRun(20.9)).toBe(20);
    expect(parseMaxAlertsPerRun(9999)).toBe(500);
    expect(parseMaxAlertsPerRun('abc')).toBe(50);
    expect(parseMaxAlertsPerRun(0)).toBe(50);
  });
  it('filingTypeForRule: 8-K% → 8-K, Form 4% → 4, Correlated Signal → null', () => {
    expect(filingTypeForRule('8-K Earnings Miss')).toBe('8-K');
    expect(filingTypeForRule('8-K Material Event GPT')).toBe('8-K');
    expect(filingTypeForRule('Form 4 Insider BUY')).toBe('4');
    expect(filingTypeForRule('Form 4 Insider Signal')).toBe('4');
    expect(filingTypeForRule('Correlated Signal')).toBeNull();
  });
});

describe('CRON przy AUDITOR_ENABLED=false (domyślnie)', () => {
  it('runScheduled → skipped=disabled, zero zapytań do DB, zero zapisów', async () => {
    const { service, alertRepo, store } = build(twoAlerts());
    expect(service.isEnabled()).toBe(false);
    const summary = await service.runScheduled();
    expect(summary.skipped).toBe('disabled');
    expect(alertRepo.createQueryBuilder).not.toHaveBeenCalled();
    expect(store.rows).toHaveLength(0);
  });
  it('AUDITOR_ENABLED="true" (string z .env) → runScheduled wykonuje przebieg', async () => {
    const { service, store } = build({ ...twoAlerts(), env: { AUDITOR_ENABLED: 'true' } });
    expect(service.isEnabled()).toBe(true);
    const summary = await service.runScheduled();
    expect(summary.skipped).toBeNull();
    expect(summary.alertsScanned).toBe(2);
    expect(store.rows.length).toBeGreaterThan(0);
  });
});

describe('runOnce — przebieg na SEM #2441 + KURA #2479', () => {
  it('zapisuje findingi per alert, marker _AUDITED per alert, globalne raz', async () => {
    const { service, store } = build(twoAlerts());
    const summary = await service.runOnce();

    expect(summary.alertsScanned).toBe(2);
    expect(summary.errors).toBe(0);
    const byAlert = (id: number | null) => store.rows.filter((r) => r.alertId === id).map((r) => r.checkId).sort();
    expect(byAlert(2441)).toEqual(['PRICE_FROZEN', AUDITED_MARKER].sort());
    expect(byAlert(2479)).toEqual(['ENTRY_GAP_UNENTERABLE', AUDITED_MARKER].sort());
    // globalne: PIPELINE_VERSION_UNKNOWN z SEM (pierwszy), PRICE_LABEL_AMBIGUOUS z KURA (Form 4); drugi PIPELINE = duplikat
    // + CONCLUSION_CUT_AT_300 z KURA (wniosek ucięty na 300 zn.); drugi PIPELINE = duplikat
    expect(byAlert(null)).toEqual(['CONCLUSION_CUT_AT_300', 'PIPELINE_VERSION_UNKNOWN', 'PRICE_LABEL_AMBIGUOUS']);
    expect(summary.findingsInserted).toBe(7);
    expect(summary.findingsDuplicate).toBe(1);
    expect(summary.perCheck).toEqual({
      PRICE_FROZEN: 1,
      ENTRY_GAP_UNENTERABLE: 1,
      PIPELINE_VERSION_UNKNOWN: 1,
      PRICE_LABEL_AMBIGUOUS: 1,
      CONCLUSION_CUT_AT_300: 1,
      [AUDITED_MARKER]: 2,
    });
  });

  it('każdy wiersz: agent=AUDITOR, source=DETERMINISTIC, status=OPEN, pipelineVersion=null, evidence to obiekt', async () => {
    const { service, store } = build(twoAlerts());
    await service.runOnce();
    for (const r of store.rows) {
      expect(r).toMatchObject({ agent: 'AUDITOR', source: 'DETERMINISTIC', status: 'OPEN', pipelineVersion: null });
      expect(typeof r.evidence).toBe('object');
      expect(['P1', 'P2', 'INFO']).toContain(r.severity);
    }
    const marker = store.rows.find((r) => r.alertId === 2441 && r.checkId === AUDITED_MARKER);
    expect(marker?.evidence).toMatchObject({
      checksRun: expect.arrayContaining(['PRICE_FROZEN', 'ESCAPE_MISSING']),
      findings: ['PRICE_FROZEN'],
      ambiguous: [],
      filingId: 2688,
      tradesInWindow: 33,
    });
    expect(marker?.accessionNumber).toBe('0001104659-26-079643');
  });

  it('idempotencja: ten sam alert drugi raz → wszystko ON CONFLICT (duplikaty), 0 nowych wierszy, brak wyjątku', async () => {
    const { service, store } = build(twoAlerts());
    const first = await service.runOnce();
    const rowsAfterFirst = store.rows.length;
    const second = await service.runOnce(); // mock pending zwraca te same alerty (bez filtra NOT EXISTS)
    expect(second.findingsInserted).toBe(0);
    expect(second.findingsDuplicate).toBe(first.findingsInserted + first.findingsDuplicate);
    expect(store.rows).toHaveLength(rowsAfterFirst);
  });

  it('używa INSERT … orIgnore (ON CONFLICT DO NOTHING), nigdy save/update', async () => {
    const { service, store } = build(twoAlerts());
    await service.runOnce();
    expect(store.chain.insert).toHaveBeenCalled();
    expect(store.chain.orIgnore).toHaveBeenCalledTimes(store.chain.execute.mock.calls.length);
  });

  it('wyjątek agenta przy jednym alercie → errors=1, BEZ markera dla niego, drugi alert przetworzony', async () => {
    const real = new AuditorAgent();
    const failing = {
      name: 'AUDITOR',
      run: (ctx: { alert: { id: number } }) => {
        if (ctx.alert.id === 2441) throw new Error('boom');
        return real.run(ctx as any);
      },
    };
    const { service, store } = build({ ...twoAlerts(), agent: failing });
    const summary = await service.runOnce();
    expect(summary.errors).toBe(1);
    expect(summary.alertsScanned).toBe(2);
    expect(store.rows.some((r) => r.alertId === 2441)).toBe(false);
    expect(store.rows.some((r) => r.alertId === 2479 && r.checkId === AUDITED_MARKER)).toBe(true);
  });

  it('brak filingu i trades (Correlated Signal) → kontekst z filing=null, trades=[], marker zapisany', async () => {
    const corr = { ...alertOf(SEM), id: 9001, ruleName: 'Correlated Signal' };
    const { service, store, filingRepo } = build({ alerts: [corr] });
    const summary = await service.runOnce();
    expect(summary.errors).toBe(0);
    expect(filingRepo.createQueryBuilder).not.toHaveBeenCalled();
    const marker = store.rows.find((r) => r.alertId === 9001 && r.checkId === AUDITED_MARKER);
    expect(marker?.evidence).toMatchObject({ filingId: null, tradesInWindow: 0 });
  });
});

describe('zapytanie o alerty oczekujące', () => {
  it('domyślnie: NOT EXISTS marker, sentAt > 30d, priceOutcomeDone=true, ORDER BY id ASC, LIMIT 50', async () => {
    const { service, alertQb } = build();
    await service.runOnce();
    const [sql, params] = alertQb.where.mock.calls[0] as [string, Record<string, unknown>];
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('agent_findings');
    expect(params).toEqual({ agent: 'AUDITOR', marker: AUDITED_MARKER });
    const andWheres = alertQb.andWhere.mock.calls.map((c: unknown[]) => c[0]);
    expect(andWheres).toEqual(['a.sentAt > :since', 'a.priceOutcomeDone = :done']);
    expect(alertQb.orderBy).toHaveBeenCalledWith('a.id', 'ASC');
    expect(alertQb.take).toHaveBeenCalledWith(50);
  });
  it('AUDITOR_MAX_ALERTS_PER_RUN=20 → LIMIT 20; opcja limit ponad sufit → 500', async () => {
    const a = build({ env: { AUDITOR_MAX_ALERTS_PER_RUN: '20' } });
    await a.service.runOnce();
    expect(a.alertQb.take).toHaveBeenCalledWith(20);
    const b = build();
    await b.service.runOnce({ limit: 10_000 });
    expect(b.alertQb.take).toHaveBeenCalledWith(500);
  });
  it('opcje shadow-run (06): bez outcome/since, ORDER BY id DESC, LIMIT 30', async () => {
    const { service, alertQb } = build();
    await service.runOnce({ limit: 30, requireOutcomeDone: false, sinceDays: null, order: 'DESC' });
    expect(alertQb.andWhere).not.toHaveBeenCalled();
    expect(alertQb.orderBy).toHaveBeenCalledWith('a.id', 'DESC');
    expect(alertQb.take).toHaveBeenCalledWith(30);
  });
  it('alertIds → dodatkowy filtr a.id IN (:...ids); pusta lista = brak zapytania i 0 alertów', async () => {
    const a = build();
    await a.service.runOnce({ alertIds: [2441, 2479], requireOutcomeDone: false, sinceDays: null });
    expect(a.alertQb.andWhere).toHaveBeenCalledWith('a.id IN (:...ids)', { ids: [2441, 2479] });
    const b = build(twoAlerts());
    const summary = await b.service.runOnce({ alertIds: [] });
    expect(summary.alertsScanned).toBe(0);
    expect(b.alertRepo.createQueryBuilder).not.toHaveBeenCalled();
  });
  it('okna kontekstu: filing [sentAt−3d, sentAt] wg formType z reguły, trades [sentAt−14d, sentAt] (daty UTC)', async () => {
    const { service, filingRepo, tradeRepo } = build({ alerts: [alertOf(KURA)] }); // sentAt 2026-08-17T20:47Z
    await service.runOnce();
    const filingQb = filingRepo.createQueryBuilder.mock.results[0].value as Chain;
    expect(filingQb.where).toHaveBeenCalledWith('f.symbol = :symbol', { symbol: 'KURA' });
    expect(filingQb.andWhere).toHaveBeenCalledWith('f.formType = :formType', { formType: '4' });
    expect(filingQb.andWhere).toHaveBeenCalledWith('f.filingDate BETWEEN :from AND :to', { from: '2026-08-14', to: '2026-08-17' });
    const tradeQb = tradeRepo.createQueryBuilder.mock.results[0].value as Chain;
    expect(tradeQb.andWhere).toHaveBeenCalledWith(
      '(t.transactionDate BETWEEN :from AND :to OR t.collectedAt BETWEEN :collectedFrom AND :collectedTo)',
      {
        from: '2026-08-03',
        to: '2026-08-17',
        collectedFrom: new Date('2026-08-17T17:47:19.836823Z'),
        collectedTo: new Date('2026-08-17T20:47:19.836823Z'),
      },
    );
  });
});

describe('współbieżność', () => {
  it('drugi runOnce w trakcie pierwszego → skipped=busy', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { service } = build({ alerts: async () => { await gate; return []; } });
    const first = service.runOnce();
    const second = await service.runOnce();
    expect(second.skipped).toBe('busy');
    release();
    const done = await first;
    expect(done.skipped).toBeNull();
    // po zakończeniu flaga zwolniona
    expect((await service.runOnce()).skipped).toBeNull();
  });
});
