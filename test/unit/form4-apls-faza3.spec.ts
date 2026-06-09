import {
  Form4Pipeline,
  APLS_MIN_BUY_VALUE,
  APLS_STRICT_TIER,
} from '../../src/sec-filings/pipelines/form4.pipeline';

/**
 * APLS Faza 3 (09.06.2026) — seed observation CONSERVATIVE.
 * Plan: doc/APLS-FAZA-2-RESULTS-2026-05-23.md (checklist pkt 3-4).
 *
 * Kontrakt biotech_apls w Form4Pipeline:
 *   1. Observation gate S19-FIX-03 NIE skipuje biotech_apls przed GPT
 *      (healthcare prompt semantycznie poprawny; okno obs Fazy 4 wymaga
 *      alertów z conviction + priceAtAlert w DB).
 *   2. Tylko BUY >= $500K (SELL: zero edge w V5 i APLS Faza 2 → skip bez GPT).
 *   3. Dispatch z isObservationTicker=true → DB-only, nonDeliveryReason='observation'.
 *   4. storeSignal SKIP dla observation (czysty correlation baseline — analog FIX-03b).
 *   5. Boosty: sector ×1.2 (jak healthcare) + strict tier ×1.1 (URGN/ARDX/MNKD/CRSP).
 *   6. Semi supply chain bez zmian: SKIP_OBSERVATION_TICKER przed GPT (regresja FIX-03).
 */

const GPT_RESPONSE = JSON.stringify({
  price_impact: {
    direction: 'positive',
    magnitude: 'medium',
    confidence: 0.8,
    time_horizon: 'short_term',
  },
  conviction: 1.0,
  summary: 'CEO kupuje discretionary za $600K',
  conclusion: 'Silny sygnał insiderski BUY.',
  key_facts: ['BUY $600K discretionary', 'CEO, brak planu 10b5-1'],
  catalyst_type: 'insider_buy',
  requires_immediate_attention: false,
});

function buildPipelineWithMocks() {
  const mocks = {
    tradeRepo: { findOne: jest.fn(), find: jest.fn().mockResolvedValue([]), save: jest.fn() },
    filingRepo: { findOne: jest.fn().mockResolvedValue(null), save: jest.fn() },
    tickerRepo: { findOne: jest.fn() },
    alertRepo: {
      save: jest.fn(),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((x: any) => x),
    },
    ruleRepo: {
      findOne: jest.fn().mockResolvedValue({
        name: 'Form 4 Insider BUY',
        isActive: true,
        throttleMinutes: 60,
      }),
    },
    azureOpenai: { analyzeCustomPrompt: jest.fn().mockResolvedValue(GPT_RESPONSE) },
    telegram: { sendMarkdown: jest.fn() },
    formatter: { formatForm4GptAlert: jest.fn().mockReturnValue('msg') },
    dailyCap: { canCallGpt: jest.fn().mockResolvedValue(true) },
    correlation: { storeSignal: jest.fn(), schedulePatternCheck: jest.fn() },
    finnhub: { getQuote: jest.fn().mockResolvedValue(5.25) },
    tickerProfile: { getSignalProfile: jest.fn().mockResolvedValue(null) },
    deliveryGate: { canDeliverToTelegram: jest.fn() },
    dispatcher: {
      dispatch: jest.fn().mockResolvedValue({
        delivered: false,
        suppressedBy: 'observation',
        action: 'ALERT_DB_ONLY_OBSERVATION',
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

function aplsTicker(symbol: string) {
  return {
    symbol,
    name: symbol,
    sector: 'biotech_apls',
    observationOnly: true,
    isActive: true,
  };
}

function buyTrade(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 777,
    insiderName: 'Mike Raab',
    insiderRole: 'Chief Executive Officer',
    transactionType: 'BUY',
    shares: 100_000,
    pricePerShare: 6,
    totalValue: 600_000,
    sharesOwnedAfter: 500_000,
    is10b51Plan: false,
    transactionDate: new Date('2026-06-08T14:00:00Z'),
    accessionNumber: '0001437402-26-000099_0',
    ...overrides,
  };
}

function buyPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    tradeId: 777,
    symbol: 'ARDX',
    insiderName: 'Mike Raab',
    insiderRole: 'Chief Executive Officer',
    transactionType: 'BUY',
    totalValue: 600_000,
    shares: 100_000,
    is10b51Plan: false,
    sharesOwnedAfter: 500_000,
    source: 'sec-edgar',
    traceId: 'apls-trace',
    ...overrides,
  } as any;
}

describe('Form4Pipeline — APLS Faza 3 (biotech_apls observation)', () => {
  it('eksportowane stałe zgodne z planem Faza 3', () => {
    expect(APLS_MIN_BUY_VALUE).toBe(500_000);
    expect(APLS_STRICT_TIER).toEqual(['URGN', 'ARDX', 'MNKD', 'CRSP']);
  });

  it('ARDX C-suite BUY $600K → GPT + observation alert w DB, ZERO correlation storeSignal', async () => {
    const { pipeline, mocks } = buildPipelineWithMocks();
    mocks.tradeRepo.findOne.mockResolvedValue(buyTrade());
    mocks.tickerRepo.findOne.mockResolvedValue(aplsTicker('ARDX'));

    const result = await pipeline.onInsiderTrade(buyPayload());

    // Przeszło PRZEZ gate FIX-03 (nie SKIP_OBSERVATION_TICKER) i przez GPT
    expect(result.action).toBe('ALERT_DB_ONLY_OBSERVATION');
    expect(mocks.azureOpenai.analyzeCustomPrompt).toHaveBeenCalledTimes(1);

    // Dispatch z flagą observation (Telegram blokowany w AlertDispatcher)
    expect(mocks.dispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        ticker: 'ARDX',
        ruleName: 'Form 4 Insider BUY',
        isObservationTicker: true,
        isSellNoEdge: false,
      }),
    );

    // Alert w DB: delivered=false + nonDeliveryReason='observation' + priceAtAlert snapshot
    expect(mocks.alertRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'ARDX',
        ruleName: 'Form 4 Insider BUY',
        delivered: false,
        nonDeliveryReason: 'observation',
        alertDirection: 'positive',
        priceAtAlert: 5.25,
      }),
    );

    // Czysty correlation baseline (analog S19-FIX-03b)
    expect(mocks.correlation.storeSignal).not.toHaveBeenCalled();
    expect(mocks.correlation.schedulePatternCheck).not.toHaveBeenCalled();
  });

  it('ARDX strict tier C-suite BUY: conviction ×1.3 (C-suite) ×1.2 (sector) ×1.1 (strict) = 1.716', async () => {
    const { pipeline, mocks } = buildPipelineWithMocks();
    mocks.tradeRepo.findOne.mockResolvedValue(buyTrade());
    mocks.tickerRepo.findOne.mockResolvedValue(aplsTicker('ARDX'));

    await pipeline.onInsiderTrade(buyPayload());

    const analysis = mocks.formatter.formatForm4GptAlert.mock.calls[0][0].analysis;
    expect(analysis.conviction).toBeCloseTo(1.0 * 1.3 * 1.2 * 1.1, 5);
  });

  it('AXSM stretch tier Director BUY: ×1.15 (Director) ×1.2 (sector), BEZ strict ×1.1 = 1.38', async () => {
    const { pipeline, mocks } = buildPipelineWithMocks();
    mocks.tradeRepo.findOne.mockResolvedValue(
      buyTrade({ insiderName: 'Jane Doe', insiderRole: 'Director' }),
    );
    mocks.tickerRepo.findOne.mockResolvedValue(aplsTicker('AXSM'));

    await pipeline.onInsiderTrade(
      buyPayload({ symbol: 'AXSM', insiderName: 'Jane Doe', insiderRole: 'Director' }),
    );

    const analysis = mocks.formatter.formatForm4GptAlert.mock.calls[0][0].analysis;
    expect(analysis.conviction).toBeCloseTo(1.0 * 1.15 * 1.2, 5);
  });

  it('ARDX BUY $300K → SKIP_APLS_BELOW_THRESHOLD bez GPT i bez dispatch', async () => {
    const { pipeline, mocks } = buildPipelineWithMocks();
    mocks.tradeRepo.findOne.mockResolvedValue(buyTrade({ totalValue: 300_000 }));
    mocks.tickerRepo.findOne.mockResolvedValue(aplsTicker('ARDX'));

    const result = await pipeline.onInsiderTrade(buyPayload({ totalValue: 300_000 }));

    expect(result.action).toBe('SKIP_APLS_BELOW_THRESHOLD');
    expect(mocks.azureOpenai.analyzeCustomPrompt).not.toHaveBeenCalled();
    expect(mocks.dispatcher.dispatch).not.toHaveBeenCalled();
    expect(mocks.alertRepo.save).not.toHaveBeenCalled();
    expect(mocks.correlation.storeSignal).not.toHaveBeenCalled();
  });

  it('ARDX C-suite SELL $600K → SKIP_APLS_NON_BUY bez GPT (APLS = BUY only)', async () => {
    const { pipeline, mocks } = buildPipelineWithMocks();
    mocks.tradeRepo.findOne.mockResolvedValue(buyTrade({ transactionType: 'SELL' }));
    mocks.tickerRepo.findOne.mockResolvedValue(aplsTicker('ARDX'));

    const result = await pipeline.onInsiderTrade(buyPayload({ transactionType: 'SELL' }));

    expect(result.action).toBe('SKIP_APLS_NON_BUY');
    expect(mocks.azureOpenai.analyzeCustomPrompt).not.toHaveBeenCalled();
    expect(mocks.dispatcher.dispatch).not.toHaveBeenCalled();
    expect(mocks.alertRepo.save).not.toHaveBeenCalled();
    expect(mocks.correlation.storeSignal).not.toHaveBeenCalled();
  });

  it('regresja S19-FIX-03: semi ticker (MU) BUY $600K → SKIP_OBSERVATION_TICKER PRZED GPT', async () => {
    const { pipeline, mocks } = buildPipelineWithMocks();
    mocks.tradeRepo.findOne.mockResolvedValue(buyTrade());
    mocks.tickerRepo.findOne.mockResolvedValue({
      symbol: 'MU',
      name: 'Micron Technology',
      sector: 'semi_supply_chain',
      observationOnly: true,
      isActive: true,
    });

    const result = await pipeline.onInsiderTrade(buyPayload({ symbol: 'MU' }));

    expect(result.action).toBe('SKIP_OBSERVATION_TICKER');
    expect(mocks.azureOpenai.analyzeCustomPrompt).not.toHaveBeenCalled();
    expect(mocks.dispatcher.dispatch).not.toHaveBeenCalled();
    expect(mocks.alertRepo.save).not.toHaveBeenCalled();
    expect(mocks.correlation.storeSignal).not.toHaveBeenCalled();
  });

  it('healthcare core (PODD) BUY: bez zmian — boost ×1.3 ×1.2, storeSignal WYWOŁANE', async () => {
    const { pipeline, mocks } = buildPipelineWithMocks();
    mocks.dispatcher.dispatch.mockResolvedValue({
      delivered: true,
      suppressedBy: null,
      action: 'ALERT_SENT_TELEGRAM',
    });
    mocks.tradeRepo.findOne.mockResolvedValue(buyTrade());
    mocks.tickerRepo.findOne.mockResolvedValue({
      symbol: 'PODD',
      name: 'Insulet',
      sector: 'healthcare',
      observationOnly: false,
      isActive: true,
    });

    const result = await pipeline.onInsiderTrade(buyPayload({ symbol: 'PODD' }));

    expect(result.action).toBe('ALERT_SENT_TELEGRAM');
    const analysis = mocks.formatter.formatForm4GptAlert.mock.calls[0][0].analysis;
    expect(analysis.conviction).toBeCloseTo(1.0 * 1.3 * 1.2, 5);
    expect(mocks.correlation.storeSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        ticker: 'PODD',
        source_category: 'form4',
        direction: 'positive',
      }),
    );
    expect(mocks.correlation.schedulePatternCheck).toHaveBeenCalledWith('PODD');
  });
});
