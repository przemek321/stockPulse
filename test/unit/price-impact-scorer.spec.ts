import { scoreToAlertPriority, mapToRuleName } from '../../src/sec-filings/scoring/price-impact.scorer';
import { SecFilingAnalysis } from '../../src/sec-filings/types/sec-filing-analysis';

/**
 * Testy scorera price impact — mapowanie GPT analysis na priorytet alertu.
 */

/** Helper do tworzenia analizy z domyślnymi wartościami */
function makeAnalysis(overrides: Partial<SecFilingAnalysis> = {}): SecFilingAnalysis {
  return {
    summary: 'Test summary',
    conclusion: 'Test conclusion',
    catalyst_type: 'earnings',
    conviction: 0.5,
    key_facts: ['fact1'],
    requires_immediate_attention: false,
    price_impact: {
      direction: 'negative',
      magnitude: 'medium',
      confidence: 0.7,
      time_horizon: 'short_term',
    },
    ...overrides,
  };
}

describe('scoreToAlertPriority', () => {
  it('zwraca CRITICAL dla requires_immediate_attention + high conviction', () => {
    const analysis = makeAnalysis({
      requires_immediate_attention: true,
      conviction: 0.8,
      price_impact: { direction: 'negative', magnitude: 'high', confidence: 0.9, time_horizon: 'immediate' },
    });
    expect(scoreToAlertPriority(analysis, '8-K')).toBe('CRITICAL');
  });

  it('zwraca HIGH dla requires_immediate_attention + medium magnitude', () => {
    const analysis = makeAnalysis({
      requires_immediate_attention: true,
      conviction: 0.5,
      price_impact: { direction: 'negative', magnitude: 'medium', confidence: 0.7, time_horizon: 'immediate' },
    });
    expect(scoreToAlertPriority(analysis, '8-K')).toBe('HIGH');
  });

  it('nie alertuje dla requires_immediate_attention + niski conviction', () => {
    const analysis = makeAnalysis({
      requires_immediate_attention: true,
      conviction: 0.2,
    });
    // conviction < 0.4 → nie wchodzi do immediate attention, inne reguły mogą zadziałać
    const result = scoreToAlertPriority(analysis, '8-K');
    // Z medium magnitude i 0.7 confidence → HIGH
    expect(result).toBe('HIGH');
  });

  it('zwraca CRITICAL dla high magnitude + high confidence', () => {
    const analysis = makeAnalysis({
      price_impact: { direction: 'negative', magnitude: 'high', confidence: 0.8, time_horizon: 'immediate' },
    });
    expect(scoreToAlertPriority(analysis, '8-K')).toBe('CRITICAL');
  });

  it('zwraca HIGH dla medium magnitude + dobra confidence', () => {
    const analysis = makeAnalysis({
      price_impact: { direction: 'positive', magnitude: 'medium', confidence: 0.7, time_horizon: 'short_term' },
    });
    expect(scoreToAlertPriority(analysis, '8-K')).toBe('HIGH');
  });

  it('zwraca HIGH dla high magnitude + niska confidence', () => {
    const analysis = makeAnalysis({
      price_impact: { direction: 'negative', magnitude: 'high', confidence: 0.5, time_horizon: 'immediate' },
    });
    expect(scoreToAlertPriority(analysis, '8-K')).toBe('HIGH');
  });

  it('zwraca null dla low magnitude', () => {
    const analysis = makeAnalysis({
      price_impact: { direction: 'neutral', magnitude: 'low', confidence: 0.9, time_horizon: 'medium_term' },
    });
    expect(scoreToAlertPriority(analysis, '8-K')).toBeNull();
  });

  it('zwraca null dla medium magnitude + niska confidence', () => {
    const analysis = makeAnalysis({
      price_impact: { direction: 'positive', magnitude: 'medium', confidence: 0.4, time_horizon: 'short_term' },
    });
    expect(scoreToAlertPriority(analysis, '8-K')).toBeNull();
  });
});

describe('mapToRuleName', () => {
  it('zwraca "Form 4 Insider Signal" dla Form4', () => {
    const analysis = makeAnalysis({ catalyst_type: 'insider_selling' });
    expect(mapToRuleName(analysis, 'Form4')).toBe('Form 4 Insider Signal');
  });

  it('zwraca "8-K Earnings Miss" dla catalyst_type earnings', () => {
    const analysis = makeAnalysis({ catalyst_type: 'earnings' });
    expect(mapToRuleName(analysis, '8-K')).toBe('8-K Earnings Miss');
  });

  it('zwraca "8-K Leadership Change" dla catalyst_type leadership', () => {
    const analysis = makeAnalysis({ catalyst_type: 'leadership' });
    expect(mapToRuleName(analysis, '8-K')).toBe('8-K Leadership Change');
  });

  it('zwraca "8-K Material Event GPT" dla innego catalyst_type', () => {
    const analysis = makeAnalysis({ catalyst_type: 'contract' });
    expect(mapToRuleName(analysis, '8-K')).toBe('8-K Material Event GPT');
  });

  it('zwraca "8-K Material Event GPT" jako domyślną dla nieznanego catalyst_type', () => {
    const analysis = makeAnalysis({ catalyst_type: 'unknown' });
    expect(mapToRuleName(analysis, '8-K')).toBe('8-K Material Event GPT');
  });
});
