/**
 * Kształt `submissions/CIK##########.json` z SEC EDGAR
 * (`https://data.sec.gov/submissions/CIK0001551152.json`).
 *
 * Realny payload (ABBV, odczyt 27.09.2026 — fragment, tablice skrócone do 2 pozycji):
 * ```json
 * {
 *   "cik": "1551152", "name": "AbbVie Inc.", "sic": "2834", "tickers": ["ABBV"], "exchanges": ["NYSE"],
 *   "filings": {
 *     "recent": {
 *       "accessionNumber":       ["0001104659-26-104940", "0001762951-26-000006"],
 *       "filingDate":            ["2026-09-03", "2026-08-18"],
 *       "form":                  ["8-K", "4"],
 *       "primaryDocument":       ["tm2624674d1_8k.htm", "xslF345X06/form4-08182026_050811.xml"],
 *       "primaryDocDescription": ["FORM 8-K", ""],
 *       "reportDate": ["2026-09-03", "2026-08-14"], "acceptanceDateTime": ["2026-09-03T12:47:46.000Z", "..."],
 *       "act": ["34", ""], "fileNumber": ["001-35565", ""], "filmNumber": ["261356806", ""],
 *       "items": ["7.01,9.01", ""], "core_type": ["XBRL", "4"],
 *       "size": [322768, 8628], "isXBRL": [1, 0], "isInlineXBRL": [1, 0], "isXBRLNumeric": [0, null]
 *     },
 *     "files": [{ "name": "CIK0001551152-submissions-001.json", "filingCount": 512,
 *                 "filingFrom": "2012-06-04", "filingTo": "2017-05-03" }]
 *   }
 * }
 * ```
 *
 * `recent` to RÓWNOLEGŁE tablice: indeks `i` = jeden filing, max 1000 najnowszych,
 * posortowane od najnowszego (kolektor przerywa skan na pierwszym starszym niż 7 dni).
 * Brak wartości SEC oznacza pustym stringiem `""` (w próbce `primaryDocDescription` 322/1000,
 * `act`/`fileNumber` 617/1000), nigdy `null` — jedyny wyjątek to `isXBRLNumeric` (number | null),
 * którego kolektor nie czyta. Kolejne 1000-ki filingów siedzą w plikach z `filings.files`
 * (kolektor ich nie pobiera — interesuje go tylko ostatnie 7 dni).
 *
 * Kolektor używa 5 tablic z `recent`; pozostałe kolumny są ignorowane i nie są wymuszane
 * w guardzie (analogicznie do `EdgarFilingIndex`).
 */
export interface SecSubmissionsRecent {
  /** `0001104659-26-104940` — z myślnikami; katalog filingu to ten sam string bez myślników. */
  accessionNumber: string[];
  /** `YYYY-MM-DD` — porównywalne leksykalnie z datą odcięcia. */
  filingDate: string[];
  /** Typ formularza: `8-K`, `4`, `10-Q`, `SC 13G/A`, `DEF 14A`... */
  form: string[];
  /**
   * Ścieżka głównego dokumentu względem katalogu filingu. Form 4 przychodzi jako
   * `xslF345X06/form4-....xml` (prefix XSLT → widok HTML; surowy XML to sama nazwa pliku).
   * `""` = brak (np. filingi papierowe).
   */
  primaryDocument?: string[];
  /** Opis dokumentu, `""` dla większości Form 4 / SC 13G — kolektor mapuje `""` na brak opisu. */
  primaryDocDescription?: string[];
}

export interface SecSubmissionsFileRef {
  name: string;
  filingCount: number;
  filingFrom: string;
  filingTo: string;
}

export interface SecSubmissions {
  /** CIK bez zer wiodących, jako string (`"1551152"`). */
  cik?: string;
  name?: string;
  /** Kod SIC jako string (`"2834"`). */
  sic?: string;
  tickers?: string[];
  filings?: {
    recent?: SecSubmissionsRecent;
    files?: SecSubmissionsFileRef[];
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * `filings.recent` z trzema wymaganymi kolumnami (`form`/`accessionNumber`/`filingDate`)
 * jako tablice stringów TEJ SAMEJ długości oraz opcjonalnymi `primaryDocument` /
 * `primaryDocDescription` (nieobecne albo tablice stringów). Równa długość jest częścią
 * kontraktu „równoległe tablice" — bez niej `recent.accessionNumber[i]` typowane jako
 * `string` mogłoby być `undefined`.
 */
export function isSecSubmissionsRecent(value: unknown): value is SecSubmissionsRecent {
  if (!isRecord(value)) return false;
  const { accessionNumber, filingDate, form, primaryDocument, primaryDocDescription } = value;
  if (!isStringArray(form) || !isStringArray(accessionNumber) || !isStringArray(filingDate)) return false;
  if (accessionNumber.length !== form.length || filingDate.length !== form.length) return false;
  if (primaryDocument !== undefined && !isStringArray(primaryDocument)) return false;
  if (primaryDocDescription !== undefined && !isStringArray(primaryDocDescription)) return false;
  return true;
}

/**
 * Odpowiednik dawnego `data.filings?.recent` na `any`, z zachowaniem obu ścieżek kolektora:
 * - brak `filings` / `filings.recent` (`undefined`/`null`) → `undefined` (kolektor cicho zwraca 0),
 * - `recent` obecne, ale nie w kształcie równoległych tablic string[] → `Error` (dawniej w tym
 *   miejscu leciał `TypeError` z `recent.form.length`; `collect()` łapie i loguje warn per ticker).
 * Odpowiedź nie będąca obiektem JSON również rzuca (dawniej `TypeError` na `null.filings`).
 */
export function readSecSubmissionsRecent(data: unknown): SecSubmissionsRecent | undefined {
  if (!isRecord(data)) {
    throw new Error('SEC submissions: odpowiedź nie jest obiektem JSON');
  }
  const filings = data.filings;
  if (!isRecord(filings)) return undefined;
  const recent = filings.recent;
  if (recent === undefined || recent === null) return undefined;
  if (!isSecSubmissionsRecent(recent)) {
    throw new Error(
      'SEC submissions: filings.recent nie jest zestawem równoległych tablic string[] (form/accessionNumber/filingDate)',
    );
  }
  return recent;
}
