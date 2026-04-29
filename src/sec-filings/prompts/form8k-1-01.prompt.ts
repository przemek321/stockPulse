/**
 * Prompt GPT do analizy 8-K Item 1.01 — Material Definitive Agreement.
 * Kontrakty, umowy, partnerstwa, licencje.
 */
export function buildForm8k101Prompt(ticker: string, companyName: string, text: string, _itemNumber?: string, tickerProfile?: string | null): string {
  return `You are a financial analyst specializing in US healthcare stocks.

Analyze this SEC 8-K Item 1.01 (Material Definitive Agreement) filing.

COMPANY: ${companyName} (${ticker})
SECTOR: Healthcare

FILING TEXT:
${text.slice(0, 50_000)}

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

${tickerProfile ? tickerProfile : 'No historical signal data available for this ticker — use baseline conviction scale.'}

CONVICTION SCALE (must match event significance — do NOT default to ±1.5):
- ±0.1 to ±0.4: routine contract, standard renewal, minor agreement
- ±0.5 to ±0.8: notable partnership, moderate contract value
- ±0.9 to ±1.2: significant deal — large multi-year contract, important strategic partner
- ±1.3 to ±1.6: major deal — transformative agreement, >10% revenue impact
- ±1.7 to ±2.0: extraordinary — game-changing partnership (e.g., exclusive license for blockbuster drug)
- 0.0: truly neutral, no price impact expected
Use the FULL range. Most routine contracts should be ±0.3-0.6.

IMPORTANT: Write summary, conclusion, and key_facts in POLISH language.

Respond with JSON only, no preamble:
{
  "price_impact": {
    "direction": "positive|negative|neutral",
    "magnitude": "high|medium|low",
    "confidence": 0.0-1.0,
    "time_horizon": "immediate|short_term|medium_term"
  },
  "conviction": (use scale below),
  "summary": "jedno zdanie po polsku co się wydarzyło",
  "conclusion": "1-2 zdania po polsku: ocena wpływu na cenę i uzasadnienie",
  "key_facts": ["wartość kontraktu", "kontrahent", "czas trwania", "kluczowe warunki"],
  "catalyst_type": "contract",
  "requires_immediate_attention": true|false
}`;
}
