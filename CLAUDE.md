# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Dokumentacja i komentarze w tym projekcie piszemy po polsku.**

## Opis projektu

StockPulse to system analizy sentymentu rynku akcji w czasie rzeczywistym z alertami, skupiony na sektorze healthcare. Monitoruje media społecznościowe (Reddit, StockTwits), dane finansowe (Finnhub), zgłoszenia SEC (EDGAR) i wysyła alerty przez Telegram.

**Aktualny stan projektu**: Faza 2 + Sprint 4/4b (ukończony) + Sprint 5 (ukończony) + Sprint 6 (ukończony) + Sprint 7 (ukończony — przegląd logiki + 9 fixów). 2-etapowy pipeline sentymentu z tier-based eskalacją + SEC Filing GPT Pipeline + CorrelationService + Price Outcome Tracker + System Logowania. Kolektory → BullMQ → FinBERT na GPU (1. etap) → classifyTier → Azure OpenAI gpt-4o-mini (2. etap) → conviction [-2.0, +2.0] → effectiveScore [-1, +1] jako źródło prawdy. SEC filingi: GPT z per-typ promptami (8-K Items 1.01/2.02/5.02/other, Form 4 z historią 30d), Zod walidacja, Item 1.03 Bankruptcy → natychmiastowy CRITICAL. CorrelationService: Redis Sorted Sets, insider+8K 24h (Form4 z signals:insider + 8-K z signals:short), filing confirms news 48h (catalyst_type 'unknown' ignorowany), multi-source convergence, insider cluster 7d, escalating signal 72h. Progi: MIN_CONVICTION=0.05, MIN_CORRELATED_CONVICTION=0.20. AlertEvaluator: 6 reguł niezależnych (Promise.all), decyzje SKIP/THROTTLED/ALERT_SENT w logach, cache reguł (TTL 5 min), OnModuleDestroy, nowa reguła Urgent AI Signal (urgency=HIGH + relevance≥0.7). Price Outcome Tracker: PriceOutcomeModule — zapis priceAtAlert (Finnhub /quote) w momencie alertu, CRON co 1h uzupełnia price1h/4h/1d/3d TYLKO gdy NYSE otwarta (pon-pt 9:30-16:00 ET, helper `isNyseOpen()`), max 30 zapytań/cykl, hard timeout 7d (zamiast 72h), panel trafności na froncie. System Logowania: decorator @Logged() na ~14 metodach (w tym onFiling), tabela system_logs (JSONB input/output), frontend z filtrami i eksportem JSON, auto-cleanup 7d. Telegram alerty + prompty SEC po polsku. Dashboard: MUI Tabs (Dashboard + System Logs), 13+ paneli. Backfill: POST /api/sec-filings/backfill-gpt. 19 reguł alertów, ~37 tickerów, 12 tabel PostgreSQL. Szczegółowy status: [doc/PROGRESS-STATUS.md](doc/PROGRESS-STATUS.md). Struktura plików: [doc/schematy.md](doc/schematy.md).

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

### Stan obecny (Faza 2 + Sprint 6)

Działający system end-to-end w 6 kontenerach Docker:

1. **Warstwa zbierania danych** — 4 aktywne kolektory (StockTwits co 5 min, Finnhub co 10 min, SEC EDGAR co 30 min, PDUFA.bio co 6h) + Reddit placeholder. Eventy `NEW_MENTION` / `NEW_ARTICLE` / `NEW_PDUFA_EVENT` przez EventEmitter2.
2. **Warstwa AI** — 2-etapowy pipeline z tier-based eskalacją:
   - **1. etap**: FinBERT sidecar (ProsusAI/finbert, GPU) — szybka analiza lokalna (~67ms)
   - **Tier-based eskalacja** (classifyTier na confidence + absScore):
     - Tier 1 (silne): conf > 0.7 AND abs > 0.5 → ZAWSZE do AI (złote sygnały)
     - Tier 2 (średnie): conf > 0.3 AND abs > 0.2 → do AI jeśli VM aktywna
     - Tier 3 (śmieci): skip AI, tylko FinBERT
   - **PDUFA Context Layer**: wstrzykiwanie nadchodzących dat FDA do prompta (z tabeli `pdufa_catalysts`)
   - **2. etap**: Azure OpenAI gpt-4o-mini → wielowymiarowa analiza (relevance, novelty, source_authority, confidence, catalyst_type, price_impact) → conviction = sent × rel × nov × auth × conf × mag (range [-2.0, +2.0], magnitude: low=1.0, med=1.5, high=2.0). Zwraca `prompt_used` w odpowiedzi.
   - **Fallback**: Strong FinBERT Signal — gdy VM offline, silne sygnały (|score|>0.7, conf>0.8) generują alert "(unconfirmed)"
   - Azure VM (`stockpulse-vm`, 74.248.113.3:3100) — processor.js (POST /analyze) + api.js (:8000)
   - BullMQ kolejka `sentiment-analysis`. Wyniki w `sentiment_scores` z enrichedAnalysis (jsonb).
   - **Pipeline observability**: tabela `ai_pipeline_logs` — pełna historia egzekucji (status, tier, czasy, payload, prompt, błędy)
   - **System Logowania**: decorator `@Logged(module)` na ~13 kluczowych metodach → fire-and-forget zapis do tabeli `system_logs` (JSONB input/output, czas trwania, status). Cron cleanup 7d.
   - **SEC Filing GPT Pipeline** (`src/sec-filings/`): Form 4 + 8-K per-Item prompty z kalibracją conviction, Zod walidacja, atomowy daily cap (Redis INCR) 20/ticker/dzień, backfill endpoint. Form4Pipeline zapisuje gptAnalysis do SecFiling + throttling per catalyst_type. Conviction normalizowany [-2,+2] → [-1,+1] przed zapisem do CorrelationService.
   - **CorrelationService** (`src/correlation/`): 5 detektorów wzorców (insider+8K 24h, filing confirms news 48h, multi-source convergence, insider cluster 7d, escalating signal 72h), Redis Sorted Sets, OnModuleDestroy cleanup timerów
   - **Price Outcome Tracker** (`src/price-outcome/`): zapis ceny w momencie alertu (Finnhub /quote), CRON co 1h uzupełnia price1h/4h/1d/3d TYLKO gdy NYSE otwarta (pon-pt 9:30-16:00 ET), max 30 zapytań/cykl, hard timeout 7d
   - **AlertEvaluator**: 6 reguł niezależnych (Promise.all), decyzje SKIP/THROTTLED/ALERT_SENT w logach, Urgent AI Signal (urgency=HIGH)
3. **Warstwa danych** — PostgreSQL z 12 tabelami (w tym `system_logs`, alerts z 7 polami price outcome), Redis dla 7 kolejek BullMQ + Redis Sorted Sets (korelacje). TypeORM z `synchronize: true`.
4. **Warstwa dostarczania** — Dashboard React (MUI 5 + Recharts) na :3001 z MUI Tabs (Dashboard + System Logs), 13+ panelami (wykres sentymentu w Accordion, AI Analysis, Pipeline AI, PDUFA Calendar, Insider Trades, Analiza GPT Filingów SEC, Skorelowane Sygnały, Trafność Alertów itd.), klikalne dialogi TextDialog do kopiowania. Zakładka System Logs: filtry, sortowalna tabela, rozwijane wiersze z JSON, eksport. Alerty Telegram po polsku (z sekcją AI + raport 2h z PDUFA), REST API (20 endpointów) na :3000. Throttling per (rule, symbol, catalyst_type).

### Stack technologiczny

- **Backend**: NestJS 10, TypeORM, BullMQ, EventEmitter2, Node.js 20, TypeScript 5.x
- **Frontend**: React 18, Recharts 3.7, MUI 5 (dark theme), Vite 4
- **AI/NLP**: FinBERT (ProsusAI/finbert, PyTorch, FastAPI sidecar na :8000), Azure OpenAI gpt-4o-mini (2. etap pipeline, VM 74.248.113.3:3100)
- **Infra**: Docker Compose (6 kontenerów), NVIDIA Container Toolkit (GPU), PostgreSQL 16 + TimescaleDB, Redis 7, Azure VM (PM2 + Node.js), serwer produkcyjny (NVIDIA CUDA, autostart z git pull)

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
- **Anthropic**: klucz API (opcjonalny, aktualnie nieużywany — 2. etap pipeline to Azure OpenAI gpt-4o-mini)
- **Azure Analysis Service**: URL do VM z gpt-4o-mini + timeout (opcjonalne — 2-etapowy pipeline sentymentu)
- **Telegram**: token bota + chat ID do alertów
- **StockTwits**: publiczne endpointy, bez autoryzacji (200 req/hour)
- **Bazy danych**: konfiguracja PostgreSQL i Redis
