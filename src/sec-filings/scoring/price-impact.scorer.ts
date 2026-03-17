import { SecFilingAnalysis } from '../types/sec-filing-analysis';

/**
 * Przekształca wynik analizy GPT na priorytet alertu.
 *
 * Form 4 ma niższe progi niż 8-K — insider SELL non-10b5-1 z conviction -0.5
 * to silniejszy leading signal niż 8-K z conviction -0.5 (który często jest reaktywny).
 * Form 4 insider trades to jedne z nielicznych prawdziwie leading signals w systemie
 * (raport 2026-03-17: THC insider cluster = trafny, -15% w 6 dni).
 */
export function scoreToAlertPriority(
  analysis: SecFilingAnalysis,
  formType: '8-K' | 'Form4',
): 'CRITICAL' | 'HIGH' | 'MEDIUM' | null {

  const { price_impact, conviction, requires_immediate_attention } = analysis;

  if (formType === 'Form4') {
    return scoreForm4Priority(analysis);
  }
  return score8kPriority(analysis);
}

/**
 * Form 4 — niższe progi, bo insider trades to leading signals.
 * Conviction -0.5 od CEO non-10b5-1 jest warty alertu.
 */
function scoreForm4Priority(
  analysis: SecFilingAnalysis,
): 'CRITICAL' | 'HIGH' | 'MEDIUM' | null {
  const { price_impact, conviction, requires_immediate_attention } = analysis;
  const absConv = Math.abs(conviction);

  // CRITICAL: GPT mówi "natychmiast" + jakikolwiek sensowny conviction
  if (requires_immediate_attention && absConv >= 0.3) {
    return 'CRITICAL';
  }

  // CRITICAL: silny conviction (≥0.8) niezależnie od magnitude
  if (absConv >= 0.8 && price_impact.confidence >= 0.6) {
    return 'CRITICAL';
  }

  // HIGH: umiarkowany conviction (≥0.4) + medium/high magnitude
  if (absConv >= 0.4 && price_impact.magnitude !== 'low' && price_impact.confidence >= 0.5) {
    return 'HIGH';
  }

  // HIGH: wysoka magnitude nawet przy niższym conviction
  if (price_impact.magnitude === 'high' && price_impact.confidence >= 0.6) {
    return 'HIGH';
  }

  // MEDIUM: niski conviction ale non-trivial
  if (absConv >= 0.2 && price_impact.magnitude === 'medium') {
    return 'MEDIUM';
  }

  return null;
}

/**
 * 8-K — wyższe progi, bo filingi są często reaktywne (po ruchu ceny).
 * Wyjątek: requires_immediate_attention (bankruptcy, earnings miss).
 */
function score8kPriority(
  analysis: SecFilingAnalysis,
): 'CRITICAL' | 'HIGH' | 'MEDIUM' | null {
  const { price_impact, conviction, requires_immediate_attention } = analysis;
  const absConv = Math.abs(conviction);

  // CRITICAL: GPT mówi "natychmiast" + conviction powyżej progu
  if (requires_immediate_attention && absConv >= 0.4) {
    return price_impact.magnitude === 'high' ? 'CRITICAL' : 'HIGH';
  }

  // CRITICAL: wysoka magnitude + wysoka confidence
  if (price_impact.magnitude === 'high' && price_impact.confidence >= 0.7) {
    return 'CRITICAL';
  }

  // HIGH: średnia magnitude z wystarczającą confidence
  if (price_impact.magnitude === 'medium' && price_impact.confidence >= 0.6) {
    return 'HIGH';
  }

  // HIGH: wysoka magnitude ale niska confidence
  if (price_impact.magnitude === 'high' && price_impact.confidence < 0.7) {
    return 'HIGH';
  }

  // Niska magnitude lub niska confidence — nie alertuj
  return null;
}

/**
 * Mapuje wynik analizy GPT na nazwę reguły alertu.
 * Nazwa musi odpowiadać regule w tabeli `alert_rules` (seed.ts).
 */
export function mapToRuleName(
  analysis: SecFilingAnalysis,
  formType: '8-K' | 'Form4',
): string {
  if (formType === 'Form4') {
    return 'Form 4 Insider Signal';
  }

  // 8-K — mapuj catalyst_type na konkretną regułę
  switch (analysis.catalyst_type) {
    case 'earnings':
      return '8-K Earnings Miss';
    case 'leadership':
      return '8-K Leadership Change';
    default:
      return '8-K Material Event GPT';
  }
}
