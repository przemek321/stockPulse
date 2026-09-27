/**
 * Kształt odpowiedzi StockTwits API v2 (`https://api.stocktwits.com/api/2`) używanej przez
 * `StocktwitsService`. `fetchApi` zwraca `unknown`, a `readStocktwitsMessages` odwzorowuje
 * dawne odczyty na `any` na wyfiltrowaną tablicę `StocktwitsMessage`.
 *
 * Kolektor jest WYŁĄCZONY (0% edge, CRON off) — typy opisują realny payload uczciwie,
 * żeby ewentualne re-enable nie startowało od `any`.
 *
 * Zasada (jak `finnhub-api.types.ts`): guard wymusza WYŁĄCZNIE pola, od których zależy
 * przepływ w serwisie. Pola nieużywane są deklarowane opcjonalnie i nie są sprawdzane.
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

// ---------------------------------------------------------------------------
// /streams/symbol/{SYMBOL}.json
// ---------------------------------------------------------------------------

/**
 * Sentyment przypięty przez autora do wiadomości. StockTwits oddaje `"Bullish"` /
 * `"Bearish"`, a przy braku deklaracji `entities.sentiment` jest `null`.
 */
export interface StocktwitsSentimentEntities {
  sentiment?: { basic?: string | null } | null;
}

export interface StocktwitsUser {
  id?: number;
  username?: string | null;
  name?: string | null;
}

/**
 * Element `messages[]` ze streamu symbolu. Realny payload (fragment):
 * ```json
 * {
 *   "id": 123456789, "body": "$EXMP looking strong into PDUFA", "created_at": "2026-03-01T14:05:12Z",
 *   "user": { "id": 42, "username": "trader_x", "name": "Trader X", ... },
 *   "source": { "id": 1, "title": "StockTwits Web", ... },
 *   "symbols": [{ "id": 1, "symbol": "EXMP", "title": "Example Therapeutics", ... }],
 *   "entities": { "sentiment": { "basic": "Bullish" } }
 * }
 * ```
 * Serwis czyta `id` (klucz dedupu `st_{id}`), `body` (kolumna NOT NULL), `created_at`
 * (`new Date(...)`), `user.username` (`'unknown'` przy braku) i `entities.sentiment.basic`
 * (`undefined` przy braku / pustym stringu). `symbols`/`source` nie są używane i nie są
 * wymuszane w guardzie.
 */
export interface StocktwitsMessage {
  /** Liczbowe ID wiadomości — serwis buduje z niego `externalId = st_{id}`. */
  id: number;
  body: string;
  /** ISO 8601 (`2026-03-01T14:05:12Z`) — serwis parsuje `new Date(created_at)`. */
  created_at: string;
  user?: StocktwitsUser | null;
  entities?: StocktwitsSentimentEntities | null;
  symbols?: unknown[];
  source?: unknown;
}

export interface StocktwitsSymbolStream {
  messages: StocktwitsMessage[];
  symbol?: unknown;
  cursor?: unknown;
  response?: unknown;
}

/**
 * `entities` nieobecne / `null` / obiekt, w którym `sentiment` jest nieobecne / `null` /
 * obiektem z opcjonalnym stringowym `basic` — czyli każdy kształt, dla którego dawne
 * `msg.entities?.sentiment?.basic` dawało string albo `undefined`.
 */
function isOptionalSentimentEntities(value: unknown): value is StocktwitsSentimentEntities | null | undefined {
  if (value === undefined || value === null) return true;
  if (!isRecord(value)) return false;
  const { sentiment } = value;
  if (sentiment === undefined || sentiment === null) return true;
  return isRecord(sentiment) && isOptionalString(sentiment.basic);
}

function isOptionalUser(value: unknown): value is StocktwitsUser | null | undefined {
  if (value === undefined || value === null) return true;
  return isRecord(value) && isOptionalString(value.username);
}

export function isStocktwitsMessage(value: unknown): value is StocktwitsMessage {
  if (!isRecord(value)) return false;
  const { id, body, created_at, user, entities } = value;
  return (
    typeof id === 'number' &&
    typeof body === 'string' &&
    typeof created_at === 'string' &&
    isOptionalUser(user) &&
    isOptionalSentimentEntities(entities)
  );
}

/**
 * Odpowiednik dawnego `if (!data.messages || data.messages.length === 0) return 0`:
 * brak obiektu / brak tablicy `messages` → `[]` (serwis zwraca 0). Elementy bez liczbowego
 * `id`, stringowych `body`/`created_at` albo z nietypowym kształtem `user`/`entities` są
 * pomijane — dawny kod przekazywałby je do TypeORM (NOT NULL na `body` / Invalid Date
 * rzucały i przerywały cały symbol). W realnym payloadzie StockTwits każda wiadomość ma
 * komplet pól, więc filtr jest wyłącznie zabezpieczeniem typów.
 */
export function readStocktwitsMessages(data: unknown): StocktwitsMessage[] {
  if (!isRecord(data) || !isUnknownArray(data.messages)) return [];
  return data.messages.filter(isStocktwitsMessage);
}
