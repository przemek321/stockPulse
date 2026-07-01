# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Dokumentacja i komentarze w tym projekcie piszemy po polsku.**

> Ten plik = **„jak system działa teraz"**. Historia „jak doszliśmy" (sprinty, FIX-XX,
> TASK-XX, commit-by-commit): [doc/CHANGELOG.md](doc/CHANGELOG.md) + `git log` + pliki `doc/SESJA-*`.

## Stan obecny (czerwiec 2026) — faza walidacji forward 7d

System przeszedł **Pakiet 1 + Pakiet 2** (09-15.06, edge fixes + discovery; szczegóły:
[CHANGELOG](doc/CHANGELOG.md)). Forward-ocena 09.06 wykazała **netto 0% edge na alertach
all-time**; jedyny potwierdzony edge to **Form 4 Insider BUY** (backtest V5 d=+0.92 C-suite 7d).
Cel zrewidowany: **1 alert/tydzień z realnym edge** (precyzja > wolumen).

**TERAZ czekamy na dane** — okno obserwacyjne mierzy outcome na horyzoncie **7d** (na nim
backtest pokazuje edge; pomiar 3d zaniżał). Nic do wdrażania bez nowych danych. Kalendarz
decyzyjny (przypominany w raporcie 8h, `VALIDATION_CALENDAR` w summary-scheduler):

| Data | Przegląd |
|---|---|
| 09.07 | APLS Faza 4 (≥6 BUY, hit 7d ≥60%, alpha ≥+2%) |
| 25.07 | Okno obs discovery → decyzja delivery top-N |
| 25.08 | FIX-16 shadow review (N≥3 would_uncap) |
| ~01.09 | Werdykt „czy system ma edge" (~20-30 alertów z 7d) |
| 07.09 | Bullish-8K gate revisit (90d) |

Pierwsze obserwacje w toku: EYE, SMMT, COR (discovery) + 6 APLS — alerty DB-only, mierzone, NIE na
Telegram. Wiążące definicje metryk (hit=raw, alpha osobno) pre-zarejestrowane 02.07 w
[KALENDARZU](doc/KALENDARZ-WALIDACJI-2026.md).

## Opis projektu

StockPulse wykrywa edge na rynku akcji healthcare z alertami Telegram. Monitoruje insiderów
(SEC EDGAR Form 4), zdarzenia korporacyjne (8-K), daty FDA (PDUFA.bio). Koreluje sygnały
(insider×8-K) i alertuje tylko przy realnym edge. Działa end-to-end w kontenerach Docker
na serwerze produkcyjnym (Jetson Orin NX, autostart z git pull) + laptop dev.

## Komendy (Makefile — autodetekcja środowiska jetson/gpu/cpu)

```bash
make up / down / rebuild      # start / stop / rebuild po zmianach
make rebuild-app              # rebuild tylko backendu NestJS (po commicie kodu na prod)
make status / logs            # status kontenerów + health / logi (follow)
make log S=app                # logi konkretnego serwisu
make seed                     # seed bazy (tickery + reguły)
make backup / restore         # backup do backups/ / restore z najnowszego
make shell-app / shell-db     # shell do kontenera / psql
```

Dev (WSL): `wsl -d Ubuntu bash -c "cd /home/n1copl/stockPulse && docker compose up -d"`
Jetson: `docker compose -f docker-compose.yml -f docker-compose.jetson.yml up -d`
Weryfikacja: `curl http://localhost:3000/api/health` (+`/health/stats`). Testy: `npx jest test/unit` (~709), `npx tsc --noEmit`.

## Setup

1. `cp .env.example .env` i uzupełnij klucze API
2. `make up` (autodetekcja środowiska) → `make seed` → dashboard `http://localhost:3001`

## Architektura

End-to-end w 6 kontenerach Docker (app, frontend, postgres+TimescaleDB, redis, pgadmin — pgadmin off na Jetsonie).

### 1. Kolektory

- **SEC EDGAR** core — Form 4 + 8-K dla tickerów z uniwersum. CRON `5,35 * * * *` UTC (co 30 min).
  Eventy `NEW_INSIDER_TRADE` / `NEW_FILING`. Rate limit 200ms/ticker (~4-5 req/s vs limit 10).
- **Form4 Discovery** (Pakiet 2) — event-driven screening WSZYSTKICH Form 4 z rynku
  (`src/collectors/form4-discovery/`). Poll atom getcurrent co 5 min (`2-57/5 6-22 ET pn-pt`,
  stagger +2 min vs core :05/:35) + nightly reconciliation daily-index 22:40 ET. Pre-filter:
  SIC healthcare/biotech → discretionary BUY ≥$500K C-suite/Director (role-only) → mcap ≥$250M
  + ADV ≥$1M → auto-rejestracja `sector='healthcare_discovery'`, observation mode.
- **PDUFA.bio** — **WYŁĄCZONY 21.06** (c65a7cb): upstream przepisany na client-side render →
  HTTP 404 dla scrapera. Dane `pdufa_catalysts` nieodświeżane od 19.06 (ostatnia przyszła
  data: VERA 07.07 — potem sekcja PDUFA w raporcie 8h pusta). Decyzja do podjęcia:
  nowy parser (headless/API) albo sunset.
- **WYŁĄCZONE**: Options Flow (CRON off 10.06 — 6h zombie cycle/dzień, noga korelacyjna
  redundantna; kod/dane/API zostają, odwracalne. Scoring uśpiony, przy re-enable pamiętaj:
  **spike ratio >1000 → suspicious, conviction ×0.5** anomalia Polygona; PDUFA boost ×1.3 gdy
  event <30d; standalone options alert TYLKO z `pdufaBoosted=true`), StockTwits (0% edge),
  Finnhub news (HFT lag), sentiment pipeline (usunięty 22.04 z FinBERT sidecarem). Finnhub
  `/quote` zachowany dla Price Outcome.

### 2. Pipeline'y AI (Anthropic Claude Sonnet, bezpośrednio z NestJS)

- **Form4Pipeline** (`src/sec-filings/pipelines/form4.pipeline.ts`) — decision tree (~9 kroków,
  udokumentowany inline): plan 10b5-1 → skip; pure Director SELL → `SKIP_DIRECTOR_SELL`;
  non-role SELL → `SKIP_NON_ROLE_SELL`; observation ticker → skip PRZED GPT (wyjątek:
  `biotech_apls` + `healthcare_discovery` przechodzą przez GPT, BUY-only ≥$500K, dispatch
  DB-only observation, storeSignal skip na sektorze; `semi_supply_chain` = skip PRZED GPT
  **bez wiersza w alerts** — ta kohorta nie gromadzi danych obserwacyjnych); KAŻDY SELL
  (w tym C-suite) → `sell_no_edge` (enum `csuite_sell_no_edge` jest martwy — flaga
  `isCsuiteSellObservation` w dispatcherze nie ma settera; audyt 02.07).
  **BUY boosty** (backtest-backed): C-suite ×1.3 / Director ×1.15, healthcare/apls/discovery ×1.2,
  apls strict ×1.1. Floor priority MEDIUM dla Director BUY ≥$100K (GPT nie wetuje). Multi-tx
  aggregation (TASK-03). `sell_no_edge` → SKIP storeSignal (correlation backdoor FIX-07).
- **Form8kPipeline** — GPT per-Item (1.01/2.02/5.02/other). Item 1.03 Bankruptcy → CRITICAL bez GPT.
  Item 2.02: fetch Exhibit 99.1 + doklejenie PO `extractItemText` (FIX-10b boundary), consensus
  injection + gap guard (FIX-12), missing-data guard (FIX-01), FIX-16 shadow, **bullish gate**
  (P1-02: bullish poza udokumentowanym beatem 2.02-R4 → observation). Limit tekstu `MAX_TEXT_LENGTH`=50k,
  daily cap **20 GPT/ticker/dzień** (`DailyCapService`).
- **CorrelationService** — 3 wzorce z oknami (audyt 02.07: wszystkie de facto MARTWE —
  cisza korelacji to artefakt architektury, nie throttle): INSIDER_CLUSTER strukturalnie
  martwy (BUY disabled TASK-09, a SELL nie zasila Redis od FIX-07 — detektor nigdy nie ma
  2 sygnałów); INSIDER_PLUS_8K ~martwy (okno **24h** liczone po czasie INGESTII w storeSignal,
  a mediana latencji Form 4 = 69h); INSIDER_PLUS_OPTIONS martwy po options off (**120h/5d**).
  Redis Sorted Sets, progi `MIN_CONVICTION=0.05` / `MIN_CORRELATED_CONVICTION=0.20`.
  `detectDirectionConflict` (FIX-05). PATTERN_THROTTLE 72h dla 8K/OPTIONS.
- **AlertDispatcherService** (`src/alerts/alert-dispatcher.service.ts`) — centralny dispatch,
  `@Logged('alerts')`. **Priority order suppression**: observation > gpt_missing_data >
  consensus_* > bullish_8k > direction_conflict > sell_no_edge > csuite_sell_no_edge >
  cluster_sell_no_edge > silent_rule > daily_limit. AlertDeliveryGate: **5 alertów/symbol/dzień**
  (`MAX_TELEGRAM_ALERTS_PER_SYMBOL_PER_DAY`), `bypassDailyLimit` dla bankruptcy + options.
  Ping Telegram dla `observation` (krótka notka, alert zostaje DB-only).
- **Price Outcome Tracker** (`src/price-outcome/`) — `priceAtAlert` PRZED dispatch (cena wejścia
  w Telegramie). CRON co 1h, sloty `price1h/4h/1d/3d/7d` + XBI/IBB benchmark (sector-adjusted alpha,
  beta=1.0). Hard timeout 11d. Sloty liczone od otwarcia NYSE (`getEffectiveStartTime` — alerty
  pre-market/nocne kotwiczone na 9:30 ET; S20-T06 fix dla okna 00-04 UTC).
- **Tier 1 observability**: `system_logs` z `trace_id`/`level`/`ticker`/`decision_reason`.
  `@Logged()` + `extractLogMeta()`. Tiered cleanup (debug 2d / info 7d / warn+error 30d) 03:00 UTC.

### 3. Dane i dostarczanie

- **PostgreSQL** 12 entities: `alerts` (price outcome 1h-7d + xbi/ibb + `archived` + `nonDeliveryReason`),
  `insider_trades`, `sec_filings` (`gptAnalysis` JSONB), `tickers` (`sector`/`observationOnly`),
  `system_logs` (5 kolumn Tier 1), `options_flow`. **Redis**: BullMQ + Sorted Sets (korelacje) +
  namespace `disc:` (discovery seen/sic-cache). TypeORM `synchronize: true`.
- **Dashboard React** (MUI 5) na :3001 — Tabs: Dashboard / Signal Timeline / System Logs / Słownik.
  PriceOutcomePanel z kolumnami +7d/α7d. Observation alerty przytłumione (`PriorityChip` outlined).
  **REST API ~31 endpointów** na :3000 (3 za `ApiTokenGuard`). Alerty Telegram po polsku.
- **Raport 8h** (SummaryScheduler): breakdown alertów + `nonDeliveryReason` PL + sekcja
  „🔭 Nowe obserwacje" + „📅 Kalendarz walidacji".

### Stack

NestJS 10 / TypeORM / BullMQ / Node 20 / TS 5.x; React 18 / Vite 4 / MUI 5; Anthropic Claude
Sonnet (`@anthropic-ai/sdk`); Docker Compose, PostgreSQL 16 + TimescaleDB, Redis 7.

### Porty

NestJS API `:3000` · Frontend `:3001` · pgAdmin `:5050` · PostgreSQL `:5432` · Redis `:6379`

### Monitorowane sektory

- **Healthcare** (core, delivery): [doc/stockpulse-healthcare-universe.json](doc/stockpulse-healthcare-universe.json) — 28 zwalidowanych tickerów.
- **biotech_apls** (observation): 6 tickerów (URGN/ARDX/MNKD/CRSP/AXSM/RCKT), [doc/stockpulse-biotech-apls.json](doc/stockpulse-biotech-apls.json).
- **semi_supply_chain** (observation): 14 tickerów, [doc/stockpulse-semi-supply-chain.json](doc/stockpulse-semi-supply-chain.json).
- **healthcare_discovery** (observation, auto-rejestracja Pakiet 2): rośnie z rynku (EYE, SMMT, COR...).

## Ważne konwencje danych (PUŁAPKI — czytaj przed pisaniem kodu)

- **insider_trades.transactionType**: pełne słowa (`SELL`, `BUY`, `EXERCISE`, `TAX`, `GRANT`, `OTHER`), NIE kody SEC (`P`, `S`). Zawsze filtruj po pełnych słowach.
- **insider_trades.is10b51Plan**: `true` = plan (szum, skip), `false` = discretionary (sygnał). Źródło prawdy: **doc-level `<aff10b5One>`** w XML (NIE per-transaction tag — ten nie występuje w realnych filingach; fix P1-00 09.06).
- **C-suite detection** (`isCsuiteRole`): whitelist CEO/CFO/COO/CTO/CMO/CSO/CLO/CIO + President/Chairman/EVP — **role-only WSZĘDZIE**; parametr `name` usunięty 02.07.2026 („Harvard hole": entity z „President"/„CSO" w nazwie matchowało wzorce; ścieżka boost BUY miała tę dziurę do 02.07 — starsze alerty mogą nosić skażony priorytet, atrybucję ról w analizach licz z `insider_trades.insiderRole`).
- **priceAtAlert**: zapisywany dla WSZYSTKICH alertów, **PRZED dispatch** (cena wejścia w Telegramie).
- **tickers.sector**: `healthcare` / `biotech_apls` / `healthcare_discovery` / `semi_supply_chain`. Healthcare-class → boost ×1.2.
- **tickers.observationOnly**: `true` = alert do DB, NIE na Telegram. Gate w Form4/Form8k/AlertEvaluator/Correlation. WYJĄTEK: `semi_supply_chain` skipowany PRZED GPT bez wiersza w alerts — obserwacja bez danych (apls/discovery mają alerty DB-only).
- **alerts.nonDeliveryReason**: `observation` / `gpt_missing_data` / `consensus_*` / `bullish_8k_no_edge` / `bullish_no_consensus_data` / `direction_conflict` / `sell_no_edge` / `csuite_sell_no_edge` (martwy — nigdy nie występuje, patrz Form4Pipeline) / `cluster_sell_no_edge` / `daily_limit` / `telegram_failed` / `null`. Krytyczne dla forward analysis. PUŁAPKA: priorytet suppression maskuje powody — byczy 8-K z missing-data ląduje w `gpt_missing_data`, nie `bullish_*`; w analizach gate'ów filtruj też po `alertDirection`.
- **Sektorowa alpha**: surowy priceChange miesza edge alertu z beta biotechu — uczciwa metryka to `xbiAlpha`/`ibbAlpha` (vs XBI, fallback IBB).
- **Pomiar outcome na 7d** (nie 3d) — backtest pokazuje edge na 7d, 3d zaniża.

## Multi-środowisko: Laptop ↔ Jetson

Kod wspólny (git), `.env` osobny per maszyna (gitignored). Laptop dev → `git push` → Jetson prod
(`git pull` + `make up`, autostart @reboot). **Po commicie KODU na Jetsonie: `make rebuild-app`**
(commit ≠ produkcja). Transfer bazy: `make backup` + scp + `make restore`. Makefile sam wykrywa
środowisko po `uname -m`. Pełny setup Jetsona: [doc/JETSON-SETUP.md](doc/JETSON-SETUP.md).

## Zmienne środowiskowe

Patrz `.env.example` (gitignored). Główne:
- **Anthropic**: `ANTHROPIC_API_KEY` (wymagany), `ANTHROPIC_MODEL` (domyślnie `claude-sonnet-4-6`), `ANTHROPIC_TIMEOUT_MS`.
- **SEC EDGAR**: `SEC_USER_AGENT` (email, bez klucza, 10 req/s).
- **Finnhub**: klucz API (free 60 req/min) — `/quote` price outcome + discovery mcap/ADV.
- **Alpha Vantage**: `ALPHA_VANTAGE_API_KEY` (free 25/dzień — consensus FIX-12), `CONSENSUS_TIMEOUT_MS`.
- **Polygon.io**: `POLYGON_API_KEY` (options collector — CRON off, klucz dla ewentualnego re-enable).
- **Telegram**: token bota + chat ID. **Admin API**: `ADMIN_API_TOKEN` (3 endpointy system-logs).
- **Bazy**: PostgreSQL + Redis (opcjonalny `REDIS_PASSWORD`).

## Dokumentacja szczegółowa

- **Historia zmian**: [doc/CHANGELOG.md](doc/CHANGELOG.md)
- **Status i plan**: [doc/PROGRESS-STATUS.md](doc/PROGRESS-STATUS.md) · **Struktura plików**: [doc/schematy.md](doc/schematy.md)
- **Plan edge + walidacja**: [doc/PLAN-EDGE-IMPROVEMENTS-2026-06-09.md](doc/PLAN-EDGE-IMPROVEMENTS-2026-06-09.md) · [doc/KALENDARZ-WALIDACJI-2026.md](doc/KALENDARZ-WALIDACJI-2026.md)
- **Backtest**: `scripts/backtest/` (6 hipotez, 3 lata Form 4) · ściąga [doc/STOCKPULSE-CHEATSHEET-2026-04-17.md](doc/STOCKPULSE-CHEATSHEET-2026-04-17.md)
- **Raporty tygodniowe**: [doc/reports/](doc/reports/)
