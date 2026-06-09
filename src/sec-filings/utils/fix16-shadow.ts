import { ConsensusComparison } from '../types/consensus-comparison';
import { ConsensusGapDecision } from './consensus-gap-guard';

/**
 * Pakiet 1 fix #4 (09.06.2026): FIX-16 w SHADOW MODE.
 *
 * Trigger: HIMS 11.05.2026 alert id 2402 — earnings miss extreme (EPS -0.18 vs
 * +0.04 konsensus = -507%), GPT bearish conviction -1.6, FIX-12 R1 cap'nął do
 * -0.3 → DB-only → stracony short -19.7% 1d. Cap symetryczny zaprojektowany pod
 * PODD (beat priced-in, ochrona przed FOMO long) zabija odwrotny case (miss
 * extreme niewyceniony = realny short).
 *
 * Decyzja Plan v3: NIE deployujemy zmiany progów z N=1 (FIX-12 R1 zaprojektowany
 * pod 1 case PODD właśnie zabił HIMS — nie powtarzamy wzorca). Zamiast tego
 * SHADOW MODE: cap FIX-12 zostaje bez zmian w zachowaniu, ale przy każdym
 * cap'ie liczymy proponowane asymetryczne progi i persystujemy wynik w
 * `sec_filings.gptAnalysis.fix16_shadow` (NIE w system_logs — retencja 7-30d
 * nie przeżyje do review). Decyzja deploy: 25.08.2026 przy N>=3 extreme-miss
 * w shadow logu z kierunkiem zgodnym (would_uncap=true AND stock spadł).
 *
 * Proponowana asymetryczna drabinka R1 (rejestrowana jako proposed_cap):
 *   - miss extreme (def. niżej)  → NO cap (HIMS would qualify)
 *   - miss medium (10-30%)       → cap 0.5
 *   - miss light (<10%)          → cap 0.3 (= obecny R1)
 *
 * Definicja EXTREME odporna na niestabilność mianownika (surprise % eksploduje
 * gdy estimate ~0): |epsSurprisePct| > 30 AND (sign-flip estimate→actual LUB
 * |actual-estimate| >= $0.10 EPS). Wykluczenie: anomaly-guard WARN klasa z
 * FIX-13 (|eps|>50 = one-time charge GILD-class, rev<1M = jednostki).
 *
 * Sign-gate: would_uncap TYLKO gdy conviction_precap < 0 — GPT bearish zgodny
 * z missem. Bullish conviction na missie to dokładnie PODD-class, cap słuszny.
 *
 * 30d pre-earnings price action (odróżnienie "miss niewyceniony" od "relief
 * bounce") NIE jest liczone przy alercie — retro-fetch przy review 25.08
 * (alert ma sentAt + symbol, Finnhub /candle wystarczy; liczenie na żywo
 * wymagałoby nowej metody FinnhubService — scope creep dla shadow logu).
 */

export interface Fix16Shadow {
  /** Conviction GPT PRZED cap'em FIX-12 (magnitude zachowana do review) */
  conviction_precap: number;
  /** Cap faktycznie zastosowany przez FIX-12 (0.3 / 0.5 / 0.7) */
  cap_applied: number;
  /** Reason z shouldCapForConsensusGap (consensus_miss / in_line / mixed) */
  cap_reason: string;
  eps_surprise_pct: number | null;
  revenue_surprise_pct: number | null;
  eps_actual: number | null;
  eps_estimate: number | null;
  /** |epsSurprise|>30 AND (sign-flip LUB |Δ|>=0.10 EPS) */
  is_extreme_miss: boolean;
  /** conviction_precap < 0 — GPT bearish zgodny z missem */
  sign_gate_pass: boolean;
  /** FIX-13 WARN klasa: |epsActual|>50 lub 0<revenueActual<1M → wykluczony */
  anomaly_excluded: boolean;
  /** Werdykt shadow: extreme + sign-gate + bez anomalii → FIX-16 NIE cap'owałby */
  would_uncap: boolean;
  /** Cap wg proponowanej drabinki (null = no cap) — do porównania przy review */
  proposed_cap: number | null;
  /** ISO timestamp zapisu shadow */
  shadowed_at: string;
}

/** Progi anomalii zsynchronizowane z FIX-13 WARN-only guard (consensus-comparison.service) */
const ANOMALY_EPS_ABS = 50;
const ANOMALY_REV_FLOOR = 1_000_000;

export function buildFix16Shadow(
  comp: ConsensusComparison,
  convictionPreCap: number,
  decision: ConsensusGapDecision,
  now: Date = new Date(),
): Fix16Shadow | null {
  if (decision.cap === null || decision.reason === null) return null;

  const eps = comp.epsSurprisePct;
  const epsActual = comp.epsActual;
  const epsEstimate = comp.epsEstimate;

  const anomalyExcluded =
    (epsActual !== null && Math.abs(epsActual) > ANOMALY_EPS_ABS) ||
    (comp.revenueActual !== null && comp.revenueActual > 0 && comp.revenueActual < ANOMALY_REV_FLOOR);

  // Sign-flip: estimate i actual po przeciwnych stronach zera (HIMS: +0.04 → -0.18).
  // Math.sign(0)=0 — estimate dokładnie 0 nie liczy się jako flip (mianownik
  // niestabilny, łapie go warunek |Δ| >= 0.10).
  const signFlip =
    epsActual !== null &&
    epsEstimate !== null &&
    Math.sign(epsActual) !== 0 &&
    Math.sign(epsEstimate) !== 0 &&
    Math.sign(epsActual) !== Math.sign(epsEstimate);

  const absDelta =
    epsActual !== null && epsEstimate !== null ? Math.abs(epsActual - epsEstimate) : null;

  const isExtremeMiss =
    eps !== null &&
    eps < -30 &&
    (signFlip || (absDelta !== null && absDelta >= 0.1));

  const signGatePass = convictionPreCap < 0;

  const wouldUncap =
    decision.reason === 'consensus_miss' && isExtremeMiss && signGatePass && !anomalyExcluded;

  // Proponowana drabinka — tylko dla R1 (consensus_miss); R2/R3 bez zmian w propozycji.
  // Gradacja po wielkości MISSU (najbardziej ujemny surprise z eps/rev) — nie po
  // |eps| ogólnie (PODD: eps BEAT +16.2% a miss był revenue -3.5% → light → 0.3).
  let proposedCap: number | null = decision.cap;
  if (decision.reason === 'consensus_miss') {
    const epsMiss = eps !== null && eps < 0 ? Math.abs(eps) : 0;
    const revMiss =
      comp.revenueSurprisePct !== null && comp.revenueSurprisePct < 0
        ? Math.abs(comp.revenueSurprisePct)
        : 0;
    const missMagnitude = Math.max(epsMiss, revMiss);
    if (wouldUncap) proposedCap = null;
    else if (missMagnitude >= 10 && missMagnitude <= 30) proposedCap = 0.5;
    else proposedCap = 0.3;
  }

  return {
    conviction_precap: convictionPreCap,
    cap_applied: decision.cap,
    cap_reason: decision.reason,
    eps_surprise_pct: eps,
    revenue_surprise_pct: comp.revenueSurprisePct,
    eps_actual: epsActual,
    eps_estimate: epsEstimate,
    is_extreme_miss: isExtremeMiss,
    sign_gate_pass: signGatePass,
    anomaly_excluded: anomalyExcluded,
    would_uncap: wouldUncap,
    proposed_cap: proposedCap,
    shadowed_at: now.toISOString(),
  };
}
