/**
 * S19-FIX-10: testy fetchExhibit991 (Form8kPipeline) — pobranie press release
 * dla Item 2.02 z directory index.json.
 *
 * Trigger: 4/4 alerty 29-30.04 (ABBV/CI/DXCM/AMGN) trafiły w gpt_missing_data
 * guard bo GPT widział tylko 40KB wrapper 8-K bez liczb. Liczby (EPS, revenue,
 * MLR, guidance) są w Exhibit 99.1 (200-300KB), pomijane przez fetchFilingText
 * szybką ścieżką (.htm endswith → bezpośredni fetch, bez index.json).
 */

import { Form8kPipeline } from '../../src/sec-filings/pipelines/form8k.pipeline';

describe('Form8kPipeline.fetchExhibit991 — naming variants (S19-FIX-10)', () => {
  function buildPipeline() {
    return new Form8kPipeline(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { get: jest.fn(() => 'StockPulse test@example.com') } as any,
    );
  }

  function mockFetch(indexJson: any, exhibitHtml: string | null) {
    return jest.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/index.json')) {
        return {
          ok: true,
          json: async () => indexJson,
        };
      }
      if (exhibitHtml === null) {
        return { ok: false };
      }
      return {
        ok: true,
        text: async () => exhibitHtml,
      };
    });
  }

  beforeEach(() => {
    (global as any).originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = (global as any).originalFetch;
  });

  const namingVariants = [
    'abbv-20260331xexhibit991.htm',
    'ex991.htm',
    'ex-99-1.htm',
    'ex-99.1.htm',
    'exhibit991.htm',
    'exhibit99-1.htm',
    'exhibit_99_1.htm',
    'cmpny_ex991.htm',
    'amgn-20260430-ex991.htm',
    'dxcm-ex99-1.htm',
  ];

  for (const variant of namingVariants) {
    it(`łapie exhibit po nazwie: ${variant}`, async () => {
      global.fetch = mockFetch(
        {
          directory: {
            item: [
              { name: 'abbv-20260429.htm' },
              { name: variant },
              { name: 'R1.htm' },
            ],
          },
        },
        '<html><body><p>EPS $2.10 vs consensus $1.95</p></body></html>',
      );

      const svc = buildPipeline();
      const result = await (svc as any).fetchExhibit991(
        'https://www.sec.gov/Archives/edgar/data/1551152/000155115226000013/abbv-20260429.htm',
      );

      expect(result).not.toBeNull();
      expect(result).toContain('EPS $2.10');
      expect(result).toContain('consensus $1.95');
    });
  }

  it('zwraca null gdy directory nie ma exhibit', async () => {
    global.fetch = mockFetch(
      {
        directory: {
          item: [
            { name: 'abbv-20260429.htm' },
            { name: 'R1.htm' },
            { name: 'FilingSummary.xml' },
          ],
        },
      },
      null,
    );

    const svc = buildPipeline();
    const result = await (svc as any).fetchExhibit991(
      'https://www.sec.gov/Archives/edgar/data/x/y/main-8k.htm',
    );
    expect(result).toBeNull();
  });

  it('zwraca null gdy index.json zwraca 404', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false });

    const svc = buildPipeline();
    const result = await (svc as any).fetchExhibit991(
      'https://www.sec.gov/Archives/edgar/data/x/y/main-8k.htm',
    );
    expect(result).toBeNull();
  });

  it('zwraca null gdy exhibit fetch zwraca 404', async () => {
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/index.json')) {
        return {
          ok: true,
          json: async () => ({
            directory: { item: [{ name: 'ex991.htm' }] },
          }),
        };
      }
      return { ok: false };
    });

    const svc = buildPipeline();
    const result = await (svc as any).fetchExhibit991(
      'https://www.sec.gov/Archives/edgar/data/x/y/main-8k.htm',
    );
    expect(result).toBeNull();
  });

  it('graceful gdy fetch rzuca exception', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

    const svc = buildPipeline();
    const result = await (svc as any).fetchExhibit991(
      'https://www.sec.gov/Archives/edgar/data/x/y/main-8k.htm',
    );
    expect(result).toBeNull();
  });

  it('directory URL bez .htm — używa bezpośrednio bez wycinania filename', async () => {
    let capturedIndexUrl: string | undefined;
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/index.json')) {
        capturedIndexUrl = url;
        return {
          ok: true,
          json: async () => ({
            directory: { item: [{ name: 'ex991.htm' }] },
          }),
        };
      }
      return { ok: true, text: async () => '<p>Press release content</p>' };
    });

    const svc = buildPipeline();
    await (svc as any).fetchExhibit991(
      'https://www.sec.gov/Archives/edgar/data/1551152/000155115226000013',
    );

    expect(capturedIndexUrl).toBe(
      'https://www.sec.gov/Archives/edgar/data/1551152/000155115226000013/index.json',
    );
  });

  it('NIE łapie main 8-K wrapper jako exhibit (bez ex/exhibit prefix)', async () => {
    global.fetch = mockFetch(
      {
        directory: {
          item: [
            { name: 'abbv-20260429.htm' }, // wrapper
            { name: 'R1.htm' },
            { name: 'abbv-20260429-991.htm' }, // mylące "991" ale bez ex/exhibit
          ],
        },
      },
      '<p>Exhibit text</p>',
    );

    const svc = buildPipeline();
    const result = await (svc as any).fetchExhibit991(
      'https://www.sec.gov/Archives/edgar/data/x/y/abbv-20260429.htm',
    );
    // "abbv-20260429-991.htm" nie powinien matchować — brak "ex" prefix.
    // Regex /ex(hibit)?[-_]?99[-_.]?1\b/ albo /ex(hibit)?991/ wymaga "ex".
    expect(result).toBeNull();
  });
});

describe('Form8kPipeline — exhibit integration into onFiling (S19-FIX-10)', () => {
  function buildMocks(opts: {
    filingText: string;
    items: string[];
    exhibitText?: string | null;
  }) {
    const filing: any = {
      id: 200,
      symbol: 'ABBV',
      formType: '8-K',
      documentUrl: 'https://www.sec.gov/Archives/edgar/data/1551152/000155115226000013/abbv-20260429.htm',
      filingDate: new Date('2026-04-29'),
      gptAnalysis: null,
      priceImpactDirection: null,
    };

    const mocks = {
      filingRepo: {
        findOne: jest.fn().mockResolvedValue(filing),
        save: jest.fn(),
      },
      tickerRepo: {
        findOne: jest.fn().mockResolvedValue({
          symbol: 'ABBV',
          name: 'AbbVie',
          observationOnly: false,
          sector: 'healthcare',
        }),
      },
      alertRepo: { save: jest.fn(), create: jest.fn().mockReturnValue({}), findOne: jest.fn() },
      ruleRepo: { findOne: jest.fn() },
      azureOpenai: {
        analyzeCustomPrompt: jest.fn().mockImplementation(async (prompt: string) => {
          // Capture prompt dla assertions
          (mocks as any).lastPrompt = prompt;
          return null; // wczesny return → SKIP_VM_OFFLINE
        }),
      },
      telegram: { sendMarkdown: jest.fn() },
      formatter: { formatForm8kGptAlert: jest.fn() },
      dailyCap: { canCallGpt: jest.fn().mockResolvedValue(true) },
      config: { get: jest.fn((_k: string, def?: string) => def ?? '') },
      correlation: { storeSignal: jest.fn(), schedulePatternCheck: jest.fn() },
      finnhub: { getQuote: jest.fn() },
      tickerProfile: { getSignalProfile: jest.fn() },
      deliveryGate: { canDeliverToTelegram: jest.fn() },
      dispatcher: { dispatch: jest.fn() },
      lastPrompt: undefined as string | undefined,
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

    jest.spyOn(pipeline as any, 'fetchFilingText').mockResolvedValue(opts.filingText);
    const exhibitSpy = jest
      .spyOn(pipeline as any, 'fetchExhibit991')
      .mockResolvedValue(opts.exhibitText ?? null);

    return { pipeline, mocks, exhibitSpy };
  }

  it('Item 2.02 wrapper-only (brak exhibit) → fetchExhibit991 wywołane, sam wrapper trafia do GPT', async () => {
    const wrapperText = 'Item 2.02 Results of Operations. AbbVie released earnings. See Exhibit 99.1. ' + 'Lorem ipsum '.repeat(20);
    const { pipeline, mocks, exhibitSpy } = buildMocks({
      filingText: wrapperText,
      items: ['2.02'],
      exhibitText: null,
    });

    await pipeline.onFiling({
      filingId: 200,
      symbol: 'ABBV',
      formType: '8-K',
    });

    expect(exhibitSpy).toHaveBeenCalledWith(
      'https://www.sec.gov/Archives/edgar/data/1551152/000155115226000013/abbv-20260429.htm',
    );
    // GPT prompt powinien zawierać sam wrapper (bez sekcji EXHIBIT 99.1)
    expect(mocks.lastPrompt).toBeDefined();
    expect(mocks.lastPrompt).not.toContain('EXHIBIT 99.1 (PRESS RELEASE)');
    expect(mocks.lastPrompt).toContain('Item 2.02');
  });

  it('Item 2.02 z exhibit → konkatenacja, prompt zawiera press release content', async () => {
    const wrapperText = 'Item 2.02 Results of Operations. See Exhibit 99.1. ' + 'Lorem ipsum '.repeat(20);
    const exhibitText =
      'AbbVie reports Q1 2026 EPS of $2.79, beating consensus of $2.62. ' +
      'Full-year guidance reaffirmed at $12.10-$12.30 Adjusted EPS. ' +
      'Net revenues totaled $13.5 billion, up 8.4% YoY. Skyrizi sales rose 71% to $3.4 billion. ' +
      'Q1 2026 operating margin expanded 250bps; cash flow from operations $4.2 billion.';
    const { pipeline, mocks, exhibitSpy } = buildMocks({
      filingText: wrapperText,
      items: ['2.02'],
      exhibitText,
    });

    await pipeline.onFiling({
      filingId: 200,
      symbol: 'ABBV',
      formType: '8-K',
    });

    expect(exhibitSpy).toHaveBeenCalled();
    expect(mocks.lastPrompt).toBeDefined();
    expect(mocks.lastPrompt).toContain('EXHIBIT 99.1 (PRESS RELEASE)');
    expect(mocks.lastPrompt).toContain('EPS of $2.79');
    expect(mocks.lastPrompt).toContain('beating consensus');
    expect(mocks.lastPrompt).toContain('guidance reaffirmed');
  });

  it('Item 1.01 (nie 2.02) → fetchExhibit991 NIE wywołane', async () => {
    const wrapperText = 'Item 1.01 Material Definitive Agreement. Company entered into licensing deal. ' + 'Lorem ipsum '.repeat(20);
    const { pipeline, exhibitSpy } = buildMocks({
      filingText: wrapperText,
      items: ['1.01'],
      exhibitText: 'should not be fetched',
    });

    await pipeline.onFiling({
      filingId: 200,
      symbol: 'ABBV',
      formType: '8-K',
    });

    expect(exhibitSpy).not.toHaveBeenCalled();
  });

  it('Items 2.02 + 9.01 (multi-item filing) → exhibit fetch wywołane', async () => {
    const wrapperText = 'Item 2.02 Results of Operations. Item 9.01 Financial Statements and Exhibits. ' + 'Lorem ipsum '.repeat(20);
    const { pipeline, exhibitSpy } = buildMocks({
      filingText: wrapperText,
      items: ['2.02', '9.01'],
      exhibitText: 'EPS $1.50 beat',
    });

    await pipeline.onFiling({
      filingId: 200,
      symbol: 'ABBV',
      formType: '8-K',
    });

    expect(exhibitSpy).toHaveBeenCalled();
  });

  it('Exhibit krótki (<200 znaków) → traktowany jak brak (defensive)', async () => {
    const wrapperText = 'Item 2.02 Results of Operations. ' + 'Lorem ipsum '.repeat(20);
    const { pipeline, mocks } = buildMocks({
      filingText: wrapperText,
      items: ['2.02'],
      exhibitText: 'tiny', // <200 chars
    });

    await pipeline.onFiling({
      filingId: 200,
      symbol: 'ABBV',
      formType: '8-K',
    });

    expect(mocks.lastPrompt).not.toContain('EXHIBIT 99.1 (PRESS RELEASE)');
  });
});
