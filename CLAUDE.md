# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Dokumentacja i komentarze w tym projekcie piszemy po polsku.**

> 🎯 **Backtest V5 (18.04.2026, po Sprint 17 P1 — H6 control fix + H1 cluster-vs-single)** — V5 commit f69cfa8 (regenerate po mismatch w 3a319d7). **Healthcare SELL: zero edge** (d≈0 wszystkie horyzonty). **Control SELL: d=+0.10 30d Bonferroni ✓✓✓** (non-healthcare ma edge na dłuższym horyzoncie). **Direct HC vs CTRL: d=-0.14 30d p=0.016** — healthcare SŁABSZY niż control dla SELL. **H1 cluster BUY vs solo BUY: p>0.37 wszystkie horyzonty** (N_cluster=21 vs N_single=49) — czekanie na 2-giego insidera nie dodaje edge'u. **BUY edge silniejszy V4→V5** (C-suite BUY csuite_buys 7d: +0.82→+0.92, All BUY: +0.68→+0.75). Wyniki: [backtest_report.md](scripts/backtest/data/results/backtest_report.md), ściąga: [STOCKPULSE-CHEATSHEET-2026-04-17.md](doc/STOCKPULSE-CHEATSHEET-2026-04-17.md).
>
> ✅ **Sprint 17 resolved (18.04.2026)**: (1) C-suite SELL → observation mode (abff1c9, 5dc2a36). (2) Director BUY boost ×1.15 (e07bbc2). (3) H6 control group fix (e07bbc2). (4) H1 cluster_buy_vs_single_buy direct test (e07bbc2 + f69cfa8). (5) Production 10b5-1 parser audit verified. Sprint 18 candidates: INSIDER_CLUSTER BUY disable, C-suite regex ujednolicenie, d=None bug w `_direct_cluster_vs_single`, report_generator renderowanie nowych sub_groups.
>
> 🔧 **Audyt 16.04.2026**: Phase 1 (5 bugów P0-P2) + Tier 1 observability (traceId, level, ticker, decision_reason w system_logs) + 6 P0 fixów z code review (multi-owner parser, backfill contamination, baseline winsorize, bankruptcy cap, NYSE holidays, AlertDeliveryGate). Raport: [STOCKPULSE-AUDIT-2026-04-16.md](doc/STOCKPULSE-AUDIT-2026-04-16.md), handoff: [HANDOFF-CODE-REVIEW-2026-04-16.md](doc/HANDOFF-CODE-REVIEW-2026-04-16.md).

## Opis projektu

StockPulse to system wykrywania edge'u na rynku akcji healthcare z alertami Telegram. Monitoruje transakcje insiderów (SEC EDGAR Form 4), zdarzenia korporacyjne (8-K), aktywność opcyjną (Polygon.io) i daty FDA (PDUFA.bio). Koreluje sygnały z wielu źródeł (insider×options, insider×8-K, insider cluster) i alertuje tylko gdy wykryje realny edge.

**Aktualny stan projektu**: Faza 2 + Sprint 4-10 (ukończone) + **Sprint 11 (przebudowa — focus na edge, 03.04.2026)** + **Sprint 12 (migracja AI + dashboard, 04.04.2026)** + **Sprint 13 (Signal Timeline, 05.04.2026)** + **Sprint 14 (TickerProfile + Słownik, 05.04.2026)** + **Sprint 15 (Backtest + BUY rule, 06.04.2026)** + **Sprint 16 (UTC fix + Options Flow UX, 06.04.2026)** + **Sprint 17 (Semi Supply Chain — observation layer, 09.04.2026)**. Analiza 2 tygodni (962 alertów, 55.5% hit rate) wykazała brak edge'u na sentymencie. Sprint 11: wyłączenie szumu, focus na insider pipeline. Sprint 12: migracja z Azure OpenAI gpt-4o-mini na **Anthropic Claude Sonnet** (bezpośrednio z NestJS, bez Azure VM pośrednika), panel Status Systemu na dashboardzie, fix parsowania 8-K (inline XBRL), hard delete 1585 alertów z wyłączonych reguł. **Sprint 15**: backtest 3 lat danych SEC EDGAR (43 946 transakcji, 61 tickerów), 6 hipotez z Welch's t-test + Cohen's d. Wynik: **insider BUY to jedyny silny edge** (d=0.43, p<0.001, potwierdzone vs dip baseline). Nowa reguła "Form 4 Insider BUY" (min $100K, C-suite ×1.3, healthcare ×1.2). Director SELL = hard skip (anty-sygnał, 68% cena rośnie). INSIDER_CLUSTER SELL → observation mode (DB only, no Telegram). **Sprint 17**: Semi Supply Chain — 14 nowych tickerów (MU, WDC, STX, KLIC, AMKR, ONTO, CAMT, NVMI, ASX, DELL, HPQ, HPE, SMCI, NTAP) w **observation mode** (DB only, brak Telegram). Ticker entity: kolumny `sector` + `observationOnly`. Alert entity: `nonDeliveryReason` (observation/silent_hour/daily_limit). Healthcare boost guard: `sector === 'healthcare'`. Plan: [doc/plan-semi-supply-chain.md](doc/plan-semi-supply-chain.md). **Aktywne kolektory**: SEC EDGAR (Form 4 + 8-K), Options Flow (Polygon EOD), PDUFA.bio. **Wyłączone**: StockTwits (0% edge), Finnhub news (HFT lag), sentiment pipeline (usunięty 22.04.2026 wraz z FinBERT sidecarem). **8 aktywnych reguł**: Form 4 Insider Signal, **Form 4 Insider BUY** (Sprint 15), 8-K Material Event GPT, 8-K Earnings Miss, 8-K Leadership Change, 8-K Bankruptcy, Correlated Signal, Unusual Options Activity (tylko z PDUFA boost). **12 wyłączonych reguł** (isActive=false w DB). **3 aktywne wzorce korelacji**: INSIDER_CLUSTER (2+ discretionary C-suite w 7d, **SELL = observation mode**), INSIDER_PLUS_8K (insider + 8-K w 24h), INSIDER_PLUS_OPTIONS (insider + opcje w 120h/5d). **Wyłączone wzorce**: FILING_CONFIRMS_NEWS, MULTI_SOURCE_CONVERGENCE, ESCALATING_SIGNAL (wymagały sentymentu). Form4Pipeline: filtr **discretionary only** (is10b51Plan=true → skip), **Director SELL → hard skip** (Sprint 15, backtest: anty-sygnał), **C-suite priorytet** (CEO/CFO/President/Chairman/EVP → boost priority), **BUY boosty** (C-suite ×1.3, healthcare ×1.2 — backtest-backed). **Observation mode gate** w Form4Pipeline, Form8kPipeline, AlertEvaluator, CorrelationService, OptionsFlowAlertService — tickery z `observationOnly=true` zapisują alert do DB z `delivered=false`, `nonDeliveryReason='observation'`, brak Telegramu. Pokrywa **wszystkie 5 ścieżek** wysyłki Telegram. Options scoring: **spike ratio > 1000 → suspicious, conviction ×0.5**. Options Flow API: filtr `expiry >= today` (wygasłe opcje ukryte). Options Flow CRON: `tz: 'UTC'` explicite (BullMQ). `getLastTradingDay()`: `getUTCDay()`/`setUTCDate()` (fix: serwer Europe/Warsaw powodował błędny dzień handlowy). 8-K Item 5.02 prompt: rozróżnienie **voluntary+successor vs crisis vs relief rally**. **priceAtAlert** naprawiony dla Correlated Signal, Form 4, 8-K (wcześniej NULL). SEC filingi: Claude Sonnet z per-typ promptami, Zod walidacja, Item 1.03 Bankruptcy → natychmiastowy CRITICAL. CorrelationService: Redis Sorted Sets, progi MIN_CONVICTION=0.05, MIN_CORRELATED_CONVICTION=0.20. Price Outcome Tracker: CRON co 1h (NYSE open), hard timeout 7d. System Logowania: @Logged() na ~15 metodach z `extractLogMeta()`, tiered cleanup (debug 2d / info 7d / warn+error 30d) o 03:00 UTC (`@Cron('0 3 * * *', { timeZone: 'UTC' })`), traceId propagacja. **Backtest**: `scripts/backtest/` — 6 hipotez na 3 latach SEC EDGAR Form 4, wyniki w `scripts/backtest/data/results/backtest_summary.md`. **Sprint 16 (10.04.2026, w toku — walidacja Sprint 15)**: P0.5 fix backtest-production mismatch — zawężenie do 28 healthcare overlap + soft delete 9 production-only tickerów (ALHC, CERT, CVS, CYH, DVA, GSK, HCAT, VEEV, WBA). Soft delete dla alertów: `alerts.archived` column + endpoint `POST /api/alerts/archive`. Wyniki walidacji w bloku 🎯 na górze pliku. **Monitorowane tickery**: 42 aktywne — **28 zwalidowanych healthcare + 14 semi supply chain (observation mode)** + 9 soft-deleted (`isActive=false`). Config: [doc/stockpulse-healthcare-universe.json](doc/stockpulse-healthcare-universe.json) + [doc/stockpulse-semi-supply-chain.json](doc/stockpulse-semi-supply-chain.json). Cel: **3-5 alertów/tydzień z realnym edge** (insider BUY, insider sell healthcare, PDUFA options, korelacje). **Sprint 16b interim (17.04.2026)**: C-suite whitelist (explicit, bez soft roles typu Comm/People/Diversity), C-suite SELL → observation mode (5dc2a36, V4 d=-0.002), dead handler usunięty (98b3741), Options Flow timeout 30s (d78a92f). **Sprint 17 P1 V5 backtest (18.04.2026)**: Director BUY boost ×1.15 (e07bbc2, V4 d=+0.59), H6 control group fix (e07bbc2 — usunięty top-level `is_healthcare==True` filter z `run_analysis`), H1 cluster_buy_vs_single_buy direct test (e07bbc2 + f69cfa8 regenerate po 3a319d7 mismatch). V5 wyniki: healthcare SELL zero edge, control SELL d=+0.10 30d Bonferroni ✓✓✓, cluster vs solo BUY p>0.37 wszystkie horyzonty. Ściąga backtest: [STOCKPULSE-CHEATSHEET-2026-04-17.md](doc/STOCKPULSE-CHEATSHEET-2026-04-17.md). Raporty tygodniowe: [doc/reports/](doc/reports/). Szczegółowy status: [doc/PROGRESS-STATUS.md](doc/PROGRESS-STATUS.md). **22.04.2026 FinBERT cleanup**: usunięty sidecar + sentiment pipeline + entities + 3 endpointy REST (szczegóły w Already resolved, ~2400 LoC).

## Komendy (Makefile — autodetekcja środowiska)

```bash
# Makefile automatycznie wykrywa: jetson (aarch64) / gpu (x86+nvidia) / cpu (x86)
make up              # start całego stacku
make down            # stop
make rebuild         # rebuild po zmianach kodu
make rebuild-app     # rebuild tylko backendu NestJS
make status          # status kontenerów + health check
make logs            # logi (follow)
make log S=app       # logi konkretnego serwisu
make seed            # seed bazy (tickery + reguły)
make backup          # backup bazy do backups/
make restore         # restore z najnowszego backupu
make stats           # statystyki bazy
make shell-app       # shell do kontenera app
make shell-db        # shell psql
make help            # lista komend
```

Alternatywnie docker compose bezpośrednio:

```bash
# Laptop / desktop (bazowy compose — po usunięciu FinBERT nie ma GPU overridów)
docker compose up -d

# Jetson (aarch64) — app /proc/sys binds + pgadmin wyłączony
docker compose -f docker-compose.yml -f docker-compose.jetson.yml up -d

# Weryfikacja
curl http://localhost:3000/api/health                     # status systemu
curl http://localhost:3000/api/health/stats                # totale per tabela
curl http://localhost:3000/api/sentiment/insider-trades    # transakcje insiderów (Form 4)

# Testy integracji API (Faza 0)
npm run test:all
```

## Setup

1. `cp .env.example .env` i uzupełnij klucze API
2. `make up` — start stacku (autodetekcja środowiska)
3. `make seed` — seed tickerów i reguł alertów
4. Otwórz `http://localhost:3001` — dashboard React

## Architektura

### Stan obecny (Sprint 11 — focus na edge)

Działający system end-to-end w 6 kontenerach Docker. Po Sprint 11 system skupia się na insider pipeline + PDUFA + korelacjach zamiast sentymentu.

1. **Warstwa zbierania danych** — 2 aktywne kolektory + 2 pomocnicze:
   - **SEC EDGAR** co 30 min (CRON `5,35 * * * *` UTC) — Form 4 (insider trades) + 8-K (material events). Eventy `NEW_INSIDER_TRADE` / `NEW_FILING`.
   - **Options Flow** (Polygon.io EOD) CRON 22:15 UTC — volume spike detection (3× avg20d). Event `NEW_OPTIONS_FLOW`.
   - **PDUFA.bio** co 6h (CRON `15 */6 * * *` UTC: 00:15/06:15/12:15/18:15) — kalendarz dat FDA. Event `NEW_PDUFA_EVENT`. Używany do PDUFA boost w options scoring.
   - **WYŁĄCZONE (Sprint 11)**: StockTwits (77% wolumenu, 0% edge), Finnhub news/MSPR (HFT lag), Reddit (placeholder). Schedulery StockTwits i Finnhub czyszczą repeatable jobs przy starcie (zero pustych jobów BullMQ). Finnhub `/quote` zachowany dla Price Outcome Tracker.
2. **Warstwa AI** — SEC Filing GPT Pipeline (bez sentymentu):
   - **Form4Pipeline** (`src/sec-filings/pipelines/form4.pipeline.ts`): GPT analiza insider trades. Filtr: **discretionary only** (is10b51Plan=true → skip), **C-suite priorytet** (CEO/CFO/President/Chairman/EVP → boost). Prompt z 30-dniową historią, sign convention SELL=ujemna/BUY=dodatnia, safety net post-GPT. Conviction [-2,+2] → [-1,+1] do CorrelationService.
   - **Form8kPipeline** (`src/sec-filings/pipelines/form8k.pipeline.ts`): GPT per-Item prompty (1.01/2.02/5.02/other). Item 5.02 prompt rozróżnia **voluntary+successor vs crisis vs relief rally**. Item 1.03 Bankruptcy → natychmiastowy CRITICAL bez GPT. Zod walidacja, daily cap 20/ticker/dzień.
   - **Options Flow Scoring** (`src/options-flow/`): heurystyczny scoring (bez GPT). Spike ratio > 1000 → suspicious, conviction ×0.5. PDUFA boost ×1.3 gdy event < 30 dni. Standalone alert **tylko z pdufaBoosted=true**.
   - **CorrelationService** (`src/correlation/`): **3 aktywne wzorce** — INSIDER_CLUSTER (2+ C-suite w 7d), INSIDER_PLUS_8K (insider + 8-K w 24h), INSIDER_PLUS_OPTIONS (insider + opcje w 120h/5d). Redis Sorted Sets. 3 wyłączone wzorce (wymagały sentymentu).
   - **Anthropic Claude Sonnet** (`AnthropicClientService`, SDK `@anthropic-ai/sdk`) — bezpośrednie wywołanie API z NestJS. Zastąpił Azure OpenAI gpt-4o-mini (Sprint 12). Provider alias: `AzureOpenaiClientService` → `AnthropicClientService` (zero zmian w pipeline'ach). Konfiguracja: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (domyślnie `claude-sonnet-4-6`). Azure VM (`74.248.113.3:3100`) na standby jako fallback.
   - **Pipeline observability (Tier 1)**: `system_logs` z 5 enriched kolumnami: `trace_id`, `parent_trace_id`, `level` (debug/info/warn/error), `ticker`, `decision_reason`. Decorator `@Logged()` z `extractLogMeta()` — automatyczna ekstrakcja metadata z args/result. Tiered cleanup: debug 2d, info 7d, warn+error 30d. traceId propagacja: SEC EDGAR (per filing + per trade), Options Flow, PDUFA.
   - **Price Outcome Tracker** (`src/price-outcome/`): priceAtAlert (Finnhub /quote) w momencie alertu. CRON co 1h price1h/4h/1d/3d (NYSE open only), `@Cron('0 * * * *', { timeZone: 'UTC' })`, hard timeout 7d. **Sloty liczone od otwarcia NYSE** (`getEffectiveStartTime()`) — alerty pre-market (Options Flow 22:15, SEC 7:00) mają 1h/4h od open 9:30 ET, nie od czasu alertu (fix: price1h ≠ price4h).
   - **AlertEvaluator**: 8 aktywnych reguł, 12 wyłączonych. Per-symbol daily limit 5 alertów. Throttling per (rule, symbol, catalyst_type). `onInsiderTrade()` ma early return (Sprint 11 — Insider Trade Large wyłączone, obsługiwane przez Form4Pipeline). **Granularne action values** (Tier 1): `ALERT_SENT_TELEGRAM`, `ALERT_TELEGRAM_FAILED`, `ALERT_DB_ONLY_OBSERVATION`, `ALERT_DB_ONLY_DAILY_LIMIT`, `ALERT_DB_ONLY_CLUSTER_SELL`, `ALERT_DB_ONLY_CSUITE_SELL`. `onSentimentScored` + 5 prywatnych checkerów + SILENT_RULES wycięte 22.04.2026 razem z FinBERT cleanup.
   - **USUNIĘTE (22.04.2026)**: FinBERT sidecar + sentiment pipeline (listener, processor, HTTP client, entities sentiment_scores/ai_pipeline_logs jako orphan tabele, backfill seed, 6 reguł sentymentowych w DB nadal jako isActive=false audit trail). Backtest Sprint 15 potwierdził zero edge na sentymencie — usunięcie zamyka 1337 LoC martwego kodu.
3. **Warstwa danych** — PostgreSQL z 12 aktywnymi entities (14 tabelami: `sentiment_scores` i `ai_pipeline_logs` orphan po FinBERT cleanup, zachowane dla historycznych danych do drop-migration w Sprint 18), w tym `options_flow`, `options_volume_baseline`, alerts z 7 polami price outcome + `archived` + `nonDeliveryReason`, system_logs z 5 kolumnami Tier 1. Redis dla kolejek BullMQ + Sorted Sets (korelacje) z password support. TypeORM z `synchronize: true` (constant, niezależny od NODE_ENV).
4. **Warstwa dostarczania** — Dashboard React (MUI 5 + Recharts) na :3001 z MUI Tabs (Dashboard + Signal Timeline + System Logs + Słownik). Panel Status Systemu (kolektory, błędy, pipeline). Signal Timeline (`/api/alerts/timeline`) — sekwencja sygnałów per ticker z deltami cenowymi, gap czasowym, conviction, zgodność kierunków. **Options Flow tabela** (Sprint 16): 8 kolumn (z 11), żywy DTE z `expiry`, kolumny połączone (Ticker+kierunek+typ, Strike/Cena/OTM, Volume/Spike), nowe: Kontrakty (clustering per ticker+sesja), Ekspozycja (szt + notional), Conviction z paskiem siły. Sortowanie domyślne po conviction desc. Filtr wygasłych opcji (frontend + backend). Signal Timeline: dropdown pokazuje wszystkie tickery z alertami (usunięto filtr `priceAtAlert IS NOT NULL` i `HAVING COUNT >= 2`). **System Logs (Tier 1)**: 3 nowe kolumny (Level chip, Ticker mono, Decision Reason z kolorowymi chipami), 2 filtry (level dropdown, ticker input), trace_id w rozwinięciu wiersza z copy-to-clipboard. Alerty Telegram po polsku. REST API (31 endpointów, w tym 3 za `ApiTokenGuard`: trace, ticker, decisions) na :3000.

### Stack technologiczny

- **Backend**: NestJS 10, TypeORM, BullMQ, EventEmitter2, Node.js 20, TypeScript 5.x
- **Frontend**: React 18, Recharts 3.7, MUI 5 (dark theme), Vite 4
- **AI/NLP**: **Anthropic Claude Sonnet** (SDK `@anthropic-ai/sdk`, bezpośrednio z NestJS — zastąpił Azure OpenAI gpt-4o-mini w Sprint 12). FinBERT sidecar usunięty 22.04.2026 (Sprint 15 backtest: zero edge na sentymencie).
- **Infra**: Docker Compose (5 kontenerów: app, frontend, postgres, redis, pgadmin — pgadmin wyłączony na Jetsonie przez `profiles: [pgadmin]`), PostgreSQL 16 + TimescaleDB, Redis 7, serwer produkcyjny (autostart z git pull). Azure VM (74.248.113.3:3100) na standby jako fallback LLM.

### Usługi i porty

| Usługa | Port | URL |
|--------|------|-----|
| NestJS API | 3000 | http://localhost:3000/api/ |
| Frontend React | 3001 | http://localhost:3001/ |
| pgAdmin | 5050 | http://localhost:5050/ |
| PostgreSQL | 5432 | — |
| Redis | 6379 | — |

### Monitorowane sektory

- **Healthcare** (core): [doc/stockpulse-healthcare-universe.json](doc/stockpulse-healthcare-universe.json) — 37 tickerów (wg podsektora), 201 słów kluczowych, 18 subredditów, 20 reguł alertów (8 aktywnych, 12 wyłączonych). Backtest-backed edge (insider BUY d=0.43).
- **Semi Supply Chain** (observation mode): [doc/stockpulse-semi-supply-chain.json](doc/stockpulse-semi-supply-chain.json) — 14 tickerów w 3 koszykach: Memory Producers (MU, WDC, STX), Equipment & Packaging (KLIC, AMKR, ONTO, CAMT, NVMI, ASX), OEM Anti-Signal (DELL, HPQ, HPE, SMCI, NTAP). Alerty zapisywane do DB z `delivered=false`, `nonDeliveryReason='observation'` — brak Telegramu dopóki backtest nie potwierdzi edge'u. Plan: [doc/plan-semi-supply-chain.md](doc/plan-semi-supply-chain.md).

### Dokumentacja szczegółowa

- **Status projektu i plan**: [doc/PROGRESS-STATUS.md](doc/PROGRESS-STATUS.md)
- **Struktura plików**: [doc/schematy.md](doc/schematy.md)
- **Architektura (wizualizacja)**: [doc/stockpulse-architecture.jsx](doc/stockpulse-architecture.jsx)
- **Raporty tygodniowe**: [doc/reports/](doc/reports/) — analizy systemu z danymi z bazy
- **Changelog zmian**: [doc/reports/2026-03-14-zmiany.md](doc/reports/2026-03-14-zmiany.md) — ostatnie zmiany z uzasadnieniem

### Ważne konwencje danych

- **insider_trades.transactionType**: pełne słowa (`SELL`, `BUY`, `EXERCISE`, `TAX`, `GRANT`, `OTHER`), NIE kody SEC (`P`, `S`). Zawsze filtruj po pełnych słowach.
- **insider_trades.is10b51Plan**: `true` = automatyczny plan sprzedaży (szum, **skipowane w Form4Pipeline od Sprint 11**), `false` = discretionary (realny sygnał insiderski).
- **C-suite detection** w Form4Pipeline: regex na insiderRole — CEO, CFO, COO, CMO, CTO, President, Chairman, EVP, Chief, Executive Vice → boost priority.
- **Options flow spikeRatio > 1000**: flaga suspicious, conviction ×0.5 (anomalia danych Polygon, np. MRNA 5032×).
- **priceAtAlert**: od Sprint 11 zapisywany dla WSZYSTKICH typów alertów (Correlated Signal, Form 4, 8-K, Options). Wcześniej NULL dla 120+ alertów/2tyg.
- **tickers.sector**: `'healthcare'` (domyślny) lub `'semi_supply_chain'`. Używany do healthcare boost guard w Form4Pipeline (`sector === 'healthcare'` → ×1.2).
- **tickers.observationOnly**: `true` = alert zapisywany do DB ale NIE wysyłany na Telegram. Observation gate w Form4Pipeline, Form8kPipeline, AlertEvaluator.
- **alerts.nonDeliveryReason**: `'observation'` / `'silent_hour'` / `'daily_limit'` / `'csuite_sell_no_edge'` / `null`. Rozróżnia powód `delivered=false` — krytyczne dla forward analysis i backtestów. `'csuite_sell_no_edge'` dodane w Sprint 16b #2 (V4 backtest: H2 SINGLE_CSUITE SELL d=-0.002 p=0.95 → zero edge).

## Multi-środowisko: Laptop ↔ Jetson

Projekt działa na dwóch maszynach. Kod jest wspólny (git), konfiguracja osobna per maszynę.

### Środowiska

Po usunięciu FinBERT sidecara (22.04.2026) wszystkie maszyny używają identycznego
backendu Node.js — różnice ograniczają się do bindów Jetsona (`/proc`, `/sys`) i
profili pgAdmin.

| Środowisko | Architektura | Compose |
|------------|-------------|---------|
| **Laptop / desktop** | x86_64 | `docker-compose.yml` (bazowy) |
| **Jetson Orin NX** | aarch64 | `docker-compose.yml` + `docker-compose.jetson.yml` (app /proc /sys binds, pgadmin wyłączony) |

### Workflow

```
Laptop WSL2 (dev) ──git push──→ GitHub ──git pull──→ Serwer prod (192.168.0.138, autostart po reboot)
                                                  └→ Azure VM (74.248.113.3, PM2: processor.js + api.js)
```

- **Rozwijasz kod na laptopie**, commitujesz, pushujesz
- **Jetson po restarcie** automatycznie robi `git pull` + `make up` (crontab @reboot, skrypt `scripts/autostart.sh`)
- `.env` jest **gitignored** — każda maszyna ma swoje klucze API
- `make up` / `make rebuild` — Makefile sam wykrywa środowisko po `uname -m`

### Transfer bazy między maszynami

```bash
# Na źródłowej maszynie
make backup
scp backups/stockpulse_*.dump user@<cel-ip>:~/stockPulse/backups/

# Na docelowej maszynie
make restore
```

### Dokumentacja Jetson

Pełna dokumentacja setupu Jetsona: [doc/JETSON-SETUP.md](doc/JETSON-SETUP.md)

## Zmienne środowiskowe

Patrz `.env.example`. Plik `.env` jest **gitignored** — osobny na każdej maszynie.

Główne grupy:
- **Reddit**: OAuth2 (client ID, secret, username, password)
- **Finnhub**: klucz API (free tier, 60 req/min)
- **SEC EDGAR**: User-Agent z emailem (bez klucza, 10 req/sec)
- **Anthropic**: klucz API (`ANTHROPIC_API_KEY`) — **wymagany** dla SEC Filing Pipeline (Claude Sonnet). Opcjonalnie: `ANTHROPIC_MODEL` (domyślnie `claude-sonnet-4-6`), `ANTHROPIC_TIMEOUT_MS` (domyślnie 30000)
- **Polygon.io**: `POLYGON_API_KEY` — opcjonalny (Options Flow collector)
- **Azure Analysis Service**: URL do VM z gpt-4o-mini + timeout (legacy fallback — nieaktywne od Sprint 12, VM na standby)
- **Telegram**: token bota + chat ID do alertów
- **StockTwits**: publiczne endpointy, bez autoryzacji (200 req/hour)
- **Admin API**: `ADMIN_API_TOKEN` — opcjonalny, wymagany dla `/api/system-logs/trace`, `/api/system-logs/ticker`, `/api/system-logs/decisions`
- **Bazy danych**: konfiguracja PostgreSQL i Redis (z opcjonalnym `REDIS_PASSWORD`)

dev tak sie uruchamia 

wsl -d Ubuntu bash -c "cd /home/n1copl/stockPulse && docker compose up -d 2>&1 | tail -20"

## Sprint 16 P0 fixes completed (17.04.2026)

Commits c2d8ae9..7fe870b, szczegóły: [HANDOFF-CODE-REVIEW-2026-04-16.md](doc/HANDOFF-CODE-REVIEW-2026-04-16.md)
- FLAG #30: Form 4 multi-reportingOwner parser (mergeOwnerRoles + pure Director SELL)
- FLAG #25: disable broken PriceOutcome backfill (getQuote current price ≠ historical)
- FLAG #21: winsorize options baseline (spike contamination, camouflage effect)
- FLAG #8: bankruptcy detection before daily cap (Item 1.03 nie wymaga GPT)
- FLAG #26: NYSE holidays 2024-2027 (isNyseHoliday w isNyseOpen)
- FLAG #10: AlertDeliveryGate shared daily limit (4 pipelines, bankruptcy exempt)

## Sprint 16b interim fixes (17.04.2026, po decyzji 17.04)

Action items po analizie 24h logów produkcji — briefing "Post Sprint 16 action items".
- #3 AlertEvaluator.onInsiderTrade: dead handler usunięty (Sprint 11 przeniósł logic do Form4Pipeline, handler generował SKIP_RULE_INACTIVE spam 12×/dobę)
- #4 OptionsFlow: AbortSignal.timeout 30s na Polygon fetchach (17.04 produkcja: runCollectionCycle duration=11h 25min bez timeout — analogiczne do FLAG #28)
- #7 8-K pipeline: diagnoza bez zmian kodu — SKIP_NOT_8K w logach to Form 4/3 filingi (poprawne), 8-K pipeline działa (2 real 8-K/7 dni = post-earnings low activity, nie bug)
- #1 Form4Pipeline C-suite whitelist: `/\bChief\b/i` zastąpione explicit whitelist (soft roles Comm/People/Diversity/Marketing/Sustainability wyłączone). 17.04 "Chief Communications Officer" dostawał ×1.3 boost i Telegram alert — noise. Chief Medical Officer ZOSTAJE (healthcare critical), Chief Marketing Officer WYŁĄCZONY (decyzja Przemka).
- #2 Form4Pipeline C-suite SELL → observation mode: V4 backtest potwierdził zero edge (H2 SINGLE_CSUITE all_sells N=855 d=-0.002 p=0.95). Route do DB-only z `nonDeliveryReason='csuite_sell_no_edge'`, action `ALERT_DB_ONLY_CSUITE_SELL`. GPT analysis zachowana dla forward validation (DB record ma conviction + priceAtAlert). C-suite BUY dalej idzie na Telegram (d=0.83 vs baseline, 1.3× boost).

## Sprint 17 P1 research (18.04.2026, mierzalne)

- #1 Form4Pipeline Director BUY boost ×1.15: V4 potwierdził d=0.59 dla Director BUY
  (mniejsze niż C-suite d=0.83 ×1.3, ale wyraźny sygnał). Kumulatywne z healthcare
  ×1.2 (Dir hc BUY = ×1.38). C-suite priorytet w co-filing (albo/albo, nie stack).
- #2 Backtest control group fix: usunięty top-level `is_healthcare==True` filter
  z `run_analysis`. H1-H5 filtrują healthcare per-hypothesis (tx_df_hc), H6 używa
  pełnego tx_df (healthcare + control). Bez tego H6 miał 0 control events — teraz
  faktyczny sector-specific edge test możliwy.
- #3 H1 cluster vs single BUY: nowa sub-analiza w analyze_h1_clusters —
  direct Welch's t-test cluster BUY vs non-cluster single BUY (unique_insiders<2
  w 7d forward window). Odpowiada "czy warto czekać na drugiego insidera".
  Funkcje: `_collect_single_buy_events`, `_direct_cluster_vs_single`. 7 testów
  jednostkowych w `tests/test_analyzer.py`.

## Scheduler consolidation (22.04.2026)

Konsolidacja wszystkich zaplanowanych zadań — eliminacja niedeterministycznego dryfu po restarcie + rozkład slotów żeby uniknąć jednoczesnego startu 3 kolektorów.

**Audyt**: 2 `@Cron` (nestjs/schedule) + 3 aktywne `BullMQ repeatable` (sec-edgar, pdufa-bio, options-flow) + 3 wyłączone schedulery (finnhub, stocktwits — cleanup-only po Sprint 11; reddit — placeholder). Zmiany:

- **timeZone UTC w `@Cron` (48caf0b)**: `price-outcome.service.ts:49` i `system-log.service.ts:144` używały TZ serwera (laptop CEST / Jetson UTC / prod różne). Explicit `{ timeZone: 'UTC' }` zapewnia spójność.
- **every:ms → cron pattern (ee14a5f)**: BullMQ `every: N ms` dryfował od momentu startu (restart o 08:17 → odpala :47, :17...). Fix: `sec-edgar` pattern `0,30 * * * *` UTC, `pdufa-bio` pattern `0 */6 * * *` UTC. Deterministyczny timing.
- **5-min stagger (de11193)**: po migracji sec-edgar/pdufa-bio lądowały na :00 — kolizja z `price-outcome` (hourly). Rozkład:
  - `:00` — price-outcome (Finnhub /quote)
  - `:05`, `:35` — sec-edgar (co 30 min, pattern `5,35 * * * *`)
  - `:15` — pdufa-bio (co 6h, pattern `15 */6 * * *`)
  - `03:00` — system-log cleanup (daily)
  - `16:30 America/New_York` — options-flow (DST-aware, bez kolizji z UTC slotami)

SEC rate limit zweryfikowany: `sec-edgar.service.ts:68` 200ms delay per ticker (sekwencyjnie, ~4-5 req/s vs limit 10), User-Agent z emailem wymuszany przez Joi (`env.validation.ts:30`).

## Produkcyjny 10b5-1 parser (status OK, zweryfikowano 17.04)

`form4-parser.ts:148-152` używa **per-transaction** XML path `txn.transactionCoding?.['Rule10b5-1Transaction']` + strict value match ('1' albo 'Y'). NIE jest naive string detection (odróżnia się od V3 Python FLAG #34). 4 testy jednostkowe pokrywają edge cases ('1', 'Y', pusty string, brak tagu).

## Known issues NOT yet fixed (priorytet Sprint 18)

- FLAG #41-43: Python backtest — baseline sampling uniform per-ticker (#42 skipped w HANDOFF #2), inne nierozstrzygnięte
- Sprint 18 candidates post-V5: INSIDER_CLUSTER BUY disable (V5 cluster vs solo p>0.37), C-suite regex ujednolicenie (`form4.pipeline.ts:119` `/\bChief\b/` vs linia 240 `isCsuiteRole()`), d=None bug w `_direct_cluster_vs_single` (JSON zapisuje None zamiast wyliczonych wartości), report_generator nie renderuje `hc_vs_ctrl_direct` ani `cluster_buy_vs_single_buy` (sekcje w JSON, brak w markdown)

## Already resolved (Sprint 16b + Sprint 17 P1)

- FLAG #30 multi-owner parser: fixed (TypeScript mergeOwnerRoles, Python eabdb06)
- FLAG #32 Cohen's d biased: fixed (ac503d7 proper pooled formula + winsorization)
- FLAG #34 naive 10b5-1 detection (Python): fixed (eabdb06 per-transaction); produkcyjny TS parser OK
- FLAG #35 10b5-1 per-transaction: fixed (eabdb06)
- FLAG #37 brak Bonferroni: fixed (d7a86d6)
- FLAG #40 H6 niewymienne baselines: fixed (d7a86d6 common baseline + e07bbc2 control fix)
- FLAG #28 SEC EDGAR fetch bez timeout: fixed (7e63d9d AbortSignal.timeout 30s na fetchUrl + fetchText, analogicznie do Options Flow d78a92f)
- Scheduler consolidation: fixed (48caf0b timeZone UTC w @Cron, ee14a5f every:ms → cron pattern dla sec-edgar+pdufa-bio, de11193 5-min stagger :00/:05/:15). Eliminuje dryf po restarcie i kolizje o :00 UTC.
- FinBERT + sentiment pipeline removal (22.04.2026): fixed (988bf03 docker-compose + Makefile, ba45976 sentiment services + test, d3a1b5c cross-module + env, b3a2f2b entities + API, 4b117db finbert-sidecar dir). Backtest Sprint 15 potwierdził zero edge na sentymencie (2 tygodnie × 962 alerty × 55.5% hit rate). Usunięto: kontener FinBERT, 3 compose services/volumes, cpu.yml override, 3 Makefile targets, FINBERT_SIDECAR_URL env, FinbertClient + SentimentListener + SentimentProcessor + test, 5 checkerów sentymentowych w AlertEvaluator, SILENT_RULES, EventType.SENTIMENT_SCORED, QUEUE_NAMES.SENTIMENT, SignalDirection, 6 metod telegram-formatter, 2 entities + exports, 3 endpointy REST, 4 sekcje weekly-report SQL, pipelineStats w system-overview, backfill-sentiment seed, finbert-sidecar/ (7 plików Python/Docker). Łącznie ~2400 LoC usunięte z repo. Tabele `sentiment_scores` + `ai_pipeline_logs` zachowane jako orphan (historyczne dane, drop-migration w Sprint 18).

## System totals (22.04.2026, po FinBERT cleanup)

42 tickery aktywne (28 healthcare + 14 semi observation) + 9 soft-deleted, **29 REST endpoints** (po usunięciu /api/sentiment/scores, /pipeline-logs, /:ticker), **12 TypeORM entities** (było 14 — usunięte SentimentScore, AiPipelineLog; tabele orphan do drop-migration w Sprint 18), **7 BullMQ queues** (było 8 — usunięty SENTIMENT), **8 active alert rules** (w tym Form 4 Insider BUY z Director ×1.15 boost post-Sprint 17 P1), 12 disabled rules (w tym 6 sentiment rules — audit trail, isActive=false), **17 @Logged methods** (było 22 — 5 usunięte razem z sentiment handlers). C-suite + Director SELL w observation mode (V4+V5 backed). Backtest V5 (f69cfa8): 128 testów (threshold p<0.000391), 19 Bonferroni ✓, healthcare SELL zero edge, control SELL d=+0.10 30d ✓✓✓, cluster vs solo BUY p>0.37.