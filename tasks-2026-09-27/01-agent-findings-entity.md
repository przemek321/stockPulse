# 01 — encja `AgentFinding` → tabela `agent_findings`

## Scope (3 pliki)
- `src/entities/agent-finding.entity.ts` (nowy)
- `src/entities/index.ts` (+1 export; glob w `database.module.ts:20` i tak ją złapie — export dla spójności importów)
- `test/unit/agent-finding.entity.spec.ts` (nowy; test kształtu + enumów, bez DB)

## Model (nazwy kolumn dokładnie tak — MCP i checki będą się do nich odwoływać)
```ts
@Entity('agent_findings')
export class AgentFinding {
  @PrimaryGeneratedColumn() id!: number;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @Column({ type: 'int', nullable: true }) alertId!: number | null;        // FK logiczne do alerts.id (bez constraint — alerts.archived/DELETE nie mogą wywalić audytu)
  @Column({ length: 10, nullable: true }) ticker!: string | null;
  @Column({ length: 30, nullable: true }) accessionNumber!: string | null;
  @Column({ type: 'varchar', length: 20 }) agent!: 'AUDITOR' | 'RESEARCHER' | 'POSTMORTEM';   // varchar + union, NIE pg enum (synchronize + enum = pułapka 27.07)
  @Column({ length: 60 }) checkId!: string;
  @Column({ type: 'varchar', length: 5 }) severity!: 'P1' | 'P2' | 'INFO';
  @Column({ type: 'varchar', length: 15 }) source!: 'DETERMINISTIC' | 'LLM';
  @Column({ type: 'text' }) summary!: string;
  @Column({ type: 'jsonb' }) evidence!: Record<string, unknown>;          // { expected, actual, where, ... }
  @Column({ type: 'varchar', length: 15, default: 'OPEN' }) status!: 'OPEN' | 'ACKED' | 'FALSE_POSITIVE';
  @Column({ type: 'varchar', length: 12, nullable: true }) pipelineVersion!: string | null;   // git SHA short; dziś zawsze null
}
@Index(['alertId']) @Index(['agent', 'checkId', 'status']) @Index(['createdAt'])
@Index(['alertId', 'checkId'], { unique: true, where: '"alertId" IS NOT NULL' })   // idempotencja per (alert, check)
```
Decyzje projektowe do potwierdzenia przy implementacji: (a) **varchar zamiast pg enum** — dodanie wartości
`RESEARCHER` później to zmiana stringa w typie TS, nie `ALTER TYPE` na prod; (b) **brak FK** — audyt ma przeżyć
archiwizację/DELETE alertów; (c) unikalny indeks częściowy = idempotencja bez logiki w kodzie (findingi globalne
z `alertId=null` deduplikowane po `(agent, checkId)` w kodzie orkiestratora).

## Inwarianty
- Nowa tabela przy `synchronize:true` = `CREATE TABLE` (bezpieczne). **Nie ruszać żadnej istniejącej encji.**
- Deploy = rebuild `app`; sprawdzić `RestartCount=0` i log startu (lekcja 27.07).

## Weryfikacja
```sql
\d agent_findings                              -- 13 kolumn, 4 indeksy (w tym unique partial)
SELECT count(*) FROM agent_findings;           -- 0
INSERT ... (alertId=2511, checkId='X') ×2      -- drugi INSERT: unique_violation 23505
```
`npx tsc --noEmit`, `npx jest test/unit` (726+1), `npm run lint` 0 nowych, rebuild, `/api/health` healthy.

## Exit criteria
- [ ] tabela istnieje na prod z indeksami, 0 wierszy; unique partial działa
- [ ] żadna inna tabela nie zmieniona (`\d alerts` identyczne jak przed)
- [ ] restarts=0 po rebuildzie, CI zielone
