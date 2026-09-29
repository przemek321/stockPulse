import type { AgentName } from '../entities/agent-finding.entity';
import type { AuditContext, FindingDraft } from './auditor/audit-context';

/** Wynik jednego przebiegu agenta nad jednym alertem. */
export interface AgentRunResult {
  /** Szkice findingów: per alert (alertId = id alertu) i globalne (alertId = null). */
  readonly findings: readonly FindingDraft[];
  /** Id checków, które faktycznie się wykonały (do markera `_AUDITED`). */
  readonly checksRun: readonly string[];
  /** Id checków zakończonych 'AMBIGUOUS' (etap 1: finding INFO `<checkId>_AMBIGUOUS`; LLM w 04). */
  readonly ambiguous: readonly string[];
  /** Checki, które rzuciły wyjątkiem (izolowane) — trafiają do evidence markera `_AUDITED`. */
  readonly checkErrors: readonly { readonly checkId: string; readonly message: string }[];
}

/**
 * Agent w orkiestracji (tasks-2026-09-27/05). Etap 1: tylko AUDITOR.
 * Bez konwersacji agent↔agent, bez wspólnego stanu — każdy dostaje ten sam AuditContext.
 */
export interface Agent {
  readonly name: AgentName;
  run(ctx: AuditContext): AgentRunResult | Promise<AgentRunResult>;
}
