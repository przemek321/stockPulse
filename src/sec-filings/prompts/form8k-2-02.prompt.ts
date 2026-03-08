/**
 * Prompt GPT do analizy 8-K Item 2.02 — Results of Operations (wyniki kwartalne).
 * Earnings beat/miss, guidance, MLR, membership.
 */
export function buildForm8k202Prompt(ticker: string, companyName: string, text: string): string {
  return `You are a financial analyst specializing in US healthcare stocks.

Analyze this SEC 8-K Item 2.02 (Results of Operations) earnings filing.

COMPANY: ${companyName} (${ticker})
SECTOR: Healthcare

FILING TEXT:
${text.slice(0, 8000)}

Focus on extracting:
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

Respond with JSON only, no preamble:
{
  "price_impact": {
    "direction": "positive|negative|neutral",
    "magnitude": "high|medium|low",
    "confidence": 0.0-1.0,
    "time_horizon": "immediate|short_term|medium_term"
  },
  "conviction": -2.0 to +2.0,
  "summary": "one sentence: EPS beat/miss and guidance direction",
  "conclusion": "1-2 sentences: price impact with key numbers",
  "key_facts": ["EPS reported vs estimate", "revenue reported vs estimate", "guidance change", "MLR if applicable"],
  "catalyst_type": "earnings",
  "requires_immediate_attention": true
}`;
}
