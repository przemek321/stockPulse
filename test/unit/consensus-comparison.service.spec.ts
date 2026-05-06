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
import {
  ConsensusComparisonService,
  computeSurprisePct,
  formatConsensusBlock,
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
