import { SystemLogService } from '../../system-log/system-log.service';

/** Maksymalna długość zserializowanego input/output w logu.
 *  Zwiększone z 2000 na 4000 żeby zmieścić enriched context (Tier 1). */
const MAX_LOG_LENGTH = 4000;

/**
 * Serializuje wartość do obiektu logu, obcinając długie stringi.
 * Obsługuje circular references i nietypowe wartości.
 */
function truncateForLog(value: unknown): Record<string, any> | null {
  if (value === undefined || value === null) return null;

  try {
    // Prymitywy — wrap w obiekt
    if (typeof value !== 'object') {
      return { value };
    }

    // Serializacja z obsługą circular refs
    const seen = new WeakSet();
    const json = JSON.stringify(value, (_key, val) => {
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) return '[Circular]';
        seen.add(val);
      }
      // Obcinaj długie stringi wewnątrz obiektów
      if (typeof val === 'string' && val.length > 500) {
        return val.substring(0, 500) + '…';
      }
      return val;
    });

    if (!json) return null;

    // Obcinaj cały JSON jeśli za długi
    if (json.length > MAX_LOG_LENGTH) {
      const truncated = json.substring(0, MAX_LOG_LENGTH);
      return { _truncated: true, data: truncated };
    }

    return JSON.parse(json);
  } catch {
    return { _error: 'Nie udało się zserializować wartości' };
  }
}

/**
 * Serializuje argumenty funkcji do obiektu logu.
 * Każdy argument dostaje klucz arg0, arg1, ...
 */
function serializeArgs(args: unknown[]): Record<string, any> | null {
  if (!args || args.length === 0) return null;

  const result: Record<string, any> = {};
  for (let i = 0; i < args.length; i++) {
    const val = args[i];
    // Pomijaj duże obiekty (np. Job z BullMQ) — weź tylko .data
    if (val && typeof val === 'object' && 'data' in val) {
      result[`arg${i}`] = truncateForLog((val as any).data);
    } else {
      result[`arg${i}`] = truncateForLog(val);
    }
  }
  return result;
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
function extractLogMeta(args: any[], result: any): LogMeta {
  const meta: LogMeta = {};

  // Z pierwszego argumentu (event payload)
  const arg0 = args?.[0];
  if (arg0 && typeof arg0 === 'object') {
    // BullMQ Job wrap — wyciągnij .data
    const payload = 'data' in arg0 ? arg0.data : arg0;
    if (payload && typeof payload === 'object') {
      meta.ticker = payload.symbol ?? payload.ticker ?? null;
      meta.traceId = payload.traceId ?? null;
      meta.parentTraceId = payload.parentTraceId ?? null;
    }
  }

  // Z wyniku (pipeline return)
  if (result && typeof result === 'object') {
    // Ticker: wynik ma priorytet nad args (output jest authoritative)
    meta.ticker = result.symbol ?? result.ticker ?? meta.ticker ?? null;
    meta.traceId = result.traceId ?? meta.traceId ?? null;
    meta.decisionReason = result.action ?? null;

    // Action-based level mapping
    const action: string = result.action ?? '';
    if (action === 'ALERT_TELEGRAM_FAILED' || action === 'REDIS_ERROR') {
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
  if (!meta.level) meta.level = 'info';

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
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const original = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const start = Date.now();
      const logger = SystemLogService.getInstance();
      // Runtime className — łapie dziecko (np. StocktwitsService), nie bazową klasę
      const className = this?.constructor?.name || target.constructor.name;

      try {
        const result = await original.apply(this, args);
        const durationMs = Date.now() - start;
        const meta = extractLogMeta(args, result);

        logger?.log({
          module: moduleName,
          className,
          functionName: propertyKey,
          status: 'success',
          durationMs,
          input: serializeArgs(args),
          output: truncateForLog(result),
          traceId: meta.traceId,
          parentTraceId: meta.parentTraceId,
          level: meta.level,
          ticker: meta.ticker,
          decisionReason: meta.decisionReason,
        });

        return result;
      } catch (error) {
        const durationMs = Date.now() - start;
        const errClassName = this?.constructor?.name || target.constructor.name;
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
              ? `${error.message}\n${error.stack}`
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
