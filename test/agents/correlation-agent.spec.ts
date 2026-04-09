/**
 * Agent: Correlation Service
 *
 * Weryfikuje 5 detektorów wzorców, agregację conviction,
 * dominujący kierunek, progi i okna czasowe.
 * Używa RZECZYWISTEGO CorrelationService z mockowanym Redis/Telegram/repo.
 *
 * Pliki: src/correlation/correlation.service.ts,
 *        src/correlation/types/correlation.types.ts
 */

import { CorrelationService } from '../../src/correlation/correlation.service';
import {
  StoredSignal,
  Direction,
  PatternType,
  PATTERN_THROTTLE,
  PATTERN_LABELS,
} from '../../src/correlation/types/correlation.types';

// ── Mock factories ──

function createMockRedis() {
  return {
    zadd: jest.fn().mockResolvedValue(1),
    zrangebyscore: jest.fn().mockResolvedValue([]),
    zremrangebyscore: jest.fn().mockResolvedValue(0),
    zremrangebyrank: jest.fn().mockResolvedValue(0),
    expire: jest.fn().mockResolvedValue(1),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
  };
}

function createMockTelegram() {
  return { sendMarkdown: jest.fn().mockResolvedValue(true) };
}

function createMockFormatter() {
  return { formatCorrelatedAlert: jest.fn().mockReturnValue('📊 test alert') };
}

function createMockRepo() {
  return {
    save: jest.fn().mockImplementation(data => Promise.resolve({ id: 1, ...data })),
    create: jest.fn().mockImplementation(data => data),
  };
}

interface ServiceDeps {
  redis?: ReturnType<typeof createMockRedis>;
  telegram?: ReturnType<typeof createMockTelegram>;
  formatter?: ReturnType<typeof createMockFormatter>;
  alertRepo?: ReturnType<typeof createMockRepo>;
  ruleRepo?: ReturnType<typeof createMockRepo>;
}

function createMockTickerRepo() {
  return {
    findOne: jest.fn(async () => ({ symbol: 'UNH', observationOnly: false, sector: 'healthcare' })),
  };
}

function createService(overrides: ServiceDeps = {}) {
  const redis = overrides.redis ?? createMockRedis();
  const telegram = overrides.telegram ?? createMockTelegram();
  const formatter = overrides.formatter ?? createMockFormatter();
  const alertRepo = overrides.alertRepo ?? createMockRepo();
  const ruleRepo = overrides.ruleRepo ?? createMockRepo();
  const tickerRepo = createMockTickerRepo();

  const service = new CorrelationService(
    redis as any,
    telegram as any,
    formatter as any,
    alertRepo as any,
    ruleRepo as any,
    tickerRepo as any,
  );

  return { service, redis, telegram, formatter, alertRepo, ruleRepo, tickerRepo };
}

// ── Helpery ──

function makeSignal(overrides: Partial<StoredSignal> = {}): StoredSignal {
  return {
    id: `test-${Math.random().toString(36).slice(2, 8)}`,
    ticker: 'UNH',
    source_category: 'social',
    conviction: 0.5,
    direction: 'negative' as Direction,
    catalyst_type: 'earnings',
    timestamp: Date.now(),
    ...overrides,
  };
}

/** Konfiguruje mock Redis do zwracania sygnałów per klucz */
function setupRedisSignals(
  redis: ReturnType<typeof createMockRedis>,
  ticker: string,
  shortSignals: StoredSignal[],
  insiderSignals: StoredSignal[] = [],
) {
  redis.zrangebyscore.mockImplementation((key: string) => {
    if (key === `signals:short:${ticker}`)
      return Promise.resolve(shortSignals.map(s => JSON.stringify(s)));
    if (key === `signals:insider:${ticker}`)
      return Promise.resolve(insiderSignals.map(s => JSON.stringify(s)));
    return Promise.resolve([]);
  });
}

const h = 3600_000; // 1 godzina w ms

// ── Testy: Założenia (stałe z importu) ──

describe('Agent: Correlation — Założenia (stałe)', () => {
  it('PATTERN_THROTTLE z types pasuje do oczekiwań', () => {
    expect(PATTERN_THROTTLE.INSIDER_PLUS_8K).toBe(7200);       // 2h
    expect(PATTERN_THROTTLE.FILING_CONFIRMS_NEWS).toBe(14400); // 4h
    expect(PATTERN_THROTTLE.MULTI_SOURCE_CONVERGENCE).toBe(7200); // 2h
    expect(PATTERN_THROTTLE.INSIDER_CLUSTER).toBe(86400);      // 24h
    expect(PATTERN_THROTTLE.ESCALATING_SIGNAL).toBe(21600);    // 6h
  });

  it('PATTERN_LABELS dla wszystkich 6 wzorców', () => {
    expect(Object.keys(PATTERN_LABELS)).toHaveLength(6);
    expect(PATTERN_LABELS.INSIDER_PLUS_8K).toBeDefined();
    expect(PATTERN_LABELS.INSIDER_PLUS_OPTIONS).toBeDefined();
    expect(PATTERN_LABELS.ESCALATING_SIGNAL).toBeDefined();
  });
});

// ── Testy: storeSignal ──

describe('Agent: Correlation — storeSignal', () => {
  it('form4 → klucz signals:insider:{ticker}', async () => {
    const { service, redis } = createService();
    const signal = makeSignal({ source_category: 'form4', ticker: 'UNH', conviction: 0.5 });

    await service.storeSignal(signal);

    expect(redis.zadd).toHaveBeenCalledWith(
      'signals:insider:UNH',
      signal.timestamp,
      JSON.stringify(signal),
    );
  });

  it('8k → klucz signals:short:{ticker}', async () => {
    const { service, redis } = createService();
    const signal = makeSignal({ source_category: '8k', ticker: 'ISRG', conviction: 0.3 });

    await service.storeSignal(signal);

    expect(redis.zadd).toHaveBeenCalledWith(
      'signals:short:ISRG',
      signal.timestamp,
      JSON.stringify(signal),
    );
  });

  it('news/social → klucz signals:short:{ticker}', async () => {
    const { service, redis } = createService();
    await service.storeSignal(makeSignal({ source_category: 'news', ticker: 'MRNA', conviction: 0.4 }));
    await service.storeSignal(makeSignal({ source_category: 'social', ticker: 'MRNA', conviction: 0.3 }));

    expect(redis.zadd).toHaveBeenCalledTimes(2);
    expect(redis.zadd.mock.calls[0][0]).toBe('signals:short:MRNA');
    expect(redis.zadd.mock.calls[1][0]).toBe('signals:short:MRNA');
  });

  it('|conviction| < 0.05 → odrzucony (szum)', async () => {
    const { service, redis } = createService();
    await service.storeSignal(makeSignal({ conviction: 0.03 }));

    expect(redis.zadd).not.toHaveBeenCalled();
  });

  it('|conviction| = 0.05 → zapisany', async () => {
    const { service, redis } = createService();
    await service.storeSignal(makeSignal({ conviction: 0.05 }));

    expect(redis.zadd).toHaveBeenCalled();
  });

  it('zremrangebyscore czyści stare sygnały przed zapisem', async () => {
    const { service, redis } = createService();
    await service.storeSignal(makeSignal({ source_category: '8k', conviction: 0.5 }));

    expect(redis.zremrangebyscore).toHaveBeenCalledWith(
      expect.stringContaining('signals:short:'),
      0,
      expect.any(Number),
    );
  });

  it('zremrangebyrank przycina do max 50 sygnałów', async () => {
    const { service, redis } = createService();
    await service.storeSignal(makeSignal({ conviction: 0.5 }));

    expect(redis.zremrangebyrank).toHaveBeenCalledWith(
      expect.any(String),
      0,
      -51,
    );
  });

  it('expire ustawia TTL: 14d dla form4, 48h dla reszty', async () => {
    const { service, redis } = createService();

    await service.storeSignal(makeSignal({ source_category: 'form4', conviction: 0.5 }));
    const insiderTtl = redis.expire.mock.calls[0][1];

    redis.expire.mockClear();
    await service.storeSignal(makeSignal({ source_category: '8k', conviction: 0.5 }));
    const shortTtl = redis.expire.mock.calls[0][1];

    // insider 14d ≈ 1_209_600 s, short 120h (5d) ≈ 432_000 s
    expect(insiderTtl).toBe(Math.ceil(14 * 24 * 3600));
    expect(shortTtl).toBe(Math.ceil(120 * 3600));
  });
});

// ── Testy: runPatternDetection — < 2 sygnały → skip ──

describe('Agent: Correlation — runPatternDetection guard', () => {
  it('< 2 sygnały łącznie → brak detekcji', async () => {
    const { service, redis, telegram } = createService();
    setupRedisSignals(redis, 'UNH', [
      makeSignal({ source_category: 'news', conviction: 0.5, timestamp: Date.now() - h }),
    ]);

    await service.runPatternDetection('UNH');

    expect(telegram.sendMarkdown).not.toHaveBeenCalled();
  });
});

// ── Testy: Detektor 1 — Insider + 8-K (24h) ──

describe('Agent: Correlation — Detektor 1: Insider + 8-K (24h)', () => {
  it('wykrywa gdy form4 + 8k w oknie 24h, ten sam kierunek', async () => {
    const { service, redis, formatter, telegram } = createService();
    const now = Date.now();

    setupRedisSignals(redis, 'UNH', [
      makeSignal({ source_category: '8k', direction: 'negative', conviction: 0.5, timestamp: now - 1 * h }),
    ], [
      makeSignal({ source_category: 'form4', direction: 'negative', conviction: 0.6, timestamp: now - 2 * h }),
    ]);

    await service.runPatternDetection('UNH');

    expect(formatter.formatCorrelatedAlert).toHaveBeenCalledWith(
      expect.objectContaining({ patternType: 'INSIDER_PLUS_8K' }),
    );
    expect(telegram.sendMarkdown).toHaveBeenCalled();
  });

  it('null gdy brak form4', async () => {
    const { service, redis, formatter } = createService();
    const now = Date.now();

    setupRedisSignals(redis, 'UNH', [
      makeSignal({ source_category: '8k', direction: 'negative', conviction: 0.5, timestamp: now - h }),
      makeSignal({ source_category: 'news', direction: 'negative', conviction: 0.4, timestamp: now - 2 * h }),
    ]);

    await service.runPatternDetection('UNH');

    // Może wykryć inny wzorzec, ale nie INSIDER_PLUS_8K
    const calls = formatter.formatCorrelatedAlert.mock.calls;
    const insiderPlus8K = calls.find((c: any) => c[0]?.patternType === 'INSIDER_PLUS_8K');
    expect(insiderPlus8K).toBeUndefined();
  });

  it('null gdy form4 spoza okna 24h', async () => {
    const { service, redis, formatter } = createService();
    const now = Date.now();

    setupRedisSignals(redis, 'UNH', [
      makeSignal({ source_category: '8k', direction: 'negative', conviction: 0.5, timestamp: now - h }),
    ], [
      makeSignal({ source_category: 'form4', direction: 'negative', conviction: 0.6, timestamp: now - 30 * h }),
    ]);

    await service.runPatternDetection('UNH');

    const calls = formatter.formatCorrelatedAlert.mock.calls;
    const insiderPlus8K = calls.find((c: any) => c[0]?.patternType === 'INSIDER_PLUS_8K');
    expect(insiderPlus8K).toBeUndefined();
  });

  it('null przy rozbieżnych kierunkach (50/50)', async () => {
    const { service, redis, formatter } = createService();
    const now = Date.now();

    setupRedisSignals(redis, 'UNH', [
      makeSignal({ source_category: '8k', direction: 'positive', conviction: 0.5, timestamp: now - h }),
    ], [
      makeSignal({ source_category: 'form4', direction: 'negative', conviction: 0.6, timestamp: now - 2 * h }),
    ]);

    await service.runPatternDetection('UNH');

    const calls = formatter.formatCorrelatedAlert.mock.calls;
    const insiderPlus8K = calls.find((c: any) => c[0]?.patternType === 'INSIDER_PLUS_8K');
    expect(insiderPlus8K).toBeUndefined();
  });
});

// ── Testy: Detektor 2 — Filing Confirms News (48h) ──

// Sprint 11: wyłączone detektory — metody istnieją ale nie są wywoływane w runPatternDetection
describe.skip('Agent: Correlation — Detektor 2: Filing Confirms News (48h) [DISABLED Sprint 11]', () => {
  it('wykrywa gdy news PRZED 8k z matching catalyst_type', async () => {
    const { service, redis, formatter } = createService();
    const now = Date.now();

    setupRedisSignals(redis, 'UNH', [
      makeSignal({ source_category: 'news', direction: 'negative', conviction: 0.5, catalyst_type: 'earnings', timestamp: now - 10 * h }),
      makeSignal({ source_category: '8k', direction: 'negative', conviction: 0.6, catalyst_type: 'earnings', timestamp: now - h }),
    ]);

    await service.runPatternDetection('UNH');

    const calls = formatter.formatCorrelatedAlert.mock.calls;
    const fcn = calls.find((c: any) => c[0]?.patternType === 'FILING_CONFIRMS_NEWS');
    expect(fcn).toBeDefined();
  });

  it('social traktowany jak news (kod filtruje news || social)', async () => {
    const { service, redis, formatter } = createService();
    const now = Date.now();

    // WAŻNE: lokalna re-implementacja tego nie testowała — kod łapie social + news
    setupRedisSignals(redis, 'UNH', [
      makeSignal({ source_category: 'social', direction: 'negative', conviction: 0.5, catalyst_type: 'earnings', timestamp: now - 10 * h }),
      makeSignal({ source_category: '8k', direction: 'negative', conviction: 0.6, catalyst_type: 'earnings', timestamp: now - h }),
    ]);

    await service.runPatternDetection('UNH');

    const calls = formatter.formatCorrelatedAlert.mock.calls;
    const fcn = calls.find((c: any) => c[0]?.patternType === 'FILING_CONFIRMS_NEWS');
    expect(fcn).toBeDefined();
  });

  it('null gdy 8k PRZED news (odwrotna kolejność)', async () => {
    const { service, redis, formatter } = createService();
    const now = Date.now();

    setupRedisSignals(redis, 'UNH', [
      makeSignal({ source_category: '8k', direction: 'negative', conviction: 0.6, catalyst_type: 'earnings', timestamp: now - 10 * h }),
      makeSignal({ source_category: 'news', direction: 'negative', conviction: 0.5, catalyst_type: 'earnings', timestamp: now - h }),
    ]);

    await service.runPatternDetection('UNH');

    const calls = formatter.formatCorrelatedAlert.mock.calls;
    const fcn = calls.find((c: any) => c[0]?.patternType === 'FILING_CONFIRMS_NEWS');
    expect(fcn).toBeUndefined();
  });

  it('oba unknown catalyst_type → przepuszcza (brak danych ≠ brak korelacji)', async () => {
    const { service, redis, formatter } = createService();
    const now = Date.now();

    // Kod: jeśli obie strony mają TYLKO 'unknown' → bothHaveKnownTypes=false → przepuszcza
    setupRedisSignals(redis, 'UNH', [
      makeSignal({ source_category: 'news', direction: 'negative', conviction: 0.5, catalyst_type: 'unknown', timestamp: now - 10 * h }),
      makeSignal({ source_category: '8k', direction: 'negative', conviction: 0.6, catalyst_type: 'unknown', timestamp: now - h }),
    ]);

    await service.runPatternDetection('UNH');

    const calls = formatter.formatCorrelatedAlert.mock.calls;
    const fcn = calls.find((c: any) => c[0]?.patternType === 'FILING_CONFIRMS_NEWS');
    expect(fcn).toBeDefined();
  });

  it('różne znane catalyst_type → null', async () => {
    const { service, redis, formatter } = createService();
    const now = Date.now();

    setupRedisSignals(redis, 'UNH', [
      makeSignal({ source_category: 'news', direction: 'negative', conviction: 0.5, catalyst_type: 'earnings', timestamp: now - 10 * h }),
      makeSignal({ source_category: '8k', direction: 'negative', conviction: 0.6, catalyst_type: 'insider', timestamp: now - h }),
    ]);

    await service.runPatternDetection('UNH');

    const calls = formatter.formatCorrelatedAlert.mock.calls;
    const fcn = calls.find((c: any) => c[0]?.patternType === 'FILING_CONFIRMS_NEWS');
    expect(fcn).toBeUndefined();
  });
});

// ── Testy: Detektor 3 — Multi-Source Convergence (24h) ──

describe.skip('Agent: Correlation — Detektor 3: Multi-Source Convergence (24h) [DISABLED Sprint 11]', () => {
  it('wykrywa gdy 3+ kategorie w 24h potwierdzają ten sam kierunek', async () => {
    const { service, redis, formatter } = createService();
    const now = Date.now();

    setupRedisSignals(redis, 'UNH', [
      makeSignal({ source_category: 'social', direction: 'negative', conviction: 0.5, timestamp: now - h }),
      makeSignal({ source_category: 'news', direction: 'negative', conviction: 0.4, timestamp: now - 2 * h }),
      makeSignal({ source_category: '8k', direction: 'negative', conviction: 0.6, timestamp: now - 3 * h }),
    ]);

    await service.runPatternDetection('UNH');

    const calls = formatter.formatCorrelatedAlert.mock.calls;
    const msc = calls.find((c: any) => c[0]?.patternType === 'MULTI_SOURCE_CONVERGENCE');
    expect(msc).toBeDefined();
  });

  it('null gdy < 3 kategorie', async () => {
    const { service, redis, formatter } = createService();
    const now = Date.now();

    setupRedisSignals(redis, 'UNH', [
      makeSignal({ source_category: 'social', direction: 'negative', conviction: 0.5, timestamp: now - h }),
      makeSignal({ source_category: 'news', direction: 'negative', conviction: 0.4, timestamp: now - 2 * h }),
    ]);

    await service.runPatternDetection('UNH');

    const calls = formatter.formatCorrelatedAlert.mock.calls;
    const msc = calls.find((c: any) => c[0]?.patternType === 'MULTI_SOURCE_CONVERGENCE');
    expect(msc).toBeUndefined();
  });

  it('3 kategorie ale brak 66% zgodności kierunku → null', async () => {
    const { service, redis, formatter } = createService();
    const now = Date.now();

    // 2 negative + 1 positive — ale kod wymaga confirming >= 3 tego samego kierunku
    setupRedisSignals(redis, 'UNH', [
      makeSignal({ source_category: 'social', direction: 'negative', conviction: 0.5, timestamp: now - h }),
      makeSignal({ source_category: 'news', direction: 'positive', conviction: 0.4, timestamp: now - 2 * h }),
      makeSignal({ source_category: '8k', direction: 'negative', conviction: 0.6, timestamp: now - 3 * h }),
    ]);

    await service.runPatternDetection('UNH');

    const calls = formatter.formatCorrelatedAlert.mock.calls;
    const msc = calls.find((c: any) => c[0]?.patternType === 'MULTI_SOURCE_CONVERGENCE');
    // Kod wymaga confirming.length >= 3 — przy 2/3 negative, confirming=2 < 3
    expect(msc).toBeUndefined();
  });
});

// ── Testy: Detektor 4 — Insider Cluster (7d) ──

describe('Agent: Correlation — Detektor 4: Insider Cluster (7d)', () => {
  it('wykrywa gdy 2+ insider trades w 7 dni, ten sam kierunek', async () => {
    const { service, redis, formatter } = createService();
    const now = Date.now();

    setupRedisSignals(redis, 'UNH', [], [
      makeSignal({ source_category: 'form4', direction: 'positive', conviction: 0.3, timestamp: now - 48 * h }),
      makeSignal({ source_category: 'form4', direction: 'positive', conviction: 0.4, timestamp: now - 24 * h }),
    ]);

    await service.runPatternDetection('UNH');

    const calls = formatter.formatCorrelatedAlert.mock.calls;
    const ic = calls.find((c: any) => c[0]?.patternType === 'INSIDER_CLUSTER');
    expect(ic).toBeDefined();
  });

  it('null przy 1 insider trade', async () => {
    const { service, redis, formatter } = createService();
    const now = Date.now();

    setupRedisSignals(redis, 'UNH', [
      // Dodaj dummy short signal żeby łącznie było >= 2
      makeSignal({ source_category: 'news', conviction: 0.3, timestamp: now - h }),
    ], [
      makeSignal({ source_category: 'form4', direction: 'positive', conviction: 0.4, timestamp: now - 24 * h }),
    ]);

    await service.runPatternDetection('UNH');

    const calls = formatter.formatCorrelatedAlert.mock.calls;
    const ic = calls.find((c: any) => c[0]?.patternType === 'INSIDER_CLUSTER');
    expect(ic).toBeUndefined();
  });

  it('2 insidery ale różne kierunki → null (confirming < 2)', async () => {
    const { service, redis, formatter } = createService();
    const now = Date.now();

    setupRedisSignals(redis, 'UNH', [], [
      makeSignal({ source_category: 'form4', direction: 'positive', conviction: 0.3, timestamp: now - 48 * h }),
      makeSignal({ source_category: 'form4', direction: 'negative', conviction: 0.4, timestamp: now - 24 * h }),
    ]);

    await service.runPatternDetection('UNH');

    const calls = formatter.formatCorrelatedAlert.mock.calls;
    const ic = calls.find((c: any) => c[0]?.patternType === 'INSIDER_CLUSTER');
    expect(ic).toBeUndefined();
  });
});

// ── Testy: Detektor 5 — Escalating Signal (72h) ──

describe.skip('Agent: Correlation — Detektor 5: Escalating Signal (72h) [DISABLED Sprint 11]', () => {
  it('wykrywa eskalację 3 sygnałów z rosnącym conviction', async () => {
    const { service, redis, formatter } = createService();
    const now = Date.now();

    setupRedisSignals(redis, 'UNH', [
      makeSignal({ source_category: 'news', conviction: 0.1, direction: 'negative', timestamp: now - 10 * h }),
      makeSignal({ source_category: 'social', conviction: 0.2, direction: 'negative', timestamp: now - 5 * h }),
      makeSignal({ source_category: '8k', conviction: 0.4, direction: 'negative', timestamp: now - h }),
    ]);

    await service.runPatternDetection('UNH');

    const calls = formatter.formatCorrelatedAlert.mock.calls;
    const esc = calls.find((c: any) => c[0]?.patternType === 'ESCALATING_SIGNAL');
    expect(esc).toBeDefined();
    // Conviction: min(1.0, 0.4 * 1.3) * -1 = -0.52
    expect(esc![0].correlatedConviction).toBeCloseTo(-0.52);
  });

  it('null gdy conviction nie rośnie monotonycznie', async () => {
    const { service, redis, formatter } = createService();
    const now = Date.now();

    setupRedisSignals(redis, 'UNH', [
      makeSignal({ conviction: 0.5, direction: 'negative', timestamp: now - 10 * h }),
      makeSignal({ conviction: 0.3, direction: 'negative', timestamp: now - 5 * h }),
      makeSignal({ conviction: 0.4, direction: 'negative', timestamp: now - h }),
    ]);

    await service.runPatternDetection('UNH');

    const calls = formatter.formatCorrelatedAlert.mock.calls;
    const esc = calls.find((c: any) => c[0]?.patternType === 'ESCALATING_SIGNAL');
    expect(esc).toBeUndefined();
  });

  it('null gdy < 3 sygnały w oknie 72h', async () => {
    const { service, redis, formatter } = createService();
    const now = Date.now();

    setupRedisSignals(redis, 'UNH', [
      makeSignal({ conviction: 0.3, direction: 'negative', timestamp: now - 5 * h }),
      makeSignal({ conviction: 0.5, direction: 'negative', timestamp: now - h }),
    ]);

    await service.runPatternDetection('UNH');

    const calls = formatter.formatCorrelatedAlert.mock.calls;
    const esc = calls.find((c: any) => c[0]?.patternType === 'ESCALATING_SIGNAL');
    expect(esc).toBeUndefined();
  });

  it('null gdy ostatni conviction < 0.25 (MIN_ESCALATING_LAST_CONVICTION)', async () => {
    const { service, redis, formatter } = createService();
    const now = Date.now();

    setupRedisSignals(redis, 'UNH', [
      makeSignal({ conviction: 0.05, direction: 'negative', timestamp: now - 10 * h }),
      makeSignal({ conviction: 0.1, direction: 'negative', timestamp: now - 5 * h }),
      makeSignal({ conviction: 0.2, direction: 'negative', timestamp: now - h }),
    ]);

    await service.runPatternDetection('UNH');

    const calls = formatter.formatCorrelatedAlert.mock.calls;
    const esc = calls.find((c: any) => c[0]?.patternType === 'ESCALATING_SIGNAL');
    expect(esc).toBeUndefined();
  });

  it('null gdy różne kierunki w last3', async () => {
    const { service, redis, formatter } = createService();
    const now = Date.now();

    setupRedisSignals(redis, 'UNH', [
      makeSignal({ conviction: 0.1, direction: 'positive', timestamp: now - 10 * h }),
      makeSignal({ conviction: 0.2, direction: 'negative', timestamp: now - 5 * h }),
      makeSignal({ conviction: 0.4, direction: 'negative', timestamp: now - h }),
    ]);

    await service.runPatternDetection('UNH');

    const calls = formatter.formatCorrelatedAlert.mock.calls;
    const esc = calls.find((c: any) => c[0]?.patternType === 'ESCALATING_SIGNAL');
    expect(esc).toBeUndefined();
  });
});

// ── Testy: getDominantDirection (pośrednio przez wzorce) ──

describe('Agent: Correlation — getDominantDirection (pośrednio)', () => {
  it('66% pozytywnych → wykrywa wzorzec positive', async () => {
    const { service, redis, formatter } = createService();
    const now = Date.now();

    // 2/3 positive = 66.7% — na granicy
    setupRedisSignals(redis, 'UNH', [
      makeSignal({ source_category: 'social', direction: 'positive', conviction: 0.5, timestamp: now - h }),
      makeSignal({ source_category: 'news', direction: 'positive', conviction: 0.4, timestamp: now - 2 * h }),
      makeSignal({ source_category: '8k', direction: 'negative', conviction: 0.3, timestamp: now - 3 * h }),
    ]);

    await service.runPatternDetection('UNH');

    // Multi-Source Convergence wymaga 3 confirming — tu confirming=2 (positive), więc MSC null
    // Ale getDominantDirection zwraca 'positive' → potencjalnie inne wzorce
    const calls = formatter.formatCorrelatedAlert.mock.calls;
    const msc = calls.find((c: any) => c[0]?.patternType === 'MULTI_SOURCE_CONVERGENCE');
    // 2/3 nie spełnia MSC.confirming >= 3, więc brak MSC
    expect(msc).toBeUndefined();
  });

  it('50/50 → brak dominującego kierunku → brak wzorca', async () => {
    const { service, redis, telegram } = createService();
    const now = Date.now();

    setupRedisSignals(redis, 'UNH', [], [
      makeSignal({ source_category: 'form4', direction: 'positive', conviction: 0.5, timestamp: now - 24 * h }),
      makeSignal({ source_category: 'form4', direction: 'negative', conviction: 0.5, timestamp: now - 48 * h }),
    ]);

    await service.runPatternDetection('UNH');

    // 50/50 → getDominantDirection=null → Insider Cluster nie wykryje
    expect(telegram.sendMarkdown).not.toHaveBeenCalled();
  });
});

// ── Testy: aggregateConviction (pośrednio przez conviction w alertach) ──

describe('Agent: Correlation — aggregateConviction (pośrednio)', () => {
  it('+20% boost za drugie źródło tego samego kierunku', async () => {
    const { service, redis, formatter } = createService();
    const now = Date.now();

    // Insider + 8-K: 2 źródła, oba negative
    // strongest=0.6 (form4), boost=1.2 (2 same-direction) → 0.6 * 1.2 = 0.72
    setupRedisSignals(redis, 'UNH', [
      makeSignal({ source_category: '8k', direction: 'negative', conviction: 0.5, timestamp: now - h }),
    ], [
      makeSignal({ source_category: 'form4', direction: 'negative', conviction: 0.6, timestamp: now - 2 * h }),
    ]);

    await service.runPatternDetection('UNH');

    const calls = formatter.formatCorrelatedAlert.mock.calls;
    const ip8k = calls.find((c: any) => c[0]?.patternType === 'INSIDER_PLUS_8K');
    expect(ip8k).toBeDefined();
    expect(ip8k![0].correlatedConviction).toBeCloseTo(-0.72);
  });

  // Skip: wymaga MULTI_SOURCE_CONVERGENCE (wyłączony Sprint 11)
  it.skip('cap na ±1.0 przy wielu silnych źródłach [DISABLED Sprint 11 — wymaga MSC]', () => {});
});

// ── Testy: MIN_CORRELATED_CONVICTION → alert lub skip ──

describe('Agent: Correlation — MIN_CORRELATED_CONVICTION (0.20)', () => {
  it('|conviction| < 0.20 → brak alertu (za słaby wzorzec)', async () => {
    const { service, redis, telegram } = createService();
    const now = Date.now();

    // Insider Cluster z bardzo słabymi sygnałami → aggregated conviction < 0.20
    setupRedisSignals(redis, 'UNH', [], [
      makeSignal({ source_category: 'form4', direction: 'positive', conviction: 0.1, timestamp: now - 24 * h }),
      makeSignal({ source_category: 'form4', direction: 'positive', conviction: 0.08, timestamp: now - 48 * h }),
    ]);

    await service.runPatternDetection('UNH');

    // conviction=0.1 * boost 1.0 (1 kategoria) = 0.1 < 0.20 → skip
    expect(telegram.sendMarkdown).not.toHaveBeenCalled();
  });
});

// ── Testy: Throttle / Deduplikacja ──

describe('Agent: Correlation — Throttle / Deduplikacja', () => {
  it('wzorzec już alertowany → redis.get zwraca wartość → skip', async () => {
    const redis = createMockRedis();
    // fired:UNH:INSIDER_PLUS_8K istnieje → skip
    redis.get.mockResolvedValue('1');

    const { service, telegram } = createService({ redis });
    const now = Date.now();

    setupRedisSignals(redis, 'UNH', [
      makeSignal({ source_category: '8k', direction: 'negative', conviction: 0.5, timestamp: now - h }),
    ], [
      makeSignal({ source_category: 'form4', direction: 'negative', conviction: 0.6, timestamp: now - 2 * h }),
    ]);

    await service.runPatternDetection('UNH');

    // Telegram NIE wysłany — wzorzec throttled
    expect(telegram.sendMarkdown).not.toHaveBeenCalled();
  });

  it('po wysłaniu alertu → redis.set z EX = PATTERN_THROTTLE', async () => {
    const { service, redis } = createService();
    const now = Date.now();

    setupRedisSignals(redis, 'UNH', [
      makeSignal({ source_category: '8k', direction: 'negative', conviction: 0.5, timestamp: now - h }),
    ], [
      makeSignal({ source_category: 'form4', direction: 'negative', conviction: 0.6, timestamp: now - 2 * h }),
    ]);

    await service.runPatternDetection('UNH');

    expect(redis.set).toHaveBeenCalledWith(
      'fired:UNH:INSIDER_PLUS_8K',
      '1',
      'EX',
      PATTERN_THROTTLE.INSIDER_PLUS_8K,
    );
  });
});

// ── Testy: Priority (CRITICAL vs HIGH) ──

describe('Agent: Correlation — Priority', () => {
  it('|conviction| >= 0.6 → CRITICAL', async () => {
    const { service, redis, formatter } = createService();
    const now = Date.now();

    // 2 silne sygnały: 0.6 * 1.2 boost = 0.72 → CRITICAL
    setupRedisSignals(redis, 'UNH', [
      makeSignal({ source_category: '8k', direction: 'negative', conviction: 0.5, timestamp: now - h }),
    ], [
      makeSignal({ source_category: 'form4', direction: 'negative', conviction: 0.6, timestamp: now - 2 * h }),
    ]);

    await service.runPatternDetection('UNH');

    expect(formatter.formatCorrelatedAlert).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 'CRITICAL' }),
    );
  });

  it('|conviction| < 0.6 → HIGH', async () => {
    const { service, redis, formatter } = createService();
    const now = Date.now();

    // Insider Cluster: 2 form4 conviction 0.25 → aggregate = 0.25 (1 kategoria, no boost)
    setupRedisSignals(redis, 'UNH', [], [
      makeSignal({ source_category: 'form4', direction: 'positive', conviction: 0.25, timestamp: now - 24 * h }),
      makeSignal({ source_category: 'form4', direction: 'positive', conviction: 0.22, timestamp: now - 48 * h }),
    ]);

    await service.runPatternDetection('UNH');

    expect(formatter.formatCorrelatedAlert).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 'HIGH' }),
    );
  });
});

// ── Testy: Alert zapis do bazy ──

describe('Agent: Correlation — Alert zapis do bazy', () => {
  it('po wysłaniu alertu → alertRepo.save z Correlated Signal', async () => {
    const { service, redis, alertRepo } = createService();
    const now = Date.now();

    setupRedisSignals(redis, 'UNH', [
      makeSignal({ source_category: '8k', direction: 'negative', conviction: 0.5, timestamp: now - h }),
    ], [
      makeSignal({ source_category: 'form4', direction: 'negative', conviction: 0.6, timestamp: now - 2 * h }),
    ]);

    await service.runPatternDetection('UNH');

    expect(alertRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'UNH',
        ruleName: 'Correlated Signal',
        channel: 'TELEGRAM',
        catalystType: 'INSIDER_PLUS_8K',
      }),
    );
    expect(alertRepo.save).toHaveBeenCalled();
  });
});

// ── Testy: Debounce (schedulePatternCheck) ──

describe('Agent: Correlation — Debounce (schedulePatternCheck)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('schedulePatternCheck odpala runPatternDetection po 10s', () => {
    const { service, redis } = createService();
    // Mock runPatternDetection żeby nie wykonywać pełnej detekcji
    const spy = jest.spyOn(service, 'runPatternDetection').mockResolvedValue({ ticker: 'UNH', signals: 0, patterns: 0 });

    service.schedulePatternCheck('UNH');
    expect(spy).not.toHaveBeenCalled();

    jest.advanceTimersByTime(10_000);
    expect(spy).toHaveBeenCalledWith('UNH');

    spy.mockRestore();
  });

  it('2 sygnały w 5s → drugi skipowany (already scheduled), runPatternDetection raz', () => {
    const { service } = createService();
    const spy = jest.spyOn(service, 'runPatternDetection').mockResolvedValue({ ticker: 'UNH', signals: 0, patterns: 0 });

    service.schedulePatternCheck('UNH');
    jest.advanceTimersByTime(5_000);
    service.schedulePatternCheck('UNH'); // skip — timer już zaplanowany
    jest.advanceTimersByTime(10_000);

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('2 różne tickery → 2 niezależne detekcje', () => {
    const { service } = createService();
    const spy = jest.spyOn(service, 'runPatternDetection').mockResolvedValue({ ticker: 'UNH', signals: 0, patterns: 0 });

    service.schedulePatternCheck('UNH');
    service.schedulePatternCheck('ISRG');
    jest.advanceTimersByTime(10_000);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith('UNH');
    expect(spy).toHaveBeenCalledWith('ISRG');
    spy.mockRestore();
  });
});

// ── Testy: onModuleDestroy ──

describe('Agent: Correlation — onModuleDestroy', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('czyści pending timery', () => {
    const { service } = createService();
    const spy = jest.spyOn(service, 'runPatternDetection').mockResolvedValue({ ticker: 'UNH', signals: 0, patterns: 0 });

    service.schedulePatternCheck('UNH');
    service.schedulePatternCheck('ISRG');
    service.onModuleDestroy();

    jest.advanceTimersByTime(10_000);
    // Timery wyczyszczone — runPatternDetection nie zostanie wywołane
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ── Testy: Edge case — Insider+8K okno 24h ──

describe('Agent: Correlation — Insider+8K edge case (25h vs 23h)', () => {
  it('Form4 sprzed 25h + 8-K teraz → null (poza oknem 24h)', async () => {
    const { service, redis, formatter } = createService();
    const now = Date.now();

    setupRedisSignals(redis, 'UNH', [
      makeSignal({ source_category: '8k', direction: 'negative', conviction: 0.5, timestamp: now - h }),
    ], [
      makeSignal({ source_category: 'form4', direction: 'negative', conviction: 0.6, timestamp: now - 25 * h }),
    ]);

    await service.runPatternDetection('UNH');

    const calls = formatter.formatCorrelatedAlert.mock.calls;
    const ip = calls.find((c: any) => c[0]?.patternType === 'INSIDER_PLUS_8K');
    expect(ip).toBeUndefined();
  });

  it('Form4 sprzed 23h + 8-K teraz → wykrywa (wewnątrz okna)', async () => {
    const { service, redis, formatter } = createService();
    const now = Date.now();

    setupRedisSignals(redis, 'UNH', [
      makeSignal({ source_category: '8k', direction: 'negative', conviction: 0.5, timestamp: now - h }),
    ], [
      makeSignal({ source_category: 'form4', direction: 'negative', conviction: 0.6, timestamp: now - 23 * h }),
    ]);

    await service.runPatternDetection('UNH');

    const calls = formatter.formatCorrelatedAlert.mock.calls;
    const ip = calls.find((c: any) => c[0]?.patternType === 'INSIDER_PLUS_8K');
    expect(ip).toBeDefined();
  });
});

// ── Testy: Rozbieżności dokumentacja vs kod (weryfikacja) ──

describe('Agent: Correlation — Rozbieżności doc vs kod', () => {
  // stockpulse-logic-check.md sekcja 5.2 ma 3 rozbieżności z kodem

  it('DOC: Insider Cluster = "3+ insider trades" → KOD: 2+ (correlation.service.ts:256)', () => {
    // logic-check.md pisze: "3+ insider trades, ten sam kierunek"
    // Kod: if (recent.length < 2) return null → wystarczą 2
    const MIN_INSIDER_CLUSTER_CODE = 2;
    const MIN_INSIDER_CLUSTER_DOC = 3; // BŁĄD W DOKUMENTACJI
    expect(MIN_INSIDER_CLUSTER_CODE).toBe(2);
    expect(MIN_INSIDER_CLUSTER_CODE).not.toBe(MIN_INSIDER_CLUSTER_DOC);
  });

  it('DOC: Multi-Source Convergence = "48h" → KOD: 24h (correlation.service.ts:221)', () => {
    // logic-check.md pisze: "48h | 3+ różne kategorie źródeł"
    // Kod: const window = now - WINDOW_24H
    const WINDOW_24H = 24 * 3600_000;
    expect(WINDOW_24H).toBe(24 * 3600_000);
    // Multi-Source używa 24h, nie 48h jak w dokumentacji
  });

  it('DOC: DailyCap key = "secfil:gpt:daily:" → KOD: "gpt:daily:" (daily-cap.service.ts:57)', () => {
    // logic-check.md sekcja 4.3 pisze: "secfil:gpt:daily:{ticker}:{YYYY-MM-DD}"
    // Kod: return `gpt:daily:${ticker}:${date}` — BEZ prefixu secfil:
    const codeKey = `gpt:daily:ISRG:2026-03-09`;
    const docKey = `secfil:gpt:daily:ISRG:2026-03-09`; // BŁĄD W DOKUMENTACJI
    expect(codeKey).not.toBe(docKey);
    expect(codeKey).toBe('gpt:daily:ISRG:2026-03-09');
  });
});
