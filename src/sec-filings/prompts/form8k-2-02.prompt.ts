/**
 * Prompt GPT do analizy 8-K Item 2.02 — Results of Operations (wyniki kwartalne).
 * Earnings beat/miss, guidance, MLR, membership.
 */
export function buildForm8k202Prompt(
  ticker: string,
  companyName: string,
  text: string,
  _itemNumber?: string,
  tickerProfile?: string | null,
  extractedFacts?: string | null,
): string {
  return `You are a financial analyst specializing in US healthcare stocks.

Analyze this SEC 8-K Item 2.02 (Results of Operations) earnings filing.

COMPANY: ${companyName} (${ticker})
SECTOR: Healthcare

FILING TEXT:
${text.slice(0, 50_000)}

${extractedFacts ? `## CONFIRMED FACTS (extracted deterministically — TRUST THESE OVER YOUR OWN INFERENCE FROM THE TEXT):\n${extractedFacts}\n\n` : ''}Focus on extracting:
1. EPS: reported vs analyst consensus (if mentioned)
2. Revenue: reported vs guidance/consensus
3. Full-year guidance: raised, lowered, or maintained
4. Medical Loss Ratio (MLR) — critical for managed care companies
5. Membership/enrollment changes — critical for insurers
6. Any one-time items distorting results

Price impact assessment:
- Beat on EPS + raised guidance = strongly bullish
- Miss on EPS + lowered guidance = strongly bearish
- MLR above 90% for managed care = severe bearish signal
- Guidance cut is more impactful than earnings miss
- AFFIRMED Adjusted guidance is NEUTRAL-to-BULLISH for managed care (sector
  is adjusted-driven; GAAP-only changes are typically non-cash and should
  NOT drive bearish conviction below -0.3).

${tickerProfile ? tickerProfile : 'No historical signal data available for this ticker — use baseline conviction scale.'}

CONVICTION SCALE (must match event significance — do NOT default to ±1.5):
- ±0.1 to ±0.4: in-line results, guidance maintained, no surprises
- ±0.5 to ±0.8: slight beat/miss, minor guidance adjustment
- ±0.9 to ±1.2: solid beat/miss with guidance change in same direction
- ±1.3 to ±1.6: large beat/miss + significant guidance revision
- ±1.7 to ±2.0: extreme — massive earnings surprise + dramatic guidance change (e.g., MLR spike from 85% to 92%)
- 0.0: truly neutral, results exactly as expected
Use the FULL range. Routine earnings with in-line results should be ±0.1-0.3.

REQUIRES_IMMEDIATE_ATTENTION DECISION RULE (default: false):
Set to TRUE only if ALL of the following hold:
1. |conviction| >= 1.0
2. price_impact.magnitude == "high"
3. price_impact.confidence >= 0.7
4. key_facts contain CONCRETE numbers (no "niedostępne", "brak danych", "unknown", "insufficient")
Otherwise set to FALSE. Routine earnings, in-line results, mild beats/misses,
or filings where critical numbers are missing/unclear → ALWAYS false.

KEY_FACTS RULE: Only include facts that you can support with concrete numbers
or explicit statements from the filing text. Do NOT speculate. If a metric
(EPS, revenue, guidance, MLR) is not present in the filing text, OMIT that
key_fact entirely — do NOT write "niedostępne" or "brak danych" as a fact.

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
  "summary": "jedno zdanie po polsku: EPS beat/miss i kierunek guidance",
  "conclusion": "1-2 zdania po polsku: wpływ na cenę z kluczowymi liczbami",
  "key_facts": ["EPS raportowany vs szacunek", "przychód vs szacunek", "zmiana guidance", "MLR jeśli dotyczy"],
  "catalyst_type": "earnings",
  "requires_immediate_attention": false
}`;
}
