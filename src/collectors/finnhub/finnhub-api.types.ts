/**
 * Kształty odpowiedzi Finnhub REST API (`https://finnhub.io/api/v1`) używane przez
 * `FinnhubService`. Wszystkie endpointy oddają JSON; `fetchApi` zwraca `unknown`,
 * a każdy endpoint ma tu własny guard/reader odwzorowujący dawne odczyty na `any`.
 *
 * Zasada: guard wymusza WYŁĄCZNIE pola, od których zależy przepływ w serwisie.
 * Pola nieużywane są deklarowane opcjonalnie i nie są sprawdzane (jak w
 * `edgar-filing-index.types.ts`) — brak lub inny typ nie może zmienić decyzji,
 * której dawny kod i tak by nie podjął.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/** Pole nieobecne / `null` / string — dopuszczalne wartości opcjonalnych pól tekstowych JSON. */
function isOptionalString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string';
}

function isOptionalNumber(value: unknown): value is number | null | undefined {
  return value === undefined || value === null || typeof value === 'number';
}

// ---------------------------------------------------------------------------
// /quote
// ---------------------------------------------------------------------------

/**
 * Odpowiedź `/quote`. Realny payload:
 * ```json
 * { "c": 16.51, "d": -0.12, "dp": -0.72, "h": 16.8, "l": 16.4, "o": 16.7, "pc": 16.63, "t": 1756713600 }
 * ```
 * Po pełnym delistingu Finnhub zwraca same zera (`c: 0, d: null, dp: null, ..., t: 0`).
 *
 * `getQuote` czyta tylko `c` (cena bieżąca) i `t` (unix ts w sekundach ostatniej
 * aktualizacji — guard na martwe notowania, werdykt 01.09.2026 SEM #2441).
 * `t` jest opcjonalne: starsze odpowiedzi/mocki go nie mają, a `getQuote` weryfikuje
 * je `typeof` w miejscu użycia — dlatego guard go nie wymusza (nie-liczbowe `t`
 * = brak guardu stale, dokładnie jak dotąd).
 */
export interface FinnhubQuote {
  /** Cena bieżąca; `0` gdy brak notowań (delisting). */
  c: number;
  d?: number | null;
  dp?: number | null;
  h?: number;
  l?: number;
  o?: number;
  pc?: number;
  /** Unix ts (sekundy) ostatniej aktualizacji notowania; `0` po delistingu. */
  t?: number;
}

/** Obiekt z liczbowym `c` — jedyny warunek, od którego zależy `getQuote` (`c > 0` sprawdza serwis). */
export function isFinnhubQuote(value: unknown): value is FinnhubQuote {
  return isRecord(value) && typeof value.c === 'number';
}

// ---------------------------------------------------------------------------
// /stock/profile2
// ---------------------------------------------------------------------------

/**
 * Odpowiedź `/stock/profile2`. Dla nieznanego symbolu Finnhub oddaje `{}` (HTTP 200),
 * stąd wszystkie pola opcjonalne. Realny payload:
 * ```json
 * {
 *   "country": "US", "currency": "USD", "estimateCurrency": "USD", "exchange": "NASDAQ NMS - GLOBAL MARKET",
 *   "finnhubIndustry": "Biotechnology", "ipo": "2019-05-03", "logo": "https://...", "marketCapitalization": 1234.56,
 *   "name": "Example Therapeutics Inc", "phone": "...", "shareOutstanding": 45.6, "ticker": "EXMP", "weburl": "https://..."
 * }
 * ```
 * `marketCapitalization` jest w MILIONACH USD (discovery pre-filter mcap ≥ $250M).
 */
export interface FinnhubCompanyProfile {
  /** Kapitalizacja w MILIONACH USD. */
  marketCapitalization?: number | null;
  exchange?: string | null;
  name?: string | null;
  country?: string;
  currency?: string;
  estimateCurrency?: string;
  finnhubIndustry?: string;
  ipo?: string;
  logo?: string;
  phone?: string;
  shareOutstanding?: number;
  ticker?: string;
  weburl?: string;
}

/**
 * Obiekt, w którym trzy pola czytane przez `getCompanyProfile` (`marketCapitalization`,
 * `exchange`, `name`) są nieobecne, `null` albo we właściwym typie. Pusty obiekt `{}`
 * PRZECHODZI guard — sprawdzenie „profil pusty" zostaje w serwisie (`Object.keys`),
 * tak jak dotąd.
 */
export function isFinnhubCompanyProfile(value: unknown): value is FinnhubCompanyProfile {
  if (!isRecord(value)) return false;
  const { marketCapitalization, exchange, name } = value;
  return isOptionalNumber(marketCapitalization) && isOptionalString(exchange) && isOptionalString(name);
}

// ---------------------------------------------------------------------------
// /stock/metric?metric=all
// ---------------------------------------------------------------------------

/**
 * Odpowiedź `/stock/metric?metric=all` (basic financials). Realny payload (fragment):
 * ```json
 * {
 *   "metric": { "10DayAverageTradingVolume": 1.23456, "52WeekHigh": 45.6, "52WeekHighDate": "2026-03-01", "beta": 1.1, ... },
 *   "metricType": "all",
 *   "series": { "annual": { ... }, "quarterly": { ... } },
 *   "symbol": "EXMP"
 * }
 * ```
 * `metric` to ~100 wskaźników o MIESZANYCH typach (liczby, `null`, stringi dla dat) —
 * stąd `Record<string, unknown>`; typ konkretnego wskaźnika weryfikuje konsument
 * (`get10DayAvgVolumeMlnShares`: `typeof === 'number' && > 0`).
 * `10DayAverageTradingVolume` jest w MILIONACH sztuk.
 */
export interface FinnhubBasicFinancials {
  metric: Record<string, unknown>;
  metricType?: string;
  symbol?: string;
  series?: unknown;
}

/** Obiekt z obiektowym `metric` — odpowiednik dawnego `data?.metric?.[...]` (nie-obiekt → `undefined`). */
export function isFinnhubBasicFinancials(value: unknown): value is FinnhubBasicFinancials {
  return isRecord(value) && isRecord(value.metric);
}

// ---------------------------------------------------------------------------
// /company-news
// ---------------------------------------------------------------------------

/**
 * Element tablicy `/company-news`. Realny payload:
 * ```json
 * [{
 *   "category": "company", "datetime": 1756713600, "headline": "Example Therapeutics announces...",
 *   "id": 123456789, "image": "https://...", "related": "EXMP", "source": "Yahoo",
 *   "summary": "...", "url": "https://finnhub.io/api/news?id=..."
 * }]
 * ```
 * `datetime` = unix ts w SEKUNDACH (serwis mnoży ×1000). `summary`/`category`/`source`
 * bywają pustym stringiem — serwis mapuje `''` przez `||` na `undefined` / `'finnhub'`.
 * `id`/`image`/`related` nie są używane i nie są wymuszane w guardzie.
 */
export interface FinnhubNewsArticle {
  category: string;
  datetime: number;
  headline: string;
  source: string;
  summary: string;
  url: string;
  id?: number;
  image?: string;
  related?: string;
}

export function isFinnhubNewsArticle(value: unknown): value is FinnhubNewsArticle {
  if (!isRecord(value)) return false;
  const { category, datetime, headline, source, summary, url } = value;
  return (
    typeof url === 'string' &&
    typeof headline === 'string' &&
    typeof datetime === 'number' &&
    typeof source === 'string' &&
    typeof summary === 'string' &&
    typeof category === 'string'
  );
}

/**
 * Odpowiednik dawnego `Array.isArray(articles)` na `any`: nie-tablica → `[]` (serwis
 * zwraca 0). Elementy bez kompletu stringowych pól tekstowych i liczbowego `datetime`
 * są pomijane — dawny kod przekazywałby je do TypeORM (NOT NULL na `url`/`headline`
 * rzucał; brak `source` dawał `'finnhub'`). W realnym payloadzie Finnhub każdy artykuł
 * ma komplet pól, więc filtr jest wyłącznie zabezpieczeniem typów.
 */
export function readFinnhubNewsArticles(data: unknown): FinnhubNewsArticle[] {
  if (!isUnknownArray(data)) return [];
  return data.filter(isFinnhubNewsArticle);
}

// ---------------------------------------------------------------------------
// /stock/insider-sentiment
// ---------------------------------------------------------------------------

/**
 * Wpis `data[]` z `/stock/insider-sentiment` (MSPR — Monthly Share Purchase Ratio).
 * Realny payload:
 * ```json
 * { "data": [{ "symbol": "EXMP", "year": 2026, "month": 3, "change": -12345, "mspr": -0.42 }], "symbol": "EXMP" }
 * ```
 * `change` = netto kupno/sprzedaż insiderów w sztukach (serwis bierze `Math.abs(change || 0)`),
 * `mspr` w [-100, 100] (`> 0` → BUY, inaczej SELL).
 */
export interface FinnhubInsiderSentimentEntry {
  year: number;
  month: number;
  change: number;
  mspr: number;
  symbol?: string;
}

export interface FinnhubInsiderSentiment {
  data: FinnhubInsiderSentimentEntry[];
  symbol?: string;
}

export function isFinnhubInsiderSentimentEntry(value: unknown): value is FinnhubInsiderSentimentEntry {
  if (!isRecord(value)) return false;
  const { change, month, mspr, year } = value;
  return (
    typeof year === 'number' &&
    typeof month === 'number' &&
    typeof mspr === 'number' &&
    typeof change === 'number'
  );
}

/**
 * Odpowiednik dawnego `data.data` na `any` wewnątrz `try { ... } catch { return 0 }`:
 * brak obiektu / brak tablicy `data` → `[]` (serwis zwraca 0 — dawniej TypeError
 * łapany przez catch, wynik ten sam). Wpisy bez liczbowych `year`/`month`/`mspr`/`change`
 * są pomijane (dawniej `new Date(undefined, NaN, 1)` → Invalid Date → błąd zapisu → catch → 0).
 * W realnym payloadzie każdy wpis ma komplet liczb — filtr jest zabezpieczeniem typów.
 */
export function readFinnhubInsiderSentimentEntries(data: unknown): FinnhubInsiderSentimentEntry[] {
  if (!isRecord(data) || !isUnknownArray(data.data)) return [];
  return data.data.filter(isFinnhubInsiderSentimentEntry);
}
