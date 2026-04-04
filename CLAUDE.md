# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Dokumentacja i komentarze w tym projekcie piszemy po polsku.**

## Opis projektu

StockPulse to system wykrywania edge'u na rynku akcji healthcare z alertami Telegram. Monitoruje transakcje insiderów (SEC EDGAR Form 4), zdarzenia korporacyjne (8-K), aktywność opcyjną (Polygon.io) i daty FDA (PDUFA.bio). Koreluje sygnały z wielu źródeł (insider×options, insider×8-K, insider cluster) i alertuje tylko gdy wykryje realny edge.

**Aktualny stan projektu**: Faza 2 + Sprint 4-10 (ukończone) + **Sprint 11 (przebudowa — focus na edge, 03.04.2026)** + **Sprint 12 (migracja AI + dashboard, 04.04.2026)** + **Sprint 13 (Signal Timeline, 05.04.2026)**. Analiza 2 tygodni (962 alertów, 55.5% hit rate) wykazała brak edge'u na sentymencie. Sprint 11: wyłączenie szumu, focus na insider pipeline. Sprint 12: migracja z Azure OpenAI gpt-4o-mini na **Anthropic Claude Sonnet** (bezpośrednio z NestJS, bez Azure VM pośrednika), panel Status Systemu na dashboardzie, fix parsowania 8-K (inline XBRL), hard delete 1585 alertów z wyłączonych reguł. **Aktywne kolektory**: SEC EDGAR (Form 4 + 8-K), Options Flow (Polygon EOD), PDUFA.bio. **Wyłączone**: StockTwits (0% edge), Finnhub news (HFT lag), sentiment pipeline (FinBERT + GPT na newsach). **7 aktywnych reguł**: Form 4 Insider Signal, 8-K Material Event GPT, 8-K Earnings Miss, 8-K Leadership Change, 8-K Bankruptcy, Correlated Signal, Unusual Options Activity (tylko z PDUFA boost). **12 wyłączonych reguł** (isActive=false w DB). **3 aktywne wzorce korelacji**: INSIDER_CLUSTER (2+ discretionary C-suite w 7d), INSIDER_PLUS_8K (insider + 8-K w 24h), INSIDER_PLUS_OPTIONS (insider + opcje w 72h). **Wyłączone wzorce**: FILING_CONFIRMS_NEWS, MULTI_SOURCE_CONVERGENCE, ESCALATING_SIGNAL (wymagały sentymentu). Form4Pipeline: filtr **discretionary only** (is10b51Plan=true → skip), **C-suite priorytet** (CEO/CFO/President/Chairman/EVP → boost priority). Options scoring: **spike ratio > 1000 → suspicious, conviction ×0.5**. 8-K Item 5.02 prompt: rozróżnienie **voluntary+successor vs crisis vs relief rally**. **priceAtAlert** naprawiony dla Correlated Signal, Form 4, 8-K (wcześniej NULL). SEC filingi: Claude Sonnet z per-typ promptami, Zod walidacja, Item 1.03 Bankruptcy → natychmiastowy CRITICAL. CorrelationService: Redis Sorted Sets, progi MIN_CONVICTION=0.05, MIN_CORRELATED_CONVICTION=0.20. Price Outcome Tracker: CRON co 1h (NYSE open), hard timeout 7d. System Logowania: @Logged() na ~13 metodach, auto-cleanup 7d. Cel: **3-5 alertów/tydzień z realnym edge** (insider sell, PDUFA options, korelacje). Raporty tygodniowe: [doc/reports/](doc/reports/). Szczegółowy status: [doc/PROGRESS-STATUS.md](doc/PROGRESS-STATUS.md).

## Komendy (Makefile — autodetekcja środowiska)

```bash
# Makefile automatycznie wykrywa: jetson (aarch64) / gpu (x86+nvidia) / cpu (x86)
make up              # start całego stacku
make down            # stop
make rebuild         # rebuild po zmianach kodu
make rebuild-app     # rebuild tylko backendu NestJS
make rebuild-finbert # rebuild FinBERT sidecar
make status          # status kontenerów + health check
make logs            # logi (follow)
make log S=finbert   # logi konkretnego serwisu
make seed            # seed bazy (tickery + reguły)
make backfill        # backfill sentymentu FinBERTem
make backup          # backup bazy do backups/
make restore         # restore z najnowszego backupu
make stats           # statystyki bazy
make shell-app       # shell do kontenera app
make shell-db        # shell psql
make help            # lista komend
```

Alternatywnie docker compose bezpośrednio:

```bash
# Laptop z GPU
docker compose up -d

# Laptop bez GPU
docker compose -f docker-compose.yml -f docker-compose.cpu.yml up -d

# Jetson (aarch64)
docker compose -f docker-compose.yml -f docker-compose.jetson.yml up -d

# Weryfikacja
curl http://localhost:3000/api/health           # status systemu
curl http://localhost:3000/api/health/stats      # totale per tabela
curl http://localhost:3000/api/sentiment/scores  # wyniki sentymentu FinBERT

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
   - **SEC EDGAR** co 30 min — Form 4 (insider trades) + 8-K (material events). Eventy `NEW_INSIDER_TRADE` / `NEW_FILING`.
   - **Options Flow** (Polygon.io EOD) CRON 22:15 UTC — volume spike detection (3× avg20d). Event `NEW_OPTIONS_FLOW`.
   - **PDUFA.bio** co 6h — kalendarz dat FDA. Event `NEW_PDUFA_EVENT`. Używany do PDUFA boost w options scoring.
   - **WYŁĄCZONE (Sprint 11)**: StockTwits (77% wolumenu, 0% edge), Finnhub news/MSPR (HFT lag), Reddit (placeholder). Schedulery StockTwits i Finnhub czyszczą repeatable jobs przy starcie (zero pustych jobów BullMQ). Finnhub `/quote` zachowany dla Price Outcome Tracker.
2. **Warstwa AI** — SEC Filing GPT Pipeline (bez sentymentu):
   - **Form4Pipeline** (`src/sec-filings/pipelines/form4.pipeline.ts`): GPT analiza insider trades. Filtr: **discretionary only** (is10b51Plan=true → skip), **C-suite priorytet** (CEO/CFO/President/Chairman/EVP → boost). Prompt z 30-dniową historią, sign convention SELL=ujemna/BUY=dodatnia, safety net post-GPT. Conviction [-2,+2] → [-1,+1] do CorrelationService.
   - **Form8kPipeline** (`src/sec-filings/pipelines/form8k.pipeline.ts`): GPT per-Item prompty (1.01/2.02/5.02/other). Item 5.02 prompt rozróżnia **voluntary+successor vs crisis vs relief rally**. Item 1.03 Bankruptcy → natychmiastowy CRITICAL bez GPT. Zod walidacja, daily cap 20/ticker/dzień.
   - **Options Flow Scoring** (`src/options-flow/`): heurystyczny scoring (bez GPT). Spike ratio > 1000 → suspicious, conviction ×0.5. PDUFA boost ×1.3 gdy event < 30 dni. Standalone alert **tylko z pdufaBoosted=true**.
   - **CorrelationService** (`src/correlation/`): **3 aktywne wzorce** — INSIDER_CLUSTER (2+ C-suite w 7d), INSIDER_PLUS_8K (insider + 8-K w 24h), INSIDER_PLUS_OPTIONS (insider + opcje w 72h). Redis Sorted Sets. 3 wyłączone wzorce (wymagały sentymentu).
   - **Anthropic Claude Sonnet** (`AnthropicClientService`, SDK `@anthropic-ai/sdk`) — bezpośrednie wywołanie API z NestJS. Zastąpił Azure OpenAI gpt-4o-mini (Sprint 12). Provider alias: `AzureOpenaiClientService` → `AnthropicClientService` (zero zmian w pipeline'ach). Konfiguracja: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (domyślnie `claude-sonnet-4-6`). Azure VM (`74.248.113.3:3100`) na standby jako fallback.
   - **Pipeline observability**: `ai_pipeline_logs` + `system_logs` (decorator @Logged, cleanup 7d).
   - **Price Outcome Tracker** (`src/price-outcome/`): priceAtAlert (Finnhub /quote) w momencie alertu (naprawiony Sprint 11 — wcześniej NULL dla Correlated/Form4/8-K), CRON co 1h price1h/4h/1d/3d (NYSE open only), hard timeout 7d.
   - **AlertEvaluator**: 7 aktywnych reguł, 12 wyłączonych. Per-symbol daily limit 5 alertów. Throttling per (rule, symbol, catalyst_type). `onSentimentScored()` i `onInsiderTrade()` mają early return (Sprint 11 — reguły sentymentowe i Insider Trade Large wyłączone). Martwy kod insider aggregation usunięty (InsiderBatch, flushInsiderBatch, insiderBatches).
   - **WYŁĄCZONE (Sprint 11)**: FinBERT sidecar (kontener działa ale nie otrzymuje jobów), sentiment pipeline (listener bez @OnEvent), 6 reguł sentymentowych + Insider Trade Large (isActive=false, early return w handlerach).
3. **Warstwa danych** — PostgreSQL z 14 tabelami (w tym `options_flow`, `options_volume_baseline`, alerts z 7 polami price outcome), Redis dla kolejek BullMQ + Sorted Sets (korelacje). TypeORM z `synchronize: true`.
4. **Warstwa dostarczania** — Dashboard React (MUI 5 + Recharts) na :3001 z MUI Tabs (Dashboard + Signal Timeline + System Logs). Panel Status Systemu (kolektory, błędy, pipeline). Signal Timeline (`/api/alerts/timeline`) — sekwencja sygnałów per ticker z deltami cenowymi, gap czasowym, conviction, zgodność kierunków. Alerty Telegram po polsku. REST API (~25 endpointów) na :3000.

### Stack technologiczny

- **Backend**: NestJS 10, TypeORM, BullMQ, EventEmitter2, Node.js 20, TypeScript 5.x
- **Frontend**: React 18, Recharts 3.7, MUI 5 (dark theme), Vite 4
- **AI/NLP**: FinBERT (ProsusAI/finbert, PyTorch, FastAPI sidecar na :8000), **Anthropic Claude Sonnet** (SDK `@anthropic-ai/sdk`, bezpośrednio z NestJS — zastąpił Azure OpenAI gpt-4o-mini w Sprint 12)
- **Infra**: Docker Compose (6 kontenerów), NVIDIA Container Toolkit (GPU), PostgreSQL 16 + TimescaleDB, Redis 7, serwer produkcyjny (NVIDIA CUDA, autostart z git pull). Azure VM (74.248.113.3:3100) na standby jako fallback.

### Usługi i porty

| Usługa | Port | URL |
|--------|------|-----|
| NestJS API | 3000 | http://localhost:3000/api/ |
| Frontend React | 3001 | http://localhost:3001/ |
| FinBERT sidecar | 8000 | http://localhost:8000/ |
| pgAdmin | 5050 | http://localhost:5050/ |
| PostgreSQL | 5432 | — |
| Redis | 6379 | — |

### Healthcare Universe

[doc/stockpulse-healthcare-universe.json](doc/stockpulse-healthcare-universe.json) definiuje zakres monitoringu: ~37 tickerów healthcare (wg podsektora), 180+ słów kluczowych, 18 subredditów i 17 reguł alertów z priorytetami (w tym SEC Filing GPT Pipeline + Correlated Signal).

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

## Multi-środowisko: Laptop ↔ Jetson

Projekt działa na dwóch maszynach. Kod jest wspólny (git), konfiguracja osobna per maszynę.

### Środowiska

| Środowisko | Architektura | GPU / CUDA | FinBERT Dockerfile | Python |
|------------|-------------|------------|-------------------|--------|
| **Laptop z GPU** | x86_64 | NVIDIA desktop / CUDA 12.x | `Dockerfile` | 3.11 |
| **Laptop bez GPU** | x86_64 | brak | `Dockerfile.cpu` | 3.11 |
| **Jetson Orin NX** | aarch64 | Orin / CUDA 11.4 (L4T) | `Dockerfile.jetson` | 3.8 |

### Pliki per środowisko

```
docker-compose.yml              ← bazowy (wspólny, NIE edytuj per-maszynę)
docker-compose.cpu.yml          ← override: laptop bez GPU
docker-compose.jetson.yml       ← override: Jetson (L4T + runtime nvidia)

finbert-sidecar/
  Dockerfile                    ← laptop z GPU (nvidia/cuda:12.4, Python 3.11)
  Dockerfile.cpu                ← laptop bez GPU (python:3.11-slim)
  Dockerfile.jetson             ← Jetson (L4T PyTorch r35.2.1, Python 3.8)
  requirements.txt              ← laptop (torch==2.5.1)
  requirements-jetson.txt       ← Jetson (bez torch — wbudowany w obraz L4T)
```

### Workflow

```
Laptop WSL2 (dev) ──git push──→ GitHub ──git pull──→ Serwer prod (192.168.0.138, autostart po reboot)
                                                  └→ Azure VM (74.248.113.3, PM2: processor.js + api.js)
```

- **Rozwijasz kod na laptopie**, commitujesz, pushujesz
- **Jetson po restarcie** automatycznie robi `git pull` + `make up` (crontab @reboot, skrypt `scripts/autostart.sh`)
- `.env` jest **gitignored** — każda maszyna ma swoje klucze API
- `make up` / `make rebuild` — Makefile sam wykrywa środowisko po `uname -m`

### Zasady przy edycji kodu FinBERT

- **NIE usuwaj** `from __future__ import annotations` z plików `finbert-sidecar/app/*.py` — zapewnia kompatybilność z Python 3.8 na Jetsonie
- Jeśli dodajesz nową zależność do `requirements.txt`, dodaj też kompatybilną wersję do `requirements-jetson.txt` (bez torch, wersje dla Python 3.8)
- Pakiet `eval_type_backport` w requirements-jetson.txt jest potrzebny dla Pydantic v2 na Python 3.8

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
- **Azure Analysis Service**: URL do VM z gpt-4o-mini + timeout (legacy fallback — nieaktywne od Sprint 12, VM na standby)
- **Telegram**: token bota + chat ID do alertów
- **StockTwits**: publiczne endpointy, bez autoryzacji (200 req/hour)
- **Bazy danych**: konfiguracja PostgreSQL i Redis

dev tak sie uruchamia 

wsl -d Ubuntu bash -c "cd /home/n1copl/stockPulse && docker compose up -d 2>&1 | tail -20"