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
