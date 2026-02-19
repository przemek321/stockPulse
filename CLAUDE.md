# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Dokumentacja i komentarze w tym projekcie piszemy po polsku.**

## Opis projektu

StockPulse to system analizy sentymentu rynku akcji w czasie rzeczywistym z alertami, skupiony na sektorze healthcare. Monitoruje media społecznościowe (Reddit, StockTwits), dane finansowe (Finnhub), zgłoszenia SEC (EDGAR) i wysyła alerty przez Telegram.

**Aktualny stan projektu**: Faza 2 — Analiza AI sentymentu (w trakcie). Pełny pipeline działa end-to-end: kolektory → eventy → BullMQ → FinBERT na GPU → wyniki w bazie → alerty Telegram. Szczegółowy status: [doc/PROGRESS-STATUS.md](doc/PROGRESS-STATUS.md). Struktura plików: [doc/schematy.md](doc/schematy.md).

## Komendy

```bash
# Cały stack (postgres, redis, app, finbert, frontend, pgadmin)
docker compose up -d                        # start
docker compose down                         # stop
docker compose up -d --build app            # rebuild backend po zmianach w src/
docker compose up -d --build app frontend   # rebuild backend + frontend
docker compose logs app --tail 50           # logi NestJS
docker compose logs finbert --tail 20       # logi FinBERT sidecar

# Tryb CPU (bez GPU) — dla maszyn bez NVIDIA
docker compose -f docker-compose.yml -f docker-compose.cpu.yml up -d

# Seed bazy danych (tickery + reguły alertów)
docker exec stockpulse-app npm run seed

# Backfill sentymentu (analiza istniejących danych FinBERT-em)
docker exec stockpulse-app npm run backfill:sentiment

# Weryfikacja
curl http://localhost:3000/api/health           # status systemu
curl http://localhost:3000/api/health/stats      # totale per tabela
curl http://localhost:3000/api/tickers           # lista tickerów
curl http://localhost:3000/api/sentiment/scores  # wyniki sentymentu FinBERT
curl http://localhost:3000/api/alerts            # historia alertów

# Testy integracji API (Faza 0)
npm run test:all
```

## Setup

1. `cp .env.example .env` i uzupełnij klucze API
2. `docker compose up -d` — start całego stacku
3. `docker exec stockpulse-app npm run seed` — seed tickerów i reguł alertów
4. Otwórz `http://localhost:3001` — dashboard React

## Architektura

### Stan obecny (Faza 2)

Działający system end-to-end w 6 kontenerach Docker:

1. **Warstwa zbierania danych** — 4 kolektory (StockTwits co 5 min, Finnhub co 10 min, SEC EDGAR co 30 min, Reddit placeholder). Eventy `NEW_MENTION` / `NEW_ARTICLE` przez EventEmitter2.
2. **Warstwa AI** — FinBERT sidecar (ProsusAI/finbert) w kontenerze z GPU passthrough (NVIDIA Container Toolkit). BullMQ kolejka `sentiment-analysis`. Wyniki w `sentiment_scores` z score/confidence/model.
3. **Warstwa danych** — PostgreSQL z 9 tabelami, Redis dla 6 kolejek BullMQ. TypeORM z `synchronize: true`.
4. **Warstwa dostarczania** — Dashboard React (MUI 5 + Recharts) na :3001, alerty Telegram, REST API (11 endpointów) na :3000.

### Stack technologiczny

- **Backend**: NestJS 10, TypeORM, BullMQ, EventEmitter2, Node.js 20, TypeScript 5.x
- **Frontend**: React 18, Recharts 3.7, MUI 5 (dark theme), Vite 4
- **AI/NLP**: FinBERT (ProsusAI/finbert, PyTorch, FastAPI sidecar na :8000)
- **Infra**: Docker Compose (6 kontenerów), NVIDIA Container Toolkit (GPU), PostgreSQL 16 + TimescaleDB, Redis 7

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

[doc/stockpulse-healthcare-universe.json](doc/stockpulse-healthcare-universe.json) definiuje zakres monitoringu: 27 tickerów healthcare (wg podsektora), 180+ słów kluczowych, 18 subredditów i 7 reguł alertów z priorytetami.

### Dokumentacja szczegółowa

- **Status projektu i plan**: [doc/PROGRESS-STATUS.md](doc/PROGRESS-STATUS.md)
- **Struktura plików**: [doc/schematy.md](doc/schematy.md)
- **Architektura (wizualizacja)**: [doc/stockpulse-architecture.jsx](doc/stockpulse-architecture.jsx)

## Zmienne środowiskowe

Patrz `.env.example`. Główne grupy:
- **Reddit**: OAuth2 (client ID, secret, username, password)
- **Finnhub**: klucz API (free tier, 60 req/min)
- **SEC EDGAR**: User-Agent z emailem (bez klucza, 10 req/sec)
- **Anthropic**: klucz API do Claude Haiku (potrzebny od Fazy 2)
- **Telegram**: token bota + chat ID do alertów
- **StockTwits**: publiczne endpointy, bez autoryzacji (200 req/hour)
- **Bazy danych**: konfiguracja PostgreSQL i Redis
