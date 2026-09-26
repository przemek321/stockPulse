/**
 * strict:true (27.09.2026) — `catch (err)` daje `unknown` (useUnknownInCatchVariables); wcześniej `any`
 * i `err.message` przechodziło bez kontroli (lint liczył to jako no-unsafe-member-access).
 * Jedno miejsce zamiast 23 powtórzeń `err instanceof Error ? err.message : String(err)`.
 */
export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Kod błędu drivera (np. PostgreSQL '23505' unique_violation) z nieznanego wyjątku. */
export function errCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const c = (err as { code?: unknown }).code;
    return typeof c === 'string' ? c : undefined;
  }
  return undefined;
}
