/**
 * Prompt GPT do analizy 8-K dla ogólnych Itemów (7.01, 8.01 i inne).
 * FDA, CMS, DOJ/FTC, M&A, clinical trials, restatements.
 */
export function buildForm8kOtherPrompt(
  ticker: string,
  companyName: string,
  text: string,
  itemNumber?: string,
  tickerProfile?: string | null,
): string {
  return `You are a financial analyst specializing in US healthcare stocks.

Analyze this SEC 8-K Item ${itemNumber ?? 'unknown'} filing for its potential price impact.

COMPANY: ${companyName} (${ticker})
SECTOR: Healthcare

FILING TEXT:
${text.slice(0, 50_000)}

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

${tickerProfile ? tickerProfile : 'No historical signal data available for this ticker — use baseline conviction scale.'}

CONVICTION SCALE (must match event significance — do NOT default to ±1.5):
- ±0.1 to ±0.4: routine disclosure, minor regulatory update, standard filing
- ±0.5 to ±0.8: notable event — CMS rate change, litigation update, clinical trial progress
- ±0.9 to ±1.2: significant — FDA approval/rejection of secondary product, major settlement
- ±1.3 to ±1.6: very significant — FDA decision on key product, DOJ investigation, M&A announcement
- ±1.7 to ±2.0: extreme — only for extraordinary events (FDA rejection of sole product, bankruptcy-level litigation, hostile takeover)
- 0.0: truly neutral, no price impact expected
Use the FULL range. Most 7.01/8.01 filings should be ±0.2-0.6.

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
  "conclusion": "1-2 zdania po polsku: wpływ na cenę i uzasadnienie",
  "key_facts": ["fakt1 po polsku", "fakt2", "fakt3"],
  "catalyst_type": "fda|cms_rate|legal|ma|regulatory|earnings|other",
  "requires_immediate_attention": true|false
}`;
}
