import { buildFix16Shadow } from '../../src/sec-filings/utils/fix16-shadow';
import { ConsensusGapDecision } from '../../src/sec-filings/utils/consensus-gap-guard';
import { ConsensusComparison } from '../../src/sec-filings/types/consensus-comparison';

/**
 * Pakiet 1 fix #4 (09.06.2026) — FIX-16 shadow mode.
 *
 * Cap FIX-12 zostaje bez zmian; shadow liczy proponowane asymetryczne progi
 * i persystuje w gptAnalysis.fix16_shadow. Deploy decyzja 25.08.2026 przy N>=3.
 */

function comp(overrides: Partial<ConsensusComparison> = {}): ConsensusComparison {
  return {
    epsActual: -0.18,
    epsEstimate: 0.04,
    epsSurprisePct: -507.2,
    revenueActual: 312_000_000,
    revenueEstimate: 320_000_000,
    revenueSurprisePct: -2.5,
    analystCount: 12,
    period: '2026-03-31',
    fetchedAt: new Date('2026-05-11T20:00:00Z'),
    isEmpty: false,
    ...overrides,
  };
}

const MISS_DECISION: ConsensusGapDecision = {
  cap: 0.3,
  reason: 'consensus_miss',
  details: 'EPS miss vs consensus',
};

const NOW = new Date('2026-06-09T22:00:00Z');

describe('FIX-16 shadow mode (Pakiet 1 fix #4)', () => {
  it('HIMS replay: extreme miss + GPT bearish → would_uncap=true, proposed_cap=null', () => {
    // HIMS 11.05: EPS -0.18 vs +0.04 (-507%), conviction precap -1.6, cap 0.3
    // → stracony short -19.7% 1d. Shadow: sign-flip + |Δ|=0.22 >= 0.10 → extreme.
    const shadow = buildFix16Shadow(comp(), -1.6, MISS_DECISION, NOW)!;

    expect(shadow.is_extreme_miss).toBe(true);
    expect(shadow.sign_gate_pass).toBe(true);
    expect(shadow.anomaly_excluded).toBe(false);
    expect(shadow.would_uncap).toBe(true);
    expect(shadow.proposed_cap).toBeNull();
    expect(shadow.conviction_precap).toBe(-1.6);
    expect(shadow.cap_applied).toBe(0.3);
    expect(shadow.shadowed_at).toBe('2026-06-09T22:00:00.000Z');
  });

  it('PODD replay: revenue miss light + GPT bullish → would_uncap=false, proposed_cap=0.3', () => {
    // PODD 06.05: EPS BEAT +16.2%, revenue miss -3.5%, conviction precap +1.40.
    // Sign-gate fail (bullish na missie = dokładnie PODD-class, cap słuszny).
    // Drabinka graduje po missie (rev 3.5% < 10) — NIE po |eps beat|.
    const shadow = buildFix16Shadow(
      comp({
        epsActual: 1.42,
        epsEstimate: 1.22,
        epsSurprisePct: 16.2,
        revenueSurprisePct: -3.5,
      }),
      1.4,
      MISS_DECISION,
      NOW,
    )!;

    expect(shadow.is_extreme_miss).toBe(false);
    expect(shadow.sign_gate_pass).toBe(false);
    expect(shadow.would_uncap).toBe(false);
    expect(shadow.proposed_cap).toBe(0.3);
  });

  it('miss medium (10-30%) → proposed_cap=0.5', () => {
    const shadow = buildFix16Shadow(
      comp({ epsActual: 0.8, epsEstimate: 1.0, epsSurprisePct: -20 }),
      -0.9,
      MISS_DECISION,
      NOW,
    )!;
    expect(shadow.is_extreme_miss).toBe(false); // -20 nie przekracza -30
    expect(shadow.would_uncap).toBe(false);
    expect(shadow.proposed_cap).toBe(0.5);
  });

  it('anomaly exclusion: |epsActual|>50 (one-time charge) → would_uncap=false mimo extreme', () => {
    const shadow = buildFix16Shadow(
      comp({ epsActual: -69.0, epsEstimate: 1.5, epsSurprisePct: -4700 }),
      -1.8,
      MISS_DECISION,
      NOW,
    )!;
    expect(shadow.is_extreme_miss).toBe(true);
    expect(shadow.anomaly_excluded).toBe(true);
    expect(shadow.would_uncap).toBe(false);
  });

  it('anomaly exclusion: revenueActual < 1M (jednostki) → wykluczony', () => {
    const shadow = buildFix16Shadow(
      comp({ revenueActual: 312_000 }),
      -1.6,
      MISS_DECISION,
      NOW,
    )!;
    expect(shadow.anomaly_excluded).toBe(true);
    expect(shadow.would_uncap).toBe(false);
  });

  it('niestabilny mianownik: surprise -600% ale |Δ|<0.10 i brak flip → NIE extreme', () => {
    // estimate 0.01 → actual -0.05 to flip, więc test bez flipa: 0.01 → 0.005?
    // To nie miss < -30%... użyj estimate 0.02 → actual 0.01: surprise -50%, |Δ|=0.01,
    // brak flip (oba dodatnie) → extreme=false (definicja odporna na mianownik)
    const shadow = buildFix16Shadow(
      comp({ epsActual: 0.01, epsEstimate: 0.02, epsSurprisePct: -50 }),
      -1.2,
      MISS_DECISION,
      NOW,
    )!;
    expect(shadow.is_extreme_miss).toBe(false);
    expect(shadow.would_uncap).toBe(false);
  });

  it('sign-flip z małą |Δ|: estimate +0.01 → actual -0.05 → extreme (flip wystarcza)', () => {
    const shadow = buildFix16Shadow(
      comp({ epsActual: -0.05, epsEstimate: 0.01, epsSurprisePct: -600 }),
      -1.2,
      MISS_DECISION,
      NOW,
    )!;
    expect(shadow.is_extreme_miss).toBe(true);
    expect(shadow.would_uncap).toBe(true);
  });

  it('estimate dokładnie 0 → Math.sign=0, flip nie liczy się, decyduje |Δ|', () => {
    const shadow = buildFix16Shadow(
      comp({ epsActual: -0.05, epsEstimate: 0, epsSurprisePct: -100 }),
      -1.2,
      MISS_DECISION,
      NOW,
    )!;
    expect(shadow.is_extreme_miss).toBe(false); // |Δ|=0.05 < 0.10, brak flip
  });

  it('R2 consensus_in_line → shadow zapisany ale would_uncap=false, proposed_cap=cap', () => {
    const shadow = buildFix16Shadow(
      comp({ epsSurprisePct: 1.0, revenueSurprisePct: 2.0 }),
      -0.9,
      { cap: 0.5, reason: 'consensus_in_line', details: 'in-line' },
      NOW,
    )!;
    expect(shadow.would_uncap).toBe(false);
    expect(shadow.proposed_cap).toBe(0.5);
    expect(shadow.cap_reason).toBe('consensus_in_line');
  });

  it('brak capu (R4) → null, shadow nie zapisywany', () => {
    expect(
      buildFix16Shadow(comp(), 1.2, { cap: null, reason: null, details: null }, NOW),
    ).toBeNull();
  });
});
