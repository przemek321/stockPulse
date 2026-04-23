import { StoredSignal, Direction } from '../../src/correlation/types/correlation.types';

/**
 * Testy logiki CorrelationService — czyste funkcje wydzielone do testów.
 *
 * Metody prywatne CorrelationService testujemy przez re-implementację logiki
 * (czyste funkcje bez zależności Redis/Telegram).
 */

// Re-implementacja getDominantDirection (kopia z CorrelationService)
function getDominantDirection(signals: StoredSignal[]): Direction | null {
  const pos = signals.filter(s => s.direction === 'positive').length;
  const neg = signals.filter(s => s.direction === 'negative').length;
  if (pos >= signals.length * 0.66) return 'positive';
  if (neg >= signals.length * 0.66) return 'negative';
  return null;
}

// Re-implementacja aggregateConviction (kopia z CorrelationService)
function aggregateConviction(signals: StoredSignal[]): number {
  if (signals.length === 0) return 0;

  const byCategory = new Map<string, StoredSignal>();
  for (const sig of signals) {
    const existing = byCategory.get(sig.source_category);
    if (!existing || Math.abs(sig.conviction) > Math.abs(existing.conviction)) {
      byCategory.set(sig.source_category, sig);
    }
  }

  const best = [...byCategory.values()];
  const strongest = best.reduce((a, b) =>
    Math.abs(a.conviction) > Math.abs(b.conviction) ? a : b,
  );

  const sameDirection = best.filter(s => s.direction === strongest.direction);
  const boost = 1 + 0.2 * (sameDirection.length - 1);

  const sign = strongest.direction === 'positive' ? 1 : -1;
  return Math.min(1.0, Math.abs(strongest.conviction) * boost) * sign;
}

// Re-implementacja detectInsiderPlus8K
function detectInsiderPlus8K(signals: StoredSignal[], now: number) {
  const WINDOW_24H = 24 * 3600_000;
  const window = now - WINDOW_24H;
  const form4 = signals.filter(s => s.source_category === 'form4' && s.timestamp > window);
  const filing8k = signals.filter(s => s.source_category === '8k' && s.timestamp > window);

  if (form4.length === 0 || filing8k.length === 0) return null;

  const allSignals = [...form4, ...filing8k];
  const dir = getDominantDirection(allSignals);
  if (!dir) return null;

  return {
    type: 'INSIDER_PLUS_8K' as const,
    signals: allSignals,
    correlated_conviction: aggregateConviction(allSignals),
    direction: dir,
  };
}

// Re-implementacja detectEscalatingSignal
const MIN_ESCALATING_LAST_CONVICTION = 0.25;

function detectEscalatingSignal(signals: StoredSignal[], now: number) {
  const WINDOW_72H = 72 * 3600_000;
  const window = now - WINDOW_72H;
  const recent = signals
    .filter(s => s.timestamp > window)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (recent.length < 3) return null;

  const dir = getDominantDirection(recent);
  if (!dir) return null;

  const last3 = recent.slice(-3);
  if (Math.abs(last3[2].conviction) < MIN_ESCALATING_LAST_CONVICTION) return null;

  const isEscalating =
    Math.abs(last3[1].conviction) > Math.abs(last3[0].conviction) &&
    Math.abs(last3[2].conviction) > Math.abs(last3[1].conviction);

  if (!isEscalating) return null;
  if (!last3.every(s => s.direction === dir)) return null;

  const directionSign = dir === 'positive' ? 1 : -1;
  return {
    type: 'ESCALATING_SIGNAL' as const,
    signals: last3,
    correlated_conviction: Math.min(1.0, Math.abs(last3[2].conviction) * 1.3) * directionSign,
    direction: dir,
  };
}

// ── Helpers ──

function makeSignal(overrides: Partial<StoredSignal> = {}): StoredSignal {
  return {
    id: 'test-signal',
    ticker: 'UNH',
    source_category: 'social',
    conviction: 0.5,
    direction: 'negative',
    catalyst_type: 'earnings',
    timestamp: Date.now(),
    ...overrides,
  };
}

// ── Testy ──

describe('getDominantDirection', () => {
  it('zwraca positive gdy >=66% sygnałów positive', () => {
    const signals = [
      makeSignal({ direction: 'positive' }),
      makeSignal({ direction: 'positive' }),
      makeSignal({ direction: 'negative' }),
    ];
    expect(getDominantDirection(signals)).toBe('positive');
  });

  it('zwraca negative gdy >=66% sygnałów negative', () => {
    const signals = [
      makeSignal({ direction: 'negative' }),
      makeSignal({ direction: 'negative' }),
      makeSignal({ direction: 'positive' }),
    ];
    expect(getDominantDirection(signals)).toBe('negative');
  });

  it('zwraca null gdy brak dominacji (50/50)', () => {
    const signals = [
      makeSignal({ direction: 'positive' }),
      makeSignal({ direction: 'negative' }),
    ];
    expect(getDominantDirection(signals)).toBeNull();
  });

  it('zwraca null przy 60% (poniżej progu 66%)', () => {
    const signals = [
      makeSignal({ direction: 'positive' }),
      makeSignal({ direction: 'positive' }),
      makeSignal({ direction: 'positive' }),
      makeSignal({ direction: 'negative' }),
      makeSignal({ direction: 'negative' }),
    ];
    // 3/5 = 60% — poniżej 66%
    expect(getDominantDirection(signals)).toBeNull();
  });

  it('zwraca positive przy jednym sygnale', () => {
    const signals = [makeSignal({ direction: 'positive' })];
    expect(getDominantDirection(signals)).toBe('positive');
  });
});

describe('aggregateConviction', () => {
  it('zwraca 0 dla pustej listy', () => {
    expect(aggregateConviction([])).toBe(0);
  });

  it('zwraca conviction jedynego sygnału', () => {
    const signals = [makeSignal({ conviction: 0.7, direction: 'negative' })];
    expect(aggregateConviction(signals)).toBeCloseTo(-0.7);
  });

  it('boost 20% za drugie źródło', () => {
    const signals = [
      makeSignal({ source_category: 'social', conviction: 0.5, direction: 'negative' }),
      makeSignal({ source_category: 'news', conviction: 0.3, direction: 'negative' }),
    ];
    // Najsilniejszy = 0.5, boost = 1 + 0.2 * 1 = 1.2
    // Wynik = min(1.0, 0.5 * 1.2) * -1 = -0.6
    expect(aggregateConviction(signals)).toBeCloseTo(-0.6);
  });

  it('boost 40% za trzy źródła tego samego kierunku', () => {
    const signals = [
      makeSignal({ source_category: 'social', conviction: 0.6, direction: 'positive' }),
      makeSignal({ source_category: 'news', conviction: 0.4, direction: 'positive' }),
      makeSignal({ source_category: 'form4', conviction: 0.3, direction: 'positive' }),
    ];
    // Najsilniejszy = 0.6, boost = 1 + 0.2 * 2 = 1.4
    // Wynik = min(1.0, 0.6 * 1.4) = min(1.0, 0.84) = 0.84
    expect(aggregateConviction(signals)).toBeCloseTo(0.84);
  });

  it('cap na 1.0', () => {
    const signals = [
      makeSignal({ source_category: 'social', conviction: 0.9, direction: 'positive' }),
      makeSignal({ source_category: 'news', conviction: 0.8, direction: 'positive' }),
      makeSignal({ source_category: 'form4', conviction: 0.7, direction: 'positive' }),
    ];
    // 0.9 * 1.4 = 1.26 → cap do 1.0
    expect(aggregateConviction(signals)).toBeCloseTo(1.0);
  });

  it('bierze najsilniejszy sygnał per kategoria (deduplikacja)', () => {
    const signals = [
      makeSignal({ source_category: 'social', conviction: 0.8, direction: 'negative' }),
      makeSignal({ source_category: 'social', conviction: 0.3, direction: 'negative' }),
    ];
    // Tylko 1 kategoria, najsilniejszy = 0.8, boost = 1.0
    expect(aggregateConviction(signals)).toBeCloseTo(-0.8);
  });
});

describe('detectInsiderPlus8K', () => {
  const now = Date.now();

  it('wykrywa insider + 8-K w oknie 24h', () => {
    const signals = [
      makeSignal({ source_category: 'form4', direction: 'negative', conviction: 0.6, timestamp: now - 2 * 3600_000 }),
      makeSignal({ source_category: '8k', direction: 'negative', conviction: 0.5, timestamp: now - 1 * 3600_000 }),
    ];
    const result = detectInsiderPlus8K(signals, now);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('INSIDER_PLUS_8K');
    expect(result!.direction).toBe('negative');
  });

  it('nie wykrywa gdy brak form4', () => {
    const signals = [
      makeSignal({ source_category: '8k', timestamp: now - 1 * 3600_000 }),
      makeSignal({ source_category: 'social', timestamp: now - 2 * 3600_000 }),
    ];
    expect(detectInsiderPlus8K(signals, now)).toBeNull();
  });

  it('nie wykrywa gdy brak 8k', () => {
    const signals = [
      makeSignal({ source_category: 'form4', timestamp: now - 1 * 3600_000 }),
      makeSignal({ source_category: 'social', timestamp: now - 2 * 3600_000 }),
    ];
    expect(detectInsiderPlus8K(signals, now)).toBeNull();
  });

  it('nie wykrywa gdy sygnały spoza okna 24h', () => {
    const signals = [
      makeSignal({ source_category: 'form4', timestamp: now - 30 * 3600_000 }),
      makeSignal({ source_category: '8k', timestamp: now - 1 * 3600_000 }),
    ];
    expect(detectInsiderPlus8K(signals, now)).toBeNull();
  });

  it('nie wykrywa gdy brak dominacji kierunku', () => {
    const signals = [
      makeSignal({ source_category: 'form4', direction: 'positive', timestamp: now - 2 * 3600_000 }),
      makeSignal({ source_category: '8k', direction: 'negative', timestamp: now - 1 * 3600_000 }),
    ];
    // 50/50 — brak dominacji
    expect(detectInsiderPlus8K(signals, now)).toBeNull();
  });
});

describe('detectEscalatingSignal', () => {
  const now = Date.now();
  const h = 3600_000; // 1 godzina w ms

  it('wykrywa eskalację 3 sygnałów', () => {
    const signals = [
      makeSignal({ conviction: 0.1, direction: 'negative', timestamp: now - 10 * h }),
      makeSignal({ conviction: 0.2, direction: 'negative', timestamp: now - 5 * h }),
      makeSignal({ conviction: 0.4, direction: 'negative', timestamp: now - 1 * h }),
    ];
    const result = detectEscalatingSignal(signals, now);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('ESCALATING_SIGNAL');
  });

  it('nie wykrywa gdy conviction nie rośnie', () => {
    const signals = [
      makeSignal({ conviction: 0.5, direction: 'negative', timestamp: now - 10 * h }),
      makeSignal({ conviction: 0.3, direction: 'negative', timestamp: now - 5 * h }),
      makeSignal({ conviction: 0.4, direction: 'negative', timestamp: now - 1 * h }),
    ];
    expect(detectEscalatingSignal(signals, now)).toBeNull();
  });

  it('nie wykrywa gdy za mało sygnałów (<3)', () => {
    const signals = [
      makeSignal({ conviction: 0.3, direction: 'negative', timestamp: now - 5 * h }),
      makeSignal({ conviction: 0.5, direction: 'negative', timestamp: now - 1 * h }),
    ];
    expect(detectEscalatingSignal(signals, now)).toBeNull();
  });

  it('nie wykrywa gdy ostatni conviction < MIN_ESCALATING (0.25)', () => {
    const signals = [
      makeSignal({ conviction: 0.05, direction: 'negative', timestamp: now - 10 * h }),
      makeSignal({ conviction: 0.1, direction: 'negative', timestamp: now - 5 * h }),
      makeSignal({ conviction: 0.2, direction: 'negative', timestamp: now - 1 * h }),
    ];
    // 0.2 < 0.25 → nie spełnia progu
    expect(detectEscalatingSignal(signals, now)).toBeNull();
  });

  it('nie wykrywa gdy różne kierunki', () => {
    const signals = [
      makeSignal({ conviction: 0.1, direction: 'positive', timestamp: now - 10 * h }),
      makeSignal({ conviction: 0.2, direction: 'negative', timestamp: now - 5 * h }),
      makeSignal({ conviction: 0.4, direction: 'negative', timestamp: now - 1 * h }),
    ];
    // Kierunki nie spójne w last3
    expect(detectEscalatingSignal(signals, now)).toBeNull();
  });

  it('nie wykrywa sygnałów spoza okna 72h', () => {
    const signals = [
      makeSignal({ conviction: 0.1, direction: 'negative', timestamp: now - 100 * h }),
      makeSignal({ conviction: 0.2, direction: 'negative', timestamp: now - 80 * h }),
      makeSignal({ conviction: 0.4, direction: 'negative', timestamp: now - 75 * h }),
    ];
    // Wszystkie spoza 72h
    expect(detectEscalatingSignal(signals, now)).toBeNull();
  });
});

// ── TASK-04: content-hash deduplikacja runPatternDetection ─────────────

import {
  hashPatternSet,
  shouldSkipDuplicatePatternDetection,
} from '../../src/correlation/correlation.service';
import { DetectedPattern } from '../../src/correlation/types/correlation.types';

function makePattern(opts: Partial<DetectedPattern> & { signalIds: string[] }): DetectedPattern {
  return {
    type: opts.type ?? 'INSIDER_PLUS_OPTIONS',
    direction: opts.direction ?? 'positive',
    correlated_conviction: opts.correlated_conviction ?? 0.6,
    description: opts.description ?? 'test',
    signals: opts.signalIds.map((id, idx) =>
      makeSignal({ id, timestamp: 1000 + idx }),
    ),
  };
}

describe('TASK-04 — hashPatternSet (content hash)', () => {
  it('pusta lista → pusty string', () => {
    expect(hashPatternSet([])).toBe('');
  });

  it('ten sam skład patternów i signals → ten sam hash', () => {
    const p1 = makePattern({ type: 'INSIDER_PLUS_OPTIONS', signalIds: ['a', 'b'] });
    const p2 = makePattern({ type: 'INSIDER_PLUS_OPTIONS', signalIds: ['a', 'b'] });
    expect(hashPatternSet([p1])).toBe(hashPatternSet([p2]));
  });

  it('dodany signal → inny hash', () => {
    const p1 = makePattern({ type: 'INSIDER_PLUS_OPTIONS', signalIds: ['a', 'b'] });
    const p2 = makePattern({ type: 'INSIDER_PLUS_OPTIONS', signalIds: ['a', 'b', 'c'] });
    expect(hashPatternSet([p1])).not.toBe(hashPatternSet([p2]));
  });

  it('kolejność signal IDs nie ma znaczenia (internal sort)', () => {
    const p1 = makePattern({ type: 'INSIDER_PLUS_OPTIONS', signalIds: ['a', 'b', 'c'] });
    const p2 = makePattern({ type: 'INSIDER_PLUS_OPTIONS', signalIds: ['c', 'a', 'b'] });
    expect(hashPatternSet([p1])).toBe(hashPatternSet([p2]));
  });

  it('kolejność patternów nie ma znaczenia (internal sort po type)', () => {
    const pA = makePattern({ type: 'INSIDER_PLUS_OPTIONS', signalIds: ['a'] });
    const pB = makePattern({ type: 'INSIDER_CLUSTER', signalIds: ['b'] });
    expect(hashPatternSet([pA, pB])).toBe(hashPatternSet([pB, pA]));
  });

  it('nowy typ patternu dodany → inny hash', () => {
    const pA = makePattern({ type: 'INSIDER_PLUS_OPTIONS', signalIds: ['a'] });
    const pB = makePattern({ type: 'INSIDER_CLUSTER', signalIds: ['b'] });
    expect(hashPatternSet([pA])).not.toBe(hashPatternSet([pA, pB]));
  });

  it('różne typy patternów z tymi samymi signals → różne hashe', () => {
    const pA = makePattern({ type: 'INSIDER_PLUS_OPTIONS', signalIds: ['a', 'b'] });
    const pB = makePattern({ type: 'INSIDER_PLUS_8K', signalIds: ['a', 'b'] });
    expect(hashPatternSet([pA])).not.toBe(hashPatternSet([pB]));
  });

  it('hash ma 16 znaków (truncated sha256)', () => {
    const p = makePattern({ signalIds: ['a'] });
    expect(hashPatternSet([p])).toHaveLength(16);
  });
});

describe('TASK-04 — shouldSkipDuplicatePatternDetection', () => {
  const now = 1_700_000_000_000;
  const WINDOW = 15 * 60_000;

  it('brak cached → nie skip (pierwszy run)', () => {
    expect(shouldSkipDuplicatePatternDetection('abc123', undefined, now)).toBe(false);
  });

  it('cached taki sam hash, w oknie → skip', () => {
    const cached = { hash: 'abc123', ts: now - 5 * 60_000 };
    expect(shouldSkipDuplicatePatternDetection('abc123', cached, now)).toBe(true);
  });

  it('cached inny hash, w oknie → nie skip (pattern set zmienił się)', () => {
    const cached = { hash: 'old___', ts: now - 5 * 60_000 };
    expect(shouldSkipDuplicatePatternDetection('new___', cached, now)).toBe(false);
  });

  it('cached taki sam hash, poza oknem (>15 min) → nie skip (refresh)', () => {
    const cached = { hash: 'abc123', ts: now - 16 * 60_000 };
    expect(shouldSkipDuplicatePatternDetection('abc123', cached, now)).toBe(false);
  });

  it('granica okna: dokładnie 15 min → skip (mniej-niż-równe OK)', () => {
    const cached = { hash: 'abc123', ts: now - WINDOW };
    expect(shouldSkipDuplicatePatternDetection('abc123', cached, now)).toBe(true);
  });

  it('granica okna: 15 min + 1ms → nie skip', () => {
    const cached = { hash: 'abc123', ts: now - WINDOW - 1 };
    expect(shouldSkipDuplicatePatternDetection('abc123', cached, now)).toBe(false);
  });

  it('custom window: 5 min → skip tylko w 5-min oknie', () => {
    const cached = { hash: 'abc123', ts: now - 4 * 60_000 };
    expect(shouldSkipDuplicatePatternDetection('abc123', cached, now, 5 * 60_000)).toBe(true);
    const cachedOld = { hash: 'abc123', ts: now - 6 * 60_000 };
    expect(shouldSkipDuplicatePatternDetection('abc123', cachedOld, now, 5 * 60_000)).toBe(false);
  });
});

describe('TASK-04 — scenariusz HPE cascade 22.04.2026', () => {
  // Symulacja: 7 runPatternDetection w 6 min, pierwsze 3 kolejne z nowym signalem,
  // kolejne 4 bez zmian (noise). Dedup powinien pozwolić pierwszym 3, zblokować resztę.
  const baseTime = 1_700_000_000_000;

  it('pierwszy run: brak cache → nie skip', () => {
    const patterns = [makePattern({ type: 'INSIDER_PLUS_OPTIONS', signalIds: ['s1'] })];
    const hash = hashPatternSet(patterns);
    expect(shouldSkipDuplicatePatternDetection(hash, undefined, baseTime)).toBe(false);
  });

  it('drugi run 13s później, nowy signal dołączył → nowy hash, nie skip', () => {
    const firstHash = hashPatternSet([makePattern({ signalIds: ['s1'] })]);
    const cached = { hash: firstHash, ts: baseTime };
    const secondPatterns = [makePattern({ signalIds: ['s1', 's2'] })];
    const secondHash = hashPatternSet(secondPatterns);
    expect(secondHash).not.toBe(firstHash);
    expect(shouldSkipDuplicatePatternDetection(secondHash, cached, baseTime + 13_000)).toBe(false);
  });

  it('trzeci run 14s po drugim, bez nowego signala → ten sam hash, SKIP', () => {
    const patterns = [makePattern({ signalIds: ['s1', 's2'] })];
    const hash = hashPatternSet(patterns);
    const cached = { hash, ts: baseTime + 13_000 };
    expect(shouldSkipDuplicatePatternDetection(hash, cached, baseTime + 27_000)).toBe(true);
  });

  it('po 16 min bez zmiany → cache expiry → nie skip (fresh start)', () => {
    const patterns = [makePattern({ signalIds: ['s1', 's2'] })];
    const hash = hashPatternSet(patterns);
    const cached = { hash, ts: baseTime };
    expect(shouldSkipDuplicatePatternDetection(hash, cached, baseTime + 16 * 60_000)).toBe(false);
  });
});

// ── TASK-09: detectInsiderCluster BUY disabled (V5 p>0.37 vs solo BUY) ────

const WINDOW_7D = 7 * 24 * 3600_000;

/**
 * Re-implementacja detectInsiderCluster z TASK-09 (23.04.2026) — BUY wyłączony.
 * V5 backtest (commit f69cfa8): cluster_buy_vs_single_buy N=21/49, p>0.37 wszystkie
 * horyzonty. SELL zostaje (observation mode Sprint 15, obsługiwany w triggerCorrelatedAlert).
 */
function detectInsiderCluster(signals: StoredSignal[], now: number) {
  const window = now - WINDOW_7D;
  const recent = signals.filter(s => s.source_category === 'form4' && s.timestamp > window);

  if (recent.length < 2) return null;

  const dir = getDominantDirection(recent);
  if (!dir) return null;

  if (dir === 'positive') return null; // TASK-09 disable

  const confirming = recent.filter(s => s.direction === dir);
  if (confirming.length < 2) return null;

  return {
    type: 'INSIDER_CLUSTER' as const,
    signals: confirming,
    correlated_conviction: aggregateConviction(confirming),
    direction: dir,
  };
}

describe('TASK-09 — detectInsiderCluster BUY disabled', () => {
  const now = 1_700_000_000_000;

  it('2 BUY Form4 w 7d → null (V5 p>0.37 vs solo BUY)', () => {
    const signals = [
      makeSignal({ id: 's1', source_category: 'form4', direction: 'positive', conviction: 0.7, timestamp: now - 1000 }),
      makeSignal({ id: 's2', source_category: 'form4', direction: 'positive', conviction: 0.6, timestamp: now - 500 }),
    ];
    expect(detectInsiderCluster(signals, now)).toBeNull();
  });

  it('3 BUY Form4 różni insiderzy → null (dominant positive nadal disabled)', () => {
    const signals = [
      makeSignal({ id: 's1', source_category: 'form4', direction: 'positive', conviction: 0.8, timestamp: now - 3000 }),
      makeSignal({ id: 's2', source_category: 'form4', direction: 'positive', conviction: 0.9, timestamp: now - 2000 }),
      makeSignal({ id: 's3', source_category: 'form4', direction: 'positive', conviction: 0.5, timestamp: now - 1000 }),
    ];
    expect(detectInsiderCluster(signals, now)).toBeNull();
  });

  it('2 SELL Form4 w 7d → emituje pattern (observation mode w triggerCorrelatedAlert)', () => {
    const signals = [
      makeSignal({ id: 's1', source_category: 'form4', direction: 'negative', conviction: -0.7, timestamp: now - 1000 }),
      makeSignal({ id: 's2', source_category: 'form4', direction: 'negative', conviction: -0.6, timestamp: now - 500 }),
    ];
    const result = detectInsiderCluster(signals, now);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('INSIDER_CLUSTER');
    expect(result!.direction).toBe('negative');
    expect(result!.signals).toHaveLength(2);
  });

  it('1 BUY + 1 SELL Form4 (50/50, brak dominacji) → null (getDominantDirection)', () => {
    const signals = [
      makeSignal({ id: 's1', source_category: 'form4', direction: 'positive', conviction: 0.7, timestamp: now - 1000 }),
      makeSignal({ id: 's2', source_category: 'form4', direction: 'negative', conviction: -0.6, timestamp: now - 500 }),
    ];
    expect(detectInsiderCluster(signals, now)).toBeNull();
  });

  it('2 SELL Form4 ale >7d temu → null (okno)', () => {
    const signals = [
      makeSignal({ id: 's1', source_category: 'form4', direction: 'negative', conviction: -0.7, timestamp: now - 8 * 24 * 3600_000 }),
      makeSignal({ id: 's2', source_category: 'form4', direction: 'negative', conviction: -0.6, timestamp: now - 500 }),
    ];
    expect(detectInsiderCluster(signals, now)).toBeNull();
  });

  it('2 BUY social (nie form4) → null (tylko form4 liczy się do clustra)', () => {
    const signals = [
      makeSignal({ id: 's1', source_category: 'social', direction: 'positive', conviction: 0.7, timestamp: now - 1000 }),
      makeSignal({ id: 's2', source_category: 'social', direction: 'positive', conviction: 0.6, timestamp: now - 500 }),
    ];
    expect(detectInsiderCluster(signals, now)).toBeNull();
  });
});
