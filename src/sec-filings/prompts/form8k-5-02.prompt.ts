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

CONVICTION SCALE (must match event significance — do NOT default to ±1.5):
- ±0.1 to ±0.3: planned retirement with named successor, director rotation
- ±0.4 to ±0.7: executive departure with transition period, internal promotion
- ±0.8 to ±1.2: sudden CEO/CFO departure, no successor named yet
- ±1.3 to ±1.6: CEO fired/resigned amid controversy, CFO departure before earnings
- ±1.7 to ±2.0: extreme — only for crisis-level departures (e.g., CEO departure + SEC investigation)
- 0.0: truly neutral, routine board changes
Use the FULL range. Planned retirements should be ±0.1-0.3.

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
  "summary": "jedno zdanie po polsku: kto odszedł/dołączył i na jakim stanowisku",
  "conclusion": "1-2 zdania po polsku: okoliczności i prawdopodobna reakcja cenowa",
  "key_facts": ["stanowisko", "powód odejścia", "data wejścia w życie", "następca jeśli wskazany"],
  "catalyst_type": "leadership",
  "requires_immediate_attention": true|false
}`;
}
