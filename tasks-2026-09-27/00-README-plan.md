# StockPulse — MCP server (read-only) + agent-audytor w shadow mode — PLAN (etap 1)

> **Stan 29.09.2026 — etap 1 WYKONANY** (00 `a623d84`, 01 `f9b4f88`, 03 `f3b0ba2`, 05 `a1a2756`, 06 `4d8780c`,
> raport [doc/AUDITOR-SHADOW-RUN-2026-09-29.md](../doc/AUDITOR-SHADOW-RUN-2026-09-29.md), werdykt **(a)**).
> Rozjazdy z planem: 00 = tylko zakres w manifeście (lock miał 3.25.76 od marca); checków jest **13**, nie 11
> (+`OUTCOME_DONE_EMPTY`, +`CONCLUSION_CUT_AT_300`; ENTRY_GAP także SHORT i AMBIGUOUS dla alertów w sesji;
> POST_CLOSE P2 tylko delivered; TRANSACTION_TYPE_MISMATCH obie reguły Form 4, pre-backfill → INFO); trades
> także po `collectedAt`; OSCR #2505 = pozytyw POST_CLOSE (06:05 NY, nie 14:05). 02 MCP i 04 LLM: po 01.11.

> Status: **PLAN zatwierdzony do napisania 28.09.2026, implementacja czeka na „rób"**.
> Decyzje właściciela (28.09): kolejność 00→01→03→05→06→02→04; checki wg §Checki; MCP = osobny kontener
> z read-only rolą Postgresa; cache EDGAR na dysku (200 MB / 30 d); start TERAZ, ale 02/04 (MCP, LLM) dopiero
> po werdykcie 01.11 — do tego czasu tylko deterministyka.

## Twarde ograniczenia (obowiązują każdy task)
1. **Ścieżka decyzyjna nietykalna**: `src/sec-filings/pipelines/*`, `src/correlation/*`,
   `src/alerts/telegram/*`, `src/alerts/alert-dispatcher.service.ts`, `src/alerts/alert-evaluator.service.ts`,
   `src/sec-filings/services/daily-cap.service.ts`, `src/price-outcome/*`, `alert_rules`. Bug tam → finding/raport, nie fix.
2. **Zero Telegrama**: nowy kod nie importuje `TelegramService` ani `TelegramFormatterService`.
3. **Read-only**: jedyny zapis = tabela `agent_findings`.
4. **Nie fabrykuj**: nazwy tylko z kodu (lista niżej). Brak → „nie wiem, sprawdzę".
5. **Deterministyka przed LLM**; LLM tylko dla `AMBIGUOUS`, `source: LLM` nigdy nie nadpisuje `DETERMINISTIC`.
6. Zależności z wersją z `npm view`. Lint: 0 nowych błędów, baseline nietknięty (`npm run lint`).
7. Każdy task = osobny commit + weryfikacja jak przy spłacie długu (tsc, jest 726+, lint, rebuild, logi, CI).

## Fakty z kodu (zweryfikowane 28.09, źródło: `src/**`)
- **Encje** (`src/entities/index.ts`, 12): `Alert`→`alerts`, `AlertRule`, `CollectionLog`, `InsiderTrade`→`insider_trades`,
  `NewsArticle`, `OptionsFlow`, `OptionsVolumeBaseline`, `PdufaCatalyst`, `RawMention`, `SecFiling`→`sec_filings`,
  `SystemLog`→`system_logs`, `Ticker`→`tickers`. Rejestracja: glob `entities/*.entity{.ts,.js}`
  (`src/database/database.module.ts:20`) — nowa encja wchodzi automatycznie. `synchronize: true` (brak migrations).
- **`alerts`**: `id, symbol, ruleName, priority, channel, message (= pełny tekst MarkdownV2 wysłany/nie na Telegram),
  catalystType, delivered, nonDeliveryReason, sentAt, alertDirection, priceAtAlert, price1h/4h/1d/3d/7d,
  priceOutcomeDone, xbiAtAlert/1d/3d/7d, ibbAtAlert/1d/3d/7d, archived`. **Brak** `accessionNumber`/`tradeId`
  — powiązanie alert↔transakcja tylko przez `symbol` + `sentAt` + nagłówek `👤 *Imię*` w `message`.
- **`sec_filings`**: `documentUrl` = katalog EDGAR (nie plik), `gptAnalysis` JSONB (`SecFilingAnalysis`:
  `summary, conclusion, key_facts[], conviction, price_impact{direction,magnitude,confidence,time_horizon},
  catalyst_type, requires_immediate_attention, fix16_shadow?`). **Surowy XML/HTML NIE jest przechowywany.**
- **Emisja alertu**: brak eventu (`EventType.ALERT_TRIGGERED` istnieje, nikt nie emituje/nie słucha). Zapis przez
  `alertRepo.save()` w `form4.pipeline.ts`, `form8k.pipeline.ts` (×3), `alert-evaluator.service.ts:141-156`.
  → **trigger audytora = CRON** (wzorzec: `@Cron('0 * * * *', { timeZone: 'UTC' })` w `price-outcome.service.ts:77`).
- **LLM**: pipeline'y wstrzykują token `AzureOpenaiClientService`, ale DI (`sentiment.module.ts:20-21`,
  `useExisting: AnthropicClientService`) daje instancję **`AnthropicClientService`** (`@anthropic-ai/sdk`,
  `ANTHROPIC_MODEL` domyślnie `claude-sonnet-4-6`, `analyzeCustomPrompt(prompt): Promise<unknown>`, `max_tokens 1024`).
  Klasa `AzureOpenaiClientService` = martwy kod. Klient nie ma własnego licznika; `DailyCapService` = Redis
  `INCR` TTL 24h per ticker, `MAX_DAILY_CALLS = 20`, token `SEC_FILINGS_REDIS`.
- **Redis**: 1 kontener (`stockpulse-redis`), 3 providery NestJS. **TimescaleDB nie jest zainstalowana** (zwykły PG 16).
- **Benchmark**: stałe XBI+IBB dla każdego alertu (`sector-snapshot.helper.ts:34-35`); brak SIC w `tickers`,
  brak mapowania → `BENCHMARK_MISMATCH` wycięty (decyzja 2).
- **MarkdownV2**: `escapeMarkdown` (`telegram-formatter.service.ts:459`) escapuje `_*[]()~\`>#+-=|{}.!\` —
  **`&` NIE jest escapowany ani zjadany** → check z briefu `AMPERSAND_EATEN` nie ma podstawy; zastąpiony przez
  `ESCAPE_MISSING` (znak specjalny MarkdownV2 bez backslasha w `message` = Telegram odrzuciłby wiadomość — lekcja 02-05.07).
- **Cena w alercie**: `formatter:264` pisze `• Transakcja: BUY 12,500 akcji @ $252,875` — `@` + `totalValue`
  (celowo, wartość transakcji). `PRICE_FIELD_IS_TOTAL_VALUE` zredefiniowany → `PRICE_LABEL_AMBIGUOUS` (INFO, raz per
  format, nie per alert) — decyzja 2.
- **8-K entry price**: `formatActionLine` (`formatter:211-220`) dodaje `| Wejście: $X` gdy `entryPrice != null`.
  NYSE: `isNyseOpen`, `getEffectiveStartTime`, `isNyseHoliday` w `src/common/utils/market-hours.util.ts`.
- **git SHA w runtime: BRAK** (Dockerfile/compose/Makefile/kod) → `pipelineVersion` null + finding INFO `PIPELINE_VERSION_UNKNOWN`.
- **Fixture z realnych danych — wzorzec istnieje**: `test/fixtures/regression/HUM-2026-04-29.json` (`_meta{incident,
  alertId, filingId, sentAt, decisionReason, actualOutcome, rootCause}, filing, gptAnalysis`).
- **Skala findingów na obecnych danych (alerty od 09.06, N=81)**: `PRICE_FROZEN` 1 (SEM #2441), gap>3% 25 — czyli
  `ENTRY_GAP_UNENTERABLE` będzie najczęstszym findingiem (zgodnie z werdyktem: 8/10 C-suite zablokowane).
- **MCP SDK**: `@modelcontextprotocol/sdk` **1.30.1**, peer `zod ^3.25 || ^4.0`; repo: zod `^3.23.0`, jedyny import
  w `src/sec-filings/types/sec-filing-analysis.ts` (ścieżka decyzyjna!) → task 00.
- **Postgres role**: tylko `stockpulse` (superuser aplikacji). Read-only rola do utworzenia (task 02).
- **Zasoby Jetson**: 2/15 GB RAM, `app` 74 MB — osobny kontener MCP zasobowo obojętny.

## Checki (decyzja 2)
| checkId | severity | source | podstawa w kodzie |
|---|---|---|---|
| `PRICE_FROZEN` | P1 | DET | 5 slotów `price1h..price7d` identyczne i non-null (SEM #2441, delisting) |
| `ENTRY_GAP_UNENTERABLE` | P2 | DET | `alertDirection='positive'`, `(price1h−priceAtAlert)/priceAtAlert > 0.03` (REGUŁY §2 chase guard) |
| `ALERT_TEXT_TRUNCATED` | P2 | DET | `message` kończy się bez `.`/`)`/emoji-linii `⏰` LUB linia `Wniosek GPT` krótsza niż `gptAnalysis.conclusion` po unescape |
| `GPT_CONCLUSION_TRUNCATED` | P2 | DET | `gptAnalysis.conclusion` nie kończy się `[.!?]` (Sonnet urwany na max_tokens 1024) |
| `ESCAPE_MISSING` | P1 | DET | regex z `test/unit/summary-scheduler.spec.ts:334` (`(?<!\\)[()[\]~\`>#+=|{}.!-]`) na `message` (poza blokami `*…*`/`_…_`) |
| `TRANSACTION_TYPE_MISMATCH` | P1 | DET→AMBIGUOUS | alert `Form 4 Insider BUY` a `insider_trades` (symbol, ±14d, insider z nagłówka) ma `is10b51Plan=true` LUB `transactionType≠'BUY'`; footnoty niedostępne (brak surówki) → AMBIGUOUS gdy brak dopasowania insidera |
| `STALE_TEMPLATE_DATE` | INFO | DET | data `przegląd ok. DD.MM.YYYY` w `message` starsza niż 30 d od `sentAt` (case: „przegląd okna obs ~25.07.2026" w pingach discovery) |
| `PREVIOUSLY_ANNOUNCED_8K` | P2 | DET | regex `previously announced\|as previously disclosed` w `message`/`gptAnalysis.summary` przy `ruleName LIKE '8-K%'` i `priceAtAlert IS NOT NULL` |
| `POST_CLOSE_8K_ENTRY_PRICE` | P2 | DET | `ruleName LIKE '8-K%'`, `priceAtAlert IS NOT NULL`, `!isNyseOpen(sentAt)` |
| `PRICE_LABEL_AMBIGUOUS` | INFO | DET | `message` zawiera `akcji @ $` i wartość = `totalValue` (nie `pricePerShare`) — **raz**, `alertId=null` |
| `PIPELINE_VERSION_UNKNOWN` | INFO | DET | brak SHA w runtime — **raz**, `alertId=null` |
| ~~`BENCHMARK_MISMATCH`~~ | — | — | wycięty (brak SIC); wraca po dodaniu SIC do `tickers` |
| ~~`AMPERSAND_EATEN`~~ | — | — | wycięty (`&` nie jest ani escapowany, ani zjadany) |

## Kolejność i zależności
`00-zod-bump` → `01-agent-findings-entity` → `03-auditor-deterministic-checks` → `05-orchestrator-and-cron`
→ `06-shadow-run-and-report` → **STOP do 01.11** → `02-mcp-server-readonly` → `04-auditor-llm-layer`.
Etap 2 (RESEARCHER, POSTMORTEM): tylko miejsce w enumie `agent` i w liście orkiestratora — bez kodu.
