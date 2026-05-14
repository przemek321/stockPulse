/**
 * S19-FIX-12: testy ConsensusComparisonService — fetch + compare logic.
 *
 * Mockuje global.fetch dla Finnhub i Alpha Vantage. Weryfikuje:
 *   - Happy path: oba źródła OK → wszystkie pola wypełnione
 *   - Graceful: jedno źródło zawodzi → drugie nadal działa
 *   - Oba zawodzą → isEmpty=true
 *   - Rate-limited Alpha Vantage (Information field) → pominięte
 *   - Brak kluczy w env → graceful (dla TS nie crash, returns fewer fields)
 */

import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import {
  ConsensusComparisonService,
  computeSurprisePct,
  formatConsensusBlock,
  selectAlphaEstimate,
  AlphaVantageEstimateRow,
} from '../../src/sec-filings/services/consensus-comparison.service';
import { ConsensusComparison } from '../../src/sec-filings/types/consensus-comparison';

function buildConfig(env: Record<string, any>): ConfigService {
  return {
    get: jest.fn((key: string, def?: any) => env[key] ?? def),
  } as any;
}

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
                date: '2026-06-30',
                horizon: 'fiscal quarter',
                eps_estimate_average: '1.4392',
                revenue_estimate_average: '789330720.00',
                revenue_estimate_analyst_count: '23.00',
              },
              {
                date: '2026-12-31',
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
    const result = await svc.fetchAndCompare('PODD', PODD_REPORT_TEXT);

    expect(result.isEmpty).toBe(false);
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
              date: '2026-06-30',
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
    const result = await svc.fetchAndCompare('TEST', PODD_REPORT_TEXT);

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
            // Historical (sprzed dziś)
            { date: '2017-06-30', horizon: 'fiscal quarter', revenue_estimate_average: '106170000' },
            { date: '2025-12-31', horizon: 'fiscal quarter', revenue_estimate_average: '755000000' },
            // Forward
            { date: '2026-06-30', horizon: 'fiscal quarter', revenue_estimate_average: '789330720', revenue_estimate_analyst_count: '20' },
            { date: '2026-09-30', horizon: 'fiscal quarter', revenue_estimate_average: '820000000' },
            // Fiscal year (powinno być pominięte)
            { date: '2026-12-31', horizon: 'fiscal year', revenue_estimate_average: '3303722320' },
          ],
        }),
      };
    });

    const svc = new ConsensusComparisonService(
      buildConfig({ FINNHUB_API_KEY: 'fkey', ALPHA_VANTAGE_API_KEY: 'akey' }),
    );
    const result = await svc.fetchAndCompare('PODD', PODD_REPORT_TEXT);

    // Bierze najbliższy forward fiscal quarter = 2026-06-30 ($789M), NIE 2017-Q2 ($106M)
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
    const result = await svc.fetchAndCompare('TEST', PODD_REPORT_TEXT);

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
    const result = await svc.fetchAndCompare('PODD', PODD_REPORT_TEXT);

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
      const futureDate = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
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
    const result = await svc.fetchAndCompare('PODD', PODD_REPORT_TEXT);

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
    await svc.fetchAndCompare('TEST', PODD_REPORT_TEXT);

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
    await svc.fetchAndCompare('TEST', PODD_REPORT_TEXT);

    const diffCalls = logSpy.mock.calls.filter(c =>
      typeof c[0] === 'string' && c[0].includes('consensus source diff'),
    );
    expect(diffCalls).toHaveLength(0);

    logSpy.mockRestore();
  });
});
