/**
 * Kształt plików uniwersum `doc/stockpulse-*.json` czytanych przez seed
 * (`stockpulse-healthcare-universe.json`, `stockpulse-semi-supply-chain.json`,
 * `stockpulse-biotech-apls.json`).
 *
 * Realny fragment (`stockpulse-healthcare-universe.json`, odczyt 27.09.2026 — tablice skrócone):
 * ```json
 * {
 *   "meta": { "...": "..." },
 *   "tickers": {
 *     "managed_care_insurers": {
 *       "description": "…", "priority": "CRITICAL",
 *       "companies": [{
 *         "ticker": "UNH", "name": "UnitedHealth Group", "cik": "0000731766",
 *         "subsector": "Managed Care", "market_cap_tier": "mega",
 *         "aliases": ["UnitedHealth", "Optum"], "key_metrics": ["MLR", "Medicare Advantage enrollment"],
 *         "ceo": "…", "cfo": "…", "notes": "…"
 *       }]
 *     }
 *   },
 *   "alert_rules": {
 *     "description": "…",
 *     "rules": [
 *       { "name": "Form 4 Insider BUY", "condition": "…", "priority": "HIGH", "throttle_minutes": 60 },
 *       { "name": "Sentiment Crash", "condition": "…", "priority": "CRITICAL", "throttle_minutes": 120,
 *         "is_active": false, "_disabled_reason": "Sprint 11: …" }
 *     ]
 *   }
 * }
 * ```
 *
 * Seed używa: `tickers` (klucz grupy → priorytet z `GROUP_PRIORITY`, `companies[]` → UPSERT
 * `Ticker`) oraz `alert_rules.rules` (tylko plik healthcare → UPSERT `AlertRule`). Pozostałe
 * sekcje (`meta`, `search_keywords`, `correlation_matrix`, `etfs_benchmarks`...) i pola
 * (`description`/`priority` grupy, `market_cap_tier`, `_disabled_reason`, `_note`) są ignorowane
 * i nie są wymuszane w guardzie. Pliki semi/apls nie mają `alert_rules` (grupy apls nie mają
 * też `description`/`priority`).
 */

/** Jedna spółka z `tickers.<grupa>.companies[]` — pola 1:1 z kolumnami encji `Ticker`. */
export interface UniverseCompanyJson {
  ticker: string;
  name: string;
  /** CIK z zerami wiodącymi (`"0000731766"`), string. */
  cik: string;
  subsector: string;
  /** `mega` / `large` / `mid` / `small` — seed nie czyta. */
  market_cap_tier?: string;
  aliases: string[];
  key_metrics: string[];
  ceo: string;
  cfo: string;
  notes: string;
}

export interface UniverseGroupJson {
  description?: string;
  /** Priorytet deklarowany w pliku — seed go NIE czyta (źródłem prawdy jest `GROUP_PRIORITY` po kluczu grupy). */
  priority?: string;
  companies: UniverseCompanyJson[];
}

/** Jedna reguła z `alert_rules.rules[]` — pola 1:1 z kolumnami encji `AlertRule`. */
export interface UniverseAlertRuleJson {
  name: string;
  condition: string;
  priority: string;
  throttle_minutes: number;
  /** Brak pola = reguła aktywna (seed: `is_active !== false`). */
  is_active?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function isUniverseCompanyJson(value: unknown): value is UniverseCompanyJson {
  if (!isRecord(value)) return false;
  const { ticker, name, cik, subsector, aliases, key_metrics, ceo, cfo, notes } = value;
  return (
    typeof ticker === 'string' &&
    typeof name === 'string' &&
    typeof cik === 'string' &&
    typeof subsector === 'string' &&
    isStringArray(aliases) &&
    isStringArray(key_metrics) &&
    typeof ceo === 'string' &&
    typeof cfo === 'string' &&
    typeof notes === 'string'
  );
}

export function isUniverseGroupJson(value: unknown): value is UniverseGroupJson {
  if (!isRecord(value)) return false;
  const { companies } = value;
  return isUnknownArray(companies) && companies.every(isUniverseCompanyJson);
}

export function isUniverseAlertRuleJson(value: unknown): value is UniverseAlertRuleJson {
  if (!isRecord(value)) return false;
  const { name, condition, priority, throttle_minutes, is_active } = value;
  return (
    typeof name === 'string' &&
    typeof condition === 'string' &&
    typeof priority === 'string' &&
    typeof throttle_minutes === 'number' &&
    (is_active === undefined || typeof is_active === 'boolean')
  );
}

/**
 * `tickers` z pliku uniwersum jako mapa grupa → `{ companies[] }`.
 * Odpowiednik dawnego `json.tickers` na `any`: plik bez `tickers` albo z grupą / spółką
 * w złym kształcie rzuca `Error` (dawniej w tym miejscu leciał `TypeError` z
 * `Object.entries(undefined)` / `group.companies`, albo — gorzej — cichy INSERT z `undefined`).
 * `label` = nazwa pliku do komunikatu.
 */
export function readUniverseTickers(data: unknown, label: string): Record<string, UniverseGroupJson> {
  if (!isRecord(data)) {
    throw new Error(`Seed: ${label} nie jest obiektem JSON`);
  }
  const tickers = data.tickers;
  if (!isRecord(tickers)) {
    throw new Error(`Seed: ${label} nie ma sekcji "tickers"`);
  }
  const groups: Record<string, UniverseGroupJson> = {};
  for (const [groupKey, group] of Object.entries(tickers)) {
    if (!isUniverseGroupJson(group)) {
      throw new Error(
        `Seed: ${label} — grupa "${groupKey}" nie ma tablicy "companies" ze spółkami (ticker/name/cik/subsector/aliases/key_metrics/ceo/cfo/notes)`,
      );
    }
    groups[groupKey] = group;
  }
  return groups;
}

/**
 * `alert_rules.rules` z pliku uniwersum. Odpowiednik dawnego
 * `json.alert_rules.rules as AlertRuleJson[]` — brak sekcji lub reguła w złym kształcie rzuca `Error`.
 */
export function readUniverseAlertRules(data: unknown, label: string): UniverseAlertRuleJson[] {
  if (!isRecord(data)) {
    throw new Error(`Seed: ${label} nie jest obiektem JSON`);
  }
  const alertRules = data.alert_rules;
  if (!isRecord(alertRules) || !isUnknownArray(alertRules.rules)) {
    throw new Error(`Seed: ${label} nie ma sekcji "alert_rules.rules"`);
  }
  const rules: UniverseAlertRuleJson[] = [];
  for (const rule of alertRules.rules) {
    if (!isUniverseAlertRuleJson(rule)) {
      throw new Error(
        `Seed: ${label} — reguła ${JSON.stringify(rule)} nie ma pól name/condition/priority (string), throttle_minutes (number), is_active (boolean, opcjonalne)`,
      );
    }
    rules.push(rule);
  }
  return rules;
}
