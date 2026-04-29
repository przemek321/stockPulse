/**
 * S19-FIX-01: Post-GPT guard wykrywający że LLM sam zadeklarował brak danych
 * w `key_facts`, ale jednocześnie zwrócił skrajne `conviction`.
 *
 * Trigger case: HUM 8-K Item 2.02 (29.04.2026, alert id 2381). GPT zwrócił:
 *   key_facts: [
 *     "EPS raportowany poniżej konsensusu — dokładne liczby niedostępne w przesłanym tekście",
 *     "Przychód: brak szczegółowych danych liczbowych w przesłanym fragmencie",
 *     ...
 *   ]
 *   conviction: -1.6
 *   requires_immediate_attention: true
 *
 * Logiczna sprzeczność: model wprost stwierdza brak danych, a system bierze
 * skrajne conviction jako fakt i wysyła CRITICAL na Telegram. Faktycznie
 * Humana affirmed guidance + beat EPS — false positive na halucynacji.
 *
 * Guard: jeśli ≥1 key_fact matchuje wzorzec missing-data → cap |conviction|
 * (consumer w pipeline downgrade'uje do DB-only z `nonDeliveryReason='gpt_missing_data'`).
 */

const MISSING_DATA_PATTERNS: readonly RegExp[] = [
  /niedost[eę]pn/i,
  /brak\s+(szczeg[oó][lł]owych|danych|liczbowych|konkretnych|informacji)/i,
  /nie\s+(podano|ujawniono|wiadomo|sprecyzowano)/i,
  /\bunknown\b/i,
  /\binsufficient\b/i,
  /not\s+(disclosed|available|specified|provided)/i,
  /\bnie\s+wiemy\b/i,
];

/**
 * Zwraca listę key_facts które matchują wzorzec missing-data.
 * Pusta tablica = brak halucynacji.
 */
export function detectMissingDataFacts(keyFacts: readonly string[]): string[] {
  if (!Array.isArray(keyFacts) || keyFacts.length === 0) return [];
  return keyFacts.filter((fact) =>
    typeof fact === 'string' && MISSING_DATA_PATTERNS.some((re) => re.test(fact)),
  );
}

/**
 * True gdy GPT zwrócił missing-data flag(s) w key_facts.
 * Helper dla call site'ów które potrzebują tylko bool.
 */
export function hasGptMissingData(keyFacts: readonly string[]): boolean {
  return detectMissingDataFacts(keyFacts).length > 0;
}
