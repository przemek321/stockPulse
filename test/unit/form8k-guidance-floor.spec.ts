/**
 * S19-FIX-02: integration test — Form8kPipeline floor enforcement gdy filing
 * zawiera affirmation guidance ale GPT zwraca bear conviction.
 *
 * Trigger: HUM 29.04.2026 — release "Affirms Full Year Adjusted Guidance" ale
 * GPT zhalucynował guidance lowered + conviction=-1.6. FIX-01 zablokował alert
 * przez missing-data guard. FIX-02 zamyka kolejny gap: nawet jeśli GPT NIE
 * deklaruje braku danych ale HALUCYNUJE bear pomimo affirms keyword w prompt,
 * floor -0.3 deterministycznie capuje conviction.
 *
 * Test scenario: filing text ZAWIERA "Affirms Full Year 2026 Adjusted
 * Guidance", GPT zwraca pełne key_facts z liczbami (NO missing-data trigger
 * for FIX-01), ale conviction=-1.4 negative — floor enforcement powinien
 * zredukować do -0.3.
 */

import { Form8kPipeline } from '../../src/sec-filings/pipelines/form8k.pipeline';

jest.mock('../../src/sec-filings/parsers/form8k.parser', () => ({
  detectItems: jest.fn(() => ['2.02']),
  extractItemText: jest.fn((text: string) => text.slice(0, 4000)),
  selectPromptBuilder: jest.fn(() => (
    _ticker: string,
    _company: string,
    _text: string,
    _item?: string,
    _profile?: string | null,
    extractedFacts?: string | null,
  ) => `mock prompt with extracted: ${extractedFacts ?? 'NONE'}`),
  isBankruptcyItem: jest.fn(() => false),
  stripHtml: jest.fn((html: string) => html),
}));

const HUM_FILING_TEXT = `
HUMANA INC. ANNOUNCES FIRST QUARTER 2026 RESULTS.
Affirms Full Year 2026 Adjusted Financial Guidance of at least $9.00 Adjusted EPS.

LOUISVILLE, Ky.--(BUSINESS WIRE)-- Humana Inc. (NYSE: HUM) today announced
financial results for the quarter ended March 31, 2026.

Q1 2026 Highlights:
- GAAP EPS of $9.43, Adjusted EPS of $10.31
- Revenue of $32.5B, up 8% year-over-year
- Medical Loss Ratio: 89.4%, in line with management guidance of "just under 90%"
- Medicare Advantage membership growth: ~25% YoY

Full Year 2026 Outlook:
- Affirms Adjusted EPS guidance: at least $9.00
- Affirms benefit ratio guidance: 92.75% +/- 25 bps
- Affirms MA membership growth: ~25%
- Lowers GAAP EPS guidance to "at least $8.36" from "at least $8.89" due to
  non-cash adjustments and one-time items.
`.repeat(2); // żeby tekst > 100 znaków

const GPT_BEAR_RESPONSE = JSON.stringify({
  summary: 'Humana raportuje EPS Q1 z wynikiem mieszanym, MLR podwyższony.',
  key_facts: [
    'Adjusted EPS Q1: $10.31 vs konsensus $9.97',
    'GAAP EPS guidance lowered from $8.89 to $8.36',
    'MLR Q1: 89.4%',
    'MA membership growth ~25%',
  ],
  conclusion: 'Mieszane wyniki z presją na MLR i obniżonym GAAP guidance sugerują negatywny wpływ.',
  conviction: -1.4,
  price_impact: {
    direction: 'negative',
    magnitude: 'high',
    confidence: 0.75,
    time_horizon: 'immediate',
  },
  catalyst_type: 'earnings',
  requires_immediate_attention: true,
});

describe('Form8kPipeline integration — HUM 29.04.2026 guidance floor (S19-FIX-02)', () => {
  function buildPipelineWithMocks(opts: { filingText?: string; gptResponse?: string } = {}) {
    const filing: any = {
      id: 9999,
      symbol: 'HUM',
      formType: '8-K',
      documentUrl: 'https://example.com/hum-fake',
      filingDate: new Date('2026-04-29'),
      gptAnalysis: null,
      priceImpactDirection: null,
    };

    const dispatchMock = jest.fn().mockImplementation(async (params: any) => ({
      action: 'ALERT_SENT_TELEGRAM',
      ticker: params.ticker,
      ruleName: params.ruleName,
      traceId: params.traceId,
      channel: 'telegram',
      delivered: true,
      suppressedBy: null,
    }));

    const mocks = {
      filingRepo: {
        findOne: jest.fn().mockResolvedValue(filing),
        save: jest.fn().mockImplementation(async (f: any) => f),
      },
      tickerRepo: {
        findOne: jest.fn().mockResolvedValue({ symbol: 'HUM', name: 'Humana', observationOnly: false }),
      },
      alertRepo: {
        save: jest.fn().mockImplementation(async (a: any) => ({ id: 9999, ...a })),
        create: jest.fn((a: any) => a),
        findOne: jest.fn().mockResolvedValue(null),
      },
      ruleRepo: {
        findOne: jest.fn().mockResolvedValue({ name: '8-K Earnings Miss', isActive: true, throttleMinutes: 60 }),
      },
      azureOpenai: {
        analyzeCustomPrompt: jest.fn().mockResolvedValue(opts.gptResponse ?? GPT_BEAR_RESPONSE),
      },
      telegram: { sendMarkdown: jest.fn().mockResolvedValue(true) },
      formatter: { formatForm8kGptAlert: jest.fn(() => 'formatted message') },
      dailyCap: { canCallGpt: jest.fn().mockResolvedValue(true) },
      config: { get: jest.fn((_k: string, def?: string) => def ?? '') },
      correlation: { storeSignal: jest.fn(), schedulePatternCheck: jest.fn() },
      finnhub: { getQuote: jest.fn().mockResolvedValue(229.72) },
      tickerProfile: { getSignalProfile: jest.fn().mockResolvedValue(null) },
      deliveryGate: { canDeliverToTelegram: jest.fn().mockResolvedValue({ allowed: true, count: 0, limit: 5 }) },
      dispatcher: { dispatch: dispatchMock },
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
    );

    jest
      .spyOn(pipeline as any, 'fetchFilingText')
      .mockResolvedValue(opts.filingText ?? HUM_FILING_TEXT);

    return { pipeline, mocks, filing };
  }

  it('HUM-style filing z Affirms Adjusted + GPT bear -1.4 → conviction floor -0.3', async () => {
    const { pipeline, mocks, filing } = buildPipelineWithMocks();

    await pipeline.onFiling({
      filingId: 9999,
      symbol: 'HUM',
      formType: '8-K',
      traceId: 'hum-floor-trace',
    });

    // Floor enforced: capped do -0.3 mimo że GPT zwrócił -1.4
    expect(filing.gptAnalysis).not.toBeNull();
    expect(filing.gptAnalysis.conviction).toBe(-0.3);

    // Sign / direction zachowane (negative direction zostaje)
    expect(filing.priceImpactDirection).toBe('negative');
  });

  it('GPT prompt dostaje extractedFacts z AFFIRMS_ADJUSTED block', async () => {
    const { pipeline, mocks } = buildPipelineWithMocks();

    await pipeline.onFiling({
      filingId: 9999,
      symbol: 'HUM',
      formType: '8-K',
    });

    const promptArg = mocks.azureOpenai.analyzeCustomPrompt.mock.calls[0][0];
    expect(promptArg).toContain('AFFIRMED_ADJUSTED');
    expect(promptArg).toContain('LOWERED_GAAP_ONLY');
    expect(promptArg).toContain('Constraint: conviction must NOT be more negative than -0.3');
  });

  it('Filing bez affirmation keywords + GPT bear -1.4 → BEZ floor (legitne bearish)', async () => {
    const NO_AFFIRM_TEXT = `
      Q1 2026 results: revenue $32B, EPS $5.20.
      Withdraws full year guidance citing market uncertainty.
    `.repeat(5);
    const { pipeline, mocks, filing } = buildPipelineWithMocks({ filingText: NO_AFFIRM_TEXT });

    await pipeline.onFiling({
      filingId: 9999,
      symbol: 'HUM',
      formType: '8-K',
    });

    // Withdraws → shouldEnforceConvictionFloor=false → conviction zachowane
    expect(filing.gptAnalysis.conviction).toBe(-1.4);
  });

  it('Filing z Affirms + GPT positive 0.5 → bez efektu floor (positive nie capowane)', async () => {
    const positiveResp = JSON.stringify({
      summary: 'Solidne wyniki, guidance affirmed.',
      key_facts: ['EPS $10.31', 'Revenue $32.5B', 'MLR 89.4%', 'Affirms guidance'],
      conclusion: 'Pozytywny sygnał — beat + affirmed.',
      conviction: 0.5,
      price_impact: {
        direction: 'positive',
        magnitude: 'medium',
        confidence: 0.7,
        time_horizon: 'short_term',
      },
      catalyst_type: 'earnings',
      requires_immediate_attention: false,
    });
    const { pipeline, filing } = buildPipelineWithMocks({ gptResponse: positiveResp });

    await pipeline.onFiling({
      filingId: 9999,
      symbol: 'HUM',
      formType: '8-K',
    });

    // Floor dotyczy tylko negative — positive zostaje bez zmian
    expect(filing.gptAnalysis.conviction).toBe(0.5);
  });

  it('Filing z Affirms + GPT bear -0.2 (powyżej -0.3) → bez efektu floor', async () => {
    const mildBearResp = JSON.stringify({
      summary: 'Wyniki mieszane.',
      key_facts: ['EPS $9.00', 'Revenue $30B', 'MLR 90%', 'Affirms guidance'],
      conclusion: 'Lekko negatywny sentyment.',
      conviction: -0.2,
      price_impact: {
        direction: 'negative',
        magnitude: 'low',
        confidence: 0.5,
        time_horizon: 'short_term',
      },
      catalyst_type: 'earnings',
      requires_immediate_attention: false,
    });
    const { pipeline, filing } = buildPipelineWithMocks({ gptResponse: mildBearResp });

    await pipeline.onFiling({
      filingId: 9999,
      symbol: 'HUM',
      formType: '8-K',
    });

    // -0.2 jest powyżej floor -0.3 — bez zmian
    expect(filing.gptAnalysis.conviction).toBe(-0.2);
  });
});
