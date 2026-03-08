/**
 * Prompt GPT do analizy 8-K Item 1.01 — Material Definitive Agreement.
 * Kontrakty, umowy, partnerstwa, licencje.
 */
export function buildForm8k101Prompt(ticker: string, companyName: string, text: string): string {
  return `You are a financial analyst specializing in US healthcare stocks.

Analyze this SEC 8-K Item 1.01 (Material Definitive Agreement) filing.

COMPANY: ${companyName} (${ticker})
SECTOR: Healthcare

FILING TEXT:
${text.slice(0, 8000)}

Focus on extracting:
1. Contract value (total, annual, or milestone-based)
2. Counterparty (who is the other party)
3. Contract duration and renewal terms
4. Termination conditions (can either party exit easily?)
5. Strategic significance (does this open new markets, create dependency, etc.)

Price impact assessment:
- Large long-term contracts with established partners = bullish
- Short-term or easily terminable contracts = neutral
- Contracts creating customer concentration risk = bearish long-term
- Healthcare-specific: Medicare/Medicaid contracts carry regulatory risk

IMPORTANT: Write summary, conclusion, and key_facts in POLISH language.

Respond with JSON only, no preamble:
{
  "price_impact": {
    "direction": "positive|negative|neutral",
    "magnitude": "high|medium|low",
    "confidence": 0.0-1.0,
    "time_horizon": "immediate|short_term|medium_term"
  },
  "conviction": -2.0 to +2.0,
  "summary": "jedno zdanie po polsku co się wydarzyło",
  "conclusion": "1-2 zdania po polsku: ocena wpływu na cenę i uzasadnienie",
  "key_facts": ["wartość kontraktu", "kontrahent", "czas trwania", "kluczowe warunki"],
  "catalyst_type": "contract",
  "requires_immediate_attention": true|false
}`;
}
