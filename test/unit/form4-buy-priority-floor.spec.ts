import {
  Form4Pipeline,
  BUY_PRIORITY_FLOOR_MIN_VALUE,
} from '../../src/sec-filings/pipelines/form4.pipeline';

/**
 * Pakiet 1 fix #1 (09.06.2026) — deterministyczny floor priority dla BUY.
 *
 * Trigger: PODD Weatherman 03.06.2026, Director BUY $497K → GPT magnitude='low',
 * confidence=0.3 → scoreToAlertPriority null → SKIP_LOW_PRIORITY, brak alertu.
 * Bliźniaczy Stonesifer $400K dzień później (magnitude='medium') delivered, +4.3% 3d.
 * LLM zjadł 25% deliverable BUY post-rule. Reguła Form 4 Insider BUY jest
 * backtest-backed (V5 C-suite d=+0.92, Director V4 d=+0.59) — GPT ma wzbogacać
 * treść, nie wetować regułę.
 *
 * Kontrakt:
 *   1. Director BUY >= $100K + GPT null priority → floor MEDIUM, alert idzie dalej.
 *   2. C-suite BUY null priority → HIGH (istniejący floor, pinned).
 *   3. Non-role BUY (10% Owner) null priority → SKIP_LOW_PRIORITY (floor NIE dotyczy).
 *   4. Director BUY z naturalnym priority → bez zmiany (floor tylko gdy null).
 */

// GPT veto scenario: magnitude='low' + confidence=0.3 → scoreForm4Priority zwraca null
// (CRITICAL wymaga absConv>=0.8+conf>=0.6; HIGH wymaga magnitude!=low; MEDIUM wymaga medium)
const GPT_LOW_MAGNITUDE = JSON.stringify({
  price_impact: {
    direction: 'positive',
    magnitude: 'low',
    confidence: 0.3,
    time_horizon: 'short_term',
  },
  conviction: 0.35,
  summary: 'Director kupuje za $497K — GPT ocenia nisko',
  conclusion: 'Umiarkowany sygnał.',
  key_facts: ['BUY $497K discretionary', 'Director'],
  catalyst_type: 'insider_buy',
  requires_immediate_attention: false,
});

const GPT_MEDIUM_MAGNITUDE = JSON.stringify({
  price_impact: {
    direction: 'positive',
    magnitude: 'medium',
    confidence: 0.7,
    time_horizon: 'short_term',
  },
  conviction: 0.5,
  summary: 'Director kupuje — solidny sygnał',
  conclusion: 'Sygnał insiderski BUY.',
  key_facts: ['BUY discretionary', 'Director'],
  catalyst_type: 'insider_buy',
  requires_immediate_attention: false,
});

function buildPipelineWithMocks(gptResponse: string) {
  const mocks = {
    tradeRepo: { findOne: jest.fn(), find: jest.fn().mockResolvedValue([]), save: jest.fn() },
    filingRepo: { findOne: jest.fn().mockResolvedValue(null), save: jest.fn() },
    tickerRepo: {
      findOne: jest.fn().mockResolvedValue({
        symbol: 'PODD',
        sector: 'healthcare',
        observationOnly: false,
        isActive: true,
      }),
    },
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
    azureOpenai: { analyzeCustomPrompt: jest.fn().mockResolvedValue(gptResponse) },
    telegram: { sendMarkdown: jest.fn() },
    formatter: { formatForm4GptAlert: jest.fn().mockReturnValue('msg') },
    dailyCap: { canCallGpt: jest.fn().mockResolvedValue(true) },
    correlation: { storeSignal: jest.fn(), schedulePatternCheck: jest.fn() },
    finnhub: { getQuote: jest.fn().mockResolvedValue(322.5) },
    tickerProfile: { getSignalProfile: jest.fn().mockResolvedValue(null) },
    deliveryGate: { canDeliverToTelegram: jest.fn() },
    dispatcher: {
      dispatch: jest.fn().mockResolvedValue({
        delivered: true,
        suppressedBy: null,
        action: 'ALERT_SENT_TELEGRAM',
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

function weathermanTrade(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 4242,
    insiderName: 'Weatherman Elizabeth',
    insiderRole: 'Director',
    transactionType: 'BUY',
    shares: 1_600,
    pricePerShare: 310.6,
    totalValue: 496_960,
    sharesOwnedAfter: 12_000,
    is10b51Plan: false,
    transactionDate: new Date('2026-06-03T14:00:00Z'),
    accessionNumber: '0001145197-26-000031_0',
    ...overrides,
  };
}

function weathermanPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    tradeId: 4242,
    symbol: 'PODD',
    insiderName: 'Weatherman Elizabeth',
    insiderRole: 'Director',
    transactionType: 'BUY',
    totalValue: 496_960,
    shares: 1_600,
    is10b51Plan: false,
    sharesOwnedAfter: 12_000,
    source: 'sec-edgar',
    traceId: 'floor-trace',
    ...overrides,
  } as any;
}

describe('Form4 BUY priority floor (Pakiet 1 fix #1)', () => {
  it('eksportuje próg $100K (spójny z globalnym entry gate)', () => {
    expect(BUY_PRIORITY_FLOOR_MIN_VALUE).toBe(100_000);
  });

  it('PODD Weatherman replay: Director BUY $497K + GPT magnitude=low → floor MEDIUM, alert dispatched', async () => {
    const { pipeline, mocks } = buildPipelineWithMocks(GPT_LOW_MAGNITUDE);
    mocks.tradeRepo.findOne.mockResolvedValue(weathermanTrade());

    const result = await pipeline.onInsiderTrade(weathermanPayload());

    expect(result.action).not.toBe('SKIP_LOW_PRIORITY');
    expect(mocks.dispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ ticker: 'PODD', ruleName: 'Form 4 Insider BUY' }),
    );
    expect(mocks.alertRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 'MEDIUM', delivered: true }),
    );
  });

  it('C-suite BUY + GPT null priority → HIGH (istniejący floor, bez regresji)', async () => {
    const { pipeline, mocks } = buildPipelineWithMocks(GPT_LOW_MAGNITUDE);
    mocks.tradeRepo.findOne.mockResolvedValue(
      weathermanTrade({ insiderName: 'Smith John', insiderRole: 'Chief Executive Officer' }),
    );

    const result = await pipeline.onInsiderTrade(
      weathermanPayload({ insiderName: 'Smith John', insiderRole: 'Chief Executive Officer' }),
    );

    expect(result.action).not.toBe('SKIP_LOW_PRIORITY');
    expect(mocks.alertRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 'HIGH' }),
    );
  });

  it('non-role BUY (10% Owner) + GPT null priority → SKIP_LOW_PRIORITY (floor nie dotyczy)', async () => {
    const { pipeline, mocks } = buildPipelineWithMocks(GPT_LOW_MAGNITUDE);
    mocks.tradeRepo.findOne.mockResolvedValue(
      weathermanTrade({ insiderName: 'Fund LP', insiderRole: '10% Owner' }),
    );

    const result = await pipeline.onInsiderTrade(
      weathermanPayload({ insiderName: 'Fund LP', insiderRole: '10% Owner' }),
    );

    expect(result.action).toBe('SKIP_LOW_PRIORITY');
    expect(mocks.dispatcher.dispatch).not.toHaveBeenCalled();
    expect(mocks.alertRepo.save).not.toHaveBeenCalled();
  });

  it('Director BUY z naturalnym priority (magnitude=medium) → bez zmiany przez floor', async () => {
    const { pipeline, mocks } = buildPipelineWithMocks(GPT_MEDIUM_MAGNITUDE);
    mocks.tradeRepo.findOne.mockResolvedValue(weathermanTrade());

    const result = await pipeline.onInsiderTrade(weathermanPayload());

    expect(result.action).not.toBe('SKIP_LOW_PRIORITY');
    // conviction 0.5 ×1.15 (Director) ×1.2 (healthcare) = 0.69 → absConv>=0.4 +
    // magnitude=medium + confidence 0.7 → naturalny HIGH (scoreForm4Priority), nie floor
    expect(mocks.alertRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 'HIGH' }),
    );
  });
});
