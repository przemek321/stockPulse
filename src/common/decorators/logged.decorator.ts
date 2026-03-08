import { SystemLogService } from '../../system-log/system-log.service';

/** Maksymalna długość zserializowanego input/output w logu */
const MAX_LOG_LENGTH = 2000;

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

/**
 * Decorator @Logged(module) — automatycznie loguje wywołania metod.
 *
 * Rejestruje: moduł, klasę, funkcję, input, output, czas trwania, status.
 * Fire-and-forget — nie blokuje oryginalnej metody.
 *
 * @example
 * ```typescript
 * @Logged('collectors')
 * async collect(): Promise<number> { ... }
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

        logger?.log({
          module: moduleName,
          className,
          functionName: propertyKey,
          status: 'success',
          durationMs,
          input: serializeArgs(args),
          output: truncateForLog(result),
        });

        return result;
      } catch (error) {
        const durationMs = Date.now() - start;
        const errClassName = this?.constructor?.name || target.constructor.name;

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
        });

        throw error;
      }
    };

    return descriptor;
  };
}
