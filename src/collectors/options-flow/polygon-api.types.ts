/**
 * Kształty odpowiedzi Polygon.io REST API (`https://api.polygon.io`) używane przez
 * `OptionsFlowService`. `res.json()` oddaje `unknown`; każdy endpoint ma tu własny
 * reader odwzorowujący dawne odczyty na `any` (`data.results || []`,
 * `data.results?.[0] || null`, `data.results?.[0]?.c || null`).
 *
 * Zasada (jak w `finnhub-api.types.ts`): guard wymusza WYŁĄCZNIE pola, od których
 * zależy przepływ w serwisie. Pola nieużywane są deklarowane opcjonalnie i nie są
 * sprawdzane. Kolektor ma CRON OFF od 10.06.2026, ale kod zostaje poprawny na
 * wypadek re-enable.
 */

import type { OptionsContract } from './unusual-activity-detector';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Odpowiednik dawnego `data.results || []` / `data.results?.[0]`: nie-obiekt lub nie-tablica → `[]`. */
function readResults(data: unknown): unknown[] {
  if (!isRecord(data) || !Array.isArray(data.results)) return [];
  return data.results;
}

// ---------------------------------------------------------------------------
// /v3/reference/options/contracts?underlying_ticker=...&expired=false&limit=250
// ---------------------------------------------------------------------------

/**
 * Odpowiedź listy kontraktów. Realny payload (fragment):
 * ```json
 * {
 *   "results": [{
 *     "cfi": "OCASPS", "contract_type": "call", "exercise_style": "american",
 *     "expiration_date": "2026-10-17", "primary_exchange": "BATO", "shares_per_contract": 100,
 *     "strike_price": 180, "ticker": "O:MRNA261017C00180000", "underlying_ticker": "MRNA"
 *   }],
 *   "status": "OK", "request_id": "...", "next_url": "https://api.polygon.io/v3/reference/options/contracts?cursor=..."
 * }
 * ```
 * Element `results[]` to `OptionsContract` z detektora (`ticker`, `underlying_ticker`,
 * `contract_type`, `strike_price`, `expiration_date`). `next_url` (paginacja) nie jest
 * używany — kolektor bierze pierwsze 250 kontraktów.
 */
export interface PolygonContractsResponse {
  results?: OptionsContract[];
  status?: string;
  request_id?: string;
  next_url?: string;
}

/**
 * Kontrakt z kompletem pól czytanych przez `filterContracts` / `collectForSymbol`:
 * `ticker` (OCC symbol → URL `/prev`, klucz baseline), `contract_type` (`call`|`put` →
 * OTM), `strike_price` i `expiration_date` (filtr DTE/OTM, wiersz `options_flow`).
 * `underlying_ticker` nie jest czytany, ale `OptionsContract` z detektora deklaruje go
 * jako wymagany string — guard sprawdza go, żeby predykat typu nie kłamał (Polygon
 * zwraca go w każdym kontrakcie).
 */
export function isPolygonOptionsContract(value: unknown): value is OptionsContract {
  if (!isRecord(value)) return false;
  const { ticker, contract_type, strike_price, expiration_date, underlying_ticker } = value;
  return (
    typeof ticker === 'string' &&
    typeof underlying_ticker === 'string' &&
    (contract_type === 'call' || contract_type === 'put') &&
    typeof strike_price === 'number' &&
    typeof expiration_date === 'string'
  );
}

/**
 * Odpowiednik dawnego `data.results || []` na `any`: brak tablicy → `[]` (serwis zwraca 0
 * dla tickera). Elementy bez kompletu pól kontraktu są pomijane — dawny kod przekazałby
 * je do `filterContracts` (porównania z `NaN`) i dalej do `fetch` z `undefined` w URL.
 * W realnym payloadzie Polygon każdy kontrakt ma komplet pól — filtr jest wyłącznie
 * zabezpieczeniem typów.
 */
export function readPolygonContracts(data: unknown): OptionsContract[] {
  return readResults(data).filter(isPolygonOptionsContract);
}

// ---------------------------------------------------------------------------
// /v2/aggs/ticker/{ticker}/prev  oraz  /v2/aggs/ticker/{ticker}/range/1/day/{from}/{to}
// ---------------------------------------------------------------------------

/**
 * Bar agregatu (ten sam kształt dla akcji i kontraktu opcyjnego). Realny payload `/prev`:
 * ```json
 * {
 *   "ticker": "O:MRNA261017C00180000", "queryCount": 1, "resultsCount": 1, "adjusted": true,
 *   "results": [{ "T": "O:MRNA261017C00180000", "v": 1250, "vw": 2.31, "o": 2.1, "c": 2.4, "h": 2.55, "l": 2.05, "t": 1758916800000, "n": 87 }],
 *   "status": "OK", "request_id": "..."
 * }
 * ```
 * `/range/1/day` oddaje tę samą tablicę `results[]` z wieloma barami (rosnąco po `t`).
 * Serwis czyta `v` (volume → spike/baseline) i `c` (close → cena underlying);
 * `t`/`o`/`h`/`l`/`n`/`vw` nie są używane i nie są wymuszane w guardzie.
 */
export interface PolygonAggBar {
  /** Volume. */
  v: number;
  /** Close. */
  c: number;
  /** Timestamp (unix ms). */
  t?: number;
  o?: number;
  h?: number;
  l?: number;
  n?: number;
  vw?: number;
  T?: string;
}

export interface PolygonAggsResponse {
  results?: PolygonAggBar[];
  ticker?: string;
  queryCount?: number;
  resultsCount?: number;
  adjusted?: boolean;
  status?: string;
  request_id?: string;
}

/** Obiekt z liczbowymi `v` i `c` — jedyne pola, od których zależy serwis. */
export function isPolygonAggBar(value: unknown): value is PolygonAggBar {
  return isRecord(value) && typeof value.v === 'number' && typeof value.c === 'number';
}

/**
 * Odpowiednik dawnego `data.results?.[0] || null`: brak tablicy / pusta tablica / pierwszy
 * element bez liczbowych `v`+`c` → `null` (serwis pomija kontrakt, jak przy `!bar`).
 * Dawny kod oddałby niekompletny obiekt, a `bar.v <= 0` na `undefined` przepuściłoby
 * `NaN` do baseline — w realnym payloadzie nie występuje.
 */
export function readPolygonFirstBar(data: unknown): PolygonAggBar | null {
  const first: unknown = readResults(data)[0];
  return isPolygonAggBar(first) ? first : null;
}

/**
 * Odpowiednik dawnego `const bars: DailyBar[] = data.results || []` w backfillu:
 * brak tablicy → `[]` (kontrakt pominięty). Bary bez liczbowych `v`+`c` są odrzucane
 * (dawniej `NaN` w średniej baseline). W realnym payloadzie każdy bar ma komplet pól.
 */
export function readPolygonBars(data: unknown): PolygonAggBar[] {
  return readResults(data).filter(isPolygonAggBar);
}
