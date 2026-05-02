/**
 * S19-FIX-07 (02.05.2026): integration test — Form4Pipeline NIE zasila
 * CorrelationService.storeSignal gdy alert został suppressedBy='sell_no_edge'
 * lub 'csuite_sell_no_edge'.
 *
 * Trigger: GILD 29.04.2026 22:05 + 01.05.2026 00:40 — Form4 SELL CRITICAL
 * dispatched DB-only z `sell_no_edge` (Sprint 16b zero-edge gate). ALE
 * `correlation.storeSignal` nadal się odpalał → sygnał trafiał do Redis Sorted Set
 * → INSIDER_PLUS_OPTIONS klaster → Correlated HIGH negative na Telegram.
 * Niewidoczna ścieżka: Form4 alert "blokowany" w UI, ale jego signal aktywny w tle.
 *
 * V5 backtest dowiódł zero edge dla SELL — sygnał nie powinien wpływać na pattern
 * detection. Po fix: BUY (delivered=true) zostaje w Redis bez zmian.
 */

import { Form4Pipeline } from '../../src/sec-filings/pipelines/form4.pipeline';

function buildMocks(opts: {
  transactionType: 'BUY' | 'SELL';
  insiderRole: string;
  dispatchSuppressedBy: string | null;
  isBuy?: boolean;
}) {
  const conviction = opts.transactionType === 'BUY' ? 1.2 : -1.2;
  const direction = conviction >= 0 ? 'positive' : 'negative';

  const gptJson = JSON.stringify({
    price_impact: {
      direction,
      magnitude: 'high',
      confidence: 0.8,
      time_horizon: 'short_term',
    },
    conviction,
    summary: `${opts.transactionType} insider trade`,
    conclusion: `Significant ${opts.transactionType.toLowerCase()} signals direction.`,
    key_facts: ['$1.2M transaction', 'C-suite executive'],
    catalyst_type: 'insider',
    requires_immediate_attention: false,
  });

  const trade = {
    id: 999,
    accessionNumber: null, // pomija filing lookup
    insiderName: 'Test Person',
    insiderRole: opts.insiderRole,
    transactionType: opts.transactionType,
    shares: 10000,
    pricePerShare: 100,
    totalValue: 1_200_000,
    sharesOwnedAfter: 50000,
    is10b51Plan: false,
    transactionDate: new Date('2026-05-01'),
  };

  const ruleName = opts.transactionType === 'BUY' ? 'Form 4 Insider BUY' : 'Form 4 Insider Signal';

  const mocks = {
    tradeRepo: {
      findOne: jest.fn().mockResolvedValue(trade),
      save: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    },
    filingRepo: { findOne: jest.fn(), save: jest.fn() },
    tickerRepo: {
      findOne: jest.fn().mockResolvedValue({
        symbol: 'GILD',
        name: 'Gilead Sciences',
        observationOnly: false,
        sector: 'healthcare',
      }),
    },
    alertRepo: { save: jest.fn(), create: jest.fn().mockReturnValue({}), findOne: jest.fn().mockResolvedValue(null) },
    ruleRepo: { findOne: jest.fn().mockResolvedValue({ name: ruleName, throttleMinutes: 60, isActive: true }) },
    azureOpenai: { analyzeCustomPrompt: jest.fn().mockResolvedValue(gptJson) },
    telegram: { sendMarkdown: jest.fn() },
    formatter: { formatForm4GptAlert: jest.fn().mockReturnValue('mock telegram message') },
    dailyCap: { canCallGpt: jest.fn().mockResolvedValue(true) },
    correlation: { storeSignal: jest.fn(), schedulePatternCheck: jest.fn() },
    finnhub: { getQuote: jest.fn().mockResolvedValue(100) },
    tickerProfile: { getSignalProfile: jest.fn().mockResolvedValue(null) },
    deliveryGate: { canDeliverToTelegram: jest.fn().mockResolvedValue({ allowed: true, count: 0, limit: 5 }) },
    dispatcher: {
      dispatch: jest.fn().mockResolvedValue({
        action: opts.dispatchSuppressedBy
          ? `ALERT_DB_ONLY_${opts.dispatchSuppressedBy.toUpperCase()}`
          : 'ALERT_SENT_TELEGRAM',
        ticker: 'GILD',
        ruleName,
        channel: opts.dispatchSuppressedBy ? 'db_only' : 'telegram',
        delivered: !opts.dispatchSuppressedBy,
        suppressedBy: opts.dispatchSuppressedBy,
      }),
    },
  };

  const pipeline = new Form4Pipeline(
    mocks.tradeRepo as any,
    mocks.filingRepo as any,
    mocks.tickerRepo as any,
    mocks.alertRepo as any,
    mocks.ruleRepo as any,
    mocks.azureOpenai as any,
    mocks.telegram as any,
    mocks.formatter as any,
    mocks.dailyCap as any,
    mocks.correlation as any,
    mocks.finnhub as any,
    mocks.tickerProfile as any,
    mocks.deliveryGate as any,
    mocks.dispatcher as any,
  );

  return { pipeline, mocks };
}

describe('Form4Pipeline — sell_no_edge correlation backdoor (S19-FIX-07)', () => {
  it('GILD CEO SELL → suppressedBy=sell_no_edge → correlation.storeSignal NIE wywołane', async () => {
    const { pipeline, mocks } = buildMocks({
      transactionType: 'SELL',
      insiderRole: "Chairman & CEO, Director",
      dispatchSuppressedBy: 'sell_no_edge',
    });

    const result = await pipeline.onInsiderTrade({
      tradeId: 999,
      symbol: 'GILD',
      insiderName: "O'Day Daniel Patrick",
      insiderRole: 'Chairman & CEO, Director',
      transactionType: 'SELL',
      totalValue: 1_291_608,
      shares: 10000,
      is10b51Plan: false,
      sharesOwnedAfter: 635617,
      source: 'sec-edgar',
      traceId: 'gild-sell-trace',
    });

    expect(result.action).toBe('ALERT_DB_ONLY_SELL_NO_EDGE');

    // Krytyczne: zero correlation footprint mimo że trade dotarł do dispatch
    expect(mocks.correlation.storeSignal).not.toHaveBeenCalled();
    expect(mocks.correlation.schedulePatternCheck).not.toHaveBeenCalled();

    // Sanity: dispatcher był wywołany z isSellNoEdge=true (dowodzi że doszliśmy do kroku 8)
    expect(mocks.dispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        ticker: 'GILD',
        isSellNoEdge: true,
      }),
    );

    // Alert i tak zapisany w DB (dla forward analysis / archived view)
    expect(mocks.alertRepo.save).toHaveBeenCalled();
  });

  it('csuite_sell_no_edge suppression → correlation.storeSignal NIE wywołane', async () => {
    const { pipeline, mocks } = buildMocks({
      transactionType: 'SELL',
      insiderRole: 'Chief Executive Officer',
      dispatchSuppressedBy: 'csuite_sell_no_edge',
    });

    await pipeline.onInsiderTrade({
      tradeId: 999,
      symbol: 'GILD',
      insiderName: 'Test CEO',
      insiderRole: 'Chief Executive Officer',
      transactionType: 'SELL',
      totalValue: 500_000,
      shares: 5000,
      is10b51Plan: false,
      sharesOwnedAfter: 100_000,
      source: 'sec-edgar',
    });

    expect(mocks.correlation.storeSignal).not.toHaveBeenCalled();
    expect(mocks.correlation.schedulePatternCheck).not.toHaveBeenCalled();
  });

  it('Form4 BUY delivered (no suppression) → correlation.storeSignal WYWOŁANE (sanity)', async () => {
    const { pipeline, mocks } = buildMocks({
      transactionType: 'BUY',
      insiderRole: 'Chief Executive Officer',
      dispatchSuppressedBy: null,
    });

    const result = await pipeline.onInsiderTrade({
      tradeId: 999,
      symbol: 'GILD',
      insiderName: 'Test CEO',
      insiderRole: 'Chief Executive Officer',
      transactionType: 'BUY',
      totalValue: 1_000_000,
      shares: 10000,
      is10b51Plan: false,
      sharesOwnedAfter: 200_000,
      source: 'sec-edgar',
    });

    expect(result.action).toBe('ALERT_SENT_TELEGRAM');
    expect(mocks.correlation.storeSignal).toHaveBeenCalled();
    expect(mocks.correlation.schedulePatternCheck).toHaveBeenCalled();

    // Verify signal payload
    const signalArg = mocks.correlation.storeSignal.mock.calls[0][0];
    expect(signalArg.source_category).toBe('form4');
    expect(signalArg.direction).toBe('positive');
    expect(signalArg.ticker).toBe('GILD');
  });

  it('Form4 BUY z innym suppression (np. daily_limit) → storeSignal NADAL wywołane (BUY edge ważny)', async () => {
    const { pipeline, mocks } = buildMocks({
      transactionType: 'BUY',
      insiderRole: 'Chief Executive Officer',
      dispatchSuppressedBy: 'daily_limit',
    });

    await pipeline.onInsiderTrade({
      tradeId: 999,
      symbol: 'GILD',
      insiderName: 'Test CEO',
      insiderRole: 'Chief Executive Officer',
      transactionType: 'BUY',
      totalValue: 1_000_000,
      shares: 10000,
      is10b51Plan: false,
      sharesOwnedAfter: 200_000,
      source: 'sec-edgar',
    });

    // BUY zawsze powinien zasilać Redis — V5 backtest C-suite BUY 7d d=+0.92 ✓✓✓
    // Daily limit to bariera Telegram, nie sygnał korelacyjny.
    expect(mocks.correlation.storeSignal).toHaveBeenCalled();
  });
});
