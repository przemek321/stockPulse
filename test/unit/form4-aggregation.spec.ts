/**
 * Testy logiki TASK-03 (22.04.2026): multi-transaction Form 4 aggregation.
 *
 * Collector (sec-edgar.service.ts) po sparsowaniu filing'u grupuje transakcje
 * po (insiderName, transactionType, is10b51Plan) i emituje JEDEN event
 * per grupa z aggregate totalValue/shares + aggregateCount + aggregateTradeIds.
 *
 * Pipeline (form4.pipeline.ts) używa aggregate values w GPT prompt i telegram
 * message. Single-trade filings: brak aggregate fields = backward compat.
 *
 * Bezpośrednie testy `parseAndSaveForm4` wymagałyby mockowania DB + EventEmitter
 * (heavy). Tutaj testujemy LOGIKĘ grupowania jako czystą funkcję, zgodnie
 * z konwencją z form4-pipeline-rules.spec.ts.
 */

import { buildForm4Prompt, Form4PromptData } from '../../src/sec-filings/prompts/form4.prompt';

interface MockTxn {
  id: number;
  insiderName: string;
  transactionType: string;
  is10b51Plan: boolean;
  totalValue: number;
  shares: number;
}

// Replikacja grupowania z sec-edgar.service.ts parseAndSaveForm4.
function groupTxns(txns: MockTxn[]): Array<{
  primaryId: number;
  tradeIds: number[];
  aggregateValue: number;
  aggregateShares: number;
  insiderName: string;
  transactionType: string;
  is10b51Plan: boolean;
}> {
  const groups = new Map<string, MockTxn[]>();
  for (const t of txns) {
    const key = `${t.insiderName}::${t.transactionType}::${t.is10b51Plan ? 1 : 0}`;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }
  const result: ReturnType<typeof groupTxns> = [];
  for (const group of groups.values()) {
    const primary = group[0];
    result.push({
      primaryId: primary.id,
      tradeIds: group.map(t => t.id),
      aggregateValue: group.reduce((s, t) => s + t.totalValue, 0),
      aggregateShares: group.reduce((s, t) => s + t.shares, 0),
      insiderName: primary.insiderName,
      transactionType: primary.transactionType,
      is10b51Plan: primary.is10b51Plan,
    });
  }
  return result;
}

describe('TASK-03 — multi-transaction Form 4 grouping', () => {
  it('ASX case 22.04.2026: 4 SELL od Chen Tien-Szu → 1 grupa aggregate $247M', () => {
    const txns: MockTxn[] = [
      { id: 2309, insiderName: 'Chen Tien-Szu', transactionType: 'SELL', is10b51Plan: false, totalValue: 152_554_997, shares: 328_000 },
      { id: 2310, insiderName: 'Chen Tien-Szu', transactionType: 'SELL', is10b51Plan: false, totalValue: 33_552_000, shares: 72_000 },
      { id: 2311, insiderName: 'Chen Tien-Szu', transactionType: 'SELL', is10b51Plan: false, totalValue: 23_350_000, shares: 50_000 },
      { id: 2312, insiderName: 'Chen Tien-Szu', transactionType: 'SELL', is10b51Plan: false, totalValue: 37_680_000, shares: 80_000 },
    ];
    const groups = groupTxns(txns);
    expect(groups).toHaveLength(1);
    expect(groups[0].primaryId).toBe(2309);
    expect(groups[0].tradeIds).toEqual([2309, 2310, 2311, 2312]);
    expect(groups[0].aggregateValue).toBe(247_136_997);
    expect(groups[0].aggregateShares).toBe(530_000);
  });

  it('single trade filing → 1 grupa size 1 (backward compat)', () => {
    const txns: MockTxn[] = [
      { id: 100, insiderName: 'Jane CEO', transactionType: 'BUY', is10b51Plan: false, totalValue: 500_000, shares: 5000 },
    ];
    const groups = groupTxns(txns);
    expect(groups).toHaveLength(1);
    expect(groups[0].aggregateValue).toBe(500_000);
    expect(groups[0].tradeIds).toEqual([100]);
  });

  it('różni insiderzy w tym samym filing → osobne grupy', () => {
    const txns: MockTxn[] = [
      { id: 1, insiderName: 'CEO A', transactionType: 'BUY', is10b51Plan: false, totalValue: 100_000, shares: 1000 },
      { id: 2, insiderName: 'CFO B', transactionType: 'BUY', is10b51Plan: false, totalValue: 200_000, shares: 2000 },
    ];
    const groups = groupTxns(txns);
    expect(groups).toHaveLength(2);
    expect(groups.map(g => g.insiderName).sort()).toEqual(['CEO A', 'CFO B']);
  });

  it('ten sam insider, różne typy (BUY + SELL) → osobne grupy', () => {
    // Np. exercise option (EXERCISE) + sell (SELL) w jednym Form 4 — różny sygnał
    const txns: MockTxn[] = [
      { id: 1, insiderName: 'John CEO', transactionType: 'EXERCISE', is10b51Plan: false, totalValue: 1_000_000, shares: 10_000 },
      { id: 2, insiderName: 'John CEO', transactionType: 'SELL', is10b51Plan: false, totalValue: 2_000_000, shares: 20_000 },
    ];
    const groups = groupTxns(txns);
    expect(groups).toHaveLength(2);
    const types = groups.map(g => g.transactionType).sort();
    expect(types).toEqual(['EXERCISE', 'SELL']);
  });

  it('ten sam insider, SELL plan + SELL discretionary → osobne grupy (is10b51Plan w kluczu)', () => {
    // Pipeline skipuje planowe (SKIP_10B51_PLAN) — mieszanie z discretionary by kasowało
    // sygnał rzeczywisty. Osobne grupy.
    const txns: MockTxn[] = [
      { id: 1, insiderName: 'CEO', transactionType: 'SELL', is10b51Plan: true, totalValue: 1_000_000, shares: 1000 },
      { id: 2, insiderName: 'CEO', transactionType: 'SELL', is10b51Plan: false, totalValue: 5_000_000, shares: 5000 },
    ];
    const groups = groupTxns(txns);
    expect(groups).toHaveLength(2);
    const plans = groups.map(g => g.is10b51Plan).sort();
    expect(plans).toEqual([false, true]);
  });

  it('primary = pierwsza transakcja w grupie (input order)', () => {
    const txns: MockTxn[] = [
      { id: 99, insiderName: 'A', transactionType: 'BUY', is10b51Plan: false, totalValue: 100, shares: 1 },
      { id: 50, insiderName: 'A', transactionType: 'BUY', is10b51Plan: false, totalValue: 200, shares: 2 },
    ];
    const groups = groupTxns(txns);
    expect(groups[0].primaryId).toBe(99); // pierwsza w input (współgra z save-order w kolektorze)
  });

  it('pusty input → 0 grup', () => {
    expect(groupTxns([])).toHaveLength(0);
  });
});

describe('TASK-03 — buildForm4Prompt aggregate note', () => {
  const baseParsed: Form4PromptData = {
    insiderName: 'Chen Tien-Szu',
    insiderRole: 'CEO',
    transactionType: 'SELL',
    shares: 530_000,
    pricePerShare: 466.29,
    totalValue: 247_136_997,
    sharesOwnedAfter: 2_000_000,
    is10b51Plan: false,
    transactionDate: '2026-04-22T10:35:00.000Z',
  };

  it('aggregateCount=4 → prompt zawiera AGGREGATED note', () => {
    const prompt = buildForm4Prompt('ASX', 'ASE Technology Holding', { ...baseParsed, aggregateCount: 4 }, []);
    expect(prompt).toContain('AGGREGATED: 4 fills');
    expect(prompt).toContain('Split-fill execution');
    expect(prompt).toContain('market impact management');
  });

  it('aggregateCount=1 → prompt BEZ AGGREGATED note (backward compat)', () => {
    const prompt = buildForm4Prompt('ASX', 'ASE Technology Holding', { ...baseParsed, aggregateCount: 1 }, []);
    expect(prompt).not.toContain('AGGREGATED:');
  });

  it('aggregateCount=undefined (single trade) → BEZ AGGREGATED note', () => {
    const prompt = buildForm4Prompt('ASX', 'ASE Technology Holding', baseParsed, []);
    expect(prompt).not.toContain('AGGREGATED:');
  });

  it('aggregateCount=2 (minimum multi) → prompt ZAWIERA note', () => {
    const prompt = buildForm4Prompt('ASX', 'ASE', { ...baseParsed, aggregateCount: 2 }, []);
    expect(prompt).toContain('AGGREGATED: 2 fills');
  });

  it('aggregate values w prompt (Total value używa aggregate shares/totalValue)', () => {
    const prompt = buildForm4Prompt('ASX', 'ASE', { ...baseParsed, aggregateCount: 4 }, []);
    expect(prompt).toContain('530,000'); // shares
    expect(prompt).toContain('247,136,997'); // total value
  });
});
