/**
 * Kształty danych na granicy `AnthropicClientService` ↔ JSON zwracany przez Claude.
 *
 * Claude odpowiada tekstem, który serwis parsuje `JSON.parse` — wynik jest `unknown`
 * (strict:true, 27.09.2026; wcześniej `any` przechodził bez kontroli). Zasada jak w
 * `finnhub-api.types.ts`: guard wymusza WYŁĄCZNIE to, od czego zależy przepływ.
 */

import { EnrichedAnalysis } from './azure-openai-client.service';

/**
 * Surowy JSON z `analyze()` — `EnrichedAnalysis` bez `processing_time_ms`, które serwis
 * dokleja sam (`0`, bo SDK nie mierzy czasu tak jak dawna Azure VM).
 */
export type EnrichedAnalysisPayload = Omit<EnrichedAnalysis, 'processing_time_ms'>;

/**
 * Guard dla wyniku `JSON.parse` w `analyze()`.
 *
 * Sprawdza tylko, że to obiekt (warunek konieczny spreadu `{ ...payload }`). Pól NIE
 * weryfikuje celowo: sentiment pipeline jest wyłączony od Sprintu 11, `analyze()` nie ma
 * żadnego konsumenta w kodzie, więc żaden przepływ nie zależy od konkretnego pola —
 * dawny kod też rzutował dowolny obiekt na `EnrichedAnalysis` bez sprawdzania.
 * Przy reaktywacji pipeline'u dopisz tu kontrolę pól, które konsument realnie czyta
 * (`sentiment`, `conviction`, ...).
 */
export function isEnrichedAnalysisPayload(value: unknown): value is EnrichedAnalysisPayload {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
