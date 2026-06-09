import { Form4Pipeline } from '../../src/sec-filings/pipelines/form4.pipeline';

/**
 * Pakiet 2 (10.06.2026) — sector='healthcare_discovery' w Form4Pipeline.
 *
 * Kontrakt (lustro biotech_apls z Fazy 3):
 *   1. Observation gate NIE skipuje discovery przed GPT (okno obs wymaga
 *      conviction + priceAtAlert w DB do top-N delivery ~25.07).
 *   2. Tylko BUY >= $500K (SELL → SKIP_DISCOVERY_NON_BUY; defense in depth —
 *      collector pre-filtruje, ale KOLEJNE filingi zarejestrowanego tickera
 *      lecą standardowym flow).
 *   3. Dispatch isObservationTicker=true → DB-only 'observation'.
 *   4. storeSignal SKIP (zero correlation legs dla discovered — plan §2.P2).
 *   5. Sector boost ×1.2 (SIC healthcare z definicji).
 */

const GPT_RESPONSE = JSON.stringify({
  price_impact: {
    direction: 'positive',
    magnitude: 'medium',
    confidence: 0.8,
    time_horizon: 'short_term',
  },
  conviction: 1.0,
  summary: 'CEO kupuje discretionary za $800K',
  conclusion: 'Silny sygnał insiderski BUY.',
  key_facts: ['BUY $800K discretionary', 'CEO, brak planu 10b5-1'],
  catalyst_type: 'insider_buy',
  requires_immediate_attention: false,
});

function buildPipelineWithMocks() {
  const mocks = {
    tradeRepo: { findOne: jest.fn(), find: jest.fn().mockResolvedValue([]), save: jest.fn() },
    filingRepo: { findOne: jest.fn().mockResolvedValue(null), save: jest.fn() },
    tickerRepo: {
      findOne: jest.fn().mockResolvedValue({
        symbol: 'TSTX',
        name: 'Test Pharma',
        sector: 'healthcare_discovery',
        observationOnly: true,
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
    azureOpenai: { analyzeCustomPrompt: jest.fn().mockResolvedValue(GPT_RESPONSE) },
    telegram: { sendMarkdown: jest.fn() },
    formatter: { formatForm4GptAlert: jest.fn().mockReturnValue('msg') },
    dailyCap: { canCallGpt: jest.fn().mockResolvedValue(true) },
    correlation: { storeSignal: jest.fn(), schedulePatternCheck: jest.fn() },
    finnhub: { getQuote: jest.fn().mockResolvedValue(42.0) },
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

function buyTrade(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 888,
    insiderName: 'Smith John',
    insiderRole: 'Chief Executive Officer',
    transactionType: 'BUY',
    shares: 20_000,
    pricePerShare: 40,
    totalValue: 800_000,
    sharesOwnedAfter: 120_000,
    is10b51Plan: false,
    transactionDate: new Date('2026-06-09T18:00:00Z'),
    accessionNumber: '0001437749-26-019964_0',
    ...overrides,
  };
}

function buyPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    tradeId: 888,
    symbol: 'TSTX',
    insiderName: 'Smith John',
    insiderRole: 'Chief Executive Officer',
    transactionType: 'BUY',
    totalValue: 800_000,
    shares: 20_000,
    is10b51Plan: false,
    sharesOwnedAfter: 120_000,
    source: 'SEC_EDGAR',
    traceId: 'disc-trace',
    ...overrides,
  } as any;
}

describe('Form4Pipeline — healthcare_discovery (Pakiet 2)', () => {
  it('discovery CEO BUY $800K → GPT + dispatch observation + alert DB-only + ZERO storeSignal', async () => {
    const { pipeline, mocks } = buildPipelineWithMocks();
    mocks.tradeRepo.findOne.mockResolvedValue(buyTrade());

    const result = await pipeline.onInsiderTrade(buyPayload());

    expect(result.action).not.toBe('SKIP_OBSERVATION_TICKER');
    expect(mocks.azureOpenai.analyzeCustomPrompt).toHaveBeenCalled();
    expect(mocks.dispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ isObservationTicker: true, isSellNoEdge: false }),
    );
    expect(mocks.alertRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ delivered: false, nonDeliveryReason: 'observation' }),
    );
    // Plan §2.P2: bez nóg korelacji dla discovered tickerów
    expect(mocks.correlation.storeSignal).not.toHaveBeenCalled();
    expect(mocks.correlation.schedulePatternCheck).not.toHaveBeenCalled();
  });

  it('boost: conviction 1.0 ×1.3 (C-suite) ×1.2 (sector discovery) = 1.56', async () => {
    const { pipeline, mocks } = buildPipelineWithMocks();
    mocks.tradeRepo.findOne.mockResolvedValue(buyTrade());
    mocks.filingRepo.findOne.mockResolvedValue({
      accessionNumber: '0001437749-26-019964',
      gptAnalysis: null,
      priceImpactDirection: null,
    });

    await pipeline.onInsiderTrade(buyPayload());

    const savedFiling = (mocks.filingRepo.save as jest.Mock).mock.calls.at(-1)?.[0];
    expect(savedFiling?.gptAnalysis?.conviction).toBeCloseTo(1.56, 2);
  });

  it('discovery SELL → SKIP_DISCOVERY_NON_BUY bez GPT', async () => {
    const { pipeline, mocks } = buildPipelineWithMocks();
    mocks.tradeRepo.findOne.mockResolvedValue(buyTrade({ transactionType: 'SELL' }));

    const result = await pipeline.onInsiderTrade(
      buyPayload({ transactionType: 'SELL' }),
    );

    expect(result.action).toBe('SKIP_DISCOVERY_NON_BUY');
    expect(mocks.azureOpenai.analyzeCustomPrompt).not.toHaveBeenCalled();
  });

  it('discovery BUY $300K < $500K → SKIP_DISCOVERY_BELOW_THRESHOLD bez GPT', async () => {
    const { pipeline, mocks } = buildPipelineWithMocks();
    mocks.tradeRepo.findOne.mockResolvedValue(buyTrade({ totalValue: 300_000 }));

    const result = await pipeline.onInsiderTrade(
      buyPayload({ totalValue: 300_000 }),
    );

    expect(result.action).toBe('SKIP_DISCOVERY_BELOW_THRESHOLD');
    expect(mocks.azureOpenai.analyzeCustomPrompt).not.toHaveBeenCalled();
  });

  it('po PROMOCJI (observationOnly=false, delivered): storeSignal NADAL skip — klucz na sektorze', async () => {
    // Plan §2.P2: "bez nóg korelacji dla odkrytych tickerów" obowiązuje też po
    // przyszłej promocji do delivery. Skip kluczowany na suppressedBy='observation'
    // cicho przywróciłby INSIDER_PLUS_8K (weryfikacja 10.06).
    const { pipeline, mocks } = buildPipelineWithMocks();
    mocks.tradeRepo.findOne.mockResolvedValue(buyTrade());
    mocks.tickerRepo.findOne.mockResolvedValue({
      symbol: 'TSTX',
      sector: 'healthcare_discovery',
      observationOnly: false, // promowany
      isActive: true,
    });
    mocks.dispatcher.dispatch.mockResolvedValue({
      delivered: true,
      suppressedBy: null,
      action: 'ALERT_SENT_TELEGRAM',
    });

    await pipeline.onInsiderTrade(buyPayload());

    expect(mocks.correlation.storeSignal).not.toHaveBeenCalled();
    expect(mocks.alertRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ delivered: true }),
    );
  });

  it('regresja: semi ticker (observationOnly, inny sektor) → nadal SKIP przed GPT', async () => {
    const { pipeline, mocks } = buildPipelineWithMocks();
    mocks.tradeRepo.findOne.mockResolvedValue(buyTrade({ totalValue: 900_000 }));
    mocks.tickerRepo.findOne.mockResolvedValue({
      symbol: 'MU',
      sector: 'semi_supply_chain',
      observationOnly: true,
      isActive: true,
    });

    const result = await pipeline.onInsiderTrade(
      buyPayload({ symbol: 'MU', totalValue: 900_000 }),
    );

    expect(result.action).toBe('SKIP_OBSERVATION_TICKER');
    expect(mocks.azureOpenai.analyzeCustomPrompt).not.toHaveBeenCalled();
  });
});
