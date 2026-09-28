# 04 — audytor: warstwa LLM dla `AMBIGUOUS` — **PO 01.11, tylko jeśli 06 dał werdykt (a)**

## Zakres LLM (wąski, z faktów)
Jedyny check, który dziś kończy się `AMBIGUOUS`: `TRANSACTION_TYPE_MISMATCH` gdy insidera z nagłówka nie da się
dopasować do `insider_trades` (np. joint filers SMMT, nazwisko w innej formie). LLM dostaje: nagłówek alertu + listę
kandydatów z `insider_trades` (symbol, ±14d) i zwraca `{ matchedTradeIds: number[], confidence, reason }`.
Footnoty Form 4 (offering participation) — **niedostępne bez surówki**; jeśli 02 dostarczy `get_raw_filing`,
drugi przypadek LLM: klasyfikacja footnotów → `{ isOfferingParticipation: bool, is10b51: bool, quote: string }`.

## Scope (3 pliki)
- `src/agents/auditor/llm-resolver.ts` — wstrzykuje **`AnthropicClientService`** bezpośrednio (nie alias
  `AzureOpenaiClientService`); prompt → `analyzeCustomPrompt()` → walidacja zod (`AuditorLlmResultSchema`, zod 3.25)
- `src/agents/auditor/llm-budget.ts` — Redis `INCR auditor:llm:YYYY-MM-DD` TTL 48h, `AUDITOR_LLM_DAILY_MAX` (env, domyślnie 20);
  **osobny klucz** od `DailyCapService` — **rozstrzygnięte 28.09**: DailyCap używa `gpt:daily:<ticker>:<date>` (`daily-cap.service.ts:62`); audytor używa `auditor:llm:<date>` — prefiksy rozłączne
- `test/unit/auditor-llm-resolver.spec.ts` — mock klienta; test: przekroczony budżet → brak wywołania, finding `INFO LLM_BUDGET_EXHAUSTED`

## Inwarianty
- `source: 'LLM'`; finding LLM **nigdy nie nadpisuje** deterministycznego (unique `(alertId, checkId)` — LLM używa `checkId + '_LLM'`).
- Odpowiedź niezgodna ze schematem → finding `INFO LLM_SCHEMA_INVALID` z surową odpowiedzią w `evidence` (obciętą do 2 KB), bez retry.
- Timeout klienta = istniejący (`ANTHROPIC_TIMEOUT_MS`); brak własnego retry.
- Prompt NIE zawiera treści `message` w całości (koszt) — tylko nagłówek + kandydaci.

## Weryfikacja
`npx jest test/unit/auditor-llm-resolver.spec.ts`; shadow-run z `AUDITOR_LLM_DAILY_MAX=3` → dokładnie 3 wywołania
w `system_logs` (`AnthropicClientService.analyzeCustomPrompt`), czwarty przypadek = `LLM_BUDGET_EXHAUSTED`;
`redis-cli GET auditor:llm:<dziś>` = 3; `gpt:daily:*` (DailyCap) niezmienione.

## Exit criteria
- [ ] LLM wołany wyłącznie dla `AMBIGUOUS`, budżet twardy, klucz Redis rozłączny od DailyCap
- [ ] 0 findingów LLM nadpisujących deterministyczne (test unique)
