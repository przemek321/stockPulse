/**
 * Testy warstwy deterministycznej audytora (tasks-2026-09-27/03).
 *
 * Fixture REALNE: test/fixtures/auditor/*.json — wiersze alerts/sec_filings/insider_trades z prod
 * (Jetson, 2026-09-29, SELECT row_to_json, bez modyfikacji). `_meta.expectedFindings` = checki per alert,
 * które MUSZĄ odpalić; wszystkie pozostałe muszą milczeć (0 false positives na realnych alertach).
 *
 * Checki bez realnego pozytywu w DB na 29.09 (ALERT_TEXT_TRUNCATED, GPT_CONCLUSION_TRUNCATED,
 * ESCAPE_MISSING, STALE_TEMPLATE_DATE, PREVIOUSLY_ANNOUNCED_8K) mają przypadki SYNTETYCZNE —
 * zbudowane przez mutację kopii realnego fixture, oznaczone `// FIXTURE SYNTETYCZNA`.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AuditContext, FindingDraft } from '../../src/agents/auditor/audit-context';
import type { Alert, InsiderTrade, SecFiling } from '../../src/entities';
import {
  ALERT_CHECKS,
  ENTRY_GAP_THRESHOLD,
  GLOBAL_CHECKS,
  price1hFillTime,
  runAlertChecks,
  runGlobalChecks,
  toNumber,
} from '../../src/agents/auditor/checks';

interface Fixture {
  _meta: { alertId: number; symbol: string; ruleName: string; expectedFindings: string[]; notes: string };
  alert: Record<string, unknown>;
  filing: Record<string, unknown> | null;
  trades: Record<string, unknown>[];
}

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'auditor');
const NOW = new Date('2026-09-29T12:00:00Z');

function loadFixture(file: string): Fixture {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8')) as Fixture;
}

/** Odtwarza hydrację TypeORM: sentAt jako Date; decimal zostają liczbami z row_to_json (stringi testowane osobno). */
function toCtx(fx: Fixture, overrides: Partial<AuditContext> = {}): AuditContext {
  const alert = { ...fx.alert, sentAt: new Date(fx.alert.sentAt as string) } as unknown as Alert;
  return {
    alert,
    filing: fx.filing as unknown as SecFiling | null,
    trades: fx.trades as unknown as InsiderTrade[],
    now: NOW,
    ...overrides,
  };
}

function withAlert(fx: Fixture, patch: Record<string, unknown>): Fixture {
  return { ...fx, alert: { ...fx.alert, ...patch } };
}

function ids(findings: readonly FindingDraft[]): string[] {
  return findings.map((f) => f.checkId).sort();
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

const fixtures = fs
  .readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map(loadFixture);
const byId = (id: number): Fixture => {
  const fx = fixtures.find((f) => f._meta.alertId === id);
  if (fx === undefined) throw new Error(`brak fixture #${id}`);
  return fx;
};

describe('rejestr checków', () => {
  it('10 checków per alert + 3 globalne = 13, unikalne id, poprawny scope', () => {
    expect(ALERT_CHECKS).toHaveLength(10);
    expect(GLOBAL_CHECKS).toHaveLength(3);
    const all = [...ALERT_CHECKS, ...GLOBAL_CHECKS];
    expect(new Set(all.map((c) => c.id)).size).toBe(13);
    expect(ALERT_CHECKS.every((c) => c.scope === 'ALERT')).toBe(true);
    expect(GLOBAL_CHECKS.every((c) => c.scope === 'GLOBAL')).toBe(true);
    expect(all.map((c) => c.id).sort()).toEqual(
      [
        'PRICE_FROZEN',
        'OUTCOME_DONE_EMPTY',
        'CONCLUSION_CUT_AT_300',
        'ENTRY_GAP_UNENTERABLE',
        'ALERT_TEXT_TRUNCATED',
        'GPT_CONCLUSION_TRUNCATED',
        'ESCAPE_MISSING',
        'TRANSACTION_TYPE_MISMATCH',
        'STALE_TEMPLATE_DATE',
        'PREVIOUSLY_ANNOUNCED_8K',
        'POST_CLOSE_8K_ENTRY_PRICE',
        'PRICE_LABEL_AMBIGUOUS',
        'PIPELINE_VERSION_UNKNOWN',
      ].sort(),
    );
  });
});

describe('realne alerty z prod (test/fixtures/auditor)', () => {
  it('8 fixture: VRTX SEM PFE UHS KURA OSCR THC DMRA', () => {
    expect(fixtures.map((f) => f._meta.alertId).sort()).toEqual([2431, 2441, 2471, 2478, 2479, 2505, 2509, 2511]);
  });

  it.each(fixtures.map((fx) => [`${fx._meta.symbol} #${fx._meta.alertId} (${fx._meta.ruleName})`, fx] as const))(
    '%s → dokładnie expectedFindings, 0 AMBIGUOUS',
    (_name, fx) => {
      const out = runAlertChecks(toCtx(fx));
      expect(ids(out.findings)).toEqual([...fx._meta.expectedFindings].sort());
      expect(out.ambiguous).toEqual([]);
      expect(out.checksRun).toHaveLength(10);
      expect(out.checkErrors).toEqual([]);
      for (const f of out.findings) {
        expect(f.alertId).toBe(fx._meta.alertId);
        expect(f.ticker).toBe(fx._meta.symbol);
        expect(f.summary.length).toBeGreaterThan(10);
      }
    },
  );

  it('SEM #2441 PRICE_FROZEN: 5 slotów = 16.51, accessionNumber z 8-K', () => {
    const [f] = runAlertChecks(toCtx(byId(2441))).findings;
    expect(f.checkId).toBe('PRICE_FROZEN');
    expect(f.severity).toBe('P1');
    expect(f.evidence).toMatchObject({ price1h: 16.51, price4h: 16.51, price1d: 16.51, price3d: 16.51, price7d: 16.51 });
    expect(f.accessionNumber).toBe('0001104659-26-079643');
  });

  it('KURA #2479 ENTRY_GAP_UNENTERABLE: gap +10.9% (11.28 → 12.51)', () => {
    const [f] = runAlertChecks(toCtx(byId(2479))).findings;
    expect(f.checkId).toBe('ENTRY_GAP_UNENTERABLE');
    expect(f.evidence.gapPct as number).toBeCloseTo(0.109, 3);
    expect(f.evidence).toMatchObject({ priceAtAlert: 11.28, price1h: 12.51, threshold: ENTRY_GAP_THRESHOLD });
  });

  it('VRTX #2431 TRANSACTION_TYPE_MISMATCH: „Plan 10b5-1: NIE" vs 2 SELL-e Bozic Carmen z is10b51Plan=true', () => {
    const [f] = runAlertChecks(toCtx(byId(2431))).findings;
    expect(f.checkId).toBe('TRANSACTION_TYPE_MISMATCH');
    // alert z 09.06 = sprzed backfillu 10b5-1 (10.06, e17c947) → znany incydent, INFO zamiast P1
    expect(f.severity).toBe('INFO');
    expect(f.evidence).toMatchObject({
      reason: 'PLAN_FLAG_MISMATCH_PRE_BACKFILL',
      insiderName: 'Bozic Carmen',
      expectedType: 'SELL',
      messagePlan: 'NIE',
    });
    expect(f.evidence.candidates).toHaveLength(2);
    // ten sam przypadek po backfillu → P1
    const after = withAlert(byId(2431), { sentAt: '2026-06-11T20:35:23Z' });
    const [g] = runAlertChecks(toCtx(after)).findings.filter((x) => x.checkId === 'TRANSACTION_TYPE_MISMATCH');
    expect(g.severity).toBe('P1');
    expect(g.evidence).toMatchObject({ reason: 'PLAN_FLAG_MISMATCH' });
  });

  it('OSCR #2505 POST_CLOSE_8K_ENTRY_PRICE: 10:05 UTC = 06:05 NY (pre-market, korekta planu)', () => {
    const [f] = runAlertChecks(toCtx(byId(2505))).findings;
    expect(f.checkId).toBe('POST_CLOSE_8K_ENTRY_PRICE');
    expect(String(f.evidence.sentAtNy)).toContain('06:05');
    expect(f.evidence.gapPct as number).toBeCloseTo(-0.0117, 3);
  });

  it('SEM #2441 (13:35 UTC = 09:35 NY, sesja otwarta) NIE odpala POST_CLOSE — kontrprzykład', () => {
    expect(ids(runAlertChecks(toCtx(byId(2441))).findings)).not.toContain('POST_CLOSE_8K_ENTRY_PRICE');
  });

  it('checki globalne: Form 4 (PFE) → PRICE_LABEL_AMBIGUOUS + PIPELINE_VERSION_UNKNOWN; 8-K (UHS, wniosek ucięty na 300 zn.) → CONCLUSION_CUT_AT_300 + PIPELINE_VERSION_UNKNOWN', () => {
    const form4 = runGlobalChecks(toCtx(byId(2471)));
    expect(ids(form4)).toEqual(['PIPELINE_VERSION_UNKNOWN', 'PRICE_LABEL_AMBIGUOUS']);
    for (const f of form4) {
      expect(f.alertId).toBeNull();
      expect(f.ticker).toBeNull();
      expect(f.severity).toBe('INFO');
    }
    const label = form4.find((f) => f.checkId === 'PRICE_LABEL_AMBIGUOUS');
    expect(label?.evidence).toMatchObject({ exampleAlertId: 2471, where: 'src/alerts/telegram/telegram-formatter.service.ts:264' });
    expect(String(label?.evidence.exampleLine)).toContain('akcji @ $998,821');

    const uhs = runGlobalChecks(toCtx(byId(2478)));
    expect(ids(uhs)).toEqual(['CONCLUSION_CUT_AT_300', 'PIPELINE_VERSION_UNKNOWN']);
    const cut = uhs.find((f) => f.checkId === 'CONCLUSION_CUT_AT_300');
    expect(cut?.evidence).toMatchObject({ exampleAlertId: 2478, where: 'src/alerts/telegram/telegram-formatter.service.ts:274,340' });
    expect(String(cut?.evidence.exampleTail)).toContain('prawdopodobnie zareaguje');
    // SEM #2441: wniosek krótszy niż 300 znaków, zakończony kropką → brak CONCLUSION_CUT
    expect(ids(runGlobalChecks(toCtx(byId(2441))))).toEqual(['PIPELINE_VERSION_UNKNOWN']);
  });
});

describe('czystość i determinizm', () => {
  it('checki nie modyfikują zamrożonego kontekstu i dają identyczny wynik przy 2. uruchomieniu', () => {
    for (const fx of fixtures) {
      const ctx = deepFreeze(toCtx(fx));
      const snapshot = JSON.stringify(ctx);
      const first = runAlertChecks(ctx);
      const second = runAlertChecks(ctx);
      expect(JSON.stringify(ctx)).toBe(snapshot);
      expect(second).toEqual(first);
      expect(runGlobalChecks(ctx)).toEqual(runGlobalChecks(ctx));
    }
  });

  it('toNumber: decimal TypeORM jako string, liczby, śmieci', () => {
    expect(toNumber('16.5100')).toBe(16.51);
    expect(toNumber(16.51)).toBe(16.51);
    expect(toNumber('')).toBeNull();
    expect(toNumber('   ')).toBeNull();
    expect(toNumber('abc')).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
    expect(toNumber(Number.NaN)).toBeNull();
  });

  it('PRICE_FROZEN i ENTRY_GAP działają na decimalach hydrowanych jako stringi', () => {
    const frozen = withAlert(byId(2441), {
      priceAtAlert: '16.5100',
      price1h: '16.5100',
      price4h: '16.5100',
      price1d: '16.5100',
      price3d: '16.5100',
      price7d: '16.5100',
    });
    expect(ids(runAlertChecks(toCtx(frozen)).findings)).toContain('PRICE_FROZEN');
    const gap = withAlert(byId(2479), { priceAtAlert: '11.2800', price1h: '12.5100' });
    expect(ids(runAlertChecks(toCtx(gap)).findings)).toContain('ENTRY_GAP_UNENTERABLE');
  });
});

describe('PRICE_FROZEN — granice', () => {
  it('jeden slot null (outcome w toku) → brak findingu', () => {
    const fx = withAlert(byId(2441), { price7d: null });
    expect(ids(runAlertChecks(toCtx(fx)).findings)).not.toContain('PRICE_FROZEN');
  });
  it('sloty różne o 0.01 → brak findingu', () => {
    const fx = withAlert(byId(2441), { price7d: 16.52 });
    expect(ids(runAlertChecks(toCtx(fx)).findings)).not.toContain('PRICE_FROZEN');
  });
});

describe('OUTCOME_DONE_EMPTY', () => {
  it('// FIXTURE SYNTETYCZNA: priceOutcomeDone=true i 5 pustych slotów (hard-timeout po guardzie getQuote) → P2', () => {
    const fx = withAlert(byId(2441), { priceOutcomeDone: true, price1h: null, price4h: null, price1d: null, price3d: null, price7d: null });
    const f = runAlertChecks(toCtx(fx)).findings.find((x) => x.checkId === 'OUTCOME_DONE_EMPTY');
    expect(f?.severity).toBe('P2');
    expect(f?.evidence.emptySlots).toEqual(['price1h', 'price4h', 'price1d', 'price3d', 'price7d']);
    expect(ids(runAlertChecks(toCtx(fx)).findings)).not.toContain('PRICE_FROZEN');
  });
  it('2 puste sloty (weekend) lub outcome w toku (THC #2509) → brak', () => {
    const two = withAlert(byId(2441), { priceOutcomeDone: true, price3d: null, price7d: null });
    expect(ids(runAlertChecks(toCtx(two)).findings)).not.toContain('OUTCOME_DONE_EMPTY');
    expect(ids(runAlertChecks(toCtx(byId(2509))).findings)).not.toContain('OUTCOME_DONE_EMPTY');
  });
});

describe('ENTRY_GAP_UNENTERABLE — granice', () => {
  it('kierunek negative, a kurs poszedł W GÓRĘ → brak (gap liczony w kierunku alertu)', () => {
    const fx = withAlert(byId(2479), { alertDirection: 'negative' });
    expect(ids(runAlertChecks(toCtx(fx)).findings)).not.toContain('ENTRY_GAP_UNENTERABLE');
  });
  it('SHORT: kurs spadł >3% do price1h (PODD-class) → finding z direction=negative', () => {
    // UHS #2478: negative, 170.53 → 175.91 (w górę) = brak; syntetycznie 170.53 → 160.00 (−6.2%) = finding
    expect(ids(runAlertChecks(toCtx(byId(2478))).findings)).not.toContain('ENTRY_GAP_UNENTERABLE');
    const down = withAlert(byId(2478), { price1h: 160 });
    const f = runAlertChecks(toCtx(down)).findings.find((x) => x.checkId === 'ENTRY_GAP_UNENTERABLE');
    expect(f?.evidence).toMatchObject({ direction: 'negative', sentInSession: false });
    expect(f?.evidence.gapPct as number).toBeCloseTo(0.0617, 3);
  });
  it('alert W SESJI po 14:00 NY (ELV #2446: pt 17.07 14:05 NY, +3.8%) → AMBIGUOUS, bo price1h to kurs z poniedziałku 10:00 NY', () => {
    const elv = withAlert(byId(2471), { sentAt: '2026-07-17T18:05:13Z', priceAtAlert: 369.99, price1h: 383.99 });
    const out = runAlertChecks(toCtx(elv));
    expect(out.ambiguous).toContain('ENTRY_GAP_UNENTERABLE');
    expect(ids(out.findings)).not.toContain('ENTRY_GAP_UNENTERABLE');
    expect(price1hFillTime(new Date('2026-07-17T18:05:13Z'))?.toISOString()).toBe('2026-07-20T14:00:00.000Z');
  });
  it('alert w sesji rano (10:05 NY, slot 1h wypełniony o 12:00 NY tej samej sesji) → finding z price1hAt', () => {
    const early = withAlert(byId(2471), { sentAt: '2026-07-17T14:05:00Z', priceAtAlert: 100, price1h: 105 });
    const f = runAlertChecks(toCtx(early)).findings.find((x) => x.checkId === 'ENTRY_GAP_UNENTERABLE');
    expect(f?.evidence).toMatchObject({ sentInSession: true, price1hAt: '2026-07-17T16:00:00.000Z' });
  });
  it('gap <3% w sesji po 15:00 NY → nic (ani finding, ani AMBIGUOUS)', () => {
    const small = withAlert(byId(2471), { sentAt: '2026-07-17T19:35:12Z', priceAtAlert: 100, price1h: 101 });
    const out = runAlertChecks(toCtx(small));
    expect(out.ambiguous).toEqual([]);
    expect(ids(out.findings)).not.toContain('ENTRY_GAP_UNENTERABLE');
  });
  it('gap dokładnie +3% → brak (próg wyłączny), +3.1% → finding', () => {
    const at3 = withAlert(byId(2471), { priceAtAlert: 100, price1h: 103 });
    expect(ids(runAlertChecks(toCtx(at3)).findings)).not.toContain('ENTRY_GAP_UNENTERABLE');
    const over = withAlert(byId(2471), { priceAtAlert: 100, price1h: 103.1 });
    expect(ids(runAlertChecks(toCtx(over)).findings)).toContain('ENTRY_GAP_UNENTERABLE');
  });
  it('brak price1h → brak findingu', () => {
    const fx = withAlert(byId(2479), { price1h: null });
    expect(ids(runAlertChecks(toCtx(fx)).findings)).not.toContain('ENTRY_GAP_UNENTERABLE');
  });
});

describe('ALERT_TEXT_TRUNCATED', () => {
  it('// FIXTURE SYNTETYCZNA: wiadomość DMRA ucięta przed stopką → P2 z ostatnią linią w evidence', () => {
    const original = byId(2511).alert.message as string;
    const cut = original.slice(0, original.lastIndexOf('\n⏰'));
    const fx = withAlert(byId(2511), { message: cut });
    const f = runAlertChecks(toCtx(fx)).findings.find((x) => x.checkId === 'ALERT_TEXT_TRUNCATED');
    expect(f?.severity).toBe('P2');
    expect(String(f?.evidence.lastLine)).not.toContain('⏰');
  });
  it('realny DMRA #2511 (pełna stopka „⏰ 28.09, …") → brak', () => {
    expect(ids(runAlertChecks(toCtx(byId(2511))).findings)).not.toContain('ALERT_TEXT_TRUNCATED');
  });
  it('stopka z trailing newline → brak (trimEnd)', () => {
    const fx = withAlert(byId(2511), { message: `${byId(2511).alert.message as string}\n\n` });
    expect(ids(runAlertChecks(toCtx(fx)).findings)).not.toContain('ALERT_TEXT_TRUNCATED');
  });
});

describe('GPT_CONCLUSION_TRUNCATED', () => {
  const withConclusion = (fx: Fixture, conclusion: unknown): Fixture => ({
    ...fx,
    filing: { ...(fx.filing ?? {}), gptAnalysis: { ...((fx.filing?.gptAnalysis) ?? {}), conclusion } },
  });
  it('// FIXTURE SYNTETYCZNA: conclusion urwana w pół zdania → P2', () => {
    const fx = withConclusion(byId(2478), 'Rynek prawdopodobnie zareaguje');
    const f = runAlertChecks(toCtx(fx)).findings.find((x) => x.checkId === 'GPT_CONCLUSION_TRUNCATED');
    expect(f?.severity).toBe('P2');
    expect(f?.evidence).toMatchObject({ conclusionTail: 'Rynek prawdopodobnie zareaguje', filingId: 3174 });
  });
  it('zakończenia „.", „!", „?", „)" i trailing spacja → brak', () => {
    for (const end of ['Koniec.', 'Koniec!', 'Koniec?', 'Koniec (nawias)', 'Koniec.  ']) {
      expect(ids(runAlertChecks(toCtx(withConclusion(byId(2478), end))).findings)).not.toContain('GPT_CONCLUSION_TRUNCATED');
    }
  });
  it('brak filingu / brak gptAnalysis / conclusion nie-string → brak', () => {
    expect(ids(runAlertChecks(toCtx(byId(2478), { filing: null })).findings)).not.toContain('GPT_CONCLUSION_TRUNCATED');
    const noGpt: Fixture = { ...byId(2478), filing: { ...(byId(2478).filing ?? {}), gptAnalysis: null } };
    expect(ids(runAlertChecks(toCtx(noGpt)).findings)).not.toContain('GPT_CONCLUSION_TRUNCATED');
    expect(ids(runAlertChecks(toCtx(withConclusion(byId(2478), 42))).findings)).not.toContain('GPT_CONCLUSION_TRUNCATED');
  });
});

describe('ESCAPE_MISSING', () => {
  it('// FIXTURE SYNTETYCZNA: bug raportu 8h 02-05.07 — „\\(" zdegradowane do „(" → P1 z próbkami', () => {
    const broken = (byId(2431).alert.message as string).replace('\\(4 transakc', '(4 transakc');
    const f = runAlertChecks(toCtx(withAlert(byId(2431), { message: broken }))).findings.find(
      (x) => x.checkId === 'ESCAPE_MISSING',
    );
    expect(f?.severity).toBe('P1');
    expect(f?.evidence.count).toBe(1);
    expect(f?.evidence.samples).toEqual([expect.objectContaining({ char: '(' })]);
  });
  it('// FIXTURE SYNTETYCZNA: kropka w nazwisku wewnątrz *bold* też musi być zescapowana', () => {
    const msg = (byId(2471).alert.message as string).replace('*BLAYLOCK RONALD E*', '*BLAYLOCK RONALD E.*');
    const f = runAlertChecks(toCtx(withAlert(byId(2471), { message: msg }))).findings.find((x) => x.checkId === 'ESCAPE_MISSING');
    expect(f?.evidence.samples).toEqual([expect.objectContaining({ char: '.' })]);
  });
  it('znaczniki *…* i _…_ same nie są błędem; zescapowane „\\." / „\\-" / „\\|" też nie', () => {
    const fx = withAlert(byId(2471), { message: '*Bold* _italic_ 10b5\\-1 \\| 1\\.5 \\(x\\)\n⏰ 2026\\-09\\-29' });
    expect(ids(runAlertChecks(toCtx(fx)).findings)).not.toContain('ESCAPE_MISSING');
  });
  it('szablon bankructwa z linkiem `[Link do SEC](url)` (formatter:384) → brak (składnia linku, nie brak escapu)', () => {
    // FIXTURE SYNTETYCZNA: rekonstrukcja 1:1 formatBankruptcyAlert (brak realnego alertu 8-K Bankruptcy w DB)
    const msg = [
      '🔴 *StockPulse — CRITICAL*',
      '',
      '⚠️ *WNIOSEK O UPADŁOŚĆ* — \\$XYZ',
      '',
      '📄 *Xyz Therapeutics, Inc\\.* złożyło 8\\-K Item 1\\.03 \\(Upadłość\\)',
      '• Data filingu: 2026\\-09\\-29',
      '• [Link do SEC](https://www.sec.gov/Archives/edgar/data/1234567/000119312526403355/xyz-8k.htm)',
      '',
      '⏰ 29\\.09, 14:05 PL \\(29\\.09, 08:05 NY\\)',
    ].join('\n');
    expect(ids(runAlertChecks(toCtx(withAlert(byId(2478), { message: msg }))).findings)).not.toContain('ESCAPE_MISSING');
  });
  it('niesparowany `*` lub `_` (Telegram: „Can\'t find end of the entity") → P1', () => {
    for (const msg of ['*Bold bez końca\n⏰ x', '• OPTIONS: unusual_options — conviction 0\\.31\n⏰ x']) {
      const f = runAlertChecks(toCtx(withAlert(byId(2471), { message: msg }))).findings.find((x) => x.checkId === 'ESCAPE_MISSING');
      expect(f?.evidence.count).toBe(1);
    }
  });
});

describe('TRANSACTION_TYPE_MISMATCH', () => {
  const trade = (patch: Record<string, unknown>): Record<string, unknown> => ({ ...byId(2479).trades[0], ...patch });

  it('// FIXTURE SYNTETYCZNA: alert BUY, a insider ma w oknie tylko SELL/GRANT → P1 NO_TRADE_OF_TYPE', () => {
    const fx: Fixture = { ...byId(2479), trades: [trade({ transactionType: 'SELL' }), trade({ transactionType: 'GRANT' })] };
    const f = runAlertChecks(toCtx(fx)).findings.find((x) => x.checkId === 'TRANSACTION_TYPE_MISMATCH');
    expect(f?.evidence).toMatchObject({ reason: 'NO_TRADE_OF_TYPE', expectedType: 'BUY', insiderName: 'WILSON TROY EDWARD' });
    expect(f?.summary).toContain('SELL, GRANT');
  });
  it('alert BUY „Plan: NIE", jedyny BUY insidera ma is10b51Plan=true → P1 PLAN_FLAG_MISMATCH', () => {
    const fx: Fixture = { ...byId(2479), trades: [trade({ is10b51Plan: true })] };
    const f = runAlertChecks(toCtx(fx)).findings.find((x) => x.checkId === 'TRANSACTION_TYPE_MISMATCH');
    expect(f?.evidence).toMatchObject({ reason: 'PLAN_FLAG_MISMATCH' });
  });
  it('mieszanka plan=true i plan=false tego samego typu → brak (nie wiadomo, która transakcja wyzwoliła)', () => {
    const fx: Fixture = { ...byId(2479), trades: [trade({ is10b51Plan: true }), trade({ id: 9999, is10b51Plan: false })] };
    expect(ids(runAlertChecks(toCtx(fx)).findings)).not.toContain('TRANSACTION_TYPE_MISMATCH');
  });
  it('brak transakcji tej osoby w oknie (joint filers / inna forma nazwiska) → AMBIGUOUS, nie finding', () => {
    const none = runAlertChecks(toCtx({ ...byId(2479), trades: [] }));
    expect(none.ambiguous).toEqual(['TRANSACTION_TYPE_MISMATCH']);
    expect(ids(none.findings)).not.toContain('TRANSACTION_TYPE_MISMATCH');
    const joint = runAlertChecks(toCtx({ ...byId(2479), trades: [trade({ insiderName: 'WILSON TROY EDWARD; WILSON FAMILY TRUST' })] }));
    expect(joint.ambiguous).toEqual(['TRANSACTION_TYPE_MISMATCH']);
  });
  it('dopasowanie nazwiska: case-insensitive, wielokrotne spacje, escapy MarkdownV2 w nagłówku', () => {
    const fx: Fixture = { ...byId(2479), trades: [trade({ insiderName: 'wilson   troy edward' })] };
    const out = runAlertChecks(toCtx(fx));
    expect(out.ambiguous).toEqual([]);
    expect(ids(out.findings)).not.toContain('TRANSACTION_TYPE_MISMATCH');
    // nagłówek z kropką zescapowaną: `👤 *Frist William H\.*` vs insiderName „Frist William H.”
    const escaped = withAlert(byId(2479), {
      message: (byId(2479).alert.message as string).replace('*WILSON TROY EDWARD*', '*Frist William H\\.*'),
    });
    const out2 = runAlertChecks(toCtx({ ...escaped, trades: [trade({ insiderName: 'Frist William H.' })] }));
    expect(out2.ambiguous).toEqual([]);
  });
  it('bez nagłówka 👤 (szablon nie-Form 4 pod regułą Form 4) → AMBIGUOUS; reguła 8-K → check pomija', () => {
    const noHeader = withAlert(byId(2479), { message: 'cokolwiek\n⏰ x' });
    expect(runAlertChecks(toCtx(noHeader)).ambiguous).toEqual(['TRANSACTION_TYPE_MISMATCH']);
    const eightK = withAlert(byId(2479), { ruleName: '8-K Material Event GPT' });
    expect(runAlertChecks(toCtx(eightK)).ambiguous).toEqual([]);
  });
});

describe('STALE_TEMPLATE_DATE', () => {
  const ping = (sentAt: string): Fixture =>
    // FIXTURE SYNTETYCZNA: ping discovery z szablonową datą przeglądu (realne pingi nie są w alerts — system_logs retencja 7d)
    withAlert(byId(2511), {
      message: '🔭 *Nowa obserwacja* EYE \\(discovery\\) — przegląd okna obs \\~25\\.07\\.2026\n⏰ x',
      sentAt,
    });
  it('data 25.07.2026 w pingu wysłanym 30.08.2026 (36 dni później) → INFO', () => {
    const f = runAlertChecks(toCtx(ping('2026-08-30T12:00:00Z'))).findings.find((x) => x.checkId === 'STALE_TEMPLATE_DATE');
    expect(f?.severity).toBe('INFO');
    expect(f?.evidence).toMatchObject({ templateDate: '2026-07-25', ageDays: 36.5 });
  });
  it('ta sama data w pingu z 10.08.2026 (16 dni) → brak; brak frazy → brak', () => {
    expect(ids(runAlertChecks(toCtx(ping('2026-08-10T12:00:00Z'))).findings)).not.toContain('STALE_TEMPLATE_DATE');
    expect(ids(runAlertChecks(toCtx(byId(2511))).findings)).not.toContain('STALE_TEMPLATE_DATE');
  });
  it('wariant bez „okna obs" i bez tyldy („przegląd 25\\.07\\.2026") też łapany', () => {
    const fx = withAlert(byId(2511), { message: 'przegląd 25\\.07\\.2026\n⏰ x', sentAt: '2026-09-28T11:02:15Z' });
    expect(ids(runAlertChecks(toCtx(fx)).findings)).toContain('STALE_TEMPLATE_DATE');
  });
  it('realny ping discovery BEZ roku („przegląd 25\\.07\\." — form4-discovery.service.ts:572) wysłany 28.09 → INFO, rok z sentAt', () => {
    const real = withAlert(byId(2511), {
      message: '🔭 *Discovery* — nowy ticker w obserwacji: \\$EYE\n_Observation mode — alerty DB\\-only, przegląd 25\\.07\\._',
      sentAt: '2026-09-28T11:02:15Z',
    });
    const f = runAlertChecks(toCtx(real)).findings.find((x) => x.checkId === 'STALE_TEMPLATE_DATE');
    expect(f?.evidence).toMatchObject({ templateDate: '2026-07-25', yearInText: false });
    expect(f?.evidence.ageDays as number).toBeGreaterThan(60);
    // data bez roku „w przyszłości" względem sentAt → poprzedni rok
    const wrap = withAlert(byId(2511), { message: 'przegląd 25\\.12\\.\n⏰ x', sentAt: '2026-02-10T11:02:15Z' }); // 47 dni
    const g = runAlertChecks(toCtx(wrap)).findings.find((x) => x.checkId === 'STALE_TEMPLATE_DATE');
    expect(g?.evidence).toMatchObject({ templateDate: '2025-12-25' });
  });
});

describe('PREVIOUSLY_ANNOUNCED_8K', () => {
  it('// FIXTURE SYNTETYCZNA: fraza w treści alertu 8-K → P2 matchedIn=message', () => {
    const msg = (byId(2478).alert.message as string).replace('Przejęcie Talkspace', 'Previously announced przejęcie Talkspace');
    const f = runAlertChecks(toCtx(withAlert(byId(2478), { message: msg }))).findings.find((x) => x.checkId === 'PREVIOUSLY_ANNOUNCED_8K');
    expect(f?.severity).toBe('P2');
    expect(f?.evidence).toMatchObject({ matchedIn: 'message' });
    expect(String(f?.evidence.snippet)).toContain('Previously announced');
  });
  it('// FIXTURE SYNTETYCZNA: fraza tylko w gptAnalysis.summary → matchedIn=gptAnalysis.summary', () => {
    const base = byId(2478);
    const fx: Fixture = {
      ...base,
      filing: {
        ...(base.filing ?? {}),
        gptAnalysis: { ...(base.filing?.gptAnalysis as Record<string, unknown>), summary: 'UHS completed the previously disclosed acquisition.' },
      },
    };
    const f = runAlertChecks(toCtx(fx)).findings.find((x) => x.checkId === 'PREVIOUSLY_ANNOUNCED_8K');
    expect(f?.evidence).toMatchObject({ matchedIn: 'gptAnalysis.summary' });
  });
  it('polskie warianty w treści GPT („wcześniej ogłoszone", „uprzednio ujawnione") → finding', () => {
    for (const phrase of ['wcześniej ogłoszone przejęcie', 'uprzednio ujawniona umowa', 'już zapowiedziany program']) {
      const msg = (byId(2478).alert.message as string).replace('Przejęcie Talkspace', phrase);
      expect(ids(runAlertChecks(toCtx(withAlert(byId(2478), { message: msg }))).findings)).toContain('PREVIOUSLY_ANNOUNCED_8K');
    }
  });
  it('ta sama fraza pod regułą Form 4 lub bez priceAtAlert → brak', () => {
    const msg = 'previously announced\n⏰ x';
    expect(ids(runAlertChecks(toCtx(withAlert(byId(2479), { message: msg }))).findings)).not.toContain('PREVIOUSLY_ANNOUNCED_8K');
    expect(ids(runAlertChecks(toCtx(withAlert(byId(2478), { message: msg, priceAtAlert: null }))).findings)).not.toContain(
      'PREVIOUSLY_ANNOUNCED_8K',
    );
  });
});

describe('POST_CLOSE_8K_ENTRY_PRICE — granice', () => {
  it('UHS #2478 (delivered) → P2, THC #2509 (stłumiony) → INFO; oba 20:35 UTC = 16:35 NY z sentAtNy i gapPct', () => {
    const uhs = runAlertChecks(toCtx(byId(2478))).findings.find((x) => x.checkId === 'POST_CLOSE_8K_ENTRY_PRICE');
    expect(uhs?.severity).toBe('P2');
    const thc = runAlertChecks(toCtx(byId(2509))).findings.find((x) => x.checkId === 'POST_CLOSE_8K_ENTRY_PRICE');
    expect(thc?.severity).toBe('INFO');
    for (const f of [uhs, thc]) {
      expect(String(f?.evidence.sentAtNy)).toContain('16:35');
      expect(typeof f?.evidence.gapPct).toBe('number');
    }
  });
  it('północ ET w evidence to „00:xx", nie „24:xx" (hourCycle h23)', () => {
    const midnight = withAlert(byId(2478), { sentAt: '2026-09-23T04:05:00Z' }); // 00:05 EDT
    const f = runAlertChecks(toCtx(midnight)).findings.find((x) => x.checkId === 'POST_CLOSE_8K_ENTRY_PRICE');
    expect(String(f?.evidence.sentAtNy)).toContain('00:05');
    expect(String(f?.evidence.sentAtNy)).not.toContain('24:');
  });
  it('8-K bez priceAtAlert → brak; ten sam czas pod regułą Form 4 → brak', () => {
    expect(ids(runAlertChecks(toCtx(withAlert(byId(2478), { priceAtAlert: null }))).findings)).not.toContain('POST_CLOSE_8K_ENTRY_PRICE');
    expect(ids(runAlertChecks(toCtx(withAlert(byId(2478), { ruleName: 'Form 4 Insider BUY' }))).findings)).not.toContain(
      'POST_CLOSE_8K_ENTRY_PRICE',
    );
  });
  it('8-K w sesji (SEM 13:35 UTC, wtorek 01.07) → brak; ten sam alert przesunięty na 20:35 UTC → finding', () => {
    expect(ids(runAlertChecks(toCtx(byId(2441))).findings)).not.toContain('POST_CLOSE_8K_ENTRY_PRICE');
    const late = withAlert(byId(2441), { sentAt: '2026-07-01T20:35:11Z' });
    expect(ids(runAlertChecks(toCtx(late)).findings)).toContain('POST_CLOSE_8K_ENTRY_PRICE');
  });
});
