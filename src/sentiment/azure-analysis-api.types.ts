/**
 * Kształty odpowiedzi HTTP Azure Analysis Service (VM `processor.js`, legacy —
 * sentiment pipeline usunięty 22.04.2026, w `SentimentModule` klasa jest aliasem do
 * `AnthropicClientService`). Klient trzyma `response.json()` jako `unknown` i zawęża
 * TYLKO pola, od których zależy jego przepływ — reszta payloadu przechodzi bez zmian.
 *
 * Zasada jak w `finnhub-api.types.ts`: guard nie może odrzucić odpowiedzi, którą dawny
 * kod (`any`) i tak by przepuścił, poza przypadkami, gdzie dawny kod rzucał
 * `TypeError` (np. `null.result`) i lądował w `catch` → `null`.
 */

import type { EnrichedAnalysis } from './azure-openai-client.service';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const SENTIMENTS: ReadonlySet<string> = new Set(['BULLISH', 'BEARISH', 'NEUTRAL']);

/**
 * Body błędu `POST /analyze` przy `!response.ok`. Realny payload VM:
 * ```json
 * { "error": "text is required" }
 * ```
 * Klient czyta wyłącznie `error` do logu; brak/nie-string → `response.statusText`
 * (dawny `error.error || statusText`).
 */
export interface AzureAnalysisErrorBody {
  error?: string;
}

/** Tekst błędu z body odpowiedzi, o ile jest niepustym stringiem. */
export function readAzureErrorMessage(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  const { error } = body;
  return typeof error === 'string' && error !== '' ? error : undefined;
}

/**
 * Odpowiedź `POST /analyze` — pełny `EnrichedAnalysis` serializowany przez VM.
 * Guard wymusza jedynie `sentiment` (enum) i `conviction` (number) — dwa pola, na
 * których opierał się dawny `SentimentProcessor` (effectiveScore). Pozostałe pola
 * przechodzą bez kontroli, jak dotąd.
 */
export function isEnrichedAnalysisPayload(value: unknown): value is EnrichedAnalysis {
  if (!isRecord(value)) return false;
  return typeof value.sentiment === 'string' && SENTIMENTS.has(value.sentiment)
    && typeof value.conviction === 'number';
}

/**
 * Odpowiedź `POST /analyze/custom`. VM opakowuje wynik GPT w `{ result: ... }`
 * (string z tekstem GPT albo już sparsowany obiekt), starsze wersje endpointu
 * oddawały goły wynik. Rozpakowanie 1:1 z dawnego `data.result ?? data`:
 * obiekt z niepustym (`!= null`) `result` → `result`, inaczej cały payload.
 * Kształt samego wyniku waliduje dopiero Zod w pipeline'ach (`parseGptResponse`).
 */
export interface AzureCustomAnalysisEnvelope {
  result?: unknown;
}

export function unwrapAzureCustomResult(data: unknown): unknown {
  if (isRecord(data) && data.result !== undefined && data.result !== null) {
    return data.result;
  }
  return data;
}
