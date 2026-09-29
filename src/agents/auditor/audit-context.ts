import type { Alert, InsiderTrade, SecFiling } from '../../entities';
import type { FindingSeverity } from '../../entities/agent-finding.entity';

/**
 * Wejście checków audytora (tasks-2026-09-27/03).
 *
 * Dane dostarcza orkiestrator (05) — checki NIE dotykają repozytoriów ani sieci, są czystymi
 * funkcjami nad tym obiektem (testowalne bez NestJS). Wszystkie pola read-only: żaden check
 * nie modyfikuje kontekstu.
 *
 * PUŁAPKA TypeORM: kolumny `decimal` (priceAtAlert, price1h…, totalValue) hydrują się jako
 * STRINGI mimo typu `number | null` w encji — checki muszą używać `toNumber()` z `checks.ts`.
 */
export interface AuditContext {
  readonly alert: Alert;
  /** Filing powiązany po symbolu i oknie [sentAt−3d, sentAt] (formType wg reguły); null gdy brak. */
  readonly filing: SecFiling | null;
  /** insider_trades po symbolu, transactionDate ∈ [sentAt−14d, sentAt]. */
  readonly trades: readonly InsiderTrade[];
  /** Moment audytu (wstrzykiwany — deterministyczne testy). */
  readonly now: Date;
}

/** Szkic findingu — orkiestrator dokłada `agent`, `source`, `status` i zapisuje do agent_findings. */
export interface FindingDraft {
  readonly checkId: string;
  readonly severity: FindingSeverity;
  /** null = finding globalny (dotyczy systemu, nie konkretnego alertu). */
  readonly alertId: number | null;
  readonly ticker: string | null;
  readonly accessionNumber: string | null;
  readonly summary: string;
  readonly evidence: Readonly<Record<string, unknown>>;
}

/**
 * Wynik pojedynczego checku:
 * - `FindingDraft` — reguła odpaliła,
 * - `'AMBIGUOUS'` — deterministycznie nierozstrzygalne (etap 1: finding INFO `<checkId>_AMBIGUOUS`; LLM w 04),
 * - `null` — czysto.
 */
export type CheckResult = FindingDraft | 'AMBIGUOUS' | null;

export type CheckScope = 'ALERT' | 'GLOBAL';

export interface AuditCheck {
  readonly id: string;
  readonly severity: FindingSeverity;
  /** ALERT = finding per alert (unique (alertId, checkId)); GLOBAL = raz na system (alertId=null). */
  readonly scope: CheckScope;
  readonly run: (ctx: AuditContext) => CheckResult;
}
