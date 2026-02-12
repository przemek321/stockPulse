# StockPulse — Schemat struktury katalogów

> Szczegółowy opis każdego pliku, co robi i z czym jest powiązany.

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
│   │   └── database.module.ts              # TypeORM + PostgreSQL
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
│       │   └── health.controller.ts        # GET /api/health
│       ├── tickers/
│       │   └── tickers.controller.ts       # GET /api/tickers
│       ├── sentiment/
│       │   └── sentiment.controller.ts     # GET /api/sentiment/:ticker
│       └── alerts/
│           └── alerts.controller.ts        # GET /api/alerts
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
│   ├── PROGRESS-STATUS.md                  # Status projektu i plan
│   ├── schematy.md                         # ← TEN PLIK
│   ├── stockpulse-healthcare-universe.json # 32 tickery, 180 keywords, reguły
│   ├── stockpulse-architecture.jsx         # Opis architektury warstw
│   ├── StockPulse-Setup-README.md          # Instrukcja setupu
│   └── StockPulse-Opis-Architektury.docx   # Opis w formacie Word
│
├── Dockerfile                              # Obraz Docker dla NestJS app
├── docker-compose.yml                      # 3 serwisy: app, postgres, redis
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
**Importuje:** ConfigModule, DatabaseModule, EventsModule, QueuesModule, CollectorsModule, AlertsModule, ApiModule.

---

### Konfiguracja (`src/config/`)

#### `config.module.ts`
**Co robi:** Ładuje zmienne z `.env` przy starcie aplikacji. Waliduje je schematem Joi. Eksportuje `ConfigService` dostępny globalnie we wszystkich modułach.
**Powiązania:** Używany przez `database.module.ts` (połączenie DB), `queues.module.ts` (połączenie Redis), kolektory (klucze API), `telegram.service.ts` (token bota).

#### `env.validation.ts`
**Co robi:** Schemat Joi definiujący wymagane i opcjonalne zmienne .env. Waliduje typy, wartości domyślne.
**Wymagane:** POSTGRES_PASSWORD, FINNHUB_API_KEY, SEC_USER_AGENT, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID.
**Opcjonalne:** REDDIT_*, ANTHROPIC_API_KEY, STOCKTWITS_*.

---

### Baza danych (`src/database/`)

#### `database.module.ts`
**Co robi:** Konfiguruje TypeORM z PostgreSQL. Używa `ConfigService` do pobrania parametrów połączenia. W trybie development włączone `synchronize: true` (automatyczne tworzenie/aktualizacja tabel).
**Powiązania:** Ładuje wszystkie encje z `src/entities/`. Zależy od `ConfigModule`.

---

### Encje (`src/entities/`)

Każda encja = jedna tabela w PostgreSQL.

#### `index.ts`
**Co robi:** Re-eksportuje wszystkie encje z jednego miejsca. Pozwala importować `{ Ticker, Alert } from '../entities'`.

#### `ticker.entity.ts` → tabela `tickers`
**Co robi:** 32 spółek healthcare do monitorowania. Zawiera symbol, nazwę, CIK (SEC), podsektor, priorytet, aliasy (JSONB), kluczowe metryki (JSONB), CEO, CFO.
**Używany przez:** Wszystkie kolektory (pobierają listę aktywnych tickerów), `tickers.controller.ts`.

#### `sentiment-score.entity.ts` → tabela `sentiment_scores`
**Co robi:** Wynik analizy sentymentu (-1.0 do +1.0) z confidence, modelem, źródłem. Indeksowana po [symbol, timestamp].
**Docelowo:** Hypertable TimescaleDB (Faza 2). Zasilana przez FinBERT i Claude.
**Używany przez:** `sentiment.controller.ts`.

#### `raw-mention.entity.ts` → tabela `raw_mentions`
**Co robi:** Surowa wzmianka z Reddit lub StockTwits. Przechowuje oryginalne dane (autor, treść, URL, wykryte tickery jako JSONB, sentyment ze źródła).
**Zasilana przez:** `stocktwits.service.ts`, `reddit.service.ts`.
**Używany przez:** `sentiment.controller.ts`.

#### `news-article.entity.ts` → tabela `news_articles`
**Co robi:** Artykuł newsowy z Finnhub. Tytuł, źródło, URL, podsumowanie, kategoria, wynik sentymentu (null = nie analizowano).
**Zasilana przez:** `finnhub.service.ts`.
**Używany przez:** `sentiment.controller.ts`.

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
**Co robi:** Konfiguracja reguł alertów. Nazwa, warunek (tekst), priorytet, minuty throttlingu, czy aktywna.
**Używany przez:** `alert-evaluator.service.ts`, `alerts.controller.ts`.

#### `collection-log.entity.ts` → tabela `collection_logs`
**Co robi:** Log każdego cyklu zbierania danych. Nazwa kolektora (enum), status (SUCCESS/PARTIAL/FAILED), ile elementów, czas trwania, błąd.
**Zasilana przez:** `base-collector.service.ts`.
**Używany przez:** `health.controller.ts` (status zdrowia).

---

### Współdzielone (`src/common/`)

#### `interfaces/data-source.enum.ts`
**Co robi:** Enum `DataSource` z wartościami: REDDIT, FINNHUB, SEC_EDGAR, STOCKTWITS.
**Używany przez:** Encje (`sentiment_scores.source`, `raw_mentions.source`, `collection_logs.collector`), kolektory.

#### `interfaces/collector.interface.ts`
**Co robi:** Interfejs `ICollector` — kontrakt dla kolektorów: `collect()`, `getSourceName()`, `getHealthStatus()`. Plus interfejs `CollectorHealth` dla statusu zdrowia.
**Implementowany przez:** `BaseCollectorService` → wszystkie kolektory.

#### `filters/http-exception.filter.ts`
**Co robi:** Globalny filtr błędów HTTP. Przechwytuje wyjątki i zwraca ustandaryzowany JSON: `{ statusCode, message, timestamp, path }`.

---

### Eventy (`src/events/`)

#### `events.module.ts`
**Co robi:** Rejestruje `EventEmitterModule` z EventEmitter2. Włączony wildcard i separator `.`.
**Powiązania:** Używany przez kolektory (emitują eventy) i `alert-evaluator.service.ts` (nasłuchuje eventów).

#### `event-types.ts`
**Co robi:** Enum `EventType` z typami eventów:
- `NEW_MENTION` — nowa wzmianka (Reddit, StockTwits)
- `NEW_ARTICLE` — nowy artykuł (Finnhub)
- `NEW_FILING` — nowy filing SEC
- `NEW_INSIDER_TRADE` — nowa transakcja insiderska
- `SENTIMENT_SCORED` — przeanalizowany sentyment (Faza 2)
- `ANOMALY_DETECTED` — wykryta anomalia (Faza 2)
- `ALERT_TRIGGERED` — alert wyzwolony

---

### Kolejki (`src/queues/`)

#### `queue-names.const.ts`
**Co robi:** Definiuje nazwy 6 kolejek BullMQ: `stocktwits-collector`, `finnhub-collector`, `sec-edgar-collector`, `reddit-collector`, `sentiment-analysis`, `alert-processing`.
**Używany przez:** `queues.module.ts`, moduły kolektorów, schedulery, processory.

#### `queues.module.ts`
**Co robi:** Konfiguruje BullMQ — połączenie z Redis, domyślne opcje jobów (3 próby, exponential backoff), rejestruje wszystkie 6 kolejek. Eksportuje `BullModule` do użytku w kolektorach.
**Zależy od:** `ConfigService` (REDIS_HOST, REDIS_PORT).

---

### Kolektory (`src/collectors/`)

Każdy kolektor składa się z 4 plików:

| Plik | Rola | Powiązanie |
|------|------|------------|
| `*.module.ts` | Moduł NestJS, rejestruje encje i kolejkę | Importowany przez `collectors.module.ts` |
| `*.service.ts` | Logika zbierania danych (HTTP, parsowanie, zapis) | Dziedziczy z `BaseCollectorService` |
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
- **Emituje:** `EventType.NEW_MENTION`
- **Cykl:** Co 5 minut

#### Finnhub (`finnhub/`)
- **API:** `https://finnhub.io/api/v1`
- **Auth:** API Key (FINNHUB_API_KEY)
- **Limit:** 60 req/min (free tier)
- **Co zbiera:** Newsy spółek (ostatnie 7 dni) + insider sentiment (MSPR)
- **Zapisuje do:** `news_articles`, `insider_trades`
- **Emituje:** `EventType.NEW_ARTICLE`, `EventType.NEW_INSIDER_TRADE`
- **Cykl:** Co 10 minut

#### SEC EDGAR (`sec-edgar/`)
- **API:** `https://data.sec.gov` + `https://efts.sec.gov/LATEST`
- **Auth:** Tylko User-Agent z emailem (SEC_USER_AGENT)
- **Limit:** 10 req/sec
- **Co zbiera:** Filingi (10-K, 10-Q, 8-K, Form 4) + insider trades przez EFTS
- **Zapisuje do:** `sec_filings`, `insider_trades`
- **Emituje:** `EventType.NEW_FILING`, `EventType.NEW_INSIDER_TRADE`
- **Cykl:** Co 30 minut

#### Reddit (`reddit/`)
- **API:** `https://oauth.reddit.com`
- **Auth:** OAuth2 (REDDIT_CLIENT_ID, SECRET, USERNAME, PASSWORD)
- **Limit:** 100 req/min
- **Co zbiera:** Posty z 18 subredditów healthcare, ekstrakcja tickerów ($SYMBOL + znane symbole)
- **Zapisuje do:** `raw_mentions`
- **Emituje:** `EventType.NEW_MENTION`
- **Cykl:** Co 10 minut (tylko jeśli skonfigurowany)
- **Status:** Scheduler nieaktywny — czeka na zatwierdzenie API access

---

### Alerty (`src/alerts/`)

#### `alerts.module.ts`
**Co robi:** Moduł alertów. Rejestruje encje Alert i AlertRule. Providerzy: AlertEvaluatorService, TelegramService, TelegramFormatterService.

#### `alert-evaluator.service.ts`
**Co robi:** Serce systemu alertów. Nasłuchuje na eventy przez `@OnEvent()`:
- `NEW_INSIDER_TRADE` → sprawdza regułę "Insider Trade Large"
- `NEW_FILING` → sprawdza reguły "8-K Material Event" / "Insider Trade Large"

Implementuje **throttling** — sprawdza w tabeli `alerts` czy w ciągu ostatnich N minut (z `alert_rules.throttleMinutes`) nie był już wysłany alert tego samego typu per ticker.

**Powiązania:** Nasłuchuje eventów z kolektorów → sprawdza reguły w `alert_rules` → wysyła przez `TelegramService` → zapisuje do `alerts`.

#### `telegram/telegram.service.ts`
**Co robi:** Wrapper HTTP do Telegram Bot API. Metody `sendMarkdown()` i `sendText()`. Sprawdza czy bot jest skonfigurowany (token + chat_id).
**Zależy od:** `ConfigService` (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID).

#### `telegram/telegram-formatter.service.ts`
**Co robi:** Generuje sformatowane wiadomości alertów w MarkdownV2. Obsługuje escapowanie znaków specjalnych. Typy alertów:
- `formatSentimentAlert()` — alert sentymentu
- `formatInsiderTradeAlert()` — alert transakcji insiderskiej
- `formatFilingAlert()` — alert nowego filingu SEC

---

### REST API (`src/api/`)

#### `api.module.ts`
**Co robi:** Zbiorczy moduł API. Importuje encje, `CollectorsModule` (dostęp do serwisów kolektorów) i `AlertsModule` (dostęp do TelegramService). Rejestruje 4 kontrolery.

#### `health/health.controller.ts`
**Endpoint:** `GET /api/health`
**Co robi:** Zwraca status zdrowia systemu. Odpytuje `getHealthStatus()` każdego kolektora. Sprawdza czy Telegram jest skonfigurowany. Zwraca `status: "healthy"` lub `"degraded"`.
**Powiązania:** Używa serwisów kolektorów i TelegramService.

#### `tickers/tickers.controller.ts`
**Endpoint:** `GET /api/tickers`, `GET /api/tickers/:symbol`
**Co robi:** Lista aktywnych tickerów z możliwością filtrowania po `?subsector=`. Szczegóły konkretnego tickera po symbolu.
**Powiązania:** Bezpośrednio `TickerRepository`.

#### `sentiment/sentiment.controller.ts`
**Endpoint:** `GET /api/sentiment/:ticker?limit=50`
**Co robi:** Dane sentymentu per ticker — wyniki analizy, surowe wzmianki, artykuły newsowe. Trzy sekcje w odpowiedzi: `scores`, `mentions`, `news`.
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
                    │  BullMQ     │  (kolejka w Redis)
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
              ┌────────────┼────────────┐
              │            │            │
       ┌──────▼──────┐   ┌▼──────┐   ┌─▼────────────┐
       │ PostgreSQL   │   │ Event │   │ collection   │
       │ (encja)      │   │ Bus   │   │ _logs        │
       └──────────────┘   └──┬────┘   └──────────────┘
                             │
                    ┌────────▼────────┐
                    │ AlertEvaluator  │  (sprawdza reguły + throttling)
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │ TelegramService │  → Telegram Bot API
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │ alerts (tabela) │  (historia wysyłki)
                    └─────────────────┘
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
├── AlertsModule
│   ├── AlertEvaluatorService  (nasłuchuje eventów)
│   ├── TelegramService        (wysyłka)
│   └── TelegramFormatterService (formatowanie MarkdownV2)
└── ApiModule
    ├── HealthController       (GET /api/health)
    ├── TickersController      (GET /api/tickers)
    ├── SentimentController    (GET /api/sentiment/:ticker)
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
│ filingDate   │     │ model            │     │ pricePerShare    │
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

## Docker Compose — 3 serwisy

| Serwis | Obraz | Port | Rola |
|--------|-------|------|------|
| `app` | `stockpulse-app` (Dockerfile) | 3000 | NestJS aplikacja |
| `postgres` | `timescale/timescaledb:latest-pg16` | 5432 | Baza danych |
| `redis` | `redis:7-alpine` | 6379 | Kolejki BullMQ |

Wewnątrz sieci Docker hosty to nazwy serwisów: `postgres`, `redis` (nie `localhost`).
