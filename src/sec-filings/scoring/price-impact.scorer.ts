import { SecFilingAnalysis } from '../types/sec-filing-analysis';

/**
 * Przekształca wynik analizy GPT na priorytet alertu.
 * Logika bazuje na magnitude, confidence i requires_immediate_attention z GPT.
 */
export function scoreToAlertPriority(
  analysis: SecFilingAnalysis,
  formType: '8-K' | 'Form4',
): 'CRITICAL' | 'HIGH' | 'MEDIUM' | null {

  const { price_impact, conviction, requires_immediate_attention } = analysis;

  // Natychmiastowa uwaga wymagana przez GPT + conviction powyżej progu
  if (requires_immediate_attention && Math.abs(conviction) >= 0.4) {
    return price_impact.magnitude === 'high' ? 'CRITICAL' : 'HIGH';
  }

  // Wysoka magnitude + wysoka confidence
  if (price_impact.magnitude === 'high' && price_impact.confidence >= 0.7) {
    return 'CRITICAL';
  }

  // Średnia magnitude z wystarczającą confidence
  if (price_impact.magnitude === 'medium' && price_impact.confidence >= 0.6) {
    return 'HIGH';
  }

  // Wysoka magnitude ale niska confidence — alertuj ale nie CRITICAL
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
