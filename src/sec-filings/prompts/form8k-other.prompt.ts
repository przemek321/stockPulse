/**
 * Prompt GPT do analizy 8-K dla ogólnych Itemów (7.01, 8.01 i inne).
 * FDA, CMS, DOJ/FTC, M&A, clinical trials, restatements.
 */
export function buildForm8kOtherPrompt(
  ticker: string,
  companyName: string,
  text: string,
  itemNumber?: string,
): string {
  return `You are a financial analyst specializing in US healthcare stocks.

Analyze this SEC 8-K Item ${itemNumber ?? 'unknown'} filing for its potential price impact.

COMPANY: ${companyName} (${ticker})
SECTOR: Healthcare

FILING TEXT:
${text.slice(0, 8000)}

This is an open-ended material event. Assess it freely.

Healthcare-specific events to watch for:
- FDA approval/rejection/CRL (Complete Response Letter)
- CMS rate changes (Medicare Advantage, Medicaid)
- DOJ/FTC investigation or settlement
- Clinical trial results (phase 2/3)
- M&A announcement or termination
- Major litigation settlement or judgment
- Restatement of financials

For each event type, the key question is always:
Does this change the fundamental earnings power of the company?

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
  "conclusion": "1-2 zdania po polsku: wpływ na cenę i uzasadnienie",
  "key_facts": ["fakt1 po polsku", "fakt2", "fakt3"],
  "catalyst_type": "fda|cms_rate|legal|ma|regulatory|earnings|other",
  "requires_immediate_attention": true|false
}`;
}
