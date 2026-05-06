/**
 * S19-FIX-12: regex extract EPS i Revenue z tekstu raportu earnings (Exhibit 99.1).
 *
 * Best-effort: jeśli regex nie zwróci nic → null (consensus comparison wyłączony
 * dla tej metryki, ale druga metryka może mieć wartość). Defense-in-depth: GPT
 * dostaje wartości z Finnhub/Alpha Vantage NIEZALEŻNIE od tego ekstraktora —
 * regex jest tylko dla actual revenue którego Alpha Vantage free nie udostępnia.
 *
 * Przykłady które łapie:
 *   "Revenue of $761.7 million"
 *   "Total revenue: $761.7M"
 *   "Net revenues of $761,700,000"
 *   "Revenue $3.2 billion"
 *   "Diluted EPS of $1.42"
 *   "EPS (diluted): $1.42"
 *   "Net income per share, diluted, $1.30"
 */

export interface ReportedNumbers {
  /** EPS diluted USD (preferowany), fallback EPS basic */
  epsDiluted: number | null;
  /** Revenue total USD (zwykle largest "revenue of $X" matching) */
  revenue: number | null;
}

/**
 * Konwertuje "$1.5 billion" / "$761.7 million" / "$1,234,567" → number USD.
 * "billion" → ×1e9, "million"/"M" → ×1e6, gołe liczby → as-is.
 */
function parseDollarAmount(rawNumber: string, unit?: string): number | null {
  const cleaned = rawNumber.replace(/,/g, '');
  const value = parseFloat(cleaned);
  if (!isFinite(value) || value <= 0) return null;

  const u = (unit || '').toLowerCase().trim();
  if (u.startsWith('b')) return value * 1_000_000_000;
  if (u.startsWith('m')) return value * 1_000_000;
  return value;
}

/**
 * Extract revenue actual z reportText. Bierze NAJWIĘKSZĄ wartość znalezioną
 * (raporty często wspominają segmenty: US revenue $X, International $Y, Total $Z;
 * total jest największe). Próg minimalny 1M USD (zabezpieczenie przed false matchami
 * typu "revenue per share $1.42").
 */
export function extractRevenue(text: string): number | null {
  if (!text) return null;

  const candidates: number[] = [];

  // Pattern 1: "revenue(s) of $X.X million/billion/M/B"
  const re1 = /(?:total\s+|net\s+)?revenue[s]?\s+(?:of\s+)?\$\s*([0-9]+(?:[,.][0-9]+)*)\s*(million|billion|M\b|B\b|mln|bln)?/gi;
  // Pattern 2: "revenue: $X.X million" or "revenue $X.X million"
  const re2 = /(?:total\s+|net\s+)?revenue[s]?\s*[:=]?\s*\$\s*([0-9]+(?:[,.][0-9]+)*)\s*(million|billion|M\b|B\b|mln|bln)/gi;

  for (const re of [re1, re2]) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const value = parseDollarAmount(match[1], match[2]);
      if (value !== null && value >= 1_000_000) {
        candidates.push(value);
      }
    }
  }

  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}

/**
 * Extract EPS diluted USD. Preferuje "diluted" over "basic". Próg: -100..+100 USD
 * (sensible range, blokuje false matche typu "share price $250").
 *
 * NOTE: dla EPS używamy głównie Finnhub `/stock/earnings.actual` jako primary,
 * ten extractor jest fallback gdy Finnhub nie ma jeszcze danych dla świeżego Q.
 */
export function extractEpsDiluted(text: string): number | null {
  if (!text) return null;

  const patterns: RegExp[] = [
    // "diluted EPS of $X.XX" / "diluted EPS: $X.XX" / "diluted EPS $X.XX"
    /diluted\s+(?:eps|earnings\s+per\s+share)\s*(?:of|[:=])?\s*\$?\s*\(?(-?[0-9]+\.[0-9]{1,3})\)?/i,
    // "EPS (diluted): $X.XX" / "EPS diluted $X.XX"
    /\beps\s*\(?\s*diluted\s*\)?\s*[:=]?\s*\$?\s*\(?(-?[0-9]+\.[0-9]{1,3})\)?/i,
    // "earnings per share, diluted, $X.XX"
    /earnings\s+per\s+share[,\s]+diluted[,\s:=]+\$?\s*\(?(-?[0-9]+\.[0-9]{1,3})\)?/i,
    // "net income per share, diluted, $X.XX"
    /net\s+(?:income|loss)\s+per\s+share[,\s]+diluted[,\s:=]+\$?\s*\(?(-?[0-9]+\.[0-9]{1,3})\)?/i,
  ];

  for (const re of patterns) {
    const match = re.exec(text);
    if (match) {
      const value = parseFloat(match[1]);
      if (isFinite(value) && Math.abs(value) <= 100) {
        return value;
      }
    }
  }

  return null;
}

export function extractReportedNumbers(text: string): ReportedNumbers {
  return {
    epsDiluted: extractEpsDiluted(text),
    revenue: extractRevenue(text),
  };
}
