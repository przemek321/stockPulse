/**
 * Kształty wierszy `getRawMany()` w `SummarySchedulerService` (raport 8h) — DOKŁADNIE
 * tak, jak zwraca je driver `pg` 8.x z domyślnymi parserami `pg-types` 2.x (projekt nie
 * rejestruje własnych `setTypeParser`, TypeORM 0.3 dla Postgresa też nie); reguły jak w
 * `src/api/alerts/alerts-timeline-rows.types.ts`:
 *
 * - `COUNT(*)` bez `::int` → `bigint` → **STRING** (stąd `parseInt` w serwisie),
 * - `SUM(CASE ... THEN 1 ELSE 0 END)` → `bigint` → **STRING**,
 * - `SUM(decimal)` / kolumna `decimal(10,4)` → `numeric` → **STRING** (pg nie parsuje
 *   numeric, żeby nie tracić precyzji — stąd `parseFloat` / `Number()`),
 * - agregaty `SUM(...)` są w SQL nullowalne; przy `GROUP BY` każda grupa ma ≥1 wiersz,
 *   więc w praktyce NULL nie pada — typ zostaje `| null`, bo serwis i tak ma fallback `'0'`,
 * - SQL NULL → null (nigdy `undefined`).
 *
 * Przykładowe wiersze (wartości poglądowe):
 * ```json
 * { "rule": "Form 4 Insider BUY", "count": "2", "delivered": "1" }
 * { "reason": "observation", "count": "3" }
 * { "type": "BUY", "count": "2", "totalValue": "1250322.00" }
 * { "symbol": "COR", "rule": "Form 4 Insider BUY", "priority": "MEDIUM", "price": "271.2800", "sector": "healthcare_discovery" }
 * ```
 */

/** Kolumna/wyrażenie `numeric` lub `bigint` z pg — tekstowa reprezentacja liczby (np. `"271.2800"`, `"2"`). */
export type PgNumeric = string;

/** Alerty per reguła z okna 8h: `GROUP BY a.ruleName`. */
export interface AlertsByRuleRow {
  /** `a.ruleName` — varchar(100) NOT NULL. */
  rule: string;
  /** `COUNT(*)` → bigint → string. */
  count: PgNumeric;
  /** `SUM(CASE WHEN a.delivered = true THEN 1 ELSE 0 END)` → bigint → string; NULL tylko teoretycznie (agregat). */
  delivered: PgNumeric | null;
}

/** Breakdown niedostarczonych: `GROUP BY a.nonDeliveryReason` z filtrem `IS NOT NULL`. */
export interface ReasonBreakdownRow {
  /** `a.nonDeliveryReason` — varchar(32); NULL odfiltrowany w WHERE, stąd `string`. */
  reason: string;
  /** `COUNT(*)` → bigint → string. */
  count: PgNumeric;
}

/** Insider trades BUY/SELL z okna 8h: `GROUP BY t.transactionType`. */
export interface TradesByTypeRow {
  /** `t.transactionType` — pełne słowo (`BUY` / `SELL`), varchar(20) NOT NULL. */
  type: string;
  /** `COUNT(*)` → bigint → string. */
  count: PgNumeric;
  /** `SUM(t.totalValue)` → numeric → string (np. `"1250322.00"`); NULL tylko teoretycznie (agregat). */
  totalValue: PgNumeric | null;
}

/** Alert obserwacyjny (`nonDeliveryReason = 'observation'`) z LEFT JOIN do `tickers`. */
export interface ObservationAlertRow {
  /** `a.symbol` — varchar NOT NULL. */
  symbol: string;
  /** `a.ruleName` — varchar(100) NOT NULL. */
  rule: string;
  /** `a.priority` — `INFO` / `MEDIUM` / `HIGH` / `CRITICAL`, varchar(20) NOT NULL. */
  priority: string;
  /** `a.priceAtAlert` — decimal(10,4) nullable → numeric → string albo null. */
  price: PgNumeric | null;
  /** `t.sector` z LEFT JOIN — null, gdy ticker nie istnieje w `tickers`. */
  sector: string | null;
}
