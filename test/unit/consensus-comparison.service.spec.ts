/**
 * S19-FIX-12: testy ConsensusComparisonService — fetch + compare logic.
 *
 * Mockuje global.fetch dla Finnhub i Alpha Vantage. Weryfikuje:
 *   - Happy path: oba źródła OK → wszystkie pola wypełnione
 *   - Graceful: jedno źródło zawodzi → drugie nadal działa
 *   - Oba zawodzą → isEmpty=true
 *   - Rate-limited Alpha Vantage (Information field) → pominięte
 *   - Brak kluczy w env → graceful (dla TS nie crash, returns fewer fields)
 *
 * Fix 25.11.2026: testy z zaszytym okresem Finnhub (np. 2026-03-31) przekazują
 * jawną datę odniesienia (`PODD_FILED` = data filingu 8-K) — bez niej okres
 * oceniany względem „dziś" wyglądałby na nieaktualny (ochrona GDRX).
 */

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConsensusComparisonService,
  computeSurprisePct,
  formatConsensusBlock,
  selectAlphaEstimate,
  assessReportedPeriod,
  isImplausibleRevenueBeat,
  AlphaVantageEstimateRow,
  FINNHUB_PERIOD_MAX_AGE_DAYS,
  MIN_QUARTER_GAP_DAYS,
  REVENUE_SURPRISE_MAX_RATIO,
} from '../../src/sec-filings/services/consensus-comparison.service';
import { ConsensusComparison } from '../../src/sec-filings/types/consensus-comparison';

function buildConfig(env: Record<string, any>): ConfigService {
  return {
    get: jest.fn((key: string, def?: any) => env[key] ?? def),
  } as any;
}

/** Data filingu 8-K PODD za Q1 2026 (okres 2026-03-31 → 36 dni, aktualny). */
const PODD_FILED = new Date('2026-05-06');

const PODD_REPORT_TEXT = `
Insulet Corporation Q1 2026 Results

Total revenue of $761.7 million increased 33.9% versus prior year.
Diluted EPS of $1.30 (GAAP) and adjusted diluted EPS of $1.42.
`;

describe('ConsensusComparisonService — happy path PODD replay', () => {
  beforeEach(() => {
    (global as any).originalFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = (global as any).originalFetch;
  });

  it('PODD Q1 2026: Finnhub EPS + Alpha Vantage revenue → wypełnione pola', async () => {
    // Daty forward stałe względem jawnej daty odniesienia (PODD_FILED) — test nie
    // zależy od zegara (wcześniej fixture '2026-06-30' padł 01.07.2026).
    const forwardQ = '2026-06-30';
    const forwardFY = '2026-12-31';
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('finnhub.io')) {
        return {
          ok: true,
          json: async () => [
            { actual: 1.42, estimate: 1.2221, period: '2026-03-31', surprisePercent: 16.19 },
            { actual: 1.55, estimate: 1.4832, period: '2025-12-31', surprisePercent: 4.5 },
          ],
        };
      }
      if (url.includes('alphavantage.co')) {
        return {
          ok: true,
          json: async () => ({
            symbol: 'PODD',
            estimates: [
              {
                date: forwardQ,
                horizon: 'fiscal quarter',
                eps_estimate_average: '1.4392',
                revenue_estimate_average: '789330720.00',
                revenue_estimate_analyst_count: '23.00',
              },
              {
                date: forwardFY,
                horizon: 'fiscal year',
                revenue_estimate_average: '3303722320.00',
              },
            ],
          }),
        };
      }
      throw new Error('unexpected URL');
    });

    const svc = new ConsensusComparisonService(
      buildConfig({ FINNHUB_API_KEY: 'fkey', ALPHA_VANTAGE_API_KEY: 'akey' }),
    );
    const result = await svc.fetchAndCompare('PODD', PODD_REPORT_TEXT, PODD_FILED);

    expect(result.isEmpty).toBe(false);
    expect(result.finnhubStale).toBe(false);
    expect(result.epsActual).toBe(1.42);
    expect(result.epsEstimate).toBe(1.2221);
    expect(result.epsSurprisePct).toBeCloseTo(16.19, 1);
    expect(result.revenueActual).toBeCloseTo(761_700_000, -3);
    expect(result.revenueEstimate).toBeCloseTo(789_330_720, -3);
    // Surprise: (761.7 - 789.3) / 789.3 = -3.5% (faktycznie miss, ale bliski 0 → in-line)
    expect(result.revenueSurprisePct).toBeLessThan(0);
    expect(result.revenueSurprisePct).toBeGreaterThan(-5);
    expect(result.analystCount).toBe(23);
    expect(result.period).toBe('2026-03-31');
  });
});

describe('ConsensusComparisonService — graceful degradation', () => {
  beforeEach(() => {
    (global as any).originalFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = (global as any).originalFetch;
  });

  it('Finnhub HTTP 500 + Alpha Vantage OK → revenue nadal działa', async () => {
    const forwardQ = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('finnhub.io')) {
        return { ok: false, status: 500 };
      }
      return {
        ok: true,
        json: async () => ({
          symbol: 'TEST',
          estimates: [
            {
              date: forwardQ,
              horizon: 'fiscal quarter',
              revenue_estimate_average: '100000000',
              revenue_estimate_analyst_count: '10',
            },
          ],
        }),
      };
    });

    const svc = new ConsensusComparisonService(
      buildConfig({ FINNHUB_API_KEY: 'fkey', ALPHA_VANTAGE_API_KEY: 'akey' }),
    );
    const result = await svc.fetchAndCompare('TEST', 'Total revenue of $95 million for Q1.');

    expect(result.isEmpty).toBe(false);
    expect(result.epsActual).toBeNull(); // Finnhub failed
    expect(result.epsEstimate).toBeNull();
    expect(result.epsSurprisePct).toBeNull();
    expect(result.revenueEstimate).toBe(100_000_000);
    expect(result.revenueActual).toBeCloseTo(95_000_000, -3);
  });

  it('Alpha Vantage rate-limited (Information field) → revenue null, EPS nadal z Finnhub', async () => {
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('finnhub.io')) {
        return {
          ok: true,
          json: async () => [{ actual: 1.42, estimate: 1.30, period: '2026-03-31' }],
        };
      }
      return {
        ok: true,
        json: async () => ({
          Information: 'Thank you for using Alpha Vantage! Please consider...',
        }),
      };
    });

    const svc = new ConsensusComparisonService(
      buildConfig({ FINNHUB_API_KEY: 'fkey', ALPHA_VANTAGE_API_KEY: 'akey' }),
    );
    const result = await svc.fetchAndCompare('TEST', PODD_REPORT_TEXT, PODD_FILED);

    expect(result.isEmpty).toBe(false);
    expect(result.epsActual).toBe(1.42);
    expect(result.epsSurprisePct).toBeCloseTo(9.23, 1);
    expect(result.revenueEstimate).toBeNull();
    expect(result.revenueSurprisePct).toBeNull();
  });

  it('oba źródła zawiodą (HTTP 500 + 503) → isEmpty=true', async () => {
    global.fetch = jest.fn().mockImplementation(async () => ({ ok: false, status: 500 }));

    const svc = new ConsensusComparisonService(
      buildConfig({ FINNHUB_API_KEY: 'fkey', ALPHA_VANTAGE_API_KEY: 'akey' }),
    );
    const result = await svc.fetchAndCompare('TEST', PODD_REPORT_TEXT);

    expect(result.isEmpty).toBe(true);
    expect(result.epsActual).toBeNull();
    expect(result.revenueEstimate).toBeNull();
  });

  it('brak kluczy API (oba undefined) → isEmpty=true bez fetch', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const svc = new ConsensusComparisonService(buildConfig({}));
    const result = await svc.fetchAndCompare('TEST', PODD_REPORT_TEXT);

    expect(result.isEmpty).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Finnhub zwraca pustą tablicę → epsActual null', async () => {
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('finnhub.io')) {
        return { ok: true, json: async () => [] };
      }
      return { ok: false };
    });

    const svc = new ConsensusComparisonService(
      buildConfig({ FINNHUB_API_KEY: 'fkey', ALPHA_VANTAGE_API_KEY: 'akey' }),
    );
    const result = await svc.fetchAndCompare('TEST', PODD_REPORT_TEXT);

    expect(result.isEmpty).toBe(true);
  });

  it('Alpha Vantage filter forward-only: zwraca next Q (post-today), nie historical 2017', async () => {
    // Trigger live test 06.05.2026: bez forward-only filter pierwszy quarter
    // ASC był 2017-Q2 ($106M, kiedy PODD była 8x mniejszą firmą). Forward filter
    // gwarantuje że bierzemy NEXT fiscal quarter.
    const forwardQ1 = '2026-06-30';
    const forwardQ2 = '2026-09-30';
    const forwardFY = '2026-12-31';
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('finnhub.io')) {
        return {
          ok: true,
          json: async () => [{ actual: 1.42, estimate: 1.22, period: '2026-03-31' }],
        };
      }
      return {
        ok: true,
        json: async () => ({
          symbol: 'PODD',
          estimates: [
            // Historical (sprzed daty odniesienia)
            { date: '2017-06-30', horizon: 'fiscal quarter', revenue_estimate_average: '106170000' },
            { date: '2025-12-31', horizon: 'fiscal quarter', revenue_estimate_average: '755000000' },
            // Forward
            { date: forwardQ1, horizon: 'fiscal quarter', revenue_estimate_average: '789330720', revenue_estimate_analyst_count: '20' },
            { date: forwardQ2, horizon: 'fiscal quarter', revenue_estimate_average: '820000000' },
            // Fiscal year (powinno być pominięte)
            { date: forwardFY, horizon: 'fiscal year', revenue_estimate_average: '3303722320' },
          ],
        }),
      };
    });

    const svc = new ConsensusComparisonService(
      buildConfig({ FINNHUB_API_KEY: 'fkey', ALPHA_VANTAGE_API_KEY: 'akey' }),
    );
    const result = await svc.fetchAndCompare('PODD', PODD_REPORT_TEXT, PODD_FILED);

    // Bierze najbliższy forward fiscal quarter ($789M), NIE 2017-Q2 ($106M)
    expect(result.revenueEstimate).toBe(789_330_720);
    expect(result.analystCount).toBe(20);
    // Period przyjmuje wartość z Finnhub (raportowany Q) — Alpha Vantage period
    // (next forward Q) jest fallback gdy Finnhub niedostępny.
    expect(result.period).toBe('2026-03-31');
  });

  it('Alpha Vantage zwraca tylko fiscal year (brak quarterly) → revenue null', async () => {
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('finnhub.io')) {
        return {
          ok: true,
          json: async () => [{ actual: 1.0, estimate: 0.9, period: '2026-03-31' }],
        };
      }
      return {
        ok: true,
        json: async () => ({
          symbol: 'TEST',
          estimates: [
            { date: '2026-12-31', horizon: 'fiscal year', revenue_estimate_average: '1000000000' },
          ],
        }),
      };
    });

    const svc = new ConsensusComparisonService(
      buildConfig({ FINNHUB_API_KEY: 'fkey', ALPHA_VANTAGE_API_KEY: 'akey' }),
    );
    const result = await svc.fetchAndCompare('TEST', PODD_REPORT_TEXT, PODD_FILED);

    expect(result.epsActual).toBe(1.0);
    expect(result.revenueEstimate).toBeNull();
  });
});

describe('computeSurprisePct', () => {
  it('beat: actual > estimate → positive %', () => {
    expect(computeSurprisePct(1.42, 1.22)).toBeCloseTo(16.39, 1);
  });

  it('miss: actual < estimate → negative %', () => {
    expect(computeSurprisePct(100, 120)).toBeCloseTo(-16.67, 1);
  });

  it('exact match → 0%', () => {
    expect(computeSurprisePct(1.50, 1.50)).toBe(0);
  });

  it('null actual → null', () => {
    expect(computeSurprisePct(null, 1.5)).toBeNull();
  });

  it('null estimate → null', () => {
    expect(computeSurprisePct(1.5, null)).toBeNull();
  });

  it('estimate=0 → null (avoid /0)', () => {
    expect(computeSurprisePct(1.5, 0)).toBeNull();
  });

  it('negative estimate (loss) handled correctly via abs', () => {
    // EPS -$0.50 reported, estimate -$0.30 → ostre miss
    // (actual - estimate) / |estimate| = (-0.50 - -0.30) / 0.30 = -0.20/0.30 = -66.7%
    expect(computeSurprisePct(-0.5, -0.3)).toBeCloseTo(-66.67, 1);
  });
});

describe('formatConsensusBlock', () => {
  function build(overrides: Partial<ConsensusComparison>): ConsensusComparison {
    return {
      epsActual: null,
      epsEstimate: null,
      epsSurprisePct: null,
      revenueActual: null,
      revenueEstimate: null,
      revenueSurprisePct: null,
      analystCount: null,
      period: null,
      fetchedAt: new Date(),
      isEmpty: false,
      ...overrides,
    };
  }

  it('isEmpty → null', () => {
    expect(formatConsensusBlock(build({ isEmpty: true }))).toBeNull();
  });

  it('oba surprise null → null (brak sensownej zawartości)', () => {
    expect(formatConsensusBlock(build({}))).toBeNull();
  });

  it('PODD replay: zawiera explicit liczby + reasoning rules', () => {
    const block = formatConsensusBlock(build({
      epsActual: 1.42,
      epsEstimate: 1.22,
      epsSurprisePct: 16.4,
      revenueActual: 761_700_000,
      revenueEstimate: 789_330_720,
      revenueSurprisePct: -3.5,
      analystCount: 23,
    }));
    expect(block).toContain('ANALYST CONSENSUS');
    expect(block).toContain('$1.22');
    expect(block).toContain('$1.42');
    expect(block).toContain('+16.4%');
    expect(block).toContain('STRONG BEAT');
    expect(block).toContain('$789');
    expect(block).toContain('$761');
    expect(block).toContain('-3.5%');
    expect(block).toContain('23 analysts');
    expect(block).toContain('REASONING RULES');
    expect(block).toContain('Surprise <3%');
    expect(block).toContain('PRICED IN');
  });

  it('verdict: STRONG BEAT (≥10%)', () => {
    const block = formatConsensusBlock(build({
      epsActual: 1.5, epsEstimate: 1.0, epsSurprisePct: 50,
    }));
    expect(block).toContain('STRONG BEAT');
  });

  it('verdict: BIG MISS (<-10%)', () => {
    const block = formatConsensusBlock(build({
      revenueActual: 100_000_000_000, revenueEstimate: 120_000_000_000, revenueSurprisePct: -16.7,
    }));
    expect(block).toContain('BIG MISS');
  });

  it('verdict: IN-LINE (-3..+3)', () => {
    const block = formatConsensusBlock(build({
      epsActual: 1.0, epsEstimate: 1.0, epsSurprisePct: 0,
    }));
    expect(block).toContain('IN-LINE');
  });
});

/**
 * S19-FIX-13 Faza 1: testy `selectAlphaEstimate` (pure function — matched vs forward,
 * anomaly guard pass-through). Pure function testowalna w izolacji bez fetch mock.
 */
describe('selectAlphaEstimate — FIX-13 period match', () => {
  const silentLogger = { warn: jest.fn(), debug: jest.fn(), log: jest.fn(), error: jest.fn() } as unknown as Logger;

  beforeEach(() => {
    (silentLogger.warn as jest.Mock).mockClear();
  });

  it('matched period: bierze estimate dla raportowanego Q (PODD 2026-03-31)', () => {
    const rows: AlphaVantageEstimateRow[] = [
      { date: '2026-03-31', epsEstimate: 1.1907, revenueEstimate: 730_100_840, analystCount: 21 },
      { date: '2026-06-30', epsEstimate: 1.4392, revenueEstimate: 789_330_720, analystCount: 23 },
    ];
    const result = selectAlphaEstimate(rows, '2026-03-31', silentLogger, 'PODD');

    expect(result).not.toBeNull();
    expect(result!.source).toBe('matched');
    expect(result!.period).toBe('2026-03-31');
    expect(result!.revenueEstimate).toBe(730_100_840);
    expect(result!.epsEstimate).toBe(1.1907);
    expect(result!.analystCount).toBe(21);
  });

  it('forward fallback: brak match → najbliższy fiscal quarter >= today', () => {
    const today = new Date().toISOString().slice(0, 10);
    const futureDate1 = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
    const futureDate2 = new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10);

    const rows: AlphaVantageEstimateRow[] = [
      { date: '2017-06-30', epsEstimate: 0.1, revenueEstimate: 106_170_000, analystCount: 5 },
      { date: futureDate1, epsEstimate: 1.5, revenueEstimate: 800_000_000, analystCount: 20 },
      { date: futureDate2, epsEstimate: 1.6, revenueEstimate: 850_000_000, analystCount: 22 },
    ];
    // Brak match dla "2025-12-31" w danych
    const result = selectAlphaEstimate(rows, '2025-12-31', silentLogger, 'TEST');

    expect(result).not.toBeNull();
    expect(result!.source).toBe('forward');
    expect(result!.period).toBe(futureDate1);
    expect(result!.revenueEstimate).toBe(800_000_000);
  });

  it('brak reportedPeriod → zawsze forward proxy', () => {
    const futureDate = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
    const rows: AlphaVantageEstimateRow[] = [
      { date: '2026-03-31', epsEstimate: 1.0, revenueEstimate: 700_000_000, analystCount: 20 },
      { date: futureDate, epsEstimate: 1.5, revenueEstimate: 800_000_000, analystCount: 21 },
    ];
    const result = selectAlphaEstimate(rows, null, silentLogger, 'TEST');

    expect(result!.source).toBe('forward');
    expect(result!.period).toBe(futureDate);
  });

  it('brak forward Q i brak match → null (no fiscal quarter date >= today)', () => {
    const rows: AlphaVantageEstimateRow[] = [
      { date: '2025-06-30', epsEstimate: 1.0, revenueEstimate: 700_000_000, analystCount: 20 },
      { date: '2025-09-30', epsEstimate: 1.1, revenueEstimate: 720_000_000, analystCount: 21 },
    ];
    const result = selectAlphaEstimate(rows, '2025-12-31', silentLogger, 'TEST');

    expect(result).toBeNull();
  });

  it('puste rows → null', () => {
    const result = selectAlphaEstimate([], '2026-03-31', silentLogger, 'TEST');
    expect(result).toBeNull();
  });

  it('anomaly guard: rev<1M → log WARN ale value pass-through (NIE reject)', () => {
    const rows: AlphaVantageEstimateRow[] = [
      { date: '2026-03-31', epsEstimate: 1.0, revenueEstimate: 500_000, analystCount: 5 },
    ];
    const result = selectAlphaEstimate(rows, '2026-03-31', silentLogger, 'TEST');

    expect(result).not.toBeNull();
    expect(result!.revenueEstimate).toBe(500_000); // PASS-THROUGH (Blef #6 critique)
    expect(result!.source).toBe('matched');
    expect(silentLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('suspect revenue'),
    );
  });

  it('anomaly guard: |eps|>50 → log WARN ale value pass-through (GILD Q2 case)', () => {
    const rows: AlphaVantageEstimateRow[] = [
      { date: '2026-06-30', epsEstimate: -6.90, revenueEstimate: 7_000_000_000, analystCount: 25 },
    ];
    const futureDate = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
    rows[0].date = futureDate;

    const result = selectAlphaEstimate(rows, null, silentLogger, 'GILD');

    expect(result).not.toBeNull();
    expect(result!.epsEstimate).toBe(-6.90); // PASS-THROUGH
    expect(silentLogger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('suspect EPS'),
    ); // -6.90 nie przekracza |eps|>50
  });

  it('anomaly guard: |eps|>50 PRAWDZIWY case → warn emitted, pass-through', () => {
    const futureDate = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
    const rows: AlphaVantageEstimateRow[] = [
      { date: futureDate, epsEstimate: 75, revenueEstimate: 1_000_000_000, analystCount: 5 },
    ];
    const result = selectAlphaEstimate(rows, null, silentLogger, 'TEST');

    expect(result!.epsEstimate).toBe(75); // PASS-THROUGH
    expect(silentLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('suspect EPS'),
    );
  });

  it('Infinity/NaN → null (validNumber sanitization)', () => {
    const rows: AlphaVantageEstimateRow[] = [
      { date: '2026-03-31', epsEstimate: Infinity, revenueEstimate: NaN, analystCount: 21 },
    ];
    const result = selectAlphaEstimate(rows, '2026-03-31', silentLogger, 'TEST');

    expect(result!.revenueEstimate).toBeNull();
    expect(result!.epsEstimate).toBeNull();
    expect(result!.analystCount).toBe(21); // valid
  });
});

describe('ConsensusComparisonService — FIX-13 integration (matched + forward + diff log)', () => {
  beforeEach(() => {
    (global as any).originalFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = (global as any).originalFetch;
  });

  it('PODD matched: AV ma estimate dla 2026-03-31 → revenueSource=matched, surprise +4.3%', async () => {
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('finnhub.io')) {
        return {
          ok: true,
          json: async () => [
            { actual: 1.42, estimate: 1.2221, period: '2026-03-31', surprisePercent: 16.19 },
          ],
        };
      }
      if (url.includes('alphavantage.co')) {
        return {
          ok: true,
          json: async () => ({
            symbol: 'PODD',
            estimates: [
              {
                date: '2026-03-31',
                horizon: 'fiscal quarter',
                eps_estimate_average: '1.1907',
                revenue_estimate_average: '730100840.00',
                revenue_estimate_analyst_count: '21.00',
              },
              {
                date: '2026-06-30',
                horizon: 'fiscal quarter',
                eps_estimate_average: '1.4392',
                revenue_estimate_average: '789330720.00',
                revenue_estimate_analyst_count: '23.00',
              },
            ],
          }),
        };
      }
      throw new Error('unexpected URL');
    });

    const svc = new ConsensusComparisonService(
      buildConfig({ FINNHUB_API_KEY: 'fkey', ALPHA_VANTAGE_API_KEY: 'akey' }),
    );
    const result = await svc.fetchAndCompare('PODD', PODD_REPORT_TEXT, PODD_FILED);

    expect(result.isEmpty).toBe(false);
    expect(result.revenueSource).toBe('matched');
    expect(result.revenueEstimate).toBe(730_100_840);
    expect(result.revenueActual).toBeCloseTo(761_700_000, -3);
    // Surprise: (761.7 - 730.1) / 730.1 = +4.33%
    expect(result.revenueSurprisePct).toBeCloseTo(4.33, 1);
    expect(result.epsEstimateAlphaVantage).toBe(1.1907);
    expect(result.analystCount).toBe(21);
    expect(result.period).toBe('2026-03-31'); // z Finnhub
  });

  it('PODD forward fallback: brak match w AV → revenueSource=forward, znany pre-FIX-13 behaviour', async () => {
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('finnhub.io')) {
        return {
          ok: true,
          json: async () => [{ actual: 1.42, estimate: 1.2221, period: '2026-03-31' }],
        };
      }
      const futureDate = '2026-06-30';
      return {
        ok: true,
        json: async () => ({
          symbol: 'PODD',
          estimates: [
            {
              date: futureDate,
              horizon: 'fiscal quarter',
              eps_estimate_average: '1.4392',
              revenue_estimate_average: '789330720.00',
              revenue_estimate_analyst_count: '23.00',
            },
          ],
        }),
      };
    });

    const svc = new ConsensusComparisonService(
      buildConfig({ FINNHUB_API_KEY: 'fkey', ALPHA_VANTAGE_API_KEY: 'akey' }),
    );
    const result = await svc.fetchAndCompare('PODD', PODD_REPORT_TEXT, PODD_FILED);

    expect(result.revenueSource).toBe('forward');
    expect(result.revenueEstimate).toBe(789_330_720);
    expect(result.revenueSurprisePct).toBeLessThan(0); // forward bias: $761.7M vs $789M = miss
  });

  it('diff log: emituje info (log) gdy oba EPS estimate dostępne (Finnhub vs AV)', async () => {
    // Code review #10 (14.05.2026): zmiana z debug → log (info level, 7d retention)
    // zamiast 2d retention dla debug. Faza 2 obserwacji 14d wymaga dłuższego window.
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('finnhub.io')) {
        return {
          ok: true,
          json: async () => [{ actual: 1.42, estimate: 1.30, period: '2026-03-31' }],
        };
      }
      return {
        ok: true,
        json: async () => ({
          symbol: 'TEST',
          estimates: [
            {
              date: '2026-03-31',
              horizon: 'fiscal quarter',
              eps_estimate_average: '1.25',
              revenue_estimate_average: '500000000',
            },
          ],
        }),
      };
    });

    const svc = new ConsensusComparisonService(
      buildConfig({ FINNHUB_API_KEY: 'fkey', ALPHA_VANTAGE_API_KEY: 'akey' }),
    );
    await svc.fetchAndCompare('TEST', PODD_REPORT_TEXT, PODD_FILED);

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('consensus source diff TEST'),
    );
    // diff = (1.30 - 1.25) / 1.25 * 100 = +4.00%
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/diff \+4\.00%/));

    logSpy.mockRestore();
  });

  it('diff log: NIE emituje gdy tylko Finnhub ma EPS (AV brak eps_estimate_average)', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('finnhub.io')) {
        return {
          ok: true,
          json: async () => [{ actual: 1.0, estimate: 0.9, period: '2026-03-31' }],
        };
      }
      return {
        ok: true,
        json: async () => ({
          symbol: 'TEST',
          estimates: [
            {
              date: '2026-03-31',
              horizon: 'fiscal quarter',
              revenue_estimate_average: '500000000',
              // brak eps_estimate_average
            },
          ],
        }),
      };
    });

    const svc = new ConsensusComparisonService(
      buildConfig({ FINNHUB_API_KEY: 'fkey', ALPHA_VANTAGE_API_KEY: 'akey' }),
    );
    await svc.fetchAndCompare('TEST', PODD_REPORT_TEXT, PODD_FILED);

    const diffCalls = logSpy.mock.calls.filter(c =>
      typeof c[0] === 'string' && c[0].includes('consensus source diff'),
    );
    expect(diffCalls).toHaveLength(0);

    logSpy.mockRestore();
  });
});

/**
 * Fix 25.11.2026 (GDRX): okres Finnhub z POPRZEDNIEGO kwartału. Fixture = realne
 * odpowiedzi API z 25.11.2026 (Finnhub kończy się na 2026-06-30, Alpha Vantage ma
 * wiersz 2026-09-30 z szacunkiem sprzed raportu).
 */
const GDRX_FILED = new Date('2026-11-24');
const GDRX_REPORT_TEXT = 'GoodRx Q3 2026 results. Total revenue of $218.4 million for the third quarter.';
const GDRX_FINNHUB = [
  { actual: 0.08, estimate: 0.0808, period: '2026-06-30', surprisePercent: -0.9901 },
  { actual: 0.07, estimate: 0.0734, period: '2026-03-31', surprisePercent: -4.6322 },
];
const GDRX_AV_ROWS: AlphaVantageEstimateRow[] = [
  { date: '2026-12-31', epsEstimate: 0.0794, revenueEstimate: 202_090_460, analystCount: 12 },
  { date: '2026-09-30', epsEstimate: 0.0779, revenueEstimate: 202_086_390, analystCount: 12 },
  { date: '2026-06-30', epsEstimate: 0.0797, revenueEstimate: 193_160_850, analystCount: 13 },
  { date: '2026-03-31', epsEstimate: 0.0707, revenueEstimate: 185_118_550, analystCount: 13 },
];

function toAvPayload(symbol: string, rows: AlphaVantageEstimateRow[]) {
  return {
    symbol,
    estimates: rows.map(r => ({
      date: r.date,
      horizon: 'fiscal quarter',
      eps_estimate_average: r.epsEstimate === null ? undefined : String(r.epsEstimate),
      revenue_estimate_average: r.revenueEstimate === null ? undefined : String(r.revenueEstimate),
      revenue_estimate_analyst_count: r.analystCount === null ? undefined : String(r.analystCount),
    })),
  };
}

function mockSources(finnhubRows: unknown, avPayload: unknown): void {
  global.fetch = jest.fn().mockImplementation((url: string) => {
    if (url.includes('finnhub.io')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(finnhubRows) });
    }
    if (url.includes('alphavantage.co')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(avPayload) });
    }
    return Promise.reject(new Error('unexpected URL'));
  });
}

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
}

describe('assessReportedPeriod — czy okres Finnhub to kwartał raportowany', () => {
  it('GDRX: Finnhub 30.06, filing 24.11 → nieaktualny (147 dni), kwartał raportowany = wiersz AV 30.09', () => {
    const result = assessReportedPeriod('2026-06-30', GDRX_AV_ROWS, GDRX_FILED);

    expect(result.finnhubStale).toBe(true);
    expect(result.finnhubAgeDays).toBe(147);
    expect(result.reportedRow?.date).toBe('2026-09-30');
  });

  it('okres aktualny: Finnhub 30.09, filing 24.11 (55 dni) → nie nieaktualny, brak wiersza zastępczego', () => {
    const result = assessReportedPeriod('2026-09-30', GDRX_AV_ROWS, GDRX_FILED);

    expect(result.finnhubStale).toBe(false);
    expect(result.finnhubAgeDays).toBe(55);
    expect(result.reportedRow).toBeNull();
  });

  it('granica progu wieku (bez danych AV): dokładnie 100 dni → aktualny, 101 dni → nieaktualny', () => {
    expect(FINNHUB_PERIOD_MAX_AGE_DAYS).toBe(100);

    const at100 = assessReportedPeriod('2026-06-30', [], new Date('2026-10-08'));
    expect(at100.finnhubAgeDays).toBe(100);
    expect(at100.finnhubStale).toBe(false);

    const at101 = assessReportedPeriod('2026-06-30', [], new Date('2026-10-09'));
    expect(at101.finnhubAgeDays).toBe(101);
    expect(at101.finnhubStale).toBe(true);
    expect(at101.reportedRow).toBeNull();
  });

  it('raport Q4 w terminie (90 dni, złożony w dniu końca Q1) → aktualny mimo wiersza AV 31.03', () => {
    const rows: AlphaVantageEstimateRow[] = [
      { date: '2025-12-31', epsEstimate: 1.0, revenueEstimate: 500_000_000, analystCount: 10 },
      { date: '2026-03-31', epsEstimate: 1.1, revenueEstimate: 520_000_000, analystCount: 10 },
    ];
    const result = assessReportedPeriod('2025-12-31', rows, new Date('2026-03-31'));

    // Kwartał kończący się w dniu filingu nie mógł być jeszcze raportowany (warunek ostry <).
    expect(result.finnhubAgeDays).toBe(90);
    expect(result.finnhubStale).toBe(false);
  });

  it('pre-announcement w pierwszych dniach po końcu kwartału (ABBV 05.10: Finnhub 30.06 = 97 dni) → nieaktualny dzięki wierszowi AV 30.09', () => {
    const result = assessReportedPeriod('2026-06-30', GDRX_AV_ROWS, new Date('2026-10-05'));

    expect(result.finnhubAgeDays).toBe(97); // poniżej progu wieku
    expect(result.finnhubStale).toBe(true);
    expect(result.reportedRow?.date).toBe('2026-09-30');
  });

  it('to samo okno bez danych AV → nie orzekamy nieaktualności (zostaje sam próg wieku)', () => {
    const result = assessReportedPeriod('2026-06-30', [], new Date('2026-10-05'));

    expect(result.finnhubStale).toBe(false);
  });

  it('rozjazd etykiet tego samego kwartału (Finnhub 27.09 vs AV 30.09) → NIE jest późniejszym kwartałem', () => {
    const rows: AlphaVantageEstimateRow[] = [
      { date: '2026-09-30', epsEstimate: 1.0, revenueEstimate: 500_000_000, analystCount: 10 },
    ];
    const result = assessReportedPeriod('2026-09-27', rows, GDRX_FILED);

    expect(MIN_QUARTER_GAP_DAYS).toBe(45);
    expect(result.finnhubStale).toBe(false);
    expect(result.reportedRow).toBeNull();
  });

  it('AV też nie ma bieżącego kwartału (najnowszy zakończony wiersz starszy niż próg) → nieaktualny, bez wiersza', () => {
    const rows: AlphaVantageEstimateRow[] = [
      { date: '2026-03-31', epsEstimate: 0.07, revenueEstimate: 185_118_550, analystCount: 13 },
      { date: '2026-06-30', epsEstimate: 0.08, revenueEstimate: 193_160_850, analystCount: 13 },
      { date: '2026-12-31', epsEstimate: 0.08, revenueEstimate: 202_090_460, analystCount: 12 },
    ];
    const result = assessReportedPeriod('2026-03-31', rows, GDRX_FILED);

    expect(result.finnhubStale).toBe(true);
    expect(result.reportedRow).toBeNull(); // 30.06 ma 147 dni — to nie kwartał raportowany
  });

  it('znana luka: raport Q4 złożony PO końcu Q1 (02.04) → warunek AV uznaje Q1 za raportowany', () => {
    const rows: AlphaVantageEstimateRow[] = [
      { date: '2025-12-31', epsEstimate: 1.0, revenueEstimate: 500_000_000, analystCount: 10 },
      { date: '2026-03-31', epsEstimate: 1.1, revenueEstimate: 520_000_000, analystCount: 10 },
    ];
    const result = assessReportedPeriod('2025-12-31', rows, new Date('2026-04-02'));

    // Z samych dat nieodróżnialne od pre-announcementu Q1 — udokumentowany kompromis.
    expect(result.finnhubStale).toBe(true);
    expect(result.reportedRow?.date).toBe('2026-03-31');
  });

  it('brak lub niepoprawny period → nie orzekamy (zachowanie jak dotąd)', () => {
    expect(assessReportedPeriod(null, GDRX_AV_ROWS, GDRX_FILED)).toEqual({
      finnhubStale: false,
      finnhubAgeDays: null,
      reportedRow: null,
    });
    expect(assessReportedPeriod('Q2 2026', GDRX_AV_ROWS, GDRX_FILED).finnhubStale).toBe(false);
  });

  it('period późniejszy niż data odniesienia → nie nieaktualny', () => {
    const result = assessReportedPeriod('2026-12-31', GDRX_AV_ROWS, GDRX_FILED);

    expect(result.finnhubStale).toBe(false);
    expect(result.finnhubAgeDays).toBeLessThan(0);
  });
});

describe('ConsensusComparisonService — nieaktualny okres Finnhub (GDRX 24.11.2026)', () => {
  let warnSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    (global as any).originalFetch = global.fetch;
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    global.fetch = (global as any).originalFetch;
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  function buildService(): ConsensusComparisonService {
    return new ConsensusComparisonService(
      buildConfig({ FINNHUB_API_KEY: 'fkey', ALPHA_VANTAGE_API_KEY: 'akey' }),
    );
  }

  it('GDRX: Finnhub Q2 + AV z wierszem Q3 → EPS null, szacunek przychodów i period z Q3', async () => {
    mockSources(GDRX_FINNHUB, toAvPayload('GDRX', GDRX_AV_ROWS));

    const result = await buildService().fetchAndCompare('GDRX', GDRX_REPORT_TEXT, GDRX_FILED);

    expect(result.isEmpty).toBe(false);
    expect(result.finnhubStale).toBe(true);
    expect(result.finnhubStalePeriod).toBe('2026-06-30');
    // EPS Q2 (0.08 vs 0.0808 = „miss −1,0%") NIE trafia do wyniku
    expect(result.epsActual).toBeNull();
    expect(result.epsEstimate).toBeNull();
    expect(result.epsSurprisePct).toBeNull();
    // Przychody: actual Q3 vs szacunek Q3 ($202,1M), a nie Q2 ($193,2M → fałszywe +13,1%)
    expect(result.revenueActual).toBeCloseTo(218_400_000, -3);
    expect(result.revenueEstimate).toBe(202_086_390);
    expect(result.revenueSurprisePct).toBeCloseTo(8.07, 1);
    expect(result.revenueSource).toBe('matched');
    expect(result.period).toBe('2026-09-30');
    expect(result.analystCount).toBe(12);
    expect(result.epsEstimateAlphaVantage).toBe(0.0779);
  });

  it('GDRX: WARN z symbolem, okresem i liczbą dni; bez logu „consensus source diff" (różne kwartały)', async () => {
    mockSources(GDRX_FINNHUB, toAvPayload('GDRX', GDRX_AV_ROWS));

    await buildService().fetchAndCompare('GDRX', GDRX_REPORT_TEXT, GDRX_FILED);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Finnhub period nieaktualny GDRX: period=2026-06-30 \(147 dni/),
    );
    const diffCalls = logSpy.mock.calls.filter(
      c => typeof c[0] === 'string' && c[0].includes('consensus source diff'),
    );
    expect(diffCalls).toHaveLength(0);
  });

  it('GDRX: blok do promptu GPT zawiera tylko przychody Q3, bez EPS z Q2', async () => {
    mockSources(GDRX_FINNHUB, toAvPayload('GDRX', GDRX_AV_ROWS));

    const result = await buildService().fetchAndCompare('GDRX', GDRX_REPORT_TEXT, GDRX_FILED);
    const block = formatConsensusBlock(result);

    expect(block).toContain('Revenue estimate: $202.1M → actual $218.4M');
    expect(block).toContain('+8.1%');
    expect(block).not.toContain('EPS estimate');
    expect(block).not.toContain('$0.08');
    expect(block).not.toContain('$193');
  });

  it('GDRX bez wiersza Q3 w AV → forward proxy (NIE dopasowanie do nieaktualnego Q2), period = kwartał użyty', async () => {
    const rowsWithoutQ3 = GDRX_AV_ROWS.filter(r => r.date !== '2026-09-30');
    mockSources(GDRX_FINNHUB, toAvPayload('GDRX', rowsWithoutQ3));

    const result = await buildService().fetchAndCompare('GDRX', GDRX_REPORT_TEXT, GDRX_FILED);

    expect(result.finnhubStale).toBe(true);
    expect(result.epsSurprisePct).toBeNull();
    expect(result.revenueSource).toBe('forward');
    expect(result.revenueEstimate).toBe(202_090_460); // 31.12, nie 193_160_850 z 30.06
    expect(result.period).toBe('2026-12-31');
  });

  it('GDRX przy niedostępnym AV → wynik pusty z flagą finnhubStale (EPS Q2 nieużyty)', async () => {
    mockSources(GDRX_FINNHUB, { Information: 'rate limit' });

    const result = await buildService().fetchAndCompare('GDRX', GDRX_REPORT_TEXT, GDRX_FILED);

    expect(result.isEmpty).toBe(true);
    expect(result.finnhubStale).toBe(true);
    expect(result.finnhubStalePeriod).toBe('2026-06-30');
    expect(result.epsSurprisePct).toBeNull();
    expect(result.period).toBeNull();
  });

  it('okres aktualny względem daty filingu → zachowanie bez zmian (EPS z Finnhub, matched AV, diff log)', async () => {
    const freshFinnhub = [{ actual: 0.09, estimate: 0.0779, period: '2026-09-30' }, ...GDRX_FINNHUB];
    mockSources(freshFinnhub, toAvPayload('GDRX', GDRX_AV_ROWS));

    const result = await buildService().fetchAndCompare('GDRX', GDRX_REPORT_TEXT, GDRX_FILED);

    expect(result.finnhubStale).toBe(false);
    expect(result.finnhubStalePeriod).toBeUndefined();
    expect(result.epsActual).toBe(0.09);
    expect(result.epsEstimate).toBe(0.0779);
    expect(result.epsSurprisePct).toBeCloseTo(15.53, 1);
    expect(result.revenueEstimate).toBe(202_086_390);
    expect(result.revenueSource).toBe('matched');
    expect(result.period).toBe('2026-09-30');
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('Finnhub period nieaktualny'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('consensus source diff GDRX'));
  });

  it('bez parametru daty odniesienia → domyślnie „teraz" (okres sprzed 150 dni nieaktualny, sprzed 30 dni aktualny)', async () => {
    mockSources([{ actual: 1.0, estimate: 0.9, period: isoDaysFromNow(-150) }], { Information: 'rate limit' });
    const stale = await buildService().fetchAndCompare('TEST', PODD_REPORT_TEXT);
    expect(stale.finnhubStale).toBe(true);
    expect(stale.epsActual).toBeNull();

    mockSources([{ actual: 1.0, estimate: 0.9, period: isoDaysFromNow(-30) }], { Information: 'rate limit' });
    const fresh = await buildService().fetchAndCompare('TEST', PODD_REPORT_TEXT);
    expect(fresh.finnhubStale).toBe(false);
    expect(fresh.epsActual).toBe(1.0);
  });

  it('niepoprawna data odniesienia (Invalid Date) → fallback do „teraz", bez wyjątku', async () => {
    mockSources([{ actual: 1.0, estimate: 0.9, period: isoDaysFromNow(-30) }], { Information: 'rate limit' });

    const result = await buildService().fetchAndCompare('TEST', PODD_REPORT_TEXT, new Date('nie-data'));

    expect(result.finnhubStale).toBe(false);
    expect(result.epsActual).toBe(1.0);
  });
});

describe('Bezpiecznik zaskoczenia przychodów (HIMS +329%, UHS +304%)', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    (global as any).originalFetch = global.fetch;
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    global.fetch = (global as any).originalFetch;
    warnSpy.mockRestore();
  });

  const HIMS_FILED = new Date('2026-11-09');
  const HIMS_FINNHUB = [{ actual: 0.2, estimate: 0.16, period: '2026-09-30' }];
  const HIMS_AV_ROWS: AlphaVantageEstimateRow[] = [
    { date: '2026-09-30', epsEstimate: 0.15, revenueEstimate: 100_000_000, analystCount: 15 },
  ];

  function buildService(): ConsensusComparisonService {
    return new ConsensusComparisonService(
      buildConfig({ FINNHUB_API_KEY: 'fkey', ALPHA_VANTAGE_API_KEY: 'akey' }),
    );
  }

  it('isImplausibleRevenueBeat: granica progu — dokładnie 2,5× przechodzi, powyżej odrzucone', () => {
    expect(REVENUE_SURPRISE_MAX_RATIO).toBe(2.5);
    expect(isImplausibleRevenueBeat(250_000_000, 100_000_000)).toBe(false); // +150% dokładnie
    expect(isImplausibleRevenueBeat(250_000_001, 100_000_000)).toBe(true);
    expect(isImplausibleRevenueBeat(429_000_000, 100_000_000)).toBe(true); // HIMS-class +329%
  });

  it('isImplausibleRevenueBeat: tylko w górę — skrajny miss, brak danych i estimate ≤ 0 nie są odrzucane', () => {
    expect(isImplausibleRevenueBeat(20_000_000, 100_000_000)).toBe(false); // −80%
    expect(isImplausibleRevenueBeat(1_000_000, 1_000_000_000)).toBe(false); // −99,9%
    expect(isImplausibleRevenueBeat(null, 100_000_000)).toBe(false);
    expect(isImplausibleRevenueBeat(100_000_000, null)).toBe(false);
    expect(isImplausibleRevenueBeat(100_000_000, 0)).toBe(false);
  });

  it('w górę: actual/estimate > 2,5 → revenue null + WARN z obiema liczbami, EPS nietknięty', async () => {
    mockSources(HIMS_FINNHUB, toAvPayload('HIMS', HIMS_AV_ROWS));

    const result = await buildService().fetchAndCompare(
      'HIMS',
      'Total revenue of $429 million expected for the full year.',
      HIMS_FILED,
    );

    expect(result.revenueSurprisePct).toBeNull();
    expect(result.revenueActual).toBeNull();
    expect(result.revenueEstimate).toBeNull();
    expect(result.revenueRejected).toEqual({ actual: 429_000_000, estimate: 100_000_000 });
    expect(result.epsSurprisePct).toBeCloseTo(25, 1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Revenue surprise odrzucony HIMS: actual=429000000 vs estimate=100000000 \(ratio 4\.29/),
    );
  });

  it('w górę: odrzucone liczby przychodów nie trafiają do bloku promptu GPT', async () => {
    mockSources(HIMS_FINNHUB, toAvPayload('HIMS', HIMS_AV_ROWS));

    const result = await buildService().fetchAndCompare(
      'HIMS',
      'Total revenue of $429 million expected for the full year.',
      HIMS_FILED,
    );
    const block = formatConsensusBlock(result);

    expect(block).toContain('EPS estimate: $0.16 → actual $0.20');
    expect(block).not.toContain('Revenue estimate');
    expect(block).not.toContain('$429');
    expect(block).not.toContain('$100.0M');
  });

  it('w górę: gdy EPS też niedostępny → blok promptu null (brak jakiejkolwiek liczby)', async () => {
    // Finnhub ma już wiersz raportowanego kwartału, ale jeszcze bez actual/estimate
    mockSources(
      [{ actual: null, estimate: null, period: '2026-09-30' }],
      toAvPayload('HIMS', HIMS_AV_ROWS),
    );

    const result = await buildService().fetchAndCompare(
      'HIMS',
      'Total revenue of $429 million expected for the full year.',
      HIMS_FILED,
    );

    expect(result.revenueRejected).toBeDefined();
    expect(formatConsensusBlock(result)).toBeNull();
  });

  it('w dół: skrajny miss (−80%) NIE jest zerowany — cap R1 dla prawdziwych missów zostaje', async () => {
    mockSources(HIMS_FINNHUB, toAvPayload('HIMS', HIMS_AV_ROWS));

    const result = await buildService().fetchAndCompare(
      'HIMS',
      'Total revenue of $20 million for the quarter.',
      HIMS_FILED,
    );

    expect(result.revenueActual).toBeCloseTo(20_000_000, -3);
    expect(result.revenueEstimate).toBe(100_000_000);
    expect(result.revenueSurprisePct).toBeCloseTo(-80, 1);
    expect(result.revenueRejected).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('Revenue surprise odrzucony'));
  });

  it('zwykły beat poniżej progu (+120%) przechodzi bez zmian', async () => {
    mockSources(HIMS_FINNHUB, toAvPayload('HIMS', HIMS_AV_ROWS));

    const result = await buildService().fetchAndCompare(
      'HIMS',
      'Total revenue of $220 million for the quarter.',
      HIMS_FILED,
    );

    expect(result.revenueSurprisePct).toBeCloseTo(120, 1);
    expect(result.revenueRejected).toBeUndefined();
  });
});
