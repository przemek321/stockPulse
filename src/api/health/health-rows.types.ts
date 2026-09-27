/**
 * Kształty wierszy raw SQL (`dataSource.query` / `repo.query`) używanych przez
 * `HealthController` — TAK, jak realnie zwraca je node-pg (projekt nie ustawia
 * własnych `pg.types.setTypeParser`, TypeORM-owe transformery encji NIE działają
 * na raw query):
 * - `COUNT(*)` / `COUNT(DISTINCT ...)` → int8 → **string** (kontroler robi `parseInt`),
 * - `decimal`/`numeric` (ceny alertów, `ROUND(...)`) → **string**
 *   (tak samo `alerts.controller.ts` konwertuje je przez `Number(r.price1h)`),
 * - `int` (`duration_ms`) → number, `timestamp` → `Date`, `boolean` → boolean,
 *   `text`/`varchar` → string, `NULL` → null,
 * - `json`/`jsonb` (`json_agg(...)`) → wartość JS po `JSON.parse`; kolumna `date`
 *   wewnątrz `json_build_object` jest już zserializowana do stringa `YYYY-MM-DD`.
 *
 * Wiersze weekly-report trafiają do odpowiedzi HTTP BEZ konwersji (frontend zrzuca
 * cały JSON do pliku) — typy tylko dokumentują, co realnie wychodzi w JSON.
 */

/**
 * Pierwszy wiersz wyniku albo `undefined`, gdy zapytanie nic nie zwróciło.
 * Bez `noUncheckedIndexedAccess` `rows[0]` udaje `T` (a adnotacja `T | undefined` na
 * zmiennej jest natychmiast zawężana przez TS) — helper przywraca uczciwe `T | undefined`,
 * żeby istniejące guardy kontrolera (`row ? ... : null`, `row || {}`) były typowo znaczące.
 * Runtime identyczny z dawnym `rows[0]`.
 */
export function firstRow<T>(rows: readonly T[]): T | undefined {
  return rows[0];
}

/** `SELECT pg_size_pretty(pg_database_size(current_database())) as size` — zawsze 1 wiersz. */
export interface DbSizeRow {
  size: string;
}

/** weekly-report §1 — alerty z okresu (kolumny `alerts` pod aliasami snake_case). */
export interface WeeklyAlertSentRow {
  rule_name: string;
  symbol: string;
  priority: string;
  catalyst_type: string | null;
  message: string;
  sent_at: Date;
}

/**
 * Element `upcoming_events` z `json_agg(json_build_object(...))`.
 * `drug_name` / `therapeutic_area` są nullable w encji `PdufaCatalyst`;
 * `pdufa_date` (typ `date`) po serializacji do JSON = `'YYYY-MM-DD'`.
 */
export interface WeeklyPdufaUpcomingEvent {
  symbol: string;
  drug: string | null;
  date: string;
  area: string | null;
}

/** weekly-report §2 — agregat bez GROUP BY: dokładnie 1 wiersz, COUNT-y jako string. */
export interface WeeklyPdufaStatusRow {
  total_events: string;
  resolved: string;
  upcoming: string;
  /** `COALESCE(json_agg(...), '[]'::json)` — zawsze tablica (pusta, gdy brak upcoming). */
  upcoming_events: WeeklyPdufaUpcomingEvent[];
}

/**
 * weekly-report §3 — price outcomes. Ceny (`decimal(10,4)`) i delty (`ROUND(...::numeric, 2)`)
 * przychodzą jako string; `CASE` bez `ELSE` daje null.
 */
export interface WeeklyPriceOutcomeRow {
  rule_name: string;
  symbol: string;
  priority: string;
  catalyst_type: string | null;
  alert_direction: string | null;
  /** `WHERE "priceAtAlert" IS NOT NULL` — w tym zapytaniu nigdy null. */
  price_at_alert: string;
  price1h: string | null;
  price4h: string | null;
  price1d: string | null;
  price3d: string | null;
  delta_1h_pct: string | null;
  delta_1d_pct: string | null;
  delta_3d_pct: string | null;
  direction_correct_1d: boolean | null;
  direction_correct_3d: boolean | null;
  sent_at: Date;
}

/** Wspólne kolumny hit-rate (§4/§5): COUNT → string, `ROUND(numeric)` → string, `CASE` bez `ELSE` → null. */
export interface WeeklyHitRateColumns {
  total_alerts: string;
  evaluated_1d: string;
  correct_1d: string;
  evaluated_3d: string;
  correct_3d: string;
  hit_rate_1d_pct: string | null;
  hit_rate_3d_pct: string | null;
}

/** weekly-report §4 — hit rate per `ruleName`. */
export interface WeeklyHitRateByRuleRow extends WeeklyHitRateColumns {
  rule_name: string;
}

/** weekly-report §5 — hit rate per `COALESCE("catalystType", 'unknown')` (nigdy null). */
export interface WeeklyHitRateByCatalystRow extends WeeklyHitRateColumns {
  catalyst_type: string;
}

/**
 * system-overview — błędy z `system_logs` (24h). Kolumny wg encji `SystemLog`:
 * `class_name` jest NOT NULL w schemacie (`className!: string`), a `class_name IS NULL`
 * w SQL to wyłącznie asekuracja; `error_message` (text, nullable) → string | null.
 */
export interface SystemErrorRow {
  module: string;
  class_name: string;
  function_name: string;
  error_message: string | null;
  duration_ms: number;
  created_at: Date;
}

/** system-overview — agregat alertów 7d bez GROUP BY (1 wiersz); wszystkie COUNT-y jako string. */
export interface AlertStatsRow {
  total: string;
  delivered: string;
  silent: string;
  tickers: string;
  last_24h: string;
}
