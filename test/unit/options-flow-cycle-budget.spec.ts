/**
 * S19-FIX-04: testy outer cycle budget w OptionsFlowService.collect().
 *
 * Trigger: 17.04.2026 + 29.04.2026 produkcja: runCollectionCycle 11h 25min /
 * 11h 36min. Sprint 16b FIX-04 (commit d78a92f) dodał per-request timeout 30s
 * (`AbortSignal.timeout(POLYGON_FETCH_TIMEOUT_MS)`), ale to zatrzymuje TYLKO
 * pojedynczy zawieszony fetch — nie cały sekwencyjny cykl iterujący 42 tickers
 * × ~50 contracts × (12.5s rate limit + fetch).
 *
 * Math: 42 × 52 = 2184 requests × 12.5s = 7.6h lower bound; w praktyce 11h+
 * ze względu na rate limit pauses (60s) + slow fetches.
 *
 * Fix: outer AbortController z budget 6h + AbortSignal.any() łączący per-fetch
 * timeout z cycle budget + delay() respektujący abort + cap 50 contracts/ticker
 * + abort check przed każdym ticker i contract.
 */

import { OptionsFlowService } from '../../src/collectors/options-flow/options-flow.service';

describe('OptionsFlowService.delay — abort signal support (S19-FIX-04)', () => {
  function buildService() {
    const svc = new OptionsFlowService(
      {} as any, // collectionLogRepo
      {} as any, // flowRepo
      {} as any, // baselineRepo
      {} as any, // tickerRepo
      { get: jest.fn(() => '') } as any, // config
      {} as any, // eventEmitter
    );
    return svc;
  }

  it('delay(ms) bez signal → resolves po ms', async () => {
    const svc = buildService();
    const start = Date.now();
    await (svc as any).delay(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(45);
    expect(elapsed).toBeLessThan(150);
  });

  it('delay(ms, signal) gdy signal już aborted → reject natychmiast (nie 10s)', async () => {
    const svc = buildService();
    const ctrl = new AbortController();
    ctrl.abort();
    const start = Date.now();
    await expect((svc as any).delay(10_000, ctrl.signal)).rejects.toThrow(/AbortError/);
    const elapsed = Date.now() - start;
    // Threshold 500ms żeby tolerować Jetson pod obciążeniem parallel suite —
    // istota testu to "nie 10 000ms", a nie sub-50ms latency.
    expect(elapsed).toBeLessThan(500);
  });

  it('delay(ms, signal) gdy abort fire w trakcie → reject + clearTimeout (nie 10s)', async () => {
    const svc = buildService();
    const ctrl = new AbortController();
    const start = Date.now();
    setTimeout(() => ctrl.abort(), 30);
    await expect((svc as any).delay(10_000, ctrl.signal)).rejects.toThrow(/AbortError/);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(20);
    expect(elapsed).toBeLessThan(500); // tolerancja Jetson load
  });

  it('delay(ms, signal) gdy signal nigdy nie abort → resolves normalnie', async () => {
    const svc = buildService();
    const ctrl = new AbortController();
    const start = Date.now();
    await (svc as any).delay(50, ctrl.signal);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(45);
    expect(elapsed).toBeLessThan(150);
  });
});

describe('OptionsFlowService.buildFetchSignal — combined timeout + cycle (S19-FIX-04)', () => {
  function buildService() {
    return new OptionsFlowService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { get: jest.fn(() => '') } as any,
      {} as any,
    );
  }

  it('bez cycleSignal → zwraca tylko AbortSignal.timeout(30s)', () => {
    const svc = buildService();
    const sig = (svc as any).buildFetchSignal();
    expect(sig).toBeInstanceOf(AbortSignal);
    expect(sig.aborted).toBe(false);
  });

  it('z aborted cycleSignal → combined signal jest aborted', () => {
    const svc = buildService();
    const ctrl = new AbortController();
    ctrl.abort();
    const sig = (svc as any).buildFetchSignal(ctrl.signal);
    expect(sig.aborted).toBe(true);
  });

  it('combined signal: cycle abort propaguje', async () => {
    const svc = buildService();
    const ctrl = new AbortController();
    const sig = (svc as any).buildFetchSignal(ctrl.signal);
    expect(sig.aborted).toBe(false);
    ctrl.abort();
    expect(sig.aborted).toBe(true);
  });
});

describe('OptionsFlowService.collect — cycle budget abort (S19-FIX-04)', () => {
  function buildService(opts: { tickers: string[] }) {
    const tickerRepo = {
      find: jest.fn().mockResolvedValue(opts.tickers.map((s) => ({ symbol: s, isActive: true }))),
    };
    const config = { get: jest.fn((_k: string, def?: string) => 'fake-api-key') };
    const svc = new OptionsFlowService(
      {} as any,
      {} as any,
      {} as any,
      tickerRepo as any,
      config as any,
      {} as any,
    );
    return { svc, tickerRepo };
  }

  it('cycle budget nie fire (default 6h) → wszystkie tickers processed', async () => {
    const { svc } = buildService({ tickers: ['AAPL', 'GOOG', 'MSFT'] });
    jest.spyOn(svc as any, 'collectForSymbol').mockResolvedValue(2);

    const result = await svc.collect();

    expect(result).toBe(6); // 3 × 2 = 6
  });

  it('brak POLYGON_API_KEY → return 0 bez setTimeout', async () => {
    const tickerRepo = { find: jest.fn() };
    const config = { get: jest.fn(() => '') }; // pusty klucz
    const svc = new OptionsFlowService(
      {} as any,
      {} as any,
      {} as any,
      tickerRepo as any,
      config as any,
      {} as any,
    );

    const result = await svc.collect();
    expect(result).toBe(0);
    expect(tickerRepo.find).not.toHaveBeenCalled();
  });

  it('collectForSymbol throws non-abort error → continue z następnym tickerem', async () => {
    const { svc } = buildService({ tickers: ['AAPL', 'GOOG', 'MSFT'] });

    const collectSpy = jest
      .spyOn(svc as any, 'collectForSymbol')
      .mockImplementationOnce(async () => 5)
      .mockImplementationOnce(async () => {
        throw new Error('Polygon HTTP 500');
      })
      .mockImplementationOnce(async () => 3);

    const result = await svc.collect();

    // Non-abort error: log warn + continue → AAPL=5 + (GOOG fail) + MSFT=3 = 8
    expect(result).toBe(8);
    expect(collectSpy).toHaveBeenCalledTimes(3);
  });
});
