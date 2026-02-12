# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Dokumentacja i komentarze w tym projekcie piszemy po polsku.**

## Opis projektu

StockPulse to system analizy sentymentu rynku akcji w czasie rzeczywistym z alertami, skupiony na sektorze healthcare. Monitoruje media społecznościowe (Reddit, StockTwits), dane finansowe (Finnhub), zgłoszenia SEC (EDGAR) i wysyła alerty przez Telegram. Projekt jest w **fazie setupu i integracji API** — pełny backend NestJS i frontend React są zaplanowane, ale jeszcze niezaimplementowane.

## Komendy

```bash
# Infrastruktura (PostgreSQL + TimescaleDB, Redis)
docker compose up -d       # start
docker compose down        # stop
docker compose ps          # status

# Instalacja zależności
npm install

# Test wszystkich skonfigurowanych integracji API
npm run test:all

# Testy poszczególnych integracji
npm run test:reddit       # Reddit OAuth2 (wymaga REDDIT_* w .env)
npm run test:finnhub      # Finnhub dane finansowe (wymaga FINNHUB_API_KEY)
npm run test:edgar        # SEC EDGAR filingi (wymaga SEC_USER_AGENT)
npm run test:stocktwits   # StockTwits sentyment (bez autoryzacji)
npm run test:telegram     # Telegram alerty (wymaga TELEGRAM_* w .env)
```

## Setup

1. `cp .env.example .env` i uzupełnij klucze API
2. `npm install`
3. `npm run test:all` — weryfikacja integracji

## Architektura

### Stan obecny (Faza 0)

Repo zawiera skrypty testowe integracji API w `scripts/`, które walidują każde źródło danych. Brak buildu, lintingu czy frameworka testowego — skrypty uruchamiane bezpośrednio przez Node.js z `dotenv` do konfiguracji środowiska.

### Planowana architektura (4 warstwy)

Szczegóły w [doc/stockpulse-architecture.jsx](doc/stockpulse-architecture.jsx):

1. **Warstwa zbierania danych** — Kolektory social media (Reddit, StockTwits), newsów (Finnhub, SEC EDGAR) i danych alternatywnych
2. **Warstwa AI** — Dwuetapowy sentyment: szybki FinBERT + Claude Haiku do analizy niuansowej. spaCy NER sidecar do ekstrakcji encji
3. **Warstwa danych i eventów** — PostgreSQL + TimescaleDB (time-series), Redis (cache/kolejki przez BullMQ), Elasticsearch (wyszukiwanie)
4. **Warstwa dostarczania** — Dashboard React z WebSocket, alerty Telegram/Discord, REST/GraphQL API

### Planowany stack technologiczny

- **Backend**: NestJS 10+, TypeORM, BullMQ, Node.js 20+, TypeScript 5.x
- **Frontend**: React 18+, Recharts, TanStack Query
- **AI/NLP**: Claude Haiku API, FinBERT (HuggingFace), spaCy (Python sidecar pod `FINBERT_SIDECAR_URL`)
- **Infra**: Docker Compose (lokalnie), Azure Container Apps (prod), GitHub Actions (CI/CD)

### Healthcare Universe

[doc/stockpulse-healthcare-universe.json](doc/stockpulse-healthcare-universe.json) definiuje zakres monitoringu: 32 tickery healthcare (wg podsektora), 180+ słów kluczowych, 65 kluczowych osób, 18 subredditów i reguły alertów z priorytetami.

## Zmienne środowiskowe

Patrz `.env.example`. Główne grupy:
- **Reddit**: OAuth2 (client ID, secret, username, password)
- **Finnhub**: klucz API (free tier, 60 req/min)
- **SEC EDGAR**: User-Agent z emailem (bez klucza, 10 req/sec)
- **Anthropic**: klucz API do Claude Haiku (potrzebny od Fazy 2)
- **Telegram**: token bota + chat ID do alertów
- **StockTwits**: publiczne endpointy, bez autoryzacji (200 req/hour)
- **Bazy danych**: konfiguracja PostgreSQL i Redis
