/**
 * Kształty wierszy surowych zapytań SQL w `AlertsController` (Signal Timeline) —
 * DOKŁADNIE tak, jak zwraca je driver `pg` 8.x z domyślnymi parserami `pg-types` 2.x
 * (projekt nie rejestruje własnych `setTypeParser`, TypeORM 0.3 dla Postgresa też nie):
 *
 * - `decimal(10,4)` / `numeric` (kolumny cen, `::numeric`, `ROUND(numeric, 2)`,
 *   `EXTRACT(EPOCH FROM interval)` na PG ≥ 14) → **STRING** — pg nie parsuje numeric,
 *   żeby nie tracić precyzji; stąd `Number()` w mapperach kontrolera,
 * - `int4` (`COUNT(*)::int`) → number (bez `::int` COUNT(*) byłby `bigint` → string),
 * - `timestamp` (`"sentAt"`, `MAX("sentAt")`) → Date,
 * - `boolean` (kolumna `delivered`, wynik `CASE ... THEN true ... ELSE false`) → boolean,
 * - SQL NULL → null (nigdy `undefined`).
 *
 * Przykładowy wiersz per-symbol (kształt wyprowadzony z typów kolumn encji `Alert`
 * + parserów pg-types 2.2.0; wartości poglądowe):
 * ```json
 * {
 *   "id": 2446, "symbol": "ELV", "ruleName": "Form 4 Insider BUY", "priority": "HIGH",
 *   "alertDirection": "positive", "catalystType": null, "message": "… Conviction: 0\\.505 …",
 *   "priceAtAlert": "312.4500", "price1h": "313.0100", "price4h": null, "price1d": "318.9000", "price3d": null,
 *   "sentAt": "2026-07-17T14:05:12.345Z", "delivered": true, "nonDeliveryReason": null,
 *   "conviction": "0.505", "priceDeltaFromPrevPct": "-1.23", "hoursSincePrev": "72.5000000000000000",
 *   "sameDirectionAsPrev": true, "directionCorrect1d": true
 * }
 * ```
 * (`sentAt` w JSON to serializacja obiektu Date — w kodzie to `Date`.)
 */

/** Kolumna/wyrażenie `numeric` z pg — tekstowa reprezentacja liczby (np. `"312.4500"`). */
export type PgNumeric = string;

/**
 * Wiersz `getRecentTimeline` (widok domyślny Signal Timeline, bez window functions).
 * Kolumny 1:1 z tabeli `alerts` + `conviction` wyciągnięty regexpem z `message`
 * + `directionCorrect1d` liczone w SQL.
 */
export interface RecentTimelineRow {
  id: number;
  symbol: string;
  ruleName: string;
  priority: string;
  /** `'positive'` / `'negative'` / null — kolumna varchar, nie enum; kontroler filtruje truthy. */
  alertDirection: string | null;
  catalystType: string | null;
  message: string;
  priceAtAlert: PgNumeric | null;
  price1h: PgNumeric | null;
  price4h: PgNumeric | null;
  price1d: PgNumeric | null;
  price3d: PgNumeric | null;
  sentAt: Date;
  delivered: boolean;
  nonDeliveryReason: string | null;
  /** `(regexp_match(...))[1]::numeric` — null, gdy `message` nie zawiera „Conviction:”. */
  conviction: PgNumeric | null;
  /** `CASE` → true/false, albo NULL gdy brak `price1d` / `priceAtAlert` / `alertDirection`. */
  directionCorrect1d: boolean | null;
}

/**
 * Wiersz `getTimeline` (per-symbol) — jak `RecentTimelineRow` plus kolumny okna
 * `LAG(...) OVER w`; dla pierwszego alertu w oknie wszystkie trzy są NULL.
 */
export interface SymbolTimelineRow extends RecentTimelineRow {
  /** `ROUND((price / LAG(price) - 1) * 100, 2)` → numeric → string. */
  priceDeltaFromPrevPct: PgNumeric | null;
  /**
   * `EXTRACT(EPOCH FROM ("sentAt" - LAG("sentAt"))) / 3600` — na PG ≥ 14 `EXTRACT` zwraca
   * numeric (prod: PG 16), więc string; kontroler i tak przepuszcza przez `Number()`.
   */
  hoursSincePrev: PgNumeric | null;
  /** `LAG("alertDirection") = "alertDirection"` → boolean, NULL gdy którakolwiek strona NULL. */
  sameDirectionAsPrev: boolean | null;
}

/** Wiersz `GET /alerts/timeline/symbols` — zwracany na front bez mapowania. */
export interface TimelineSymbolsRow {
  symbol: string;
  /** `COUNT(*)::int` → int4 → number. */
  alertCount: number;
  /** `MAX("sentAt")` → timestamp → Date (JSON: ISO string, tak jak oczekuje `TimelineSymbol.lastAlert`). */
  lastAlert: Date;
}
