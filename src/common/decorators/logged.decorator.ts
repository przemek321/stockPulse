import { SystemLogService } from '../../system-log/system-log.service';

/** Maksymalna długość zserializowanego input/output w logu.
 *  Zwiększone z 2000 na 4000 żeby zmieścić enriched context (Tier 1). */
const MAX_LOG_LENGTH = 4000;

// ── Strażniki typów (strict:true 27.09.2026 — args/result metod są `unknown`) ──

/** Obiekt (także tablica) — odpowiednik dawnego `val && typeof val === 'object'`. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Pole metadanych (symbol/ticker/traceId/parentTraceId/action) jako string albo `null`.
 * Wszystkie 24 metody z @Logged (27.09.2026) mają te pola typu `string` / `string | undefined`,
 * więc dla realnego ruchu to dokładnie dawne `x ?? null`; wartość nie-stringowa (nie występuje)
 * daje `null` zamiast trafić do kolumny varchar jako śmieć.
 */
function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Metoda owijana przez @Logged — sygnatura celowo najogólniejsza (this/args/wynik nieznane). */
type LoggedMethod = (this: unknown, ...args: unknown[]) => unknown;

function isLoggedMethod(value: unknown): value is LoggedMethod {
  return typeof value === 'function';
}

/**
 * Nazwa klasy z runtime `this` — odpowiednik dawnego `this?.constructor?.name`.
 * `''` gdy nie da się odczytać (brak `this`, prototyp bez `constructor`) → caller robi
 * fallback `|| target.constructor.name` tak jak dotąd.
 */
function runtimeClassName(self: unknown): string {
  if ((typeof self !== 'object' && typeof self !== 'function') || self === null)
    return '';
  const ctor: unknown = self.constructor;
  return typeof ctor === 'function' ? ctor.name : '';
}

/**
 * Serializuje wartość do obiektu logu, obcinając długie stringi.
 * Obsługuje circular references i nietypowe wartości.
 *
 * Zwraca wartość JSON gotową do kolumny JSONB: `null` (brak wartości), `{ value }` dla prymitywu,
 * obiekt/tablicę po round-tripie JSON.stringify→JSON.parse, `{ _truncated, data }` albo `{ _error }`.
 * Typ `unknown`, bo JSON.parse może oddać także prymityw (obiekt z top-level `toJSON`, np. `Date`).
 */
function truncateForLog(value: unknown): unknown {
  if (value === undefined || value === null) return null;

  try {
    // Prymitywy — wrap w obiekt
    if (typeof value !== 'object') {
      return { value };
    }

    // Serializacja z obsługą circular refs
    const seen = new WeakSet();
    const json = JSON.stringify(
      value,
      (_key: string, val: unknown): unknown => {
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return '[Circular]';
          seen.add(val);
        }
        // Obcinaj długie stringi wewnątrz obiektów
        if (typeof val === 'string' && val.length > 500) {
          return val.substring(0, 500) + '…';
        }
        return val;
      },
    );

    if (!json) return null;

    // Obcinaj cały JSON jeśli za długi
    if (json.length > MAX_LOG_LENGTH) {
      const truncated = json.substring(0, MAX_LOG_LENGTH);
      return { _truncated: true, data: truncated };
    }

    const parsed: unknown = JSON.parse(json);
    return parsed;
  } catch {
    return { _error: 'Nie udało się zserializować wartości' };
  }
}

/**
 * Serializuje argumenty funkcji do obiektu logu.
 * Każdy argument dostaje klucz arg0, arg1, ...
 */
function serializeArgs(args: unknown[]): Record<string, unknown> | null {
  if (args.length === 0) return null;

  const result: Record<string, unknown> = {};
  for (let i = 0; i < args.length; i++) {
    const val = args[i];
    // Pomijaj duże obiekty (np. Job z BullMQ) — weź tylko .data
    if (isRecord(val) && 'data' in val) {
      result[`arg${i}`] = truncateForLog(val.data);
    } else {
      result[`arg${i}`] = truncateForLog(val);
    }
  }
  return result;
}

/**
 * Kolumna `output` ma w CreateSystemLogDto kontrakt `Record<string, any>`, a `truncateForLog`
 * oddaje dla wyniku każdej metody z @Logged obiekt/tablicę albo `null` (prymityw → `{ value }`).
 * Jedyny inny przypadek — top-level `toJSON` zwracające prymityw (np. goły `Date` jako wynik):
 * dotąd prymityw szedł do JSONB bez wrappera (typ był kłamstwem), teraz dostaje ten sam `{ value }`
 * co inne prymitywy. Żadna z 24 metod z @Logged (27.09.2026) nie zwraca takiej wartości.
 */
function asOutputObject(value: unknown): object | null {
  return typeof value === 'object' ? value : { value };
}

// ── extractLogMeta — Tier 1 observability ─────────────────

interface LogMeta {
  traceId?: string | null;
  parentTraceId?: string | null;
  level?: 'debug' | 'info' | 'warn' | 'error';
  ticker?: string | null;
  decisionReason?: string | null;
}

/**
 * Wyciąga metadata z argumentów i wyniku metody dla system log.
 *
 * Konwencje:
 * - Pipeline handlers dostają payload z `symbol`, `traceId`, `parentTraceId`
 * - Pipeline handlers zwracają `{ action, symbol, traceId?, ... }`
 * - Collectors zwracają `{ collector, count }` bez action → default level='info'
 */
function extractLogMeta(args: unknown[], result: unknown): LogMeta {
  const meta: LogMeta = {};

  // Z pierwszego argumentu (event payload)
  const arg0 = args[0];
  if (isRecord(arg0)) {
    // BullMQ Job wrap — wyciągnij .data
    const payload: unknown = 'data' in arg0 ? arg0.data : arg0;
    if (isRecord(payload)) {
      meta.ticker =
        stringOrNull(payload.symbol) ?? stringOrNull(payload.ticker);
      meta.traceId = stringOrNull(payload.traceId);
      meta.parentTraceId = stringOrNull(payload.parentTraceId);
    }
  }

  // Z wyniku (pipeline return)
  if (isRecord(result)) {
    // Ticker: wynik ma priorytet nad args (output jest authoritative)
    meta.ticker =
      stringOrNull(result.symbol) ??
      stringOrNull(result.ticker) ??
      meta.ticker ??
      null;
    meta.traceId = stringOrNull(result.traceId) ?? meta.traceId ?? null;
    meta.decisionReason = stringOrNull(result.action);

    // Action-based level mapping
    const action: string = stringOrNull(result.action) ?? '';
    if (
      action === 'ALERT_TELEGRAM_FAILED' ||
      action === 'REDIS_ERROR' ||
      action === 'PARSER_EMPTY' ||
      action === 'FETCH_TIMEOUT'
    ) {
      meta.level = 'warn';
    } else if (action === 'ERROR') {
      meta.level = 'error';
    } else if (action === 'NO_PATTERNS' || action === 'TOO_FEW_SIGNALS') {
      meta.level = 'debug';
    }
    // Wszystkie pozostałe actions (SKIP_*, ALERT_*, STORED, THROTTLED, PATTERNS_DETECTED)
    // → default 'info' (ustawione poniżej)
  }

  // Default level — INFO (NIE debug).
  // Collector heartbeats ({collector, count}) i metody bez `action` muszą być INFO,
  // inaczej cleanup 2d uciąłby ważną historię.
  meta.level ??= 'info';

  return meta;
}

/**
 * Decorator @Logged(module) — automatycznie loguje wywołania metod.
 *
 * Rejestruje: moduł, klasę, funkcję, input, output, czas trwania, status.
 * Tier 1: dodatkowo traceId, level, ticker, decisionReason (z extractLogMeta).
 * Fire-and-forget — nie blokuje oryginalnej metody.
 *
 * ⚠️ CRITICAL: Na metodach z @OnEvent, @Logged MUSI być PONIŻEJ @OnEvent.
 * TypeScript aplikuje dekoratory bottom-up: @OnEvent (top) → @Logged (bottom)
 * w source code = @OnEvent (inner) → @Logged (outer) w runtime.
 * Odwrócenie = NestJS EventEmitter nie znajdzie listenera (Sprint 7.6 bug).
 *
 * @example
 * ```typescript
 * @OnEvent(EventType.NEW_FILING)    // ← NA GÓRZE
 * @Logged('sec-filings')            // ← PONIŻEJ
 * async onFiling(payload) { ... }
 * ```
 */
export function Logged(moduleName: string) {
  return function (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor {
    const original: unknown = descriptor.value;
    // Dekorator metod — `descriptor.value` to zawsze funkcja (accessor/property nie przechodzi
    // przez sygnaturę MethodDecorator). Fail-fast zamiast TypeError przy pierwszym wywołaniu.
    if (!isLoggedMethod(original)) {
      throw new TypeError(
        `@Logged('${moduleName}'): ${propertyKey} nie jest metodą`,
      );
    }

    descriptor.value = async function (
      this: unknown,
      ...args: unknown[]
    ): Promise<unknown> {
      const start = Date.now();
      const logger = SystemLogService.getInstance();
      // Runtime className — łapie dziecko (np. StocktwitsService), nie bazową klasę
      const className = runtimeClassName(this) || target.constructor.name;

      try {
        const result: unknown = await original.apply(this, args);
        const durationMs = Date.now() - start;
        const meta = extractLogMeta(args, result);

        logger?.log({
          module: moduleName,
          className,
          functionName: propertyKey,
          status: 'success',
          durationMs,
          input: serializeArgs(args),
          output: asOutputObject(truncateForLog(result)),
          traceId: meta.traceId,
          parentTraceId: meta.parentTraceId,
          level: meta.level,
          ticker: meta.ticker,
          decisionReason: meta.decisionReason,
        });

        return result;
      } catch (error) {
        const durationMs = Date.now() - start;
        const errClassName = runtimeClassName(this) || target.constructor.name;
        const meta = extractLogMeta(args, null);

        logger?.log({
          module: moduleName,
          className: errClassName,
          functionName: propertyKey,
          status: 'error',
          durationMs,
          input: serializeArgs(args),
          output: null,
          errorMessage:
            error instanceof Error
              ? `${error.message}\n${error.stack ?? ''}`
              : String(error),
          traceId: meta.traceId,
          parentTraceId: meta.parentTraceId,
          level: 'error',
          ticker: meta.ticker,
          decisionReason: 'ERROR',
        });

        throw error;
      }
    };

    return descriptor;
  };
}
