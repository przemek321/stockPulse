import { z } from 'zod';

/**
 * Wspólna struktura odpowiedzi GPT dla wszystkich typów filingów SEC.
 * Używana przez Form 4 Pipeline i 8-K Pipeline.
 */
export interface SecFilingAnalysis {
  price_impact: {
    direction: 'positive' | 'negative' | 'neutral';
    magnitude: 'high' | 'medium' | 'low';
    confidence: number;
    time_horizon: 'immediate' | 'short_term' | 'medium_term';
  };
  /** Conviction [-2.0, +2.0]: positive = bullish, negative = bearish */
  conviction: number;
  /** 1 zdanie: co się stało */
  summary: string;
  /** 1-2 zdania: jaki wpływ na cenę i dlaczego */
  conclusion: string;
  /** 2-4 bullet points z konkretnymi liczbami/faktami */
  key_facts: string[];
  catalyst_type: string;
  /** true → pomija throttling (np. bankruptcy, nagły CEO departure) */
  requires_immediate_attention: boolean;
}

/**
 * Zod schema do walidacji JSON z GPT.
 * Zapewnia poprawność struktury odpowiedzi — GPT czasem zwraca niepoprawny JSON.
 */
export const SecFilingAnalysisSchema = z.object({
  price_impact: z.object({
    direction: z.enum(['positive', 'negative', 'neutral']),
    magnitude: z.enum(['high', 'medium', 'low']),
    confidence: z.number().min(0).max(1),
    time_horizon: z.enum(['immediate', 'short_term', 'medium_term']),
  }),
  conviction: z.number().min(-2).max(2),
  summary: z.string().min(1),
  conclusion: z.string().min(1),
  key_facts: z.array(z.string()).min(1).max(10),
  catalyst_type: z.string().min(1),
  requires_immediate_attention: z.boolean(),
});

/**
 * Parsuje i waliduje odpowiedź JSON z GPT.
 * Rzuca błąd gdy JSON jest niepoprawny lub nie przechodzi walidacji Zod.
 */
export function parseGptResponse(raw: string): SecFilingAnalysis {
  // Wyciągnij JSON z odpowiedzi (GPT czasem dodaje markdown ```json ... ```)
  const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();

  const parsed = JSON.parse(jsonStr);
  return SecFilingAnalysisSchema.parse(parsed);
}
