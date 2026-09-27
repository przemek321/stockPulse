/**
 * Kształty granic JSON w discovery Form 4 (`Form4DiscoveryService.getIssuerMeta`):
 * `submissions/CIK##########.json` z data.sec.gov czytany pod kątem METADANYCH EMITENTA
 * (nie listy filingów — tę część opisuje `sec-edgar/sec-submissions.types.ts`) oraz
 * zrzut tych metadanych w cache Redis (`sic:<cik>`, TTL 30d).
 *
 * Realny payload SEC (fragment; emitent vs osoba-reporting-owner, odczyt 10.06.2026):
 * ```json
 * { "cik": "1668243", "name": "Test Pharma Inc.", "sic": "2834",
 *   "sicDescription": "Pharmaceutical Preparations", "tickers": ["TSTX"], "exchanges": ["Nasdaq"], ... }
 * { "cik": "1651325", "name": "Kosaraju Sridhar", "sic": "", "sicDescription": null,
 *   "tickers": [], "exchanges": [], ... }
 * ```
 * CIK osoby (reporting owner) ma `sic: ""` i `tickers: []` — discovery rozpoznaje po tym
 * wiersz osoby z daily-index (P1 z weryfikacji 10.06.2026) i NIE markuje accession jako seen.
 * `exchanges[i]` bywa `null` dla notowań wycofanych (SEC trzyma parę ticker/exchange równolegle).
 *
 * Zasada jak w `finnhub-api.types.ts`: guard/reader dotyka WYŁĄCZNIE pól, od których zależy
 * przepływ (sic, sicDescription, tickers[0], exchanges[0], name); reszta odpowiedzi jest ignorowana.
 */

/** Metadane emitenta wyciągnięte z submissions JSON — dokładnie to, co idzie do cache Redis. */
export interface SecIssuerMeta {
  /** Kod SIC jako string (`"2834"`); `""` dla CIK osoby; null gdy pola brak. */
  sic: string | null;
  sicDescription: string | null;
  /** `tickers[0]` UPPERCASE; null gdy tablica pusta/brak. */
  ticker: string | null;
  /** `exchanges[0]` (np. `"Nasdaq"`, `"NYSE"`, `"OTC"`); null gdy brak. */
  exchange: string | null;
  name: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/** Pole tekstowe JSON: string zostaje, brak / `null` / inny typ → null. */
function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Odwzorowanie dawnego odczytu na `any` (`d.sic != null ? String(d.sic) : null`,
 * `d.tickers[0]`, `d.exchanges[0] ?? null`, `d.name ?? null`):
 * - odpowiedź nie będąca obiektem JSON → `Error` (dawniej `TypeError` na `null.sic`;
 *   `getIssuerMeta` łapie i zwraca null = transient, bez markSeen),
 * - `sic` → string jak jest (`""` dla osoby zostaje `""`), liczba → `String(n)` (dawne
 *   `String(d.sic)` przepuszczało też liczby), brak / `null` / inny typ → null,
 * - `tickers[0]` → `.toUpperCase()` jak dotąd; pusta tablica / brak / nie-string → null,
 * - `exchanges[0]` → string albo null (SEC: string lub `null` dla wycofanych notowań),
 * - `sicDescription` / `name` → string albo null (`null` w payloadzie osoby zostaje null).
 */
export function readSecIssuerMeta(data: unknown): SecIssuerMeta {
  if (!isRecord(data)) {
    throw new Error('SEC submissions: odpowiedź nie jest obiektem JSON');
  }
  const { sic, sicDescription, tickers, exchanges, name } = data;
  const firstTicker: unknown = Array.isArray(tickers) && tickers.length > 0 ? tickers[0] : undefined;
  const firstExchange: unknown = Array.isArray(exchanges) && exchanges.length > 0 ? exchanges[0] : undefined;
  return {
    sic: typeof sic === 'number' ? String(sic) : stringOrNull(sic),
    sicDescription: stringOrNull(sicDescription),
    ticker: typeof firstTicker === 'string' ? firstTicker.toUpperCase() : null,
    exchange: stringOrNull(firstExchange),
    name: stringOrNull(name),
  };
}

/**
 * Guard wpisu cache Redis `sic:<cik>` — JSON zapisany przez `readSecIssuerMeta`, więc wszystkie
 * 5 pól muszą być stringiem albo null. Wpis w innym kształcie (ręczna edycja, stary format)
 * traktujemy jak cache miss: serwis pobiera submissions ponownie i nadpisuje cache.
 */
export function isSecIssuerMeta(value: unknown): value is SecIssuerMeta {
  if (!isRecord(value)) return false;
  const { sic, sicDescription, ticker, exchange, name } = value;
  return (
    isNullableString(sic) &&
    isNullableString(sicDescription) &&
    isNullableString(ticker) &&
    isNullableString(exchange) &&
    isNullableString(name)
  );
}

/** Parsuje wpis cache; niepoprawny JSON albo inny kształt → null (= cache miss). */
export function parseCachedIssuerMeta(cached: string): SecIssuerMeta | null {
  try {
    const parsed: unknown = JSON.parse(cached);
    return isSecIssuerMeta(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
