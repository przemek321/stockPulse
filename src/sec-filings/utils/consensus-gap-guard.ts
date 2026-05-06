import { ConsensusComparison } from '../types/consensus-comparison';

/**
 * S19-FIX-12: post-GPT defensive cap dla "beat but priced in" / "miss but headline strong".
 *
 * Działa po Zod validation w Form8kPipeline (analogicznie do FIX-01 missing-data
 * guard i FIX-02 guidance floor). GPT mimo otrzymania `## ANALYST CONSENSUS`
 * block w prompcie potrafi nadal chwalić "+33% YoY headline" — guard jest
 * deterministyczną dolną/górną granicą.
 *
 * PODD 06.05.2026 (trigger case):
 *   - epsSurprisePct: +16.2% (strong beat)
 *   - revenueSurprisePct: ~+1.8% (in-line)
 *   - GPT conviction: +1.40 → guard cap → +0.5 (single-metric beat = mixed)
 *
 * Intel-class case (metafora):
 *   - epsSurprisePct: -8% (miss)
 *   - revenueSurprisePct: -16.7% (big miss, $100B vs $120B)
 *   - GPT conviction: +1.20 ("rekordowe przychody $100B!") → guard cap → +0.3
 *
 * Reguły (w kolejności priorytetu — pierwsza match wygrywa):
 *   R1. ANY metric miss (<0%) AND |conv| > 0.3 → cap |conv| ≤ 0.3
 *   R2. BOTH metrics in-line (-3%..+3%) AND |conv| > 0.5 → cap |conv| ≤ 0.5
 *   R3. Single-metric beat (one >+5%, other in-line/miss) AND |conv| > 0.7 → cap |conv| ≤ 0.7
 *   R4. (no cap) BOTH beat >+5% → trust GPT conviction
 *
 * Brak danych dla metryki (null) traktujemy jako "no signal from this metric" —
 * NIE blokuje guarda, ale nie liczy się jako miss/beat. Jeśli OBA są null →
 * `comp.isEmpty=true` lub computed-empty → guard pomija (return null).
 */

export interface ConsensusGapDecision {
  /** Maksymalna |conviction| która może wyjść (cap). null = brak cap'u. */
  cap: number | null;
  /** Powód do logu / nonDeliveryReason (krótki snake_case) */
  reason: string | null;
  /** Human-readable diagnostyka do system_logs */
  details: string | null;
}

const NO_CAP: ConsensusGapDecision = { cap: null, reason: null, details: null };

export function shouldCapForConsensusGap(
  comp: ConsensusComparison | null,
  conviction: number,
): ConsensusGapDecision {
  if (!comp || comp.isEmpty) return NO_CAP;

  const eps = comp.epsSurprisePct;
  const rev = comp.revenueSurprisePct;

  // Brak ANY surprise data → guard nieaktywny
  if (eps === null && rev === null) return NO_CAP;

  const absConv = Math.abs(conviction);

  // R1: jakikolwiek miss + bullish conviction > 0.3
  const epsIsMiss = eps !== null && eps < 0;
  const revIsMiss = rev !== null && rev < 0;
  if ((epsIsMiss || revIsMiss) && absConv > 0.3) {
    const which = epsIsMiss && revIsMiss ? 'EPS+revenue' : epsIsMiss ? 'EPS' : 'revenue';
    return {
      cap: 0.3,
      reason: 'consensus_miss',
      details: `${which} miss vs consensus (eps=${formatPctOrNull(eps)}, rev=${formatPctOrNull(rev)}) — conviction cap 0.3`,
    };
  }

  // R2: oba in-line (jeśli oba znane) + |conv| > 0.5
  const epsInLine = eps !== null && Math.abs(eps) < 3;
  const revInLine = rev !== null && Math.abs(rev) < 3;
  const bothKnown = eps !== null && rev !== null;
  if (bothKnown && epsInLine && revInLine && absConv > 0.5) {
    return {
      cap: 0.5,
      reason: 'consensus_in_line',
      details: `Both metrics in-line (eps=${formatPctOrNull(eps)}, rev=${formatPctOrNull(rev)}) — conviction cap 0.5`,
    };
  }

  // R3: single-metric beat (jedna >+5%, druga in-line albo brak)
  // Liczy się tylko gdy są dane dla obu — inaczej nie wiemy czy "single"
  if (bothKnown) {
    const epsStrongBeat = eps! >= 5;
    const revStrongBeat = rev! >= 5;
    const epsWeak = eps! < 5;
    const revWeak = rev! < 5;
    const isSingleBeat = (epsStrongBeat && revWeak) || (revStrongBeat && epsWeak);
    if (isSingleBeat && absConv > 0.7) {
      const strong = epsStrongBeat ? 'EPS' : 'revenue';
      const weak = epsStrongBeat ? 'revenue' : 'EPS';
      return {
        cap: 0.7,
        reason: 'consensus_mixed',
        details: `Strong ${strong} beat (${formatPctOrNull(epsStrongBeat ? eps : rev)}) but ${weak} in-line (${formatPctOrNull(epsStrongBeat ? rev : eps)}) — conviction cap 0.7`,
      };
    }
  }

  return NO_CAP;
}

function formatPctOrNull(pct: number | null): string {
  if (pct === null) return 'n/a';
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}
