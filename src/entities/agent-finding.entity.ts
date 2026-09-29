import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/** Agent, który wystawił finding (etap 1: tylko AUDITOR). */
export type AgentName = 'AUDITOR' | 'RESEARCHER' | 'POSTMORTEM';
/** Waga findingu: P1 = błąd wymagający decyzji, P2 = degradacja, INFO = obserwacja. */
export type FindingSeverity = 'P1' | 'P2' | 'INFO';
/** Źródło: czysta reguła (deterministyczna) albo odpowiedź LLM (task 04). */
export type FindingSource = 'DETERMINISTIC' | 'LLM';
/** Status ręcznej weryfikacji findingu przez właściciela. */
export type FindingStatus = 'OPEN' | 'ACKED' | 'FALSE_POSITIVE';

/**
 * Finding agenta (audytor shadow-mode, tasks-2026-09-27/01).
 *
 * JEDYNA tabela, do której piszą agenci — reszta danych jest dla nich read-only.
 * Decyzje projektowe:
 * - `agent`/`severity`/`source`/`status` = varchar + union TS, NIE pg enum — dodanie
 *   wartości (np. RESEARCHER) to zmiana stringa w typie, nie `ALTER TYPE` na prod
 *   (synchronize:true + enum = crash-loop 27.07.2026).
 * - `alertId` bez FK — audyt ma przeżyć archiwizację/DELETE alertów.
 * - unikalny indeks częściowy `(alertId, checkId) WHERE alertId IS NOT NULL` = idempotencja
 *   per (alert, check) bez logiki w kodzie; findingi globalne (`alertId = null`)
 *   deduplikowane po `(agent, checkId)` w orkiestratorze.
 */
@Entity('agent_findings')
@Index(['alertId'])
@Index(['agent', 'checkId', 'status'])
@Index(['createdAt'])
@Index(['alertId', 'checkId'], { unique: true, where: '"alertId" IS NOT NULL' })
export class AgentFinding {
  @PrimaryGeneratedColumn()
  id!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  /** FK logiczne do alerts.id (bez constraint). null = finding globalny. */
  @Column({ type: 'int', nullable: true })
  alertId!: number | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  ticker!: string | null;

  /** accessionNumber filingu, jeśli finding dotyczy konkretnego zgłoszenia SEC. */
  @Column({ type: 'varchar', length: 30, nullable: true })
  accessionNumber!: string | null;

  @Column({ type: 'varchar', length: 20 })
  agent!: AgentName;

  /** Identyfikator checku, np. PRICE_FROZEN; sufiks `_LLM` dla warstwy LLM, `_AUDITED` = marker. */
  @Column({ type: 'varchar', length: 60 })
  checkId!: string;

  @Column({ type: 'varchar', length: 5 })
  severity!: FindingSeverity;

  @Column({ type: 'varchar', length: 15 })
  source!: FindingSource;

  /** Jedno zdanie po polsku: co jest nie tak. */
  @Column({ type: 'text' })
  summary!: string;

  /** Dowód: `{ expected, actual, where, ... }` — kształt zależny od checku. */
  @Column({ type: 'jsonb' })
  evidence!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 15, default: 'OPEN' })
  status!: FindingStatus;

  /** git SHA short pipeline'u, który wygenerował alert; dziś zawsze null (brak SHA w runtime). */
  @Column({ type: 'varchar', length: 12, nullable: true })
  pipelineVersion!: string | null;
}
