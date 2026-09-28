# 05 — `AgentOrchestratorService` + trigger CRON + zapis findingów

## Decyzja triggera (z faktów): CRON, nie event/kolejka
Brak eventu po emisji alertu (`ALERT_TRIGGERED` nieużywany); podpięcie wymagałoby edycji `alert-dispatcher.service.ts`
(ścieżka decyzyjna). Nowa kolejka BullMQ też wymagałaby producenta w pipeline'ach. → **`@Cron('*/15 * * * *')`**
w nowym module, skanujący `alerts` bez findingów. Wzorzec: `price-outcome.service.ts:77`.

## Scope (4 pliki)
- `src/agents/agents.module.ts` — `TypeOrmModule.forFeature([Alert, SecFiling, InsiderTrade, AgentFinding])`,
  `ScheduleModule` już globalny (sprawdzić `app.module.ts`), providers: orkiestrator + `AuditorAgent`; import w `app.module.ts` (+1 linia — jedyna zmiana poza `src/agents/`)
- `src/agents/agent-orchestrator.service.ts` — `agents: Agent[]` (etap 1: `[auditor]`), `run()` sekwencyjnie,
  `interface Agent { name: 'AUDITOR'|'RESEARCHER'|'POSTMORTEM'; run(ctx: AuditContext): Promise<FindingDraft[]> }`.
  Bez konwersacji agent↔agent, bez wspólnego stanu.
- `src/agents/auditor/auditor.agent.ts` — mapuje checki z 03 na `FindingDraft[]`; `AMBIGUOUS` → w etapie 1
  zapisuje finding `INFO` `checkId + '_AMBIGUOUS'` (LLM dopiero w 04)
- `test/unit/agent-orchestrator.spec.ts`

## Algorytm CRON (co 15 min, UTC)
1. `SELECT a.* FROM alerts a WHERE a."sentAt" > now() − interval '30 days' AND a."priceOutcomeDone" = true
   AND NOT EXISTS (SELECT 1 FROM agent_findings f WHERE f."alertId" = a.id AND f.agent='AUDITOR' AND f."checkId"='_AUDITED')
   ORDER BY a.id LIMIT 50` — czekamy na `priceOutcomeDone` (PRICE_FROZEN/ENTRY_GAP potrzebują slotów); marker
   `_AUDITED` (INFO, evidence `{checksRun: [...]}`) = idempotencja per alert.
2. Dla każdego: `filing` = `sec_filings` po `symbol` z `filingDate ∈ [sentAt−3d, sentAt]` (najnowszy; 8-K/4 wg reguły),
   `trades` = `insider_trades` po `symbol`, `transactionDate ∈ [sentAt−14d, sentAt]`.
3. `orchestrator.run(ctx)` → `INSERT ... ON CONFLICT ("alertId","checkId") DO NOTHING` (unique partial z 01).
4. Findingi globalne (`alertId=null`): `PRICE_LABEL_AMBIGUOUS`, `PIPELINE_VERSION_UNKNOWN` — raz, sprawdzane
   `SELECT 1 WHERE agent AND checkId AND alertId IS NULL`.
5. Budżet: `AUDITOR_MAX_ALERTS_PER_RUN=50`, `AUDITOR_ENABLED=true` w `.env` (domyślnie **false** do czasu 06 — shadow-run ręczny).

## Inwarianty
- Read-only na `alerts/sec_filings/insider_trades/tickers`; jedyny INSERT do `agent_findings`.
- 0 importów `TelegramService`/formattera/pipeline'ów. `grep` w weryfikacji.
- CRON nie może przekroczyć 60 s (50 alertów × czyste checki ≪ 1 s; 3 zapytania per alert).
- `@Logged('agents')` — **rozstrzygnięte 28.09**: `system_logs.module` to `varchar(50)` (`system-log.entity.ts:28`), nie pg enum; `Logged(moduleName: string)` (`logged.decorator.ts:213`) przyjmuje dowolny string → `'agents'` bez zmian schematu.

## Weryfikacja
```sql
SELECT "checkId", severity, count(*) FROM agent_findings GROUP BY 1,2 ORDER BY 3 DESC;
SELECT count(*) FROM alerts WHERE "priceOutcomeDone" AND "sentAt">now()-interval '30 days';   -- vs count(_AUDITED)
```
`npx jest test/unit` (726+), tsc, lint 0 nowych, rebuild, `restarts=0`, log `AgentOrchestratorService` przy starcie;
z `AUDITOR_ENABLED=false` CRON loguje „disabled" i nic nie pisze.

## Exit criteria
- [ ] moduł ładuje się, CRON zarejestrowany, przy `AUDITOR_ENABLED=false` zero wierszy w `agent_findings`
- [ ] test: ten sam alert dwa razy → 1 komplet findingów (idempotencja)
- [ ] `app.module.ts` diff = +1 import; żaden inny plik poza `src/agents/**` i testem
