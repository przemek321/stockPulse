/**
 * Prompt GPT do analizy 8-K Item 5.02 — Departure/Appointment of Officers.
 * Zmiana CEO, CFO, dyrektorów.
 */
export function buildForm8k502Prompt(ticker: string, companyName: string, text: string): string {
  return `You are a financial analyst specializing in US healthcare stocks.

Analyze this SEC 8-K Item 5.02 (Departure/Appointment of Officers) filing.

COMPANY: ${companyName} (${ticker})
SECTOR: Healthcare

FILING TEXT:
${text.slice(0, 8000)}

Focus on:
1. Who is departing and who is arriving (CEO, CFO, or other)
2. Reason for departure: resignation, retirement, termination, or not stated
3. Is the departure effective immediately or with transition period?
4. Background of incoming executive (internal promotion vs external hire)
5. Pattern: is this part of broader leadership changes?

Price impact assessment:
- Sudden unexplained CEO departure = bearish (uncertainty premium)
- Planned retirement with successor named = neutral to slightly negative
- New CEO with turnaround track record = potentially bullish
- CFO departure before earnings = strong bearish signal
- "Effective immediately" language = higher uncertainty = more negative

Respond with JSON only, no preamble:
{
  "price_impact": {
    "direction": "positive|negative|neutral",
    "magnitude": "high|medium|low",
    "confidence": 0.0-1.0,
    "time_horizon": "immediate|short_term|medium_term"
  },
  "conviction": -2.0 to +2.0,
  "summary": "one sentence: who left/joined and in what capacity",
  "conclusion": "1-2 sentences: circumstances and likely price reaction",
  "key_facts": ["role", "departure reason", "effective date", "successor if named"],
  "catalyst_type": "leadership",
  "requires_immediate_attention": true|false
}`;
}
