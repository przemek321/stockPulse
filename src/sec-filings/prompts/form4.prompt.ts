import { Form4Transaction } from '../../collectors/sec-edgar/form4-parser';

/**
 * Prompt GPT do analizy transakcji insiderskiej (Form 4 SEC).
 * Uwzględnia kontekst: rola insidera, plan 10b5-1, ostatnie transakcje tego tickera.
 */

/** Uproszczona struktura do budowania promptu (z Form4Transaction + dodatkowe pola) */
export interface Form4PromptData {
  insiderName: string;
  insiderRole: string | null;
  transactionType: string;
  shares: number;
  pricePerShare: number | null;
  totalValue: number;
  sharesOwnedAfter: number | null;
  is10b51Plan: boolean;
  transactionDate: string;
}

export function buildForm4Prompt(
  ticker: string,
  companyName: string,
  parsed: Form4PromptData,
  recentFilings: Form4PromptData[],
): string {
  return `You are a financial analyst specializing in insider trading signals for US healthcare stocks.

Analyze this SEC Form 4 insider transaction and assess its price impact.

COMPANY: ${companyName} (${ticker})
SECTOR: Healthcare

TRANSACTION:
- Insider: ${parsed.insiderName} (${parsed.insiderRole ?? 'Unknown role'})
- Type: ${parsed.transactionType === 'BUY' ? 'PURCHASE' : parsed.transactionType === 'SELL' ? 'SALE' : parsed.transactionType}
- Shares: ${parsed.shares.toLocaleString()}
- Price: $${parsed.pricePerShare ?? 'N/A'}
- Total value: $${parsed.totalValue.toLocaleString()}
- Shares owned after: ${parsed.sharesOwnedAfter != null ? parsed.sharesOwnedAfter.toLocaleString() : 'N/A'}
- Is 10b5-1 plan (pre-scheduled): ${parsed.is10b51Plan ? 'YES' : 'NO'}
- Transaction date: ${parsed.transactionDate}

RECENT INSIDER ACTIVITY (last 30 days, same company):
${recentFilings.length === 0
    ? 'No other insider transactions in past 30 days.'
    : recentFilings.map(f =>
        `- ${f.insiderName} (${f.insiderRole ?? '?'}): ${f.transactionType} ${f.shares.toLocaleString()} shares ($${f.totalValue.toLocaleString()})`,
      ).join('\n')
}

ANALYSIS GUIDELINES:
- Purchases are generally bullish, especially by CEO/CFO using personal funds
- Sales are less informative UNLESS: no 10b5-1 plan, large % of holdings, cluster selling
- 10b5-1 pre-scheduled plans reduce signal value significantly
- Role hierarchy: CEO/Founder > CFO > Director > VP
- Cluster selling (2+ insiders in 7 days) amplifies bearish signal
- Consider % of total holdings sold/bought, not just absolute value

CONVICTION SCALE (must match event significance — do NOT default to ±1.5):
- ±0.1 to ±0.4: routine transaction, 10b5-1 plan sale, small amount, low significance
- ±0.5 to ±0.8: notable transaction, moderate size, some signal value
- ±0.9 to ±1.2: significant — large purchase by CEO/CFO, or cluster selling pattern
- ±1.3 to ±1.6: very significant — massive insider buy before catalyst, or emergency sell-off
- ±1.7 to ±2.0: extreme — only for extraordinary events (e.g., CEO buys $10M+ worth before FDA decision)
- 0.0: truly neutral, no trading signal
Use the FULL range. Most routine 10b5-1 sales should be ±0.1-0.3. Only exceptional events warrant ±1.5+.

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
  "key_facts": ["fakt1 po polsku", "fakt2", "fakt3"],
  "catalyst_type": "insider",
  "requires_immediate_attention": true|false
}`;
}
