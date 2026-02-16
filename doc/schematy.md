# StockPulse — Schemat struktury katalogów

> Szczegółowy opis każdego pliku, co robi i z czym jest powiązany.
> Ostatnia aktualizacja: 2026-02-13

## Drzewo katalogów

```
stockPulse/
│
├── src/                                    # Cały kod NestJS
│   ├── main.ts                             # Punkt wejścia aplikacji
│   ├── app.module.ts                       # Główny moduł — importuje wszystko
│   │
│   ├── config/                             # Konfiguracja środowiska
│   │   ├── config.module.ts                # Moduł ładujący .env
│   │   └── env.validation.ts               # Schemat Joi walidujący zmienne
│   │
│   ├── database/                           # Połączenie z bazą danych
│   │   ├── database.module.ts              # TypeORM + PostgreSQL
│   │   └── seeds/                          # Skrypty inicjalizacyjne (standalone)
│   │       ├── seed.ts                     # Wypełnienie tabel (tickers, alert_rules)
│   │       └── backfill-sentiment.ts       # Backfill sentymentu FinBERT na historycznych danych
│   │
│   ├── entities/                           # Encje (tabele bazy danych)
│   │   ├── index.ts                        # Re-eksport wszystkich encji
│   │   ├── ticker.entity.ts                # 32 tickery healthcare
│   │   ├── sentiment-score.entity.ts       # Wyniki sentymentu (time-series)
│   │   ├── raw-mention.entity.ts           # Surowe wzmianki (Reddit, StockTwits)
│   │   ├── news-article.entity.ts          # Artykuły newsowe (Finnhub)
│   │   ├── sec-filing.entity.ts            # Filingi SEC (8-K, 10-Q, Form 4)
│   │   ├── insider-trade.entity.ts         # Transakcje insiderów
│   │   ├── alert.entity.ts                 # Historia wysłanych alertów
│   │   ├── alert-rule.entity.ts            # Reguły generowania alertów
│   │   └── collection-log.entity.ts        # Logi cykli zbierania danych
│   │
│   ├── common/                             # Współdzielone utility
│   │   ├── interfaces/
│   │   │   ├── collector.interface.ts       # Interfejs ICollector
│   │   │   └── data-source.enum.ts          # Enum: REDDIT, FINNHUB, SEC_EDGAR, STOCKTWITS
│   │   └── filters/
│   │       └── http-exception.filter.ts     # Globalny filtr błędów HTTP
│   │
│   ├── events/                             # Event Bus (komunikacja wewnętrzna)
│   │   ├── events.module.ts                # EventEmitterModule
│   │   └── event-types.ts                  # Enum typów eventów
│   │
│   ├── queues/                             # Kolejki zadań BullMQ
│   │   ├── queue-names.const.ts            # Nazwy 6 kolejek
│   │   └── queues.module.ts                # Rejestracja kolejek + Redis
│   │
│   ├── collectors/                         # Warstwa 1: Zbieranie danych
│   │   ├── collectors.module.ts            # Zbiorczy moduł kolektorów
│   │   ├── shared/
│   │   │   └── base-collector.service.ts   # Bazowa klasa kolektora
│   │   ├── stocktwits/
│   │   │   ├── stocktwits.module.ts
│   │   │   ├── stocktwits.service.ts       # Logika zbierania
│   │   │   ├── stocktwits.processor.ts     # BullMQ worker
│   │   │   └── stocktwits.scheduler.ts     # Cron co 5 min
│   │   ├── finnhub/
│   │   │   ├── finnhub.module.ts
│   │   │   ├── finnhub.service.ts          # Newsy + insider sentiment
│   │   │   ├── finnhub.processor.ts        # BullMQ worker
│   │   │   └── finnhub.scheduler.ts        # Cron co 10 min
│   │   ├── sec-edgar/
│   │   │   ├── sec-edgar.module.ts
│   │   │   ├── sec-edgar.service.ts        # Filingi + Form 4
│   │   │   ├── sec-edgar.processor.ts      # BullMQ worker
│   │   │   └── sec-edgar.scheduler.ts      # Cron co 30 min
│   │   └── reddit/
│   │       ├── reddit.module.ts
│   │       ├── reddit.service.ts           # OAuth2 + wzmianki
│   │       ├── reddit.processor.ts         # BullMQ worker
│   │       └── reddit.scheduler.ts         # Cron co 10 min (jeśli skonfigurowany)
│   │
│   ├── sentiment/                          # Warstwa 2: Analiza sentymentu FinBERT
│   │   ├── sentiment.module.ts             # Moduł zbiorczy (encje, kolejka, serwisy)
│   │   ├── finbert-client.service.ts       # HTTP klient do FinBERT sidecar
│   │   ├── sentiment-listener.service.ts   # Nasłuchuje eventów → dodaje joby
│   │   └── sentiment-processor.service.ts  # BullMQ processor → FinBERT → zapis
│   │
│   ├── alerts/                             # Warstwa 4: Powiadomienia
│   │   ├── alerts.module.ts                # Moduł alertów
│   │   ├── alert-evaluator.service.ts      # Ewaluacja reguł + throttling
│   │   └── telegram/
│   │       ├── telegram.service.ts         # Wysyłka wiadomości Telegram
│   │       └── telegram-formatter.service.ts # Formatowanie MarkdownV2
│   │
│   └── api/                                # REST API kontrolery
│       ├── api.module.ts                   # Zbiorczy moduł API
│       ├── health/
│       │   └── health.controller.ts        # GET /api/health, GET /api/health/stats
│       ├── tickers/
│       │   └── tickers.controller.ts       # GET /api/tickers
│       ├── sentiment/
│       │   └── sentiment.controller.ts     # GET /api/sentiment/* (5 endpointów)
│       └── alerts/
│           └── alerts.controller.ts        # GET /api/alerts
│
├── finbert-sidecar/                        # FinBERT sidecar — Python FastAPI (GPU/CPU)
│   ├── Dockerfile                          # Obraz GPU (CUDA + PyTorch)
│   ├── Dockerfile.cpu                      # Obraz CPU-only (bez CUDA)
│   ├── requirements.txt                    # Zależności Python (transformers, fastapi, torch)
│   └── app/
│       ├── main.py                         # FastAPI app (/health, /api/sentiment, /api/sentiment/batch)
│       └── model.py                        # Załadowanie modelu ProsusAI/finbert + inferencja
│
├── frontend/                               # Dashboard React (Vite + TypeScript)
│   ├── Dockerfile                          # Obraz: node → npm run dev (port 3001)
│   ├── index.html                          # HTML entry point
│   ├── package.json                        # Zależności frontend (react, recharts, axios)
│   ├── vite.config.ts                      # Konfiguracja Vite (proxy API na :3000)
│   ├── tsconfig.json                       # TypeScript frontend
│   └── src/
│       ├── main.tsx                        # Punkt wejścia React
│       ├── App.tsx                         # Layout główny (4 panele danych)
│       ├── api.ts                          # Klient HTTP do backendu (/api/*)
│       ├── vite-env.d.ts                   # Typy Vite
│       └── components/
│           ├── CollectorStatus.tsx          # Status kolektorów (health + countdown)
│           ├── DataPanel.tsx                # Panel danych (tabela z danymi)
│           └── DbSummary.tsx               # Podsumowanie bazy (totale per tabela)
│
├── docker/                                 # Pliki konfiguracyjne Docker
│   └── pgadmin-servers.json                # Auto-rejestracja serwera w pgAdmin
│
├── scripts/                                # Skrypty testowe Fazy 0
│   ├── test-all.js                         # Orchestrator testów
│   ├── test-finnhub.js                     # Test Finnhub API
│   ├── test-sec-edgar.js                   # Test SEC EDGAR API
│   ├── test-stocktwits.js                  # Test StockTwits API
│   ├── test-reddit.js                      # Test Reddit OAuth2
│   └── test-telegram.js                    # Test Telegram Bot
│
├── doc/                                    # Dokumentacja
│   ├── PROGRESS-STATUS.md                  # Status projektu i plan sprintów
│   ├── schematy.md                         # ← TEN PLIK
│   ├── README.md                           # Opis projektu
│   ├── stockpulse-healthcare-universe.json # 32 tickery, 180 keywords, reguły
│   ├── stockpulse-architecture.jsx         # Opis architektury warstw
│   ├── StockPulse-Setup-README.md          # Instrukcja setupu
│   ├── StockPulse-Opis-Architektury.md     # Opis architektury (markdown)
│   ├── StockPulse-Opis-Architektury.pdf    # Opis architektury (PDF)
│   ├── StockPulse-Plan-Dzialania.md        # Plan działania (markdown)
│   └── StockPulse-Plan-Dzialania.pdf       # Plan działania (PDF)
│
├── Dockerfile                              # Obraz Docker dla NestJS app
├── docker-compose.yml                      # 6 serwisów: app, postgres, redis, frontend, finbert, pgadmin
├── docker-compose.cpu.yml                  # Wersja CPU-only (bez GPU passthrough)
├── .dockerignore
├── tsconfig.json                           # TypeScript — konfiguracja bazowa
├── tsconfig.build.json                     # TypeScript — konfiguracja buildowa
├── nest-cli.json                           # NestJS CLI config
├── package.json                            # Zależności + skrypty
├── package-lock.json
├── .env                                    # Klucze API (git-ignored!)
├── .env.example                            # Szablon .env
├── .gitignore
└── CLAUDE.md                               # Kontekst dla Claude Code
```

---

## Szczegółowy opis plików

### Punkt wejścia

#### `src/main.ts`
**Co robi:** Bootstrap aplikacji NestJS. Tworzy instancję, ustawia globalny prefix `/api`, startuje na porcie z .env (domyślnie 3000).
**Powiązania:** Importuje `AppModule`.

#### `src/app.module.ts`
**Co robi:** Główny moduł — zbiera wszystkie podmoduły w jednym miejscu.
**Importuje:** ConfigModule, DatabaseModule, EventsModule, QueuesModule, CollectorsModule, SentimentModule, AlertsModule, ApiModule.

---

### Konfiguracja (`src/config/`)

#### `config.module.ts`
**Co robi:** Ładuje zmienne z `.env` przy starcie aplikacji. Waliduje je schematem Joi. Eksportuje `ConfigService` dostępny globalnie we wszystkich modułach.
**Powiązania:** Używany przez `database.module.ts` (połączenie DB), `queues.module.ts` (połączenie Redis), kolektory (klucze API), `telegram.service.ts` (token bota), `finbert-client.service.ts` (URL sidecar).

#### `env.validation.ts`
**Co robi:** Schemat Joi definiujący wymagane i opcjonalne zmienne .env. Waliduje typy, wartości domyślne.
**Wymagane:** POSTGRES_PASSWORD, FINNHUB_API_KEY, SEC_USER_AGENT, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID.
**Opcjonalne:** REDDIT_*, ANTHROPIC_API_KEY, STOCKTWITS_*, FINBERT_SIDECAR_URL, FINBERT_REQUEST_TIMEOUT_MS.

---

### Baza danych (`src/database/`)

#### `database.module.ts`
**Co robi:** Konfiguruje TypeORM z PostgreSQL. Używa `ConfigService` do pobrania parametrów połączenia. W trybie development włączone `synchronize: true` (automatyczne tworzenie/aktualizacja tabel).
**Powiązania:** Ładuje wszystkie encje z `src/entities/`. Zależy od `ConfigModule`.

#### `seeds/seed.ts`
**Co robi:** Standalone skrypt wypełniający bazę danymi początkowymi: 32 tickery healthcare + reguły alertów. Idempotentny (upsert `orUpdate`).
**Uruchomienie:** `npm run seed`

#### `seeds/backfill-sentiment.ts`
**Co robi:** Standalone skrypt backfill sentymentu — przetwarza historyczne wzmianki i artykuły FinBERT-em. Łączy się bezpośrednio z PostgreSQL i FinBERT sidecar. Wysyła w batchach po 16 tekstów. Idempotentny — pomija rekordy, które już mają wynik w `sentiment_scores`.
**Filtrowanie:** Pomija teksty < 20 znaków (szum: emoji, same tickery).
**Uruchomienie:** `npm run backfill:sentiment`

---

### Encje (`src/entities/`)

Każda encja = jedna tabela w PostgreSQL.

#### `index.ts`
**Co robi:** Re-eksportuje wszystkie encje z jednego miejsca. Pozwala importować `{ Ticker, Alert } from '../entities'`.

#### `ticker.entity.ts` → tabela `tickers`
**Co robi:** 32 spółek healthcare do monitorowania. Zawiera symbol, nazwę, CIK (SEC), podsektor, priorytet, aliasy (JSONB), kluczowe metryki (JSONB), CEO, CFO.
**Używany przez:** Wszystkie kolektory (pobierają listę aktywnych tickerów), `tickers.controller.ts`.

#### `sentiment-score.entity.ts` → tabela `sentiment_scores`
**Co robi:** Wynik analizy sentymentu (-1.0 do +1.0) z confidence, modelem (`finbert`), źródłem, rawText. Indeksowana po [symbol, timestamp].
**Zasilana przez:** `sentiment-processor.service.ts` (real-time), `backfill-sentiment.ts` (historyczne).
**Używany przez:** `sentiment.controller.ts`, `health.controller.ts` (stats).

#### `raw-mention.entity.ts` → tabela `raw_mentions`
**Co robi:** Surowa wzmianka z Reddit lub StockTwits. Przechowuje oryginalne dane (autor, treść, URL, wykryte tickery jako JSONB, sentyment ze źródła).
**Zasilana przez:** `stocktwits.service.ts`, `reddit.service.ts`.
**Używany przez:** `sentiment.controller.ts`, `sentiment-processor.service.ts`.

#### `news-article.entity.ts` → tabela `news_articles`
**Co robi:** Artykuł newsowy z Finnhub. Tytuł, źródło, URL, podsumowanie, kategoria, wynik sentymentu (null = nie analizowano, wypełniane przez pipeline FinBERT).
**Zasilana przez:** `finnhub.service.ts`.
**Używany przez:** `sentiment.controller.ts`, `sentiment-processor.service.ts`.

#### `sec-filing.entity.ts` → tabela `sec_filings`
**Co robi:** Filing SEC (8-K, 10-Q, 10-K, Form 4). Numer accession (unikalny), typ formularza, data złożenia, URL dokumentu.
**Zasilana przez:** `sec-edgar.service.ts`.

#### `insider-trade.entity.ts` → tabela `insider_trades`
**Co robi:** Transakcja insiderowska z Form 4. Nazwa insidera, rola, typ (BUY/SELL), liczba akcji, wartość, data.
**Zasilana przez:** `finnhub.service.ts` (MSPR), `sec-edgar.service.ts` (Form 4).

#### `alert.entity.ts` → tabela `alerts`
**Co robi:** Historia wysłanych alertów. Zawiera ticker, nazwę reguły, priorytet, kanał (TELEGRAM), treść wiadomości, czy dostarczono.
**Zasilana przez:** `alert-evaluator.service.ts`.
**Używany przez:** `alerts.controller.ts`.

#### `alert-rule.entity.ts` → tabela `alert_rules`
**Co robi:** Konfiguracja reguł alertów. Nazwa, warunek (tekst), priorytet, minuty throttlingu, czy aktywna. Reguły: "Insider Trade Large", "8-K Material Event", "Sentiment Crash".
**Używany przez:** `alert-evaluator.service.ts`, `alerts.controller.ts`.

#### `collection-log.entity.ts` → tabela `collection_logs`
**Co robi:** Log każdego cyklu zbierania danych. Nazwa kolektora (enum), status (SUCCESS/PARTIAL/FAILED), ile elementów, czas trwania, błąd.
**Zasilana przez:** `base-collector.service.ts`.
**Używany przez:** `health.controller.ts` (status zdrowia + countdown).

---

### Współdzielone (`src/common/`)

#### `interfaces/data-source.enum.ts`
**Co robi:** Enum `DataSource` z wartościami: REDDIT, FINNHUB, SEC_EDGAR, STOCKTWITS.
**Używany przez:** Encje (`sentiment_scores.source`, `raw_mentions.source`, `collection_logs.collector`), kolektory, `sentiment-listener.service.ts`.

#### `interfaces/collector.interface.ts`
**Co robi:** Interfejs `ICollector` — kontrakt dla kolektorów: `collect()`, `getSourceName()`, `getHealthStatus()`. Plus interfejs `CollectorHealth` dla statusu zdrowia.
**Implementowany przez:** `BaseCollectorService` → wszystkie kolektory.

#### `filters/http-exception.filter.ts`
**Co robi:** Globalny filtr błędów HTTP. Przechwytuje wyjątki i zwraca ustandaryzowany JSON: `{ statusCode, message, timestamp, path }`.

---

### Eventy (`src/events/`)

#### `events.module.ts`
**Co robi:** Rejestruje `EventEmitterModule` z EventEmitter2. Włączony wildcard i separator `.`.
**Powiązania:** Używany przez kolektory (emitują eventy), `sentiment-listener.service.ts` (nasłuchuje) i `alert-evaluator.service.ts` (nasłuchuje).

#### `event-types.ts`
**Co robi:** Enum `EventType` z typami eventów:
- `NEW_MENTION` — nowa wzmianka (Reddit, StockTwits) → uruchamia analizę sentymentu
- `NEW_ARTICLE` — nowy artykuł (Finnhub) → uruchamia analizę sentymentu
- `NEW_FILING` — nowy filing SEC → alert 8-K
- `NEW_INSIDER_TRADE` — nowa transakcja insiderska → alert
- `SENTIMENT_SCORED` — przeanalizowany sentyment FinBERT → alert przy score < -0.5
- `ANOMALY_DETECTED` — wykryta anomalia (Faza 2)
- `ALERT_TRIGGERED` — alert wyzwolony

---

### Kolejki (`src/queues/`)

#### `queue-names.const.ts`
**Co robi:** Definiuje nazwy 6 kolejek BullMQ: `stocktwits-collector`, `finnhub-collector`, `sec-edgar-collector`, `reddit-collector`, `sentiment-analysis`, `alert-processing`.
**Używany przez:** `queues.module.ts`, moduły kolektorów, schedulery, processory, `sentiment.module.ts`.

#### `queues.module.ts`
**Co robi:** Konfiguruje BullMQ — połączenie z Redis, domyślne opcje jobów (3 próby, exponential backoff), rejestruje wszystkie 6 kolejek. Eksportuje `BullModule` do użytku w kolektorach.
**Zależy od:** `ConfigService` (REDIS_HOST, REDIS_PORT).

---

### Kolektory (`src/collectors/`)

Każdy kolektor składa się z 4 plików:

| Plik | Rola | Powiązanie |
|------|------|------------|
| `*.module.ts` | Moduł NestJS, rejestruje encje i kolejkę | Importowany przez `collectors.module.ts` |
| `*.service.ts` | Logika zbierania danych (HTTP, parsowanie, deduplikacja, zapis) | Dziedziczy z `BaseCollectorService` |
| `*.processor.ts` | BullMQ Worker — przetwarza joby z kolejki | Wywołuje `service.runCollectionCycle()` |
| `*.scheduler.ts` | Dodaje repeatable job do kolejki przy starcie | Używa `@InjectQueue` |

#### `shared/base-collector.service.ts`
**Co robi:** Abstrakcyjna klasa bazowa. Implementuje `ICollector`. Zapewnia:
- `logCollection()` — zapis wyniku cyklu do `collection_logs`
- `getHealthStatus()` — ostatni wpis z `collection_logs`
- `runCollectionCycle()` — wrapper z pomiarem czasu, try/catch, logowaniem
**Dziedziczą:** StocktwitsService, FinnhubService, SecEdgarService, RedditService.

#### `collectors.module.ts`
**Co robi:** Zbiorczy moduł importujący wszystkie 4 moduły kolektorów. Eksportuje je do użytku w `ApiModule` (health controller).

#### StockTwits (`stocktwits/`)
- **API:** `https://api.stocktwits.com/api/2`
- **Auth:** Brak (publiczne endpointy)
- **Limit:** ~200 req/hour
- **Co zbiera:** Stream wiadomości per ticker z wbudowanym sentymentem (Bullish/Bearish)
- **Zapisuje do:** `raw_mentions`
- **Emituje:** `EventType.NEW_MENTION` → pipeline sentymentu
- **Cykl:** Co 5 minut

#### Finnhub (`finnhub/`)
- **API:** `https://finnhub.io/api/v1`
- **Auth:** API Key (FINNHUB_API_KEY)
- **Limit:** 60 req/min (free tier)
- **Co zbiera:** Newsy spółek (ostatnie 7 dni) + insider sentiment (MSPR)
- **Zapisuje do:** `news_articles`, `insider_trades`
- **Emituje:** `EventType.NEW_ARTICLE` → pipeline sentymentu, `EventType.NEW_INSIDER_TRADE` → alert
- **Cykl:** Co 10 minut

#### SEC EDGAR (`sec-edgar/`)
- **API:** `https://data.sec.gov` + `https://efts.sec.gov/LATEST`
- **Auth:** Tylko User-Agent z emailem (SEC_USER_AGENT)
- **Limit:** 10 req/sec
- **Co zbiera:** Filingi (10-K, 10-Q, 8-K, Form 4) + insider trades przez EFTS
- **Zapisuje do:** `sec_filings`, `insider_trades`
- **Emituje:** `EventType.NEW_FILING` → alert 8-K, `EventType.NEW_INSIDER_TRADE` → alert
- **Cykl:** Co 30 minut

#### Reddit (`reddit/`)
- **API:** `https://oauth.reddit.com`
- **Auth:** OAuth2 (REDDIT_CLIENT_ID, SECRET, USERNAME, PASSWORD)
- **Limit:** 100 req/min
- **Co zbiera:** Posty z 18 subredditów healthcare, ekstrakcja tickerów ($SYMBOL + znane symbole)
- **Zapisuje do:** `raw_mentions`
- **Emituje:** `EventType.NEW_MENTION` → pipeline sentymentu
- **Cykl:** Co 10 minut (tylko jeśli skonfigurowany)
- **Status:** Scheduler nieaktywny — czeka na zatwierdzenie API access

---

### Analiza sentymentu (`src/sentiment/`)

Pipeline: event z kolektora → BullMQ → FinBERT sidecar (GPU) → zapis do bazy → alert.

#### `sentiment.module.ts`
**Co robi:** Moduł zbiorczy. Rejestruje encje (SentimentScore, RawMention, NewsArticle), kolejkę `sentiment-analysis`. Providerzy: FinbertClientService, SentimentListenerService, SentimentProcessorService. Eksportuje FinbertClientService.

#### `finbert-client.service.ts`
**Co robi:** HTTP klient do FinBERT sidecar (Python FastAPI). Metody:
- `analyze(text)` — POST `/api/sentiment` (single text)
- `analyzeBatch(texts)` — POST `/api/sentiment/batch` (do 16 tekstów)
- `isHealthy()` — GET `/health` (sprawdza model_loaded)
**Konfiguracja:** `FINBERT_SIDECAR_URL` (domyślnie `http://finbert:8000`), `FINBERT_REQUEST_TIMEOUT_MS` (domyślnie 30s).
**Zwraca:** `FinbertResult` — label (positive/negative/neutral), score (-1.0 do +1.0), confidence, probabilities, processing_time_ms.

#### `sentiment-listener.service.ts`
**Co robi:** Nasłuchuje eventów z kolektorów i dodaje joby do kolejki `sentiment-analysis`:
- `@OnEvent(NEW_MENTION)` → job `analyze-mention` (priorytet: Reddit=5, StockTwits=10)
- `@OnEvent(NEW_ARTICLE)` → job `analyze-article` (priorytet: 3 — najwyższy)
**Delay:** 500ms na każdy job — pewność że encja jest zapisana w bazie.

#### `sentiment-processor.service.ts`
**Co robi:** BullMQ processor (Worker) kolejki `sentiment-analysis`. Pipeline:
1. Pobiera tekst z `RawMention` (title + body) lub `NewsArticle` (headline + summary)
2. Filtruje teksty < 20 znaków (MIN_TEXT_LENGTH — odrzuca szum: emoji, same tickery)
3. Wysyła do FinBERT sidecar przez `FinbertClientService.analyze()`
4. Zapisuje wynik do `sentiment_scores` (model='finbert')
5. Aktualizuje `sentimentScore` w `news_articles` (jeśli typ = article)
6. Emituje `EventType.SENTIMENT_SCORED` → AlertEvaluator reaguje

---

### FinBERT Sidecar (`finbert-sidecar/`)

Python FastAPI app z modelem ProsusAI/finbert. Uruchamiana jako osobny kontener Docker z GPU passthrough (NVIDIA).

#### `Dockerfile`
**Co robi:** Obraz GPU — bazuje na `pytorch/pytorch:*-cuda*`. Instaluje transformers, fastapi, uvicorn. Preloaduje model przy starcie kontenera.

#### `Dockerfile.cpu`
**Co robi:** Obraz CPU-only — bazuje na `python:3.11-slim`. Bez CUDA, wolniejszy ale nie wymaga GPU.

#### `requirements.txt`
**Co robi:** Zależności Python: transformers, torch, fastapi, uvicorn, pydantic.

#### `app/main.py`
**Co robi:** FastAPI app z endpointami:
- `GET /health` — status modelu (model_loaded, device, model_name)
- `POST /api/sentiment` — analiza jednego tekstu
- `POST /api/sentiment/batch` — analiza batchu tekstów (do BATCH_SIZE)

#### `app/model.py`
**Co robi:** Ładowanie modelu ProsusAI/finbert z HuggingFace, tokenizacja, inferencja. Cachuje model na wolumenie Docker.

---

### Frontend (`frontend/`)

Dashboard React z 4 panelami danych. Odpytuje REST API backendu.

#### `App.tsx`
**Co robi:** Główny layout — 4 panele (Sentiment Scores, News Articles, Social Mentions, SEC Filings) + status kolektorów + podsumowanie bazy.

#### `api.ts`
**Co robi:** Klient HTTP (fetch) do backendu. Endpointy: `/api/health/stats`, `/api/sentiment/scores`, `/api/sentiment/news`, `/api/sentiment/mentions`, `/api/sentiment/filings`.

#### `components/CollectorStatus.tsx`
**Co robi:** Wyświetla status 4 kolektorów: ostatni run, ile elementów, czas, countdown do następnego cyklu.

#### `components/DataPanel.tsx`
**Co robi:** Uniwersalny panel tabelaryczny z danymi (score, tekst, ticker, data).

#### `components/DbSummary.tsx`
**Co robi:** Podsumowanie bazy — totale per tabela, wielkość bazy danych.

---

### Alerty (`src/alerts/`)

#### `alerts.module.ts`
**Co robi:** Moduł alertów. Rejestruje encje Alert i AlertRule. Providerzy: AlertEvaluatorService, TelegramService, TelegramFormatterService.

#### `alert-evaluator.service.ts`
**Co robi:** Serce systemu alertów. Nasłuchuje na eventy przez `@OnEvent()`:
- `NEW_INSIDER_TRADE` → sprawdza regułę "Insider Trade Large"
- `NEW_FILING` → sprawdza regułę "8-K Material Event" (tylko 8-K)
- `SENTIMENT_SCORED` → sprawdza regułę "Sentiment Crash" (score < -0.5, confidence > 0.7)

Implementuje **throttling** — sprawdza w tabeli `alerts` czy w ciągu ostatnich N minut (z `alert_rules.throttleMinutes`) nie był już wysłany alert tego samego typu per ticker.

**Powiązania:** Nasłuchuje eventów z kolektorów i sentiment pipeline → sprawdza reguły w `alert_rules` → wysyła przez `TelegramService` → zapisuje do `alerts`.

#### `telegram/telegram.service.ts`
**Co robi:** Wrapper HTTP do Telegram Bot API. Metody `sendMarkdown()` i `sendText()`. Sprawdza czy bot jest skonfigurowany (token + chat_id).
**Zależy od:** `ConfigService` (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID).

#### `telegram/telegram-formatter.service.ts`
**Co robi:** Generuje sformatowane wiadomości alertów w MarkdownV2. Obsługuje escapowanie znaków specjalnych. Typy alertów:
- `formatSentimentAlert()` — alert sentymentu (score < -0.5)
- `formatInsiderTradeAlert()` — alert transakcji insiderskiej
- `formatFilingAlert()` — alert nowego filingu SEC

---

### REST API (`src/api/`)

#### `api.module.ts`
**Co robi:** Zbiorczy moduł API. Importuje encje, `CollectorsModule` (dostęp do serwisów kolektorów) i `AlertsModule` (dostęp do TelegramService). Rejestruje 4 kontrolery.

#### `health/health.controller.ts`
**Endpointy:**
- `GET /api/health` — status zdrowia systemu, odpytuje `getHealthStatus()` każdego kolektora, sprawdza Telegram
- `GET /api/health/stats` — szczegółowe statystyki: totale per tabela (9 tabel), interwały kolektorów, countdown do następnego pobrania, wielkość bazy

**Powiązania:** Serwisy kolektorów, TelegramService, repozytoria wszystkich encji.

#### `tickers/tickers.controller.ts`
**Endpoint:** `GET /api/tickers`, `GET /api/tickers/:symbol`
**Co robi:** Lista aktywnych tickerów z możliwością filtrowania po `?subsector=`. Szczegóły konkretnego tickera po symbolu.
**Powiązania:** Bezpośrednio `TickerRepository`.

#### `sentiment/sentiment.controller.ts`
**Endpointy:**
- `GET /api/sentiment/scores?limit=100` — wszystkie wyniki sentymentu (najnowsze)
- `GET /api/sentiment/news?limit=100` — ostatnie newsy (wszystkie tickery)
- `GET /api/sentiment/mentions?limit=100` — ostatnie wzmianki social media
- `GET /api/sentiment/filings?limit=100` — ostatnie filingi SEC
- `GET /api/sentiment/:ticker?limit=50` — dane sentymentu per ticker (scores + mentions + news)

**Powiązania:** `SentimentScoreRepository`, `RawMentionRepository`, `NewsArticleRepository`.

#### `alerts/alerts.controller.ts`
**Endpoint:** `GET /api/alerts?symbol=UNH&limit=50`, `GET /api/alerts/rules`
**Co robi:** Historia wysłanych alertów z filtrowaniem po symbolu. Lista reguł alertów.
**Powiązania:** `AlertRepository`, `AlertRuleRepository`.

---

## Schemat przepływu danych

```
                         ┌─────────────┐
                         │  Scheduler  │  (co N min dodaje job do kolejki)
                         └──────┬──────┘
                                │
                         ┌──────▼──────┐
                         │  BullMQ     │  (kolejka kolektora w Redis)
                         │  Queue      │
                         └──────┬──────┘
                                │
                         ┌──────▼──────┐
                         │  Processor  │  (BullMQ Worker przetwarza job)
                         └──────┬──────┘
                                │
                         ┌──────▼──────┐
                         │  Service    │  (HTTP → parse → deduplikacja → zapis)
                         └──────┬──────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                  │
       ┌──────▼──────┐   ┌─────▼──────┐   ┌──────▼──────────┐
       │ PostgreSQL   │   │ Event Bus  │   │ collection_logs │
       │ (encja)      │   └─────┬──────┘   └─────────────────┘
       └──────────────┘         │
                          ┌─────▼──────────────┐
                          │ SentimentListener   │  (nasłuchuje NEW_MENTION / NEW_ARTICLE)
                          └─────┬──────────────┘
                                │
                         ┌──────▼──────────┐
                         │ BullMQ Queue    │  (sentiment-analysis)
                         │ sentiment       │
                         └──────┬──────────┘
                                │
                         ┌──────▼──────────┐
                         │ Sentiment       │  (pobiera tekst z DB)
                         │ Processor       │
                         └──────┬──────────┘
                                │
                         ┌──────▼──────────┐
                         │ FinBERT Sidecar │  (GPU: ProsusAI/finbert)
                         │ POST /api/sent. │
                         └──────┬──────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                  │
       ┌──────▼──────────┐ ┌───▼───────────┐ ┌───▼──────────────────┐
       │ sentiment_scores │ │ Event Bus     │ │ news_articles        │
       │ (nowy rekord)    │ │ SENTIMENT_    │ │ (update sentScore)   │
       └─────────────────┘ │ SCORED        │ └──────────────────────┘
                           └───┬───────────┘
                               │
                         ┌─────▼────────────┐
                         │ AlertEvaluator   │  (sprawdza reguły + throttling)
                         └─────┬────────────┘
                               │
                         ┌─────▼────────────┐
                         │ TelegramService  │  → Telegram Bot API
                         └─────┬────────────┘
                               │
                         ┌─────▼────────────┐
                         │ alerts (tabela)  │  (historia wysyłki)
                         └──────────────────┘
```

---

## Schemat modułów NestJS

```
AppModule
├── ConfigModule          (globalny — .env + Joi)
├── DatabaseModule        (TypeORM + PostgreSQL)
├── EventsModule          (EventEmitter2)
├── QueuesModule          (BullMQ + Redis)
│   └── 6 kolejek
├── CollectorsModule
│   ├── StocktwitsModule  (service + processor + scheduler)
│   ├── FinnhubModule     (service + processor + scheduler)
│   ├── SecEdgarModule    (service + processor + scheduler)
│   └── RedditModule      (service + processor + scheduler)
├── SentimentModule
│   ├── FinbertClientService       (HTTP klient → FinBERT sidecar)
│   ├── SentimentListenerService   (nasłuchuje eventów → dodaje joby)
│   └── SentimentProcessorService  (BullMQ worker → FinBERT → zapis)
├── AlertsModule
│   ├── AlertEvaluatorService  (nasłuchuje: insider trade, filing, sentiment)
│   ├── TelegramService        (wysyłka)
│   └── TelegramFormatterService (formatowanie MarkdownV2)
└── ApiModule
    ├── HealthController       (GET /api/health, /api/health/stats)
    ├── TickersController      (GET /api/tickers)
    ├── SentimentController    (GET /api/sentiment/* — 5 endpointów)
    └── AlertsController       (GET /api/alerts)
```

---

## Schemat bazy danych (9 tabel)

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   tickers    │     │  raw_mentions    │     │  news_articles   │
│──────────────│     │──────────────────│     │──────────────────│
│ id           │     │ id               │     │ id               │
│ symbol (UK)  │◄────│ detectedTickers[]│     │ symbol           │
│ name         │     │ source (enum)    │     │ headline         │
│ cik          │     │ externalId       │     │ source           │
│ subsector    │     │ author           │     │ url              │
│ priority     │     │ body             │     │ summary          │
│ aliases []   │     │ url              │     │ sentimentScore   │
│ keyMetrics[] │     │ sourceSentiment  │     │ publishedAt      │
│ ceo, cfo     │     │ publishedAt      │     │ collectedAt      │
│ isActive     │     │ collectedAt      │     └──────────────────┘
└──────────────┘     └──────────────────┘
                                               ┌──────────────────┐
┌──────────────┐     ┌──────────────────┐     │ insider_trades   │
│ sec_filings  │     │ sentiment_scores │     │──────────────────│
│──────────────│     │──────────────────│     │ id               │
│ id           │     │ id               │     │ symbol           │
│ symbol       │     │ symbol           │     │ insiderName      │
│ cik          │     │ score (-1 to +1) │     │ insiderRole      │
│ formType     │     │ confidence       │     │ transactionType  │
│ accessionNum │     │ source (enum)    │     │ shares           │
│ filingDate   │     │ model ('finbert')│     │ pricePerShare    │
│ description  │     │ rawText          │     │ totalValue       │
│ documentUrl  │     │ externalId       │     │ transactionDate  │
│ collectedAt  │     │ timestamp        │     │ accessionNumber  │
└──────────────┘     └──────────────────┘     │ collectedAt      │
                                               └──────────────────┘
┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   alerts     │     │  alert_rules     │     │ collection_logs  │
│──────────────│     │──────────────────│     │──────────────────│
│ id           │     │ id               │     │ id               │
│ symbol       │     │ name (UK)        │     │ collector (enum) │
│ ruleName     │────►│ condition        │     │ status           │
│ priority     │     │ priority         │     │ itemsCollected   │
│ channel      │     │ throttleMinutes  │     │ errorMessage     │
│ message      │     │ isActive         │     │ durationMs       │
│ delivered    │     │ createdAt        │     │ startedAt        │
│ sentAt       │     │ updatedAt        │     └──────────────────┘
└──────────────┘     └──────────────────┘
```

---

## Docker Compose — 6 serwisów

| Serwis | Obraz | Port | Rola |
|--------|-------|------|------|
| `app` | `stockpulse-app` (Dockerfile) | 3000 | NestJS aplikacja (backend) |
| `postgres` | `timescale/timescaledb:latest-pg16` | 5432 | Baza danych PostgreSQL + TimescaleDB |
| `redis` | `redis:7-alpine` | 6379 | Kolejki BullMQ + cache |
| `frontend` | `stockpulse-frontend` (frontend/Dockerfile) | 3001 | Dashboard React (Vite dev server) |
| `finbert` | `stockpulse-finbert` (finbert-sidecar/Dockerfile) | 8000 | FinBERT sidecar (ProsusAI/finbert na GPU) |
| `pgadmin` | `dpage/pgadmin4:latest` | 5050 | pgAdmin — przeglądarka bazy danych |

Wewnątrz sieci Docker hosty to nazwy serwisów: `postgres`, `redis`, `finbert` (nie `localhost`).

**GPU:** FinBERT wymaga NVIDIA GPU passthrough (Docker + NVIDIA Container Toolkit). Alternatywnie: `docker-compose.cpu.yml` dla trybu CPU-only.

**Wolumeny:** `postgres_data`, `redis_data`, `pgadmin_data`, `finbert_cache` (cache modelu HuggingFace — nie pobiera ponownie przy restart).

---

## Skrypty npm

| Komenda | Co robi |
|---------|---------|
| `npm run build` | Kompilacja TypeScript → `dist/` |
| `npm run start` | Start produkcyjny (z `dist/`) |
| `npm run start:dev` | Build + start (development) |
| `npm run test` | Testy jednostkowe (Jest) |
| `npm run test:all` | Wszystkie testy integracji API |
| `npm run test:reddit` | Test Reddit OAuth2 |
| `npm run test:finnhub` | Test Finnhub API |
| `npm run test:edgar` | Test SEC EDGAR API |
| `npm run test:stocktwits` | Test StockTwits API |
| `npm run test:telegram` | Test Telegram Bot |
| `npm run seed` | Wypełnienie bazy: tickers + alert_rules |
| `npm run backfill:sentiment` | Backfill sentymentu FinBERT na historycznych danych |
