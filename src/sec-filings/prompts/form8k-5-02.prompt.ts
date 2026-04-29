/**
 * Prompt GPT do analizy 8-K Item 5.02 — Departure/Appointment of Officers.
 * Zmiana CEO, CFO, dyrektorów.
 */
export function buildForm8k502Prompt(ticker: string, companyName: string, text: string, _itemNumber?: string, tickerProfile?: string | null): string {
  return `You are a financial analyst specializing in US healthcare stocks.

Analyze this SEC 8-K Item 5.02 (Departure/Appointment of Officers) filing.

COMPANY: ${companyName} (${ticker})
SECTOR: Healthcare

FILING TEXT:
${text.slice(0, 50_000)}

Focus on:
1. Who is departing and who is arriving (CEO, CFO, or other)
2. Reason for departure: resignation, retirement, termination, or not stated
3. Is the departure effective immediately or with transition period?
4. Background of incoming executive (internal promotion vs external hire)
5. Has a successor been named? If yes — who and what's their background?
6. Is the company underperforming? Could this be a "relief rally" where investors welcome the change?
7. Is there activist pressure, proxy fight, or other external pressure driving the change?

CRITICAL DISTINCTION — three fundamentally different scenarios:

A) VOLUNTARY + SUCCESSOR NAMED (conviction ±0.1 to ±0.5):
   - Planned retirement/resignation with named successor
   - Internal promotion — continuity of strategy
   - Transition period stated (3-6 months)
   - Market reaction: usually neutral to slightly negative

B) CRISIS / NO SUCCESSOR (conviction ±0.8 to ±1.5):
   - "Effective immediately" with no successor named
   - Firing or forced resignation
   - CFO departure before earnings season
   - SEC investigation or accounting concerns mentioned
   - Multiple executives departing simultaneously
   - Market reaction: strong negative (uncertainty premium)

C) RELIEF RALLY POTENTIAL (conviction +0.2 to +0.5):
   - Company has been underperforming for 12+ months
   - CEO widely seen as obstacle to turnaround
   - Activist investor pressure preceded departure
   - New CEO with strong turnaround track record
   - Market reaction: potentially POSITIVE despite departure

${tickerProfile ? tickerProfile : 'No historical signal data available for this ticker — use baseline conviction scale.'}

CONVICTION SCALE (match the scenario, do NOT default to any single value):
- ±0.1 to ±0.3: planned retirement with named successor, director rotation, scenario A
- ±0.4 to ±0.7: departure with some uncertainty but transition plan exists
- ±0.8 to ±1.2: sudden departure, no successor, effective immediately — scenario B
- ±1.3 to ±1.6: CEO fired amid controversy, CFO departure before earnings
- ±1.7 to ±2.0: extreme crisis only (e.g., departure + SEC investigation + restatement)
- +0.2 to +0.5: relief rally scenario C (POSITIVE conviction for departure)
- 0.0: truly neutral, routine board changes
IMPORTANT: Do NOT give the same conviction to all departures. Analyze the CONTEXT.

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
