/**
 * S19-FIX-12: testy guardu post-GPT consensus gap.
 *
 * Trigger PODD 06.05.2026: GPT zwrócił conviction +1.40 mimo że revenue surprise
 * był +1.8% (in-line). Guard cap'uje conviction gdy raport vs consensus pokazuje
 * miss / in-line / single-metric beat.
 *
 * Reguły (priorytet):
 *   R1. ANY metric miss (<0%) AND |conv| > 0.3 → cap 0.3
 *   R2. BOTH metrics in-line (-3..+3%) AND |conv| > 0.5 → cap 0.5
 *   R3. Single-metric beat (one >+5%, drugi in-line/miss) AND |conv| > 0.7 → cap 0.7
 *   R4. (no cap) BOTH beats >+5% lub brak danych
 */

import { shouldCapForConsensusGap } from '../../src/sec-filings/utils/consensus-gap-guard';
import { ConsensusComparison } from '../../src/sec-filings/types/consensus-comparison';

function buildComparison(overrides: Partial<ConsensusComparison>): ConsensusComparison {
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

describe('shouldCapForConsensusGap — null/empty cases', () => {
  it('null comparison → no cap', () => {
    const result = shouldCapForConsensusGap(null, 1.5);
    expect(result.cap).toBeNull();
  });

  it('isEmpty=true → no cap', () => {
    const comp = buildComparison({ isEmpty: true });
    expect(shouldCapForConsensusGap(comp, 1.5).cap).toBeNull();
  });

  it('oba surprise null (brak danych) → no cap', () => {
    const comp = buildComparison({ epsSurprisePct: null, revenueSurprisePct: null });
    expect(shouldCapForConsensusGap(comp, 1.5).cap).toBeNull();
  });
});

describe('shouldCapForConsensusGap — R1 miss', () => {
  it('PODD-style EPS miss (Intel metafora): EPS -8%, conv +1.5 → cap 0.3', () => {
    const comp = buildComparison({ epsSurprisePct: -8, revenueSurprisePct: -16.7 });
    const r = shouldCapForConsensusGap(comp, 1.5);
    expect(r.cap).toBe(0.3);
    expect(r.reason).toBe('consensus_miss');
    expect(r.details).toContain('EPS+revenue');
  });

  it('tylko revenue miss (EPS in-line) + bullish conv → cap 0.3', () => {
    const comp = buildComparison({ epsSurprisePct: 1.5, revenueSurprisePct: -5 });
    const r = shouldCapForConsensusGap(comp, 1.2);
    expect(r.cap).toBe(0.3);
    expect(r.reason).toBe('consensus_miss');
    expect(r.details).toContain('revenue');
    expect(r.details).not.toContain('EPS+revenue');
  });

  it('tylko EPS miss (revenue in-line) + bullish conv → cap 0.3', () => {
    const comp = buildComparison({ epsSurprisePct: -2, revenueSurprisePct: 1 });
    const r = shouldCapForConsensusGap(comp, 1.0);
    expect(r.cap).toBe(0.3);
    expect(r.reason).toBe('consensus_miss');
    expect(r.details).toContain('EPS');
  });

  it('miss + |conv| ≤ 0.3 → no cap (guard nie rusza)', () => {
    const comp = buildComparison({ epsSurprisePct: -5, revenueSurprisePct: -5 });
    expect(shouldCapForConsensusGap(comp, 0.3).cap).toBeNull();
    expect(shouldCapForConsensusGap(comp, -0.3).cap).toBeNull();
    expect(shouldCapForConsensusGap(comp, 0.2).cap).toBeNull();
  });

  it('R1 dla negative conviction (bear) też capuje na 0.3 (|conv| basis)', () => {
    const comp = buildComparison({ epsSurprisePct: -10, revenueSurprisePct: -10 });
    const r = shouldCapForConsensusGap(comp, -1.5);
    expect(r.cap).toBe(0.3);
    // caller sam aplikuje znak: Math.sign(-1.5) * 0.3 = -0.3
  });
});

describe('shouldCapForConsensusGap — R2 in-line both', () => {
  it('PODD-style both in-line: EPS +2.5%, rev +1.8%, conv +1.40 → cap 0.5', () => {
    const comp = buildComparison({ epsSurprisePct: 2.5, revenueSurprisePct: 1.8 });
    const r = shouldCapForConsensusGap(comp, 1.40);
    expect(r.cap).toBe(0.5);
    expect(r.reason).toBe('consensus_in_line');
  });

  it('both in-line + |conv| ≤ 0.5 → no cap', () => {
    const comp = buildComparison({ epsSurprisePct: 0, revenueSurprisePct: 0 });
    expect(shouldCapForConsensusGap(comp, 0.5).cap).toBeNull();
    expect(shouldCapForConsensusGap(comp, 0.3).cap).toBeNull();
  });

  it('R2 nieaktywne gdy tylko jedna metryka znana', () => {
    const comp = buildComparison({ epsSurprisePct: 1, revenueSurprisePct: null });
    const r = shouldCapForConsensusGap(comp, 1.5);
    // Nie spełnia R1 (no miss) ani R3 (single beat wymaga oba znane), R2 wymaga both
    expect(r.cap).toBeNull();
  });

  it('R2 boundary: EPS +2.99% (in-line), rev +2.99% (in-line) + conv 1 → cap 0.5', () => {
    const comp = buildComparison({ epsSurprisePct: 2.99, revenueSurprisePct: 2.99 });
    expect(shouldCapForConsensusGap(comp, 1.0).cap).toBe(0.5);
  });

  it('R2 boundary: EPS +3% (poza in-line) + rev +1% → R3 wchodzi nie R2', () => {
    // EPS 3% NIE jest <3 → not in-line. Ale też nie ≥5 → nie strong beat.
    // Brak R1 (no miss), R2 wymaga BOTH in-line (EPS 3 nie spełnia <3), R3 wymaga
    // strong beat ≥5 (EPS 3 nie). Wynik: no cap.
    const comp = buildComparison({ epsSurprisePct: 3, revenueSurprisePct: 1 });
    expect(shouldCapForConsensusGap(comp, 1.5).cap).toBeNull();
  });
});

describe('shouldCapForConsensusGap — R3 single-metric beat', () => {
  it('PODD-actual replay: EPS +16.2% (strong), rev +1.8% (in-line), conv +1.40 → cap 0.7', () => {
    const comp = buildComparison({ epsSurprisePct: 16.2, revenueSurprisePct: 1.8 });
    const r = shouldCapForConsensusGap(comp, 1.40);
    expect(r.cap).toBe(0.7);
    expect(r.reason).toBe('consensus_mixed');
    expect(r.details).toContain('Strong EPS');
  });

  it('Strong revenue beat + EPS in-line + conv +1.0 → cap 0.7', () => {
    const comp = buildComparison({ epsSurprisePct: 1, revenueSurprisePct: 12 });
    const r = shouldCapForConsensusGap(comp, 1.0);
    expect(r.cap).toBe(0.7);
    expect(r.reason).toBe('consensus_mixed');
    expect(r.details).toContain('Strong revenue');
  });

  it('R3 + |conv| ≤ 0.7 → no cap', () => {
    const comp = buildComparison({ epsSurprisePct: 10, revenueSurprisePct: 1 });
    expect(shouldCapForConsensusGap(comp, 0.7).cap).toBeNull();
    expect(shouldCapForConsensusGap(comp, 0.5).cap).toBeNull();
  });
});

describe('shouldCapForConsensusGap — R4 both strong beats (no cap)', () => {
  it('EPS +12%, rev +8%, conv +1.5 → no cap (trust GPT)', () => {
    const comp = buildComparison({ epsSurprisePct: 12, revenueSurprisePct: 8 });
    expect(shouldCapForConsensusGap(comp, 1.5).cap).toBeNull();
  });

  it('EPS +25%, rev +15%, conv +2.0 (max bull) → no cap', () => {
    const comp = buildComparison({ epsSurprisePct: 25, revenueSurprisePct: 15 });
    expect(shouldCapForConsensusGap(comp, 2.0).cap).toBeNull();
  });
});

describe('shouldCapForConsensusGap — priority order', () => {
  it('R1 wygrywa nad R2 (miss + in-line drugi metric)', () => {
    // EPS miss + revenue in-line: R1 łapie pierwsze (any miss)
    const comp = buildComparison({ epsSurprisePct: -2, revenueSurprisePct: 1 });
    expect(shouldCapForConsensusGap(comp, 1.5).reason).toBe('consensus_miss');
  });

  it('R1 wygrywa nad R3 (miss + drugie strong beat)', () => {
    const comp = buildComparison({ epsSurprisePct: -2, revenueSurprisePct: 10 });
    expect(shouldCapForConsensusGap(comp, 1.5).reason).toBe('consensus_miss');
  });

  it('R2 wygrywa nad R3 (oba in-line, żaden strong)', () => {
    const comp = buildComparison({ epsSurprisePct: 2, revenueSurprisePct: 1 });
    expect(shouldCapForConsensusGap(comp, 1.0).reason).toBe('consensus_in_line');
  });
});
