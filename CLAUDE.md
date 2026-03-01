# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Dokumentacja i komentarze w tym projekcie piszemy po polsku.**

## Opis projektu

StockPulse to system analizy sentymentu rynku akcji w czasie rzeczywistym z alertami, skupiony na sektorze healthcare. Monitoruje media społecznościowe (Reddit, StockTwits), dane finansowe (Finnhub), zgłoszenia SEC (EDGAR) i wysyła alerty przez Telegram.

**Aktualny stan projektu**: Faza 2 — Analiza AI sentymentu (ukończona). 2-etapowy pipeline z tier-based eskalacją: kolektory → BullMQ → FinBERT na GPU (1. etap) → classifyTier(confidence, absScore) → Tier 1 (silne) ZAWSZE do AI, Tier 2 (średnie) do AI jeśli VM aktywna, Tier 3 skip → Azure OpenAI gpt-4o-mini na VM (2. etap) → conviction = sent × rel × nov × auth × conf × mag → alerty Telegram (Sentiment Crash + High Conviction Signal). Frontend z wykresem sentymentu, zakładką AI Analysis. Szczegółowy status: [doc/PROGRESS-STATUS.md](doc/PROGRESS-STATUS.md). Struktura plików: [doc/schematy.md](doc/schematy.md).

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

### Stan obecny (Faza 2)

Działający system end-to-end w 6 kontenerach Docker:

1. **Warstwa zbierania danych** — 3 aktywne kolektory (StockTwits co 5 min, Finnhub co 10 min, SEC EDGAR co 30 min) + Reddit placeholder. Eventy `NEW_MENTION` / `NEW_ARTICLE` przez EventEmitter2.
2. **Warstwa AI** — 2-etapowy pipeline z tier-based eskalacją:
   - **1. etap**: FinBERT sidecar (ProsusAI/finbert, GPU) — szybka analiza lokalna (~67ms)
   - **Tier-based eskalacja** (classifyTier na confidence + absScore):
     - Tier 1 (silne): conf > 0.7 AND abs > 0.5 → ZAWSZE do AI (złote sygnały)
     - Tier 2 (średnie): conf > 0.3 OR abs > 0.2 → do AI jeśli VM aktywna
     - Tier 3 (śmieci): skip AI, tylko FinBERT
   - **2. etap**: Azure OpenAI gpt-4o-mini → wielowymiarowa analiza (relevance, novelty, source_authority, confidence, catalyst_type, price_impact) → conviction = sent × rel × nov × auth × conf × mag
   - Azure VM (`stockpulse-vm`, 74.248.113.3:3100) — processor.js (POST /analyze) + api.js (:8000)
   - BullMQ kolejka `sentiment-analysis`. Wyniki w `sentiment_scores` z enrichedAnalysis (jsonb).
3. **Warstwa danych** — PostgreSQL z 9 tabelami, Redis dla 6 kolejek BullMQ. TypeORM z `synchronize: true`.
4. **Warstwa dostarczania** — Dashboard React (MUI 5 + Recharts) na :3001 z wykresem sentymentu i zakładką AI Analysis, alerty Telegram (z sekcją AI + raport 2h), REST API (12 endpointów) na :3000.

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

[doc/stockpulse-healthcare-universe.json](doc/stockpulse-healthcare-universe.json) definiuje zakres monitoringu: 27 tickerów healthcare (wg podsektora), 180+ słów kluczowych, 18 subredditów i 8 reguł alertów z priorytetami (w tym High Conviction Signal).

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
- **Anthropic**: klucz API do Claude Haiku (potrzebny od Fazy 2)
- **Azure Analysis Service**: URL do VM z gpt-4o-mini + timeout (opcjonalne — 2-etapowy pipeline sentymentu)
- **Telegram**: token bota + chat ID do alertów
- **StockTwits**: publiczne endpointy, bez autoryzacji (200 req/hour)
- **Bazy danych**: konfiguracja PostgreSQL i Redis
