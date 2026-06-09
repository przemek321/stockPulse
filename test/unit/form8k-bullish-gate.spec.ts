import { Form8kPipeline } from '../../src/sec-filings/pipelines/form8k.pipeline';
import {
  isDocumentedBeat,
  hasFullConsensusData,
} from '../../src/sec-filings/utils/consensus-gap-guard';

/**
 * Pakiet 1 fix #2 (09.06.2026) — bullish 8-K gate → observation.
 *
 * Forward 09.04-08.06: delivered bullish 8-K 0/4 trafień, śr. −4.4% 3d
 * (PODD 2.02, MOH 7.01, HUM 1.01), a SUPPRESSED bullish-z-liczbami 6/9 trafień
 * +2.1%. Gate kluczowany na mainItem (NIE catalystType — MOH Item 7.01 dostał
 * etykietę 'earnings').
 *
 * Kontrakt:
 *   1. Bullish poza 2.02 → isBullish8kGate + reason 'bullish_8k_no_edge'.
 *   2. Bullish 2.02 + udokumentowany beat (R4: oba surprise >= +5%) → DELIVER.
 *   3. Bullish 2.02 bez/partial danych konsensusu → 'bullish_no_consensus_data'.
 *   4. Bullish 2.02 z pełnymi danymi ale nie-beat (low conv escape z FIX-12) → 'bullish_8k_no_edge'.
 *   5. Cap FIX-12 (consensusGapDecision) ma pierwszeństwo — gate nieaktywny.
 *   6. Bearish — nietknięty (zero flag).
 *   7. Gated bullish NIE zasila correlation Redis (anty-backdoor jak FIX-07).
 */

function gptResponse(opts: { direction: string; conviction: number; magnitude?: string; confidence?: number }) {
  return JSON.stringify({
    price_impact: {
      direction: opts.direction,
      magnitude: opts.magnitude ?? 'high',
      confidence: opts.confidence ?? 0.8,
      time_horizon: 'short_term',
    },
    conviction: opts.conviction,
    summary: 'Analiza 8-K',
    conclusion: 'Wniosek z konkretnymi liczbami.',
    key_facts: ['Revenue $13.5B +8.4% YoY', 'EPS $2.79 vs $2.62 konsensus'],
    catalyst_type: 'earnings',
    requires_immediate_attention: false,
  });
}

function fullConsensus(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    isEmpty: false,
    epsActual: 2.79,
    epsEstimate: 2.62,
    epsSurprisePct: 6.5,
    revenueActual: 13_500_000_000,
    revenueEstimate: 12_700_000_000,
    revenueSurprisePct: 6.3,
    analystCount: 20,
    period: '2026-03-31',
    ...overrides,
  } as any;
}

function buildMocks(opts: {
  filingText: string;
  gpt: string;
  consensus?: any | null;
  hasConsensusService?: boolean;
}) {
  const filing: any = {
    id: 300,
    symbol: 'MOH',
    formType: '8-K',
    documentUrl: 'https://www.sec.gov/Archives/edgar/data/1179929/000117992926000033/moh-20260604.htm',
    filingDate: new Date('2026-06-04'),
    gptAnalysis: null,
    priceImpactDirection: null,
  };

  const mocks = {
    filingRepo: { findOne: jest.fn().mockResolvedValue(filing), save: jest.fn() },
    tickerRepo: {
      findOne: jest.fn().mockResolvedValue({
        symbol: 'MOH',
        name: 'Molina Healthcare',
        observationOnly: false,
        sector: 'healthcare',
      }),
    },
    alertRepo: {
      save: jest.fn(),
      create: jest.fn((x: any) => x),
      findOne: jest.fn().mockResolvedValue(null),
    },
    ruleRepo: {
      findOne: jest.fn().mockResolvedValue({
        name: '8-K Material Event GPT',
        isActive: true,
        throttleMinutes: 60,
      }),
    },
    azureOpenai: { analyzeCustomPrompt: jest.fn().mockResolvedValue(opts.gpt) },
    telegram: { sendMarkdown: jest.fn() },
    formatter: { formatForm8kGptAlert: jest.fn().mockReturnValue('msg') },
    dailyCap: { canCallGpt: jest.fn().mockResolvedValue(true) },
    config: { get: jest.fn((_k: string, def?: string) => def ?? '') },
    correlation: { storeSignal: jest.fn(), schedulePatternCheck: jest.fn() },
    finnhub: { getQuote: jest.fn().mockResolvedValue(290.0) },
    tickerProfile: { getSignalProfile: jest.fn().mockResolvedValue(null) },
    deliveryGate: { canDeliverToTelegram: jest.fn() },
    dispatcher: {
      dispatch: jest.fn().mockImplementation(async (p: any) => {
        const suppressedBy = p.isConsensusGap
          ? (p.consensusGapReason ?? 'consensus_gap')
          : p.isBullish8kGate
            ? (p.bullish8kReason ?? 'bullish_8k_no_edge')
            : null;
        return {
          action: suppressedBy ? `ALERT_DB_ONLY_${suppressedBy.toUpperCase()}` : 'ALERT_SENT_TELEGRAM',
          ticker: p.ticker,
          ruleName: p.ruleName,
          channel: suppressedBy ? 'db_only' : 'telegram',
          delivered: !suppressedBy,
          suppressedBy,
        };
      }),
    },
    consensusService:
      opts.hasConsensusService === false
        ? undefined
        : { fetchAndCompare: jest.fn().mockResolvedValue(opts.consensus ?? null) },
  };

  const pipeline = new Form8kPipeline(
    mocks.filingRepo as any,
    mocks.tickerRepo as any,
    mocks.alertRepo as any,
    mocks.ruleRepo as any,
    mocks.azureOpenai as any,
    mocks.telegram as any,
    mocks.formatter as any,
    mocks.dailyCap as any,
    mocks.config as any,
    mocks.correlation as any,
    mocks.finnhub as any,
    mocks.tickerProfile as any,
    mocks.deliveryGate as any,
    mocks.dispatcher as any,
    mocks.consensusService as any,
  );

  jest.spyOn(pipeline as any, 'fetchFilingText').mockResolvedValue(opts.filingText);
  jest.spyOn(pipeline as any, 'fetchExhibit991').mockResolvedValue(null);

  return { pipeline, mocks };
}

const ITEM_701_TEXT =
  'Item 7.01 Regulation FD Disclosure. Molina Healthcare announced reaffirmed guidance and growth outlook. ' +
  'Lorem ipsum '.repeat(30);
const ITEM_202_TEXT =
  'Item 2.02 Results of Operations and Financial Condition. Company reported quarterly results. ' +
  'Lorem ipsum '.repeat(30);
const ITEM_502_TEXT =
  'Item 5.02 Departure of Directors or Certain Officers. CEO resigned effective immediately amid investigation. ' +
  'Lorem ipsum '.repeat(30);

describe('Form8k bullish gate — helpery (Pakiet 1 fix #2)', () => {
  it('isDocumentedBeat: oba surprise >= +5% → true', () => {
    expect(isDocumentedBeat(fullConsensus())).toBe(true);
  });

  it('isDocumentedBeat: jedna metryka < 5% → false', () => {
    expect(isDocumentedBeat(fullConsensus({ revenueSurprisePct: 1.8 }))).toBe(false);
  });

  it('isDocumentedBeat: partial data (rev null) → false', () => {
    expect(isDocumentedBeat(fullConsensus({ revenueSurprisePct: null }))).toBe(false);
  });

  it('isDocumentedBeat: null/empty comp → false', () => {
    expect(isDocumentedBeat(null)).toBe(false);
    expect(isDocumentedBeat({ isEmpty: true } as any)).toBe(false);
  });

  it('hasFullConsensusData: oba znane → true, partial → false, null → false', () => {
    expect(hasFullConsensusData(fullConsensus())).toBe(true);
    expect(hasFullConsensusData(fullConsensus({ epsSurprisePct: null }))).toBe(false);
    expect(hasFullConsensusData(null)).toBe(false);
  });
});

describe('Form8k bullish gate — integracja onFiling (Pakiet 1 fix #2)', () => {
  const payload = { filingId: 300, symbol: 'MOH', formType: '8-K' } as any;

  it('MOH replay: bullish Item 7.01 → gate bullish_8k_no_edge + zero storeSignal', async () => {
    const { pipeline, mocks } = buildMocks({
      filingText: ITEM_701_TEXT,
      gpt: gptResponse({ direction: 'positive', conviction: 1.2 }),
    });

    await pipeline.onFiling(payload);

    expect(mocks.dispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        isBullish8kGate: true,
        bullish8kReason: 'bullish_8k_no_edge',
      }),
    );
    expect(mocks.correlation.storeSignal).not.toHaveBeenCalled();
    expect(mocks.alertRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ delivered: false, nonDeliveryReason: 'bullish_8k_no_edge' }),
    );
  });

  it('bullish Item 2.02 z udokumentowanym beatem (R4) → DELIVER + storeSignal', async () => {
    const { pipeline, mocks } = buildMocks({
      filingText: ITEM_202_TEXT,
      gpt: gptResponse({ direction: 'positive', conviction: 1.2 }),
      consensus: fullConsensus(), // eps +6.5%, rev +6.3% — oba >= +5%
    });

    await pipeline.onFiling(payload);

    expect(mocks.dispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ isBullish8kGate: false, isConsensusGap: false }),
    );
    expect(mocks.correlation.storeSignal).toHaveBeenCalled();
    expect(mocks.alertRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ delivered: true, nonDeliveryReason: null }),
    );
  });

  it('bullish Item 2.02 bez danych konsensusu (service brak) → bullish_no_consensus_data', async () => {
    const { pipeline, mocks } = buildMocks({
      filingText: ITEM_202_TEXT,
      gpt: gptResponse({ direction: 'positive', conviction: 1.2 }),
      hasConsensusService: false,
    });

    await pipeline.onFiling(payload);

    expect(mocks.dispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        isBullish8kGate: true,
        bullish8kReason: 'bullish_no_consensus_data',
      }),
    );
    expect(mocks.correlation.storeSignal).not.toHaveBeenCalled();
  });

  it('bullish Item 2.02 partial consensus (rev null) → bullish_no_consensus_data', async () => {
    const { pipeline, mocks } = buildMocks({
      filingText: ITEM_202_TEXT,
      gpt: gptResponse({ direction: 'positive', conviction: 1.2 }),
      consensus: fullConsensus({ revenueActual: null, revenueEstimate: null, revenueSurprisePct: null }),
    });

    await pipeline.onFiling(payload);

    expect(mocks.dispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        isBullish8kGate: true,
        bullish8kReason: 'bullish_no_consensus_data',
      }),
    );
  });

  it('bullish Item 2.02 in-line low-conviction (escape z FIX-12 R2) → bullish_8k_no_edge', async () => {
    // eps +1%, rev +2% (in-line), conviction 0.4 → R2 wymaga |conv|>0.5, cap NIE
    // zadziała — przed fixem #2 to by poszło na Telegram jako bullish narrative
    const { pipeline, mocks } = buildMocks({
      filingText: ITEM_202_TEXT,
      gpt: gptResponse({ direction: 'positive', conviction: 0.4 }),
      consensus: fullConsensus({ epsSurprisePct: 1.0, revenueSurprisePct: 2.0 }),
    });

    await pipeline.onFiling(payload);

    expect(mocks.dispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        isBullish8kGate: true,
        bullish8kReason: 'bullish_8k_no_edge',
      }),
    );
  });

  it('bullish Item 2.02 z miss (FIX-12 R1 cap) → consensus reason ma pierwszeństwo, gate nieaktywny', async () => {
    const { pipeline, mocks } = buildMocks({
      filingText: ITEM_202_TEXT,
      gpt: gptResponse({ direction: 'positive', conviction: 1.4 }),
      consensus: fullConsensus({ epsSurprisePct: 16.2, revenueSurprisePct: -3.5 }), // PODD case
    });

    await pipeline.onFiling(payload);

    expect(mocks.dispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        isConsensusGap: true,
        consensusGapReason: 'consensus_miss',
        isBullish8kGate: false,
      }),
    );
    expect(mocks.correlation.storeSignal).not.toHaveBeenCalled();
  });

  it('bearish Item 5.02 → zero flag gate, delivered normalnie', async () => {
    const { pipeline, mocks } = buildMocks({
      filingText: ITEM_502_TEXT,
      gpt: gptResponse({ direction: 'negative', conviction: -1.2 }),
    });

    await pipeline.onFiling(payload);

    expect(mocks.dispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ isBullish8kGate: false }),
    );
    expect(mocks.correlation.storeSignal).toHaveBeenCalled();
    expect(mocks.alertRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ delivered: true }),
    );
  });

  it('neutral direction + ujemna conviction → traktowane jako bearish, gate nieaktywny', async () => {
    const { pipeline, mocks } = buildMocks({
      filingText: ITEM_502_TEXT,
      gpt: gptResponse({ direction: 'neutral', conviction: -0.9 }),
    });

    await pipeline.onFiling(payload);

    expect(mocks.dispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ isBullish8kGate: false }),
    );
  });
});

describe('FIX-16 shadow — integracja z pipeline (Pakiet 1 fix #4)', () => {
  const payload = { filingId: 300, symbol: 'HIMS', formType: '8-K' } as any;

  it('HIMS-class: bearish extreme miss z capem → fix16_shadow.would_uncap=true w gptAnalysis', async () => {
    const { pipeline, mocks } = buildMocks({
      filingText: ITEM_202_TEXT,
      gpt: gptResponse({ direction: 'negative', conviction: -1.6 }),
      consensus: fullConsensus({
        epsActual: -0.18,
        epsEstimate: 0.04,
        epsSurprisePct: -507.2,
        revenueSurprisePct: -2.5,
      }),
    });

    await pipeline.onFiling(payload);

    const savedFiling = (mocks.filingRepo.save as jest.Mock).mock.calls.at(-1)?.[0];
    expect(savedFiling.gptAnalysis.fix16_shadow).toMatchObject({
      conviction_precap: -1.6,
      cap_applied: 0.3,
      cap_reason: 'consensus_miss',
      is_extreme_miss: true,
      sign_gate_pass: true,
      would_uncap: true,
      proposed_cap: null,
    });
    // Cap FIX-12 NADAL działa (shadow nie zmienia zachowania)
    expect(savedFiling.gptAnalysis.conviction).toBe(-0.3);
    expect(mocks.correlation.storeSignal).not.toHaveBeenCalled();
  });

  it('PODD-class: bullish miss z capem → shadow zapisany z would_uncap=false', async () => {
    const { pipeline, mocks } = buildMocks({
      filingText: ITEM_202_TEXT,
      gpt: gptResponse({ direction: 'positive', conviction: 1.4 }),
      consensus: fullConsensus({ epsSurprisePct: 16.2, revenueSurprisePct: -3.5 }),
    });

    await pipeline.onFiling(payload);

    const savedFiling = (mocks.filingRepo.save as jest.Mock).mock.calls.at(-1)?.[0];
    expect(savedFiling.gptAnalysis.fix16_shadow).toMatchObject({
      conviction_precap: 1.4,
      would_uncap: false,
      proposed_cap: 0.3,
    });
  });

  it('R4 documented beat (bez capu) → BRAK fix16_shadow w gptAnalysis', async () => {
    const { pipeline, mocks } = buildMocks({
      filingText: ITEM_202_TEXT,
      gpt: gptResponse({ direction: 'positive', conviction: 1.2 }),
      consensus: fullConsensus(), // oba >= +5%, R4 no cap
    });

    await pipeline.onFiling(payload);

    const savedFiling = (mocks.filingRepo.save as jest.Mock).mock.calls.at(-1)?.[0];
    expect(savedFiling.gptAnalysis.fix16_shadow).toBeUndefined();
  });
});
