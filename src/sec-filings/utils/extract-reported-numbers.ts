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
 *   "Revenue was $890.4 million for the third quarter of 2026"
 *   "Net revenues increased by 8.3% to $4.638 billion during the second quarter"
 *   "Diluted EPS of $1.42"
 *   "EPS (diluted): $1.42"
 *   "Net income per share, diluted, $1.30"
 *
 * Revenue = przychód KWARTAŁU (konsensus Alpha Vantage jest kwartalny). Kwoty z prognoz,
 * okresów całorocznych / narastających, zakresów i okresów porównawczych są odrzucane —
 * patrz `revenueRejectionReason` (fix 25.11.2026: HIMS +329%, UHS +304% „surprise").
 */

export interface ReportedNumbers {
  /** EPS diluted USD (preferowany), fallback EPS basic */
  epsDiluted: number | null;
  /** Revenue total USD za KWARTAŁ (największe "revenue of $X" po odrzuceniu prognoz / okresów rocznych) */
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

/** Ile znaków wstecz (w obrębie tego samego zdania) czytamy kontekst dopasowania. */
const BEFORE_WINDOW = 140;
/** Ile znaków po kwocie sprawdzamy (zakres, kolejna kolumna tabeli, okres). */
const AFTER_WINDOW = 60;
/** Ile ostatnich znaków przed dopasowaniem sprawdzamy pod kątem porównania z rokiem wcześniej. */
const COMPARISON_WINDOW = 50;
/** Ile znaków po przyimku („for the …", „during the …") szukamy nazwy okresu. */
const AFTER_PERIOD_WINDOW = 24;

/**
 * Koniec zdania w tekście po `stripHtml` (białe znaki już zwinięte do spacji): kropka +
 * spacja + wielka litera. Kropka po wielkiej literze („U.S. Revenue") nie kończy zdania.
 */
const SENTENCE_END_SRC = String.raw`(?<![A-Z])[.!?]["”’)\]]*\s+(?=["“‘(\[]?[A-Z])`;

/**
 * Słowa prognozy. „expected" po „than"/„as" („better-than-expected revenue of …") to wynik,
 * nie prognoza — dlatego wyłączone lookbehindem; „expectations" nie jest na liście.
 */
const FORWARD_LOOKING_RE =
  /\b(?:expects?|expecting|(?<!than[\s-])(?<!\bas\s)expected|guidance|guid(?:es|ed|ing)|outlook|forecast(?:s|ed)?|anticipat(?:e|es|ed|ing)|project(?:s|ed|ions?|ing)|target(?:s|ed|ing)?|range|midpoint)\b/i;

/** Porównanie z wcześniejszym okresem tuż przed kwotą: „compared to revenue of $X". */
const COMPARISON_RE =
  /\b(?:compared\s+(?:to|with)|versus|vs\b\.?|(?:up|down)\s+from|prior[\s-]+(?:year|period|quarter)|year[\s-]+ago|same\s+(?:period|quarter))\b/i;

/** Kwota bezpośrednio po kwocie = wiersz tabeli wielokolumnowej (Low/High, kwartał/YTD). */
const NEXT_AMOUNT_RE = /^\s*\$\s*[0-9]/;
/** Zakres: „$875 million to $895 million", „$844 - $850", „$3.1 billion and $3.2 billion". */
const RANGE_RE = /^\s*(?:(?:to|through|-|–|—)\s*\$?|(?:and|or)\s*\$)\s*[0-9]/i;
/** Przyimek otwierający okres po kwocie: „… $9.133 billion during the first six months". */
const AFTER_PERIOD_PREFIX_RE = /^[\s,]*(?:for|during|in|over|through)\s+(?:the\s+|our\s+)?/i;
/** Goły rok jako okres: „revenues of approximately $17.4 billion during 2025". */
const BARE_YEAR_RE = /^(?:(?:calendar|fiscal|full)\s+)?(?:year\s+)?(?:19|20)\d{2}\b/i;
/** Wtrącenie w nawiasie (także ucięte początkiem okna) — pomijane przy szukaniu porównania. */
const PARENTHETICAL_RE = /\([^()]*\)|^[^()]*\)/g;
/** Deklaracja skali tabel: „(In Thousands, Unaudited)", „$ in millions". */
const TABLE_SCALE_RE = /\bin\s+(?:thousands|millions)\b/i;

const YEAR_SRC = String.raw`(?:19|20)\d{2}`;
/**
 * Znacznik kwartału — razem z doklejonym rokiem, także obrotowym („third quarter of fiscal
 * year 2026", „Q3 FY26", „fiscal 2026 third quarter"), żeby „fiscal year" wewnątrz nazwy
 * kwartału nie zostało policzone jako okres roczny.
 */
const QUARTER_SRC =
  String.raw`(?:fiscal\s+(?:year\s+)?(?:${YEAR_SRC}\s+)?)?` +
  String.raw`(?:(?:first|second|third|fourth|1st|2nd|3rd|4th)[\s-]+quarter|\bQ[1-4](?:\s*'?\d{2,4})?\b|\b[1-4]Q(?:\s*'?\d{2,4})?\b|three[\s-]+months?|\bquarter(?:ly)?\b)` +
  String.raw`(?:\s+(?:of\s+)?(?:(?:fiscal|FY)\s*)?(?:year\s+)?'?(?:${YEAR_SRC}|\d{2})\b)?`;
/** Znacznik okresu innego niż kwartał: rok, suma narastająca, półrocze, 12 miesięcy. */
const NON_QUARTER_SRC =
  String.raw`full[\s-]+year|fiscal[\s-]+year|fiscal\s+${YEAR_SRC}|\bFY\s*'?\d{2,4}\b|\bFY\b|\bannual(?:ized|ly)?\b` +
  String.raw`|year[\s-]+to[\s-]+date|\bYTD\b|\b(?:six|nine|twelve|6|9|12)[\s-]+months?\b|\b(?:first|second)[\s-]+half\b` +
  String.raw`|\b(?:[12]H|H[12])(?:\s*'?\d{2,4})?\b|\byears?\s+ended\b|\bfor\s+the\s+year\b|trailing[\s-]+twelve|\b(?:TTM|LTM)\b`;
/** Grupa 1 = kwartał, grupa 2 = inny okres. Kwartał pierwszy w alternatywie (patrz wyżej). */
const PERIOD_MARKER_SRC = `(${QUARTER_SRC})|(${NON_QUARTER_SRC})`;

type PeriodKind = 'quarter' | 'other';

/** Rodzaje okresów wymienionych we fragmencie, w kolejności wystąpienia. */
function periodKinds(fragment: string): PeriodKind[] {
  const kinds: PeriodKind[] = [];
  const re = new RegExp(PERIOD_MARKER_SRC, 'gi');
  let match: RegExpExecArray | null;
  while ((match = re.exec(fragment)) !== null) {
    // Grupa, która nie wzięła udziału w dopasowaniu, jest undefined (typ tablicy tego nie mówi).
    const groups: (string | undefined)[] = match;
    kinds.push(groups[1] !== undefined ? 'quarter' : 'other');
  }
  return kinds;
}

/** Tekst poprzedzający pozycję `index`, obcięty do bieżącego zdania i `BEFORE_WINDOW`. */
function sameSentenceBefore(text: string, index: number): string {
  const window = text.slice(Math.max(0, index - BEFORE_WINDOW), index);
  const re = new RegExp(SENTENCE_END_SRC, 'g');
  let cut = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(window)) !== null) {
    cut = match.index + match[0].length;
  }
  return window.slice(cut);
}

/**
 * Zwraca powód odrzucenia dopasowania `text[start, end)` albo null, gdy kwota może być
 * przychodem raportowanego kwartału. Reguły dobrane na realnych press release'ach
 * (HIMS 09.11.2026, UHS 28.07.2026; kontrolnie GDRX, CI, TDOC):
 *
 *  - `forward`           — prognoza w tym samym zdaniu przed kwotą („we expect Revenue of …",
 *                          „Revised Forecast … Net revenues $18.501 billion");
 *  - `non_quarter`       — ostatni okres nazwany przed kwotą to rok / suma narastająca
 *                          („For the full year 2026 …", „For the Year Ended …"); jeśli bliżej
 *                          kwoty stoi kwartał („FY 2026 … third quarter revenue of"), kwota zostaje;
 *  - `comparison`        — porównanie tuż przed kwotą („compared to revenue of …");
 *  - `next_amount`       — zaraz po kwocie stoi następna kwota (kolumny Low/High, kwartał/YTD);
 *  - `range`             — zakres („$875 million to $895 million");
 *  - `non_quarter_after` — okres inny niż kwartał zaraz po kwocie („… $9.133 billion during
 *                          the first six months of 2026", „… $17.4 billion during 2025");
 *  - `no_quarter_marker` — tylko przy `requireQuarter`: w zdaniu nie ma nazwy kwartału ani
 *                          przed kwotą, ani zaraz po niej.
 */
function revenueRejectionReason(
  text: string,
  start: number,
  end: number,
  requireQuarter: boolean,
): string | null {
  const before = sameSentenceBefore(text, start);
  if (FORWARD_LOOKING_RE.test(before)) return 'forward';

  const kindsBefore = periodKinds(before);
  const lastBefore = kindsBefore.length > 0 ? kindsBefore[kindsBefore.length - 1] : null;
  if (lastBefore === 'other') return 'non_quarter';

  const beforePlain = before.replace(PARENTHETICAL_RE, ' ');
  if (COMPARISON_RE.test(beforePlain.slice(-COMPARISON_WINDOW))) return 'comparison';

  const after = text.slice(end, end + AFTER_WINDOW);
  if (NEXT_AMOUNT_RE.test(after)) return 'next_amount';
  if (RANGE_RE.test(after)) return 'range';

  let firstAfter: PeriodKind | null = null;
  const prefix = AFTER_PERIOD_PREFIX_RE.exec(after);
  if (prefix !== null) {
    const period = after.slice(prefix[0].length, prefix[0].length + AFTER_PERIOD_WINDOW);
    const kindsAfter = periodKinds(period);
    if (kindsAfter.length > 0) {
      firstAfter = kindsAfter[0];
    } else if (BARE_YEAR_RE.test(period)) {
      firstAfter = 'other';
    }
  }
  if (firstAfter === 'other') return 'non_quarter_after';

  if (requireQuarter && lastBefore !== 'quarter' && firstAfter !== 'quarter') {
    return 'no_quarter_marker';
  }
  return null;
}

/**
 * Extract revenue actual KWARTAŁU z reportText. Z dopasowań, które przeszły filtr
 * kontekstu (`revenueRejectionReason`), bierze NAJWIĘKSZĄ wartość (raporty często
 * wspominają segmenty: US revenue $X, International $Y, Total $Z; total jest największe).
 * Próg minimalny 1M USD (zabezpieczenie przed false matchami typu "revenue per share $1.42").
 *
 * Gdy po filtrze nic nie zostaje → null: brak danych jest lepszy niż prognoza całoroczna
 * podstawiona jako wynik kwartału (HIMS 09.11.2026 zwracał $3,13 mld przy $890,4M kwartału).
 *
 * Wzorce 1–2 (historyczne) przechodzą, gdy kontekst nie wskazuje innego okresu. Wzorce 3–4
 * (luźniejsze, dodane 25.11.2026) wymagają nazwy kwartału w tym samym zdaniu — bez tego
 * w TDOC 29.07.2026 zdania z sekcji „Six Months Ended …" („U.S. revenue decreased 6% to
 * $978.9 million") wygrywały z przychodem kwartału.
 *
 * Kwoty bez jednostki („$ 2,507,889") pomijamy, gdy dokument deklaruje skalę tabel
 * („in thousands" / „in millions") — to wartość w tysiącach, nie w dolarach.
 *
 * Świadomie NIE obsługujemy:
 *  - odczytu przychodu z tabel bez jednostki przy kwocie (kolumny, skala „in thousands");
 *  - roku porównawczego bez słowa-klucza („… for the second quarter 2025 … total revenue
 *    of $67.2 billion" przechodzi — ratuje to tylko wybór największej kwoty);
 *  - nagłówka sekcji okresu, który nie stoi w tym samym zdaniu co kwota (wzorce 1–2).
 */
export function extractRevenue(text: string): number | null {
  if (!text) return null;

  // Tekst po stripHtml ma komórki tabel i akapity porozdzielane wieloma znakami nowej
  // linii — zwijamy je, żeby okna kontekstu liczyły się w znakach treści, nie w odstępach.
  const normalized = text.replace(/\s+/g, ' ');
  const tablesScaled = TABLE_SCALE_RE.test(normalized);

  const candidates: number[] = [];

  // Pattern 1: "revenue(s) of $X.X million/billion/M/B"
  const re1 = /(?:total\s+|net\s+)?revenue[s]?\s+(?:of\s+)?\$\s*([0-9]+(?:[,.][0-9]+)*)\s*(million|billion|M\b|B\b|mln|bln)?/gi;
  // Pattern 2: "revenue: $X.X million" or "revenue $X.X million"
  const re2 = /(?:total\s+|net\s+)?revenue[s]?\s*[:=]?\s*\$\s*([0-9]+(?:[,.][0-9]+)*)\s*(million|billion|M\b|B\b|mln|bln)/gi;
  // Pattern 3 (HIMS): "Revenue was $890.4 million" / "Revenue of approximately $890 million"
  const re3 = /revenues?\s+(?:of\s+approximately|(?:was|were)(?:\s+approximately)?)\s+\$\s*([0-9]+(?:[,.][0-9]+)*)\s*(million|billion|M\b|B\b|mln|bln)/gi;
  // Pattern 4 (UHS): "Net revenues increased by 8.3% to $4.638 billion"
  const re4 = /revenues?\s+(?:increased|decreased|grew|rose|declined|fell)\s+(?:by\s+)?[0-9]+(?:\.[0-9]+)?\s*%\s+to\s+\$\s*([0-9]+(?:[,.][0-9]+)*)\s*(million|billion|M\b|B\b|mln|bln)/gi;

  const patterns: { re: RegExp; requireQuarter: boolean }[] = [
    { re: re1, requireQuarter: false },
    { re: re2, requireQuarter: false },
    { re: re3, requireQuarter: true },
    { re: re4, requireQuarter: true },
  ];

  for (const { re, requireQuarter } of patterns) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(normalized)) !== null) {
      // Opcjonalna grupa jednostki bywa undefined (typ tablicy tego nie mówi).
      const groups: (string | undefined)[] = match;
      const unit = groups[2];
      if (unit === undefined && tablesScaled) continue;
      const value = parseDollarAmount(match[1], unit);
      if (value === null || value < 1_000_000) continue;
      const end = match.index + match[0].length;
      if (revenueRejectionReason(normalized, match.index, end, requireQuarter) !== null) continue;
      candidates.push(value);
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
