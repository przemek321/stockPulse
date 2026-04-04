# StockPulse — Schemat struktury katalogów

> Szczegółowy opis każdego pliku, co robi i z czym jest powiązany.
> Ostatnia aktualizacja: 2026-04-05

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
│   │   ├── ticker.entity.ts                # ~37 tickery healthcare
│   │   ├── sentiment-score.entity.ts       # Wyniki sentymentu (time-series)
│   │   ├── raw-mention.entity.ts           # Surowe wzmianki (Reddit, StockTwits)
│   │   ├── news-article.entity.ts          # Artykuły newsowe (Finnhub)
│   │   ├── sec-filing.entity.ts            # Filingi SEC (8-K, 10-Q, Form 4)
│   │   ├── insider-trade.entity.ts         # Transakcje insiderów
│   │   ├── alert.entity.ts                 # Historia alertów + Price Outcome (7 pól cenowych, kolumna archived usunięta)
│   │   ├── alert-rule.entity.ts            # Reguły generowania alertów
│   │   ├── collection-log.entity.ts        # Logi cykli zbierania danych
│   │   ├── pdufa-catalyst.entity.ts       # Katalizatory PDUFA (decyzje FDA)
│   │   ├── ai-pipeline-log.entity.ts      # Logi egzekucji pipeline AI
│   │   └── system-log.entity.ts           # Logi systemowe (@Logged decorator)
│   │
│   ├── common/                             # Współdzielone utility
│   │   ├── interfaces/
│   │   │   ├── collector.interface.ts       # Interfejs ICollector
│   │   │   └── data-source.enum.ts          # Enum: REDDIT, FINNHUB, SEC_EDGAR, STOCKTWITS, PDUFA_BIO
│   │   ├── decorators/
│   │   │   └── logged.decorator.ts          # @Logged(module) — automatyczne logowanie metod
│   │   ├── utils/
│   │   │   └── market-hours.util.ts          # isNyseOpen() + getEffectiveStartTime() — godziny sesji NYSE, sloty od open dla pre-market
│   │   └── filters/
│   │       └── http-exception.filter.ts     # Globalny filtr błędów HTTP
│   │
│   ├── events/                             # Event Bus (komunikacja wewnętrzna)
│   │   ├── events.module.ts                # EventEmitterModule
│   │   └── event-types.ts                  # Enum typów eventów
│   │
│   ├── queues/                             # Kolejki zadań BullMQ
│   │   ├── queue-names.const.ts            # Nazwy 8 kolejek (+ options-flow-collector)
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
│   │   │   ├── sec-edgar.scheduler.ts      # Cron co 30 min
│   │   │   └── form4-parser.ts             # Parser XML Form 4 (insider trades)
│   │   ├── reddit/
│   │   │   ├── reddit.module.ts
│   │   │   ├── reddit.service.ts           # OAuth2 + wzmianki
│   │   │   ├── reddit.processor.ts         # BullMQ worker
│   │   │   └── reddit.scheduler.ts         # Cron co 10 min (jeśli skonfigurowany)
│   │   └── pdufa-bio/
│   │       ├── pdufa-bio.module.ts         # Moduł kolektora PDUFA
│   │       ├── pdufa-bio.service.ts        # Scraping pdufa.bio + buildPdufaContext()
│   │       ├── pdufa-bio.processor.ts      # BullMQ worker
│   │       ├── pdufa-bio.scheduler.ts      # Co 6h + natychmiastowy pierwszy run
│   │       └── pdufa-parser.ts             # Parser HTML tabeli kalendarza PDUFA
│   │
│   ├── sentiment/                          # Warstwa 2: Analiza sentymentu (2-etapowy pipeline)
│   │   ├── sentiment.module.ts             # Moduł zbiorczy + provider alias (Azure→Anthropic)
│   │   ├── finbert-client.service.ts       # HTTP klient do FinBERT sidecar (1. etap)
│   │   ├── anthropic-client.service.ts     # Klient Anthropic Claude Sonnet (2. etap — Sprint 12)
│   │   ├── azure-openai-client.service.ts  # Provider alias → AnthropicClientService (backward compatible)
│   │   ├── sentiment-listener.service.ts   # Nasłuchuje eventów → dodaje joby (Sprint 11: @OnEvent wyłączone)
│   │   └── sentiment-processor.service.ts  # BullMQ processor → FinBERT → eskalacja LLM (Sprint 11: nieaktywny)
│   │
│   ├── sec-filings/                        # Warstwa 2b: Pipeline GPT dla SEC filingów
│   │   ├── sec-filings.module.ts           # Moduł zbiorczy (pipelines, prompts, daily cap)
│   │   ├── sec-filings.controller.ts       # POST /api/sec-filings/backfill-gpt
│   │   ├── pipelines/
│   │   │   ├── form4.pipeline.ts           # Event NEW_INSIDER_TRADE → GPT analiza Form 4
│   │   │   └── form8k.pipeline.ts          # Event NEW_FILING (8-K) → per-Item GPT analiza
│   │   ├── prompts/
│   │   │   ├── form4.prompt.ts             # Prompt GPT dla insider trades (z historią 30d)
│   │   │   ├── form8k-1-01.prompt.ts       # Prompt 8-K Item 1.01 — Material Agreement
│   │   │   ├── form8k-2-02.prompt.ts       # Prompt 8-K Item 2.02 — Results of Operations
│   │   │   ├── form8k-5-02.prompt.ts       # Prompt 8-K Item 5.02 — Leadership Changes
│   │   │   └── form8k-other.prompt.ts      # Prompt 8-K inne Itemy (7.01, 8.01 itd.)
│   │   ├── parsers/
│   │   │   └── form8k.parser.ts            # Parser 8-K: detectItems(), extractItemText(), stripHtml(), isBankruptcyItem()
│   │   ├── scoring/
│   │   │   └── price-impact.scorer.ts      # scoreForm4Priority(), score8kPriority(), mapToRuleName()
│   │   ├── types/
│   │   │   └── sec-filing-analysis.ts      # Zod walidacja odpowiedzi GPT + parseGptResponse()
│   │   └── services/
│   │       └── daily-cap.service.ts        # Redis INCR, max 20 GPT/ticker/dzień, canCallGpt()
│   │
│   ├── system-log/                        # System logowania (@Logged decorator)
│   │   ├── system-log.module.ts           # @Global() moduł (singleton)
│   │   └── system-log.service.ts          # Zapis logów fire-and-forget, cleanup cron 7d
│   │
│   ├── correlation/                        # Warstwa 3: Detekcja wzorców cross-source
│   │   ├── correlation.module.ts           # Moduł (eksportuje CorrelationService)
│   │   ├── correlation.service.ts          # 6 detektorów wzorców (3 aktywne, 3 wyłączone), Redis Sorted Sets
│   │   ├── redis.provider.ts              # Osobna instancja Redis (keyPrefix: 'corr:')
│   │   └── types/
│   │       └── correlation.types.ts       # StoredSignal, CorrelationPattern — interfejsy
│   │
│   ├── price-outcome/                      # Warstwa 3b: Price Outcome Tracker
│   │   ├── price-outcome.module.ts         # Moduł (Alert repo + FinnhubModule)
│   │   └── price-outcome.service.ts        # CRON co 1h — uzupełnia price1h/4h/1d/3d (NYSE open, sloty od getEffectiveStartTime)
│   │
│   ├── alerts/                             # Warstwa 4: Powiadomienia
│   │   ├── alerts.module.ts                # Moduł alertów
│   │   ├── alert-evaluator.service.ts      # 7 aktywnych reguł, early return onSentimentScored/onInsiderTrade (Sprint 11), cache reguł TTL 5min
│   │   ├── summary-scheduler.service.ts    # Raport sentymentu co 2h na Telegram
│   │   └── telegram/
│   │       ├── telegram.module.ts          # Wydzielony TelegramModule (unikanie circular dep)
│   │       ├── telegram.service.ts         # Wysyłka wiadomości Telegram
│   │       └── telegram-formatter.service.ts # Formatowanie MarkdownV2 (po polsku)
│   │
│   └── api/                                # REST API kontrolery
│       ├── api.module.ts                   # Zbiorczy moduł API
│       ├── health/
│       │   ├── health.controller.ts        # GET /health, /health/stats, /health/system-overview, /health/weekly-report, /health/system-stats
│       │   └── system-stats.service.ts     # Statystyki Jetsona (temp, RAM, CPU, GPU)
│       ├── tickers/
│       │   └── tickers.controller.ts       # GET /api/tickers
│       ├── sentiment/
│       │   └── sentiment.controller.ts     # GET /api/sentiment/* (5 endpointów)
│       ├── system-logs/
│       │   └── system-logs.controller.ts   # GET /api/system-logs (z filtrami)
│       ├── alerts/
│       │   └── alerts.controller.ts        # GET /alerts, /alerts/rules, /alerts/outcomes, /alerts/timeline, /alerts/timeline/symbols
│       └── options-flow/
│           └── options-flow.controller.ts  # GET /options-flow, /options-flow/stats, POST /options-flow/backfill
│
├── finbert-sidecar/                        # FinBERT sidecar — Python FastAPI (GPU/CPU)
│   ├── Dockerfile                          # Obraz GPU (CUDA + PyTorch)
│   ├── Dockerfile.cpu                      # Obraz CPU-only (bez CUDA)
│   ├── Dockerfile.jetson                   # Obraz Jetson (L4T PyTorch r35.2.1, Python 3.8)
│   ├── requirements.txt                    # Zależności Python (transformers, fastapi, torch)
│   ├── requirements-jetson.txt             # Zależności Jetson (bez torch — wbudowany w L4T)
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
│       ├── App.tsx                         # Layout główny (MUI Tabs: Dashboard + Signal Timeline + System Logs)
│       ├── api.ts                          # Klient HTTP (/api/*, fetchTimeline, fetchSystemOverview, fetchOptionsFlow itd.)
│       ├── vite-env.d.ts                   # Typy Vite
│       └── components/
│           ├── CollectorStatus.tsx          # Status kolektorów (health + countdown, ukryty Reddit)
│           ├── DataPanel.tsx                # Panel danych (tabela z sortowaniem)
│           ├── DbSummary.tsx               # Podsumowanie bazy (totale per tabela)
│           ├── SentimentChart.tsx           # Wykres sentymentu Recharts (Sprint 11: nieużywany)
│           ├── SystemLogsTab.tsx           # Zakładka System Logs (filtry, tabela, export JSON)
│           ├── SystemHealthPanel.tsx       # Panel Status Systemu (kolektory, błędy, alerty, pipeline)
│           ├── SignalTimeline.tsx          # Signal Timeline — sekwencja sygnałów per ticker
│           ├── JetsonStatsBar.tsx         # Pasek statystyk Jetsona (temp, RAM, CPU, GPU)
│           └── PriceOutcomePanel.tsx      # Panel "Trafność Alertów" (ceny, delty %, hit rate)
│
├── azure-api/                              # Azure VM — legacy gpt-4o-mini (STANDBY od Sprint 12)
│   ├── processor.js                       # POST /analyze — gpt-4o-mini (nieaktywny, zastąpiony Claude Sonnet)
│   ├── api.js                             # Signals API (PM2, port 8000)
│   └── ecosystem.config.js               # PM2 konfiguracja (2 procesy)
│
├── docker/                                 # Pliki konfiguracyjne Docker
│   └── pgadmin-servers.json                # Auto-rejestracja serwera w pgAdmin
│
├── test/                                   # Testy (Jest + ts-jest)
│   ├── unit/                              # Testy jednostkowe
│   │   ├── alert-evaluator.spec.ts         # Testy: Sprint 11 early return, cache reguł, throttling
│   │   ├── correlation.spec.ts             # Logika CorrelationService (direction, conviction, detektory)
│   │   ├── form4-parser.spec.ts            # Parser Form 4 XML
│   │   ├── form8k-parser.spec.ts           # Parser 8-K (Items, stripHtml)
│   │   └── price-impact-scorer.spec.ts     # Scorer SEC filingów (priority, ruleName)
│   └── agents/                            # Testy agentów (realne importy, nie mocki)
│       ├── alert-evaluator-agent.spec.ts   # AlertEvaluator: reguły, throttling, silent rules
│       ├── collectors-agent.spec.ts        # Kolektory: interwały, parsery, health
│       ├── correlation-agent.spec.ts       # CorrelationService: detektory, Redis, progi
│       ├── price-outcome-agent.spec.ts     # PriceOutcome: CRON, NYSE hours, sloty cenowe
│       ├── sec-filings-agent.spec.ts       # SEC pipeline: prompty, Zod, scoring, daily cap
│       └── sentiment-agent.spec.ts         # Sentiment: FinBERT, tier eskalacja, GPT
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
│   ├── PROGRESS-STATUS.md                  # Status projektu i plan działania (główny plik śledzący postęp)
│   ├── JETSON-SETUP.md                     # Dokumentacja setupu Jetsona
│   ├── flow-form4-8k-insider.md            # Przepływ Form 4 + 8-K + Insider Trade Large (diagram + 16 sekcji)
│   ├── schematy.md                         # Ten plik — schemat struktury katalogów
│   ├── stockpulse-healthcare-universe.json # ~37 tickery, 180 keywords, 19 reguł (7 aktywnych, 12 wyłączonych)
│   ├── stockpulse-architecture.jsx         # Opis architektury warstw (wizualizacja)
│   └── reports/                            # Raporty tygodniowe i changelogi
│       ├── 2026-02-24-analiza.md           # Analiza systemu — luty 2026
│       ├── 2026-03-13-weekly-report.md     # Raport tygodniowy 7-13 marca 2026
│       ├── 2026-03-14-zmiany.md            # Changelog: StockTwits GPT exclusion + BullMQ cleanup
│       └── ai-enrichment-analiza.md        # Analiza AI enrichment pipeline
│
├── Dockerfile                              # Obraz Docker dla NestJS app
├── docker-compose.yml                      # 6 serwisów: app, postgres, redis, frontend, finbert, pgadmin
├── docker-compose.cpu.yml                  # Override: laptop bez GPU
├── docker-compose.jetson.yml               # Override: Jetson (L4T + runtime nvidia)
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
**Importuje:** ConfigModule, DatabaseModule, SystemLogModule, EventsModule, QueuesModule, CollectorsModule, SentimentModule, SecFilingsModule, CorrelationModule, OptionsFlowModule, AlertsModule, PriceOutcomeModule, ApiModule.

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
**Co robi:** Standalone skrypt wypełniający bazę danymi początkowymi: ~37 tickery healthcare + 19 reguł alertów (7 aktywnych, 12 wyłączonych). Idempotentny (upsert `orUpdate`).
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
**Co robi:** 37 spółek healthcare do monitorowania. Zawiera symbol, nazwę, CIK (SEC), podsektor, priorytet, aliasy (JSONB), kluczowe metryki (JSONB), CEO, CFO.
**Używany przez:** Wszystkie kolektory (pobierają listę aktywnych tickerów), `tickers.controller.ts`.

#### `sentiment-score.entity.ts` → tabela `sentiment_scores`
**Co robi:** Wynik analizy sentymentu (-1.0 do +1.0) z confidence, modelem (`finbert` lub `finbert+gpt-4o-mini`), źródłem, rawText, enrichedAnalysis (jsonb — wielowymiarowa analiza AI, nullable). Indeksowana po [symbol, timestamp].
**Zasilana przez:** `sentiment-processor.service.ts` (real-time), `backfill-sentiment.ts` (historyczne).
**Używany przez:** `sentiment.controller.ts` (z filtrem `?ai_only=true`), `health.controller.ts` (stats), `summary-scheduler.service.ts` (raport 2h).

#### `raw-mention.entity.ts` → tabela `raw_mentions`
**Co robi:** Surowa wzmianka z Reddit lub StockTwits. Przechowuje oryginalne dane (autor, treść, URL, wykryte tickery jako JSONB, sentyment ze źródła).
**Zasilana przez:** `stocktwits.service.ts`, `reddit.service.ts`.
**Używany przez:** `sentiment.controller.ts`, `sentiment-processor.service.ts`.

#### `news-article.entity.ts` → tabela `news_articles`
**Co robi:** Artykuł newsowy z Finnhub. Tytuł, źródło, URL, podsumowanie, kategoria, wynik sentymentu (null = nie analizowano, wypełniane przez pipeline FinBERT).
**Zasilana przez:** `finnhub.service.ts`.
**Używany przez:** `sentiment.controller.ts`, `sentiment-processor.service.ts`.

#### `sec-filing.entity.ts` → tabela `sec_filings`
**Co robi:** Filing SEC (8-K, 10-Q, 10-K, Form 4). Numer accession (unikalny), typ formularza, data złożenia, URL dokumentu, gptAnalysis (JSONB — wynik GPT pipeline: conviction, price_impact, summary, conclusion, key_facts, catalyst_type), priceImpactDirection.
**Zasilana przez:** `sec-edgar.service.ts` (zbieranie), `form8k.pipeline.ts` (analiza GPT).

#### `insider-trade.entity.ts` → tabela `insider_trades`
**Co robi:** Transakcja insiderowska z Form 4. Nazwa insidera, rola, typ (BUY/SELL), liczba akcji, wartość, data, is10b51Plan (boolean — plan Rule 10b5-1), sharesOwnedAfter.
**Zasilana przez:** `finnhub.service.ts` (MSPR), `sec-edgar.service.ts` (Form 4).

#### `alert.entity.ts` → tabela `alerts`
**Co robi:** Historia wysłanych alertów + Price Outcome Tracker. Pola podstawowe: ticker, ruleName, priorytet, kanał, treść, catalystType, delivered. Pola Price Outcome (Sprint 6): `alertDirection` (positive/negative), `priceAtAlert`, `price1h`, `price4h`, `price1d`, `price3d`, `priceOutcomeDone`.
**Zasilana przez:** `alert-evaluator.service.ts` (alerty + priceAtAlert), `correlation.service.ts` (Correlated Signal), `form4.pipeline.ts`, `form8k.pipeline.ts`, `price-outcome.service.ts` (CRON uzupełnia ceny).
**Używany przez:** `alerts.controller.ts` (w tym endpoint /outcomes), frontend (panele Skorelowane Sygnały + Trafność Alertów).

#### `alert-rule.entity.ts` → tabela `alert_rules`
**Co robi:** Konfiguracja reguł alertów. Nazwa, warunek (tekst), priorytet, minuty throttlingu, czy aktywna. Reguły: "Insider Trade Large", "8-K Material Event", "Sentiment Crash".
**Używany przez:** `alert-evaluator.service.ts`, `alerts.controller.ts`.

#### `collection-log.entity.ts` → tabela `collection_logs`
**Co robi:** Log każdego cyklu zbierania danych. Nazwa kolektora (enum), status (SUCCESS/PARTIAL/FAILED), ile elementów, czas trwania, błąd.
**Zasilana przez:** `base-collector.service.ts`.
**Używany przez:** `health.controller.ts` (status zdrowia + countdown).

#### `pdufa-catalyst.entity.ts` → tabela `pdufa_catalysts`
**Co robi:** Katalizator PDUFA (decyzja FDA). Symbol tickera, nazwa leku, wskazanie, obszar terapeutyczny, data PDUFA, typ eventu, outcome (nullable: APPROVED/CRL/DELAYED), opcjonalnie ODIN tier/score. UNIQUE constraint na (symbol, drugName, pdufaDate).
**Zasilana przez:** `pdufa-bio.service.ts` (scraping pdufa.bio co 6h).
**Używany przez:** `sentiment-processor.service.ts` (Context Layer — wstrzykiwanie do prompta AI), `sentiment.controller.ts` (endpoint `/pdufa`), `summary-scheduler.service.ts` (raport Telegram), `health.controller.ts` (stats).

#### `ai-pipeline-log.entity.ts` → tabela `ai_pipeline_logs`
**Co robi:** Log egzekucji 2-etapowego pipeline AI. 17 kolumn: symbol, source, entityType/Id, status (AI_ESCALATED/FINBERT_ONLY/AI_FAILED/AI_DISABLED/SKIPPED_SHORT/SKIPPED_NOT_FOUND/ERROR), tier, tierReason, finbertScore, finbertConfidence, inputText, pdufaContext, requestPayload (jsonb), responsePayload (jsonb z prompt_used), finbertDurationMs, azureDurationMs, errorMessage, sentimentScoreId.
**Zasilana przez:** `sentiment-processor.service.ts` (budowana inkrementalnie przez cały pipeline).
**Używany przez:** `sentiment.controller.ts` (endpoint `/pipeline-logs`).

#### `system-log.entity.ts` → tabela `system_logs`
**Co robi:** Uniwersalny log wywołań funkcji z decoratora `@Logged()`. Kolumny: module (np. 'collectors', 'sentiment', 'sec-filings', 'correlation', 'alerts'), className, functionName, status ('success'/'error'), durationMs, input (JSONB — argumenty funkcji, obcięte do 2000 znaków), output (JSONB — wartość zwrócona), errorMessage.
**Indeksy:** (module, createdAt), status, functionName.
**Zasilana przez:** `logged.decorator.ts` (fire-and-forget via `SystemLogService.getInstance()`).
**Używany przez:** `system-logs.controller.ts` (endpoint `/system-logs`), frontend `SystemLogsTab`.

---

### Współdzielone (`src/common/`)

#### `interfaces/data-source.enum.ts`
**Co robi:** Enum `DataSource` z wartościami: REDDIT, FINNHUB, SEC_EDGAR, STOCKTWITS, PDUFA_BIO, POLYGON.
**Używany przez:** Encje (`sentiment_scores.source`, `raw_mentions.source`, `collection_logs.collector`), kolektory, `sentiment-listener.service.ts`.

#### `interfaces/collector.interface.ts`
**Co robi:** Interfejs `ICollector` — kontrakt dla kolektorów: `collect()`, `getSourceName()`, `getHealthStatus()`. Plus interfejs `CollectorHealth` dla statusu zdrowia.
**Implementowany przez:** `BaseCollectorService` → wszystkie kolektory.

#### `decorators/logged.decorator.ts`
**Co robi:** Decorator `@Logged(moduleName)` — TypeScript method decorator do automatycznego logowania wywołań metod. Wrappuje async metody, mierzy czas (Date.now), przechwytuje input (argumenty) i output (wartość zwrócona). `truncateForLog()` — obsługa circular refs (WeakSet), obcinanie stringów >500 znaków, JSON >2000 znaków. `serializeArgs()` — wyciąga `.data` z BullMQ Job. Fire-and-forget zapis do bazy przez `SystemLogService.getInstance()?.log(...)`.
**Używany przez:** ~13 metod w 8 serwisach (collectors, sentiment, sec-filings, correlation, alerts).

#### `filters/http-exception.filter.ts`
**Co robi:** Globalny filtr błędów HTTP. Przechwytuje wyjątki i zwraca ustandaryzowany JSON: `{ statusCode, message, timestamp, path }`.

---

### System Logowania (`src/system-log/`)

Globalny moduł logowania wywołań funkcji — singleton pattern z fire-and-forget zapisem do PostgreSQL.

#### `system-log.module.ts`
**Co robi:** `@Global()` moduł NestJS. Importuje TypeORM (SystemLog) i ScheduleModule. Eksportuje SystemLogService. Dzięki `@Global()` decorator `@Logged()` ma dostęp do singletona bez jawnego importu modułu.

#### `system-log.service.ts`
**Co robi:** Serwis z globalnym singletonem (`static instance`, ustawiany w `onModuleInit()`). Metody:
- `log(data)` — fire-and-forget `repo.save()` z catch (nigdy nie blokuje pipeline)
- `findAll(filters)` — QueryBuilder z opcjonalnymi filtrami: module, functionName, status, dateFrom, dateTo, limit (max 500), offset. Zwraca `{ count, total, logs }`
- `cleanup()` — `@Cron('0 3 * * *')` — codzienny cleanup logów starszych niż 7 dni
**Powiązania:** `logged.decorator.ts` (producent logów), `system-logs.controller.ts` (konsument).

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
- `NEW_PDUFA_EVENT` — nowy event PDUFA z kalendarza FDA
- `ANOMALY_DETECTED` — wykryta anomalia (Faza 2)
- `ALERT_TRIGGERED` — alert wyzwolony

---

### Kolejki (`src/queues/`)

#### `queue-names.const.ts`
**Co robi:** Definiuje nazwy 8 kolejek BullMQ: `stocktwits-collector`, `finnhub-collector`, `sec-edgar-collector`, `reddit-collector`, `pdufa-bio-collector`, `sentiment-analysis`, `alert-processing`, `options-flow-collector`.
**Używany przez:** `queues.module.ts`, moduły kolektorów, schedulery, processory, `sentiment.module.ts`.

#### `queues.module.ts`
**Co robi:** Konfiguruje BullMQ — połączenie z Redis, domyślne opcje jobów (3 próby, exponential backoff), rejestruje wszystkie 8 kolejek. Eksportuje `BullModule` do użytku w kolektorach.
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
**Co robi:** Zbiorczy moduł importujący wszystkie 6 modułów kolektorów (StockTwits, Finnhub, SEC EDGAR, Reddit, PDUFA.bio, Options Flow). Eksportuje je do użytku w `ApiModule` (health controller).

#### StockTwits (`stocktwits/`) — **WYŁĄCZONY Sprint 11**
- **Status:** Scheduler czyści repeatable jobs przy starcie. 77% wolumenu, 0% edge.
- **Cykl:** Wyłączony (kod zachowany na wypadek reaktywacji)

#### Finnhub (`finnhub/`) — **WYŁĄCZONY Sprint 11** (news/MSPR)
- **Status:** Scheduler czyści repeatable jobs przy starcie. HFT lag, brak edge.
- **Zachowany:** `getQuote(symbol)` — endpoint `/quote` używany przez Price Outcome Tracker
- **Cykl:** Wyłączony (kod zachowany)

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

#### PDUFA.bio (`pdufa-bio/`)
- **API:** `https://www.pdufa.bio/pdufa-calendar-YYYY`
- **Auth:** Brak (publiczna strona HTML)
- **Limit:** Brak (co 6h to wystarczająco rzadko)
- **Co zbiera:** Kalendarz dat decyzji FDA — ticker, lek, wskazanie, obszar terapeutyczny, data PDUFA
- **Zapisuje do:** `pdufa_catalysts`
- **Emituje:** `EventType.NEW_PDUFA_EVENT`
- **Cykl:** Co 6 godzin + natychmiastowy pierwszy run po starcie
- **Dodatkowa rola:** `buildPdufaContext()` — buduje tekst kontekstu PDUFA wstrzykiwany do prompta Claude Sonnet (Context Layer)

---

### Analiza sentymentu (`src/sentiment/`)

2-etapowy pipeline: event z kolektora → BullMQ → FinBERT sidecar (1. etap) → eskalacja do Claude Sonnet (2. etap, opcjonalny) → zapis do bazy → alert. **Sprint 11: pipeline wyłączony** (listener bez @OnEvent). **Sprint 12: migracja z Azure OpenAI gpt-4o-mini na Anthropic Claude Sonnet**.

#### `sentiment.module.ts`
**Co robi:** Moduł zbiorczy. Provider alias: `AzureOpenaiClientService` → `AnthropicClientService` (backward compatible — Form4Pipeline i Form8kPipeline nie wymagają zmian). Providerzy: FinbertClientService, AnthropicClientService, SentimentListenerService, SentimentProcessorService.

#### `finbert-client.service.ts`
**Co robi:** HTTP klient do FinBERT sidecar (Python FastAPI). Metody:
- `analyze(text)` — POST `/api/sentiment` (single text)
- `analyzeBatch(texts)` — POST `/api/sentiment/batch` (do 16 tekstów)
- `isHealthy()` — GET `/health` (sprawdza model_loaded)
**Konfiguracja:** `FINBERT_SIDECAR_URL` (domyślnie `http://finbert:8000`), `FINBERT_REQUEST_TIMEOUT_MS` (domyślnie 30s).
**Zwraca:** `FinbertResult` — label (positive/negative/neutral), score (-1.0 do +1.0), confidence, probabilities, processing_time_ms.

#### `sentiment-listener.service.ts`
**Co robi:** Nasłuchuje eventów z kolektorów i dodaje joby do kolejki `sentiment-analysis`.
**Sprint 11: WYŁĄCZONY** — `@OnEvent` skomentowane, handlery logują "POMINIĘTY (Sprint 11)". Zero jobów w kolejce sentiment.
**Zachowane na wypadek reaktywacji:** `@OnEvent(NEW_MENTION)` → job `analyze-mention`, `@OnEvent(NEW_ARTICLE)` → job `analyze-article`.

#### `anthropic-client.service.ts` (NOWY — Sprint 12)
**Co robi:** Klient Anthropic Claude Sonnet (SDK `@anthropic-ai/sdk`). Bezpośrednie wywołanie API z NestJS — bez pośrednika Azure VM. Metody:
- `analyzeCustomPrompt(prompt)` — wysyła prompt do Claude, parsuje JSON response
- `analyze(text, symbol, escalationReason, pdufaContext?, source?)` — wzbogacona analiza sentymentu (kompatybilność z AzureOpenaiClientService)
- `isEnabled()` — sprawdza czy `ANTHROPIC_API_KEY` jest skonfigurowany
**Konfiguracja:** `ANTHROPIC_API_KEY` (wymagany), `ANTHROPIC_MODEL` (domyślnie `claude-sonnet-4-6`), `ANTHROPIC_TIMEOUT_MS` (domyślnie 30s).
**Graceful degradation:** Brak klucza → zwraca null, pipeline bez AI.

#### `azure-openai-client.service.ts` (LEGACY — provider alias od Sprint 12)
**Co robi:** Provider alias → AnthropicClientService w SentimentModule. Identyczny interfejs (`isEnabled`, `analyze`, `analyzeCustomPrompt`). Form4Pipeline i Form8kPipeline wstrzykują ten typ, ale faktycznie dostają AnthropicClientService. Azure VM (`74.248.113.3:3100`) na standby jako fallback. Rollback: zmiana `useExisting` na `useClass` w module.

#### `sentiment-processor.service.ts`
**Co robi:** BullMQ processor (Worker) kolejki `sentiment-analysis`. 2-etapowy pipeline z logowaniem:
1. Pobiera tekst z `RawMention` (title + body) lub `NewsArticle` (headline + summary)
2. Filtruje teksty < 20 znaków (MIN_TEXT_LENGTH — odrzuca szum: emoji, same tickery)
3. **1. etap:** Wysyła do FinBERT sidecar przez `FinbertClientService.analyze()`
4. **Filtr źródła:** StockTwits (`isGptEligibleSource = source !== DataSource.STOCKTWITS`) — skip GPT (source_authority=0.15 zeruje conviction, 83% wywołań GPT generowało ~0). Tylko FINNHUB/SEC do AI.
5. **Tier-based eskalacja:** classifyTier (Tier 1 → ZAWSZE AI, Tier 2 → AI jeśli VM aktywna, Tier 3 → skip) — tylko dla źródeł GPT-eligible
6. **PDUFA Context Layer:** pobiera nadchodzące katalizatory z PdufaBioService.getUpcomingCatalysts() i wstrzykuje do prompta
7. **2. etap:** Eskalacja do `AzureOpenaiClientService.analyze()` z pdufaContext → enrichedAnalysis
8. Zapisuje wynik do `sentiment_scores` (model='finbert' lub 'finbert+gpt-4o-mini', enrichedAnalysis jsonb)
9. Aktualizuje `sentimentScore` w `news_articles` (jeśli typ = article)
10. Emituje `EventType.SENTIMENT_SCORED` (z conviction i enrichedAnalysis) → AlertEvaluator reaguje
11. **Pipeline log:** buduje `AiPipelineLog` inkrementalnie na każdym etapie, zapisuje na każdym punkcie wyjścia (statusy: AI_ESCALATED, FINBERT_ONLY, AI_DISABLED, AI_FAILED, SKIPPED_SHORT, ERROR)

---

### SEC Filing GPT Pipeline (`src/sec-filings/`)

Pipeline GPT analizy filingów SEC — Form 4 (insider trades) i 8-K (material events) z per-typ promptami, walidacją Zod, daily cap.

#### `sec-filings.module.ts`
**Co robi:** Moduł zbiorczy. Rejestruje encje (SecFiling, InsiderTrade), importuje TelegramModule, SentimentModule. Providerzy: Form4Pipeline, Form8kPipeline, DailyCapService, SecFilingsController.

#### `sec-filings.controller.ts`
**Co robi:** Kontroler z endpointem backfill.
- `POST /api/sec-filings/backfill-gpt?limit=N` — backfill GPT analizy dla istniejących 8-K filingów bez gptAnalysis (max 50, delay 2s między wywołaniami)

#### `pipelines/form4.pipeline.ts`
**Co robi:** Nasłuchuje `NEW_INSIDER_TRADE` → buduje kontekst (rola, 10b5-1, historia 30d) → prompt GPT → Zod walidacja → alert Telegram. Sprawdza daily cap per ticker.

#### `pipelines/form8k.pipeline.ts`
**Co robi:** Nasłuchuje `NEW_FILING` (8-K only) → fetch tekstu z SEC EDGAR → `detectItems()` → per-Item prompt GPT → Zod walidacja → zapis gptAnalysis do encji → alert. Item 1.03 Bankruptcy → natychmiastowy alert CRITICAL bez GPT.

#### `prompts/` (5 plików)
**Co robią:** Generują prompt GPT dostosowany do typu fillingu. Kalibracja conviction per typ (skala CONVICTION SCALE). Odpowiedź po polsku (summary, conclusion, key_facts).
- `form4.prompt.ts` — insider trades z kontekstem historii 30d
- `form8k-1-01.prompt.ts` — Material Definitive Agreement (kontrakty)
- `form8k-2-02.prompt.ts` — Results of Operations (earnings)
- `form8k-5-02.prompt.ts` — Departure/Appointment of Officers
- `form8k-other.prompt.ts` — ogólne Itemy (7.01, 8.01 itd.)

#### `parsers/form8k.parser.ts`
**Co robi:** Parser treści 8-K: `detectItems()` — wykrywa numery Itemów, `extractItemText()` — wyciąga tekst per Item (limit 8000 znaków), `stripHtml()` — czyści HTML, `isBankruptcyItem()` — wykrywanie Item 1.03, `selectPromptBuilder()` — routowanie do per-Item prompta.

#### `scoring/price-impact.scorer.ts`
**Co robi:** `scoreForm4Priority()` — niższe progi (leading signals), `score8kPriority()` — wyższe progi (reaktywne). `scoreToAlertPriority()` — dispatcher wg formType. `mapToRuleName()` — mapuje catalyst_type na nazwę reguły alertów.

#### `types/sec-filing-analysis.ts`
**Co robi:** Schemat Zod walidujący odpowiedź GPT (price_impact, conviction, summary, conclusion, key_facts, catalyst_type, requires_immediate_attention). `parseGptResponse()` — parsowanie + walidacja JSON z GPT.

#### `services/daily-cap.service.ts`
**Co robi:** Atomowy Redis INCR z TTL 24h w `canCallGpt()` — sprawdza i inkrementuje jednym poleceniem. Max 20 wywołań GPT per ticker per dzień. `recordGptCall()` usunięty (martwy kod po Sprint 7).

---

### CorrelationService (`src/correlation/`)

Detekcja wzorców między źródłami sygnałów — insider trades, 8-K, news, social media.

#### `correlation.module.ts`
**Co robi:** Moduł eksportujący CorrelationService. Importuje TelegramModule, TypeORM (Alert, AlertRule).

#### `correlation.service.ts`
**Co robi:** ~300 linii. 5 detektorów wzorców:
- `detectInsiderPlus8K` — Form 4 + 8-K w 24h
- `detectFilingConfirmsNews` — news → 8-K tego samego catalyst_type w 48h
- `detectMultiSourceConvergence` — 3+ kategorie źródeł, ten sam kierunek, 24h
- `detectInsiderCluster` — 2+ Form 4 jednego tickera w 7 dni
- `detectEscalatingSignal` — rosnąca conviction w 72h

Sygnały przechowywane w Redis Sorted Sets (timestamp jako score). Debounce 10s per ticker. Deduplikacja i throttling per pattern type w Redis. `aggregateConviction()`: najsilniejszy bazowy + 20% boost/źródło, cap 1.0. `getDominantDirection()`: wymaga 66% przewagi.

#### `redis.provider.ts`
**Co robi:** Osobna instancja Redis z `keyPrefix: 'corr:'`. Klucze: `corr:signals:short:{ticker}` (48h TTL) i `corr:signals:insider:{ticker}` (14d TTL).

### Price Outcome Tracker (`src/price-outcome/`)

Mierzenie trafności alertów — zapis ceny akcji w momencie alertu i śledzenie zmian w 4 horyzontach czasowych.

#### `price-outcome.module.ts`
**Co robi:** Moduł importujący TypeORM (Alert) i FinnhubModule (do pobierania cen). Rejestruje PriceOutcomeService.

#### `price-outcome.service.ts`
**Co robi:** CRON `0 * * * *` (co godzinę). Early return gdy giełda NYSE zamknięta (`isNyseOpen()` z `market-hours.util.ts`) — poza sesją Finnhub zwraca cenę zamknięcia (identyczną, bezwartościową). Szuka alertów z `priceAtAlert IS NOT NULL` i `priceOutcomeDone=false`. Dla każdego sprawdza 4 sloty (1h, 4h, 1d, 3d) — jeśli czas minął i pole jest puste → pobiera cenę z `FinnhubService.getQuote()`. Max 30 zapytań Finnhub/cykl (free tier). `priceOutcomeDone=true` gdy wszystkie 4 sloty wypełnione LUB hard timeout 7d (uwzględnia weekendy i święta).

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

Dashboard React z 12+ panelami danych, wykresem sentymentu, zakładkami MUI (Dashboard + System Logs). TextDialog do podglądu i kopiowania długich tekstów. Odpytuje REST API backendu.

#### `App.tsx`
**Co robi:** Główny layout z MUI Tabs (2 zakładki: Dashboard + System Logs). Tab Dashboard: wykres sentymentu (SentimentChart w Accordion, domyślnie zwinięty), 12+ paneli DataPanel: Analiza AI, Pipeline AI (logi egzekucji), Analiza GPT Filingów SEC, Skorelowane Sygnały, Tickery, Wyniki sentymentu, News, SEC EDGAR, Insider Trades, PDUFA Kalendarz, Alerty, Reguły alertów, StockTwits Wzmianki. Status kolektorów + podsumowanie bazy. TextDialog — klikalne okna dialogowe do podglądu i kopiowania. Tab System Logs: `<SystemLogsTab />`.

#### `api.ts`
**Co robi:** Klient HTTP (fetch) do backendu. Interfejsy TypeScript: HealthData, Ticker, NewsArticle, AlertRule, Alert, SentimentScore, EnrichedAnalysis (16 pól AI), AiPipelineLog (19 pól), SystemLog, SystemLogFilters. Endpointy: fetchHealth, fetchTickers, fetchAlertRules, fetchAlerts, fetchSentimentScores, fetchAiScores, fetchPipelineLogs, fetchFilingsGpt, fetchSystemLogs.

#### `components/CollectorStatus.tsx`
**Co robi:** Wyświetla status 3 aktywnych kolektorów (Reddit ukryty): ostatni run, ile elementów, czas, countdown do następnego cyklu. Totale per tabela.

#### `components/DataPanel.tsx`
**Co robi:** Uniwersalny rozwijany panel tabelaryczny z danymi, sortowaniem po kolumnach, lazy loading. Użyty 8x w App.tsx.

#### `components/DbSummary.tsx`
**Co robi:** Podsumowanie bazy — totale per tabela, wielkość bazy danych.

#### `components/SentimentChart.tsx`
**Co robi:** Wykres sentymentu per ticker (Recharts ScatterChart). Dropdown tickerów, zakres czasu. Fioletowe kropki dla AI-eskalowanych wyników, tooltip z danymi AI (sentiment, conviction, urgency, catalyst, summary). Statystyki: średni score, positive/negative/neutral, AI count. Domyślnie schowany w Accordion (rozwijany po kliknięciu).

#### `components/SystemLogsTab.tsx`
**Co robi:** Zakładka System Logs z pełnym widokiem logów z decoratora `@Logged()`. Funkcje:
- Filtry: moduł (dropdown: collectors, sentiment, sec-filings, correlation, alerts), status (success/error)
- Auto-refresh co 30s (toggle)
- Tabela MUI z sortowaniem po kolumnach: Czas, Moduł, Klasa, Funkcja, Status, Czas trwania
- Rozwijane wiersze — kliknięcie wiersza pokazuje INPUT/OUTPUT jako sformatowany JSON w `<pre>`, ERROR na czerwono
- Paginacja (50 na stronę), przycisk Export JSON (pobiera do 500 przefiltrowanych logów)
- Czas trwania >5s podświetlony na pomarańczowo (warning)
- Statystyki: total, success count, error count
**Powiązania:** `fetchSystemLogs()` z `api.ts`.

---

### Alerty (`src/alerts/`)

#### `alerts.module.ts`
**Co robi:** Moduł alertów. Rejestruje encje Alert i AlertRule. Providerzy: AlertEvaluatorService, TelegramService, TelegramFormatterService.

#### `alert-evaluator.service.ts`
**Co robi:** Serce systemu alertów. Implementuje `OnModuleDestroy` (czyszczenie timerów). Nasłuchuje na eventy przez `@OnEvent()`:
- `NEW_INSIDER_TRADE` → agregacja w oknie 5 min per ticker → sprawdza regułę "Insider Trade Large" (tylko BUY/SELL >$100K)
- `NEW_FILING` → sprawdza regułę "8-K Material Event" (tylko 8-K), `@Logged('alerts')`
- `SENTIMENT_SCORED` → 5 niezależnych checków (`Promise.all`): Sentiment Crash, Bullish/Bearish Signal Override, High Conviction Signal, Strong FinBERT Signal, Urgent AI Signal

**Cache reguł:** `getRule()` z TTL 5 min — reguły alertów rzadko się zmieniają, cache eliminuje ~5 zapytań DB na event sentymentu.
**Throttling:** `isThrottled()` z `alertRepo.count()` per (rule, symbol, catalystType), minimalny throttle 1 min.
**Price Outcome:** `sendAlert()` pobiera cenę z `FinnhubService.getQuote()` przed zapisem alertu (1 zapis do DB).

**Powiązania:** Nasłuchuje eventów z kolektorów i sentiment pipeline → sprawdza reguły z cache → wysyła przez `TelegramService` → zapisuje do `alerts` z `priceAtAlert` → rejestruje sygnał w `CorrelationService`.

#### `summary-scheduler.service.ts`
**Co robi:** Cykliczny raport sentymentu co 2 godziny na Telegram. Agreguje: średni score, top 3 negatywne/pozytywne tickery, liczba alertów, liczba eskalacji AI, nadchodzące katalizatory PDUFA (w oknie 7 dni). Pierwszy raport po 15s od startu.
**Powiązania:** `SentimentScoreRepository`, `AlertRepository`, `PdufaCatalystRepository`, `TelegramService`, `PdufaBioService`.

#### `telegram/telegram.service.ts`
**Co robi:** Wrapper HTTP do Telegram Bot API. Metody `sendMarkdown()` i `sendText()`. Sprawdza czy bot jest skonfigurowany (token + chat_id).
**Zależy od:** `ConfigService` (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID).

#### `telegram/telegram-formatter.service.ts`
**Co robi:** Generuje sformatowane wiadomości alertów w MarkdownV2 po polsku. Obsługuje escapowanie znaków specjalnych. Typy alertów:
- `formatSentimentAlert()` — alert sentymentu (score < -0.5) z sekcją AI (sentiment, conviction, type, urgency, price impact, catalyst, summary)
- `formatInsiderTradeAlert()` — alert transakcji insiderskiej
- `formatFilingAlert()` — alert nowego filingu SEC
- `formatForm4GptAlert()` — alert GPT analizy insider trade (Form 4)
- `formatForm8kGptAlert()` — alert GPT analizy 8-K
- `formatBankruptcyAlert()` — alert upadłości (Item 1.03)
- `formatCorrelatedAlert()` — alert skorelowanego wzorca (CorrelationService)
- `formatConvictionAlert()` — alert High Conviction Signal ("Silny Sygnał")
- `formatUrgentAiAlert()` — alert Urgent AI Signal ("Pilny Sygnał AI")
- `formatSignalOverrideAlert()` — alert korekty sygnału (FinBERT vs GPT)

---

### REST API (`src/api/`)

#### `api.module.ts`
**Co robi:** Zbiorczy moduł API. Importuje encje, `CollectorsModule` (dostęp do serwisów kolektorów) i `AlertsModule` (dostęp do TelegramService). Rejestruje 5 kontrolerów (w tym SystemLogsController).

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
- `GET /api/sentiment/scores?limit=100&ai_only=true` — wyniki sentymentu (najnowsze, opcjonalny filtr AI-only)
- `GET /api/sentiment/news?limit=100` — ostatnie newsy (wszystkie tickery)
- `GET /api/sentiment/mentions?limit=100` — ostatnie wzmianki social media
- `GET /api/sentiment/filings?limit=100` — ostatnie filingi SEC
- `GET /api/sentiment/filings-gpt?limit=50` — filingi SEC z analizą GPT (gptAnalysis IS NOT NULL)
- `GET /api/sentiment/insider-trades?limit=100` — transakcje insiderów (Form 4)
- `GET /api/sentiment/pdufa?upcoming_only=true&limit=100` — kalendarz PDUFA (decyzje FDA)
- `GET /api/sentiment/pipeline-logs?status=&symbol=&limit=200` — logi egzekucji pipeline AI
- `GET /api/sentiment/:ticker?limit=50` — dane sentymentu per ticker (scores + mentions + news)

**Powiązania:** `SentimentScoreRepository`, `RawMentionRepository`, `NewsArticleRepository`, `SecFilingRepository`, `InsiderTradeRepository`, `PdufaCatalystRepository`, `AiPipelineLogRepository`.

#### `system-logs/system-logs.controller.ts`
**Endpoint:** `GET /api/system-logs?module=&function=&status=&dateFrom=&dateTo=&limit=&offset=`
**Co robi:** Zwraca logi z tabeli `system_logs` z opcjonalnymi filtrami. Domyślny limit 100, max 500. Odpowiedź: `{ count, total, logs }`.
**Powiązania:** `SystemLogService.findAll()`.

#### `alerts/alerts.controller.ts`
**Endpoint:** `GET /api/alerts?symbol=UNH&limit=50`, `GET /api/alerts/rules`, `GET /api/alerts/outcomes?limit=100&symbol=UNH`
**Co robi:** Historia wysłanych alertów z filtrowaniem po symbolu. Lista reguł alertów. Endpoint `/outcomes` zwraca alerty z danymi cenowymi (priceAtAlert, price1h/4h/1d/3d, delta %, directionCorrect).
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
                         │ FinBERT Sidecar │  (GPU: ProsusAI/finbert — 1. etap)
                         │ POST /api/sent. │
                         └──────┬──────────┘
                                │
                    ┌───────────▼───────────┐
                    │  Tier-based eskalacja │  (T1: conf>0.7 & abs>0.5 → ZAWSZE)
                    │  T2: do AI jeśli VM   │  (T3: skip → FINBERT_ONLY)
                    └───────────┬───────────┘
                                │ (Tier 1 lub 2)
                    ┌───────────▼───────────┐
                    │  PDUFA Context Layer  │  (pdufa_catalysts → tekst kontekstu)
                    └───────────┬───────────┘
                                │
                         ┌──────▼──────────┐
                         │ Azure VM        │  (gpt-4o-mini — 2. etap + prompt_used)
                         │ POST /analyze   │  (74.248.113.3:3100)
                         └──────┬──────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                  │
       ┌──────▼──────────┐ ┌───▼───────────┐ ┌───▼──────────────────┐
       │ sentiment_scores │ │ Event Bus     │ │ news_articles        │
       │ (+ enriched     │ │ SENTIMENT_    │ │ (update sentScore)   │
       │   Analysis)     │ │ SCORED        │ └──────────────────────┘
       └─────────────────┘ │ (+conviction) │
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

                    (Na każdym etapie pipeline buduje AiPipelineLog)
                         ┌──────────────────┐
                         │ ai_pipeline_logs │  (pełna historia egzekucji)
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
│   └── 7 kolejek
├── CollectorsModule
│   ├── StocktwitsModule  (service + processor + scheduler)
│   ├── FinnhubModule     (service + processor + scheduler)
│   ├── SecEdgarModule    (service + processor + scheduler + form4-parser)
│   ├── RedditModule      (service + processor + scheduler)
│   └── PdufaBioModule    (service + processor + scheduler + pdufa-parser)
├── SentimentModule
│   ├── FinbertClientService         (HTTP klient → FinBERT sidecar, 1. etap)
│   ├── AzureOpenaiClientService     (HTTP klient → Azure VM gpt-4o-mini, 2. etap + analyzeCustomPrompt)
│   ├── SentimentListenerService     (nasłuchuje eventów → dodaje joby)
│   └── SentimentProcessorService    (BullMQ worker → FinBERT → tier → PDUFA context → LLM → zapis + pipeline log)
├── SecFilingsModule
│   ├── Form4Pipeline            (NEW_INSIDER_TRADE → GPT analiza z kontekstem 30d)
│   ├── Form8kPipeline           (NEW_FILING 8-K → per-Item GPT analiza)
│   ├── DailyCapService          (Redis INCR, max 20 GPT/ticker/dzień)
│   ├── SecFilingsController     (POST /api/sec-filings/backfill-gpt)
│   └── 5 promptów + parser + scorer + Zod schema
├── CorrelationModule
│   └── CorrelationService       (5 detektorów wzorców, Redis Sorted Sets, debounce 10s)
├── PriceOutcomeModule
│   └── PriceOutcomeService      (CRON co 1h — uzupełnia price1h/4h/1d/3d z Finnhub /quote, tylko gdy NYSE otwarta)
├── TelegramModule               (wydzielony — unikanie circular dependency)
│   ├── TelegramService          (wysyłka)
│   └── TelegramFormatterService (formatowanie MarkdownV2 po polsku)
├── OptionsFlowModule
│   ├── OptionsFlowScoringService  (heurystyka conviction bez GPT: spike ratio + volume + OTM + DTE + call/put)
│   └── OptionsFlowAlertService    (@OnEvent NEW_OPTIONS_FLOW → scoring → correlation → Telegram)
├── AlertsModule
│   ├── AlertEvaluatorService    (6 reguł niezależnych, decyzje w logach, priceAtAlert + storeSignal → Correlation)
│   └── SummarySchedulerService  (raport 2h na Telegram)
└── ApiModule
    ├── HealthController       (GET /api/health, /api/health/stats)
    ├── TickersController      (GET /api/tickers)
    ├── SentimentController    (GET /api/sentiment/* — 9 endpointów, w tym filings-gpt, pipeline-logs, pdufa, insider-trades)
    ├── AlertsController       (GET /api/alerts, /api/alerts/outcomes)
    ├── SystemLogsController   (GET /api/system-logs)
    └── OptionsFlowController  (GET /api/options-flow, /api/options-flow/stats, POST /api/options-flow/backfill)
```

---

## Schemat bazy danych (14 tabel)

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
│ sec_filings      │  │ sentiment_scores │     │──────────────────│
│──────────────────│  │──────────────────│     │ id               │
│ id               │  │ id               │     │ symbol           │
│ symbol           │  │ symbol           │     │ insiderName      │
│ cik              │  │ score (-1 to +1) │     │ insiderRole      │
│ formType         │  │ confidence       │     │ transactionType  │
│ accessionNum     │  │ source (enum)    │     │ shares           │
│ filingDate       │  │ model            │     │ pricePerShare    │
│ description      │  │ rawText          │     │ totalValue       │
│ documentUrl      │  │ externalId       │     │ transactionDate  │
│ gptAnalysis(jsonb│  │ enrichedAnalysis │     │ accessionNumber  │
│ priceImpactDir   │  │  (jsonb, null)   │     │ is10b51Plan      │
│ collectedAt      │  │ timestamp        │     │ sharesOwnedAfter │
└──────────────────┘  └──────────────────┘     │ collectedAt      │
                                                └──────────────────┘

┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   alerts         │  │  alert_rules     │     │ collection_logs  │
│──────────────────│  │──────────────────│     │──────────────────│
│ id               │  │ id               │     │ id               │
│ symbol           │  │ name (UK)        │     │ collector (enum) │
│ ruleName     ───►│  │ condition        │     │ status           │
│ priority         │  │ priority         │     │ itemsCollected   │
│ channel          │  │ throttleMinutes  │     │ errorMessage     │
│ message          │  │ isActive         │     │ durationMs       │
│ catalystType     │  │ createdAt        │     │ startedAt        │
│ alertDirection   │  │ updatedAt        │     └──────────────────┘
│ priceAtAlert     │  └──────────────────┘
│ price1h/4h/1d/3d│
│ priceOutcomeDone │
│ delivered        │
│ sentAt           │
└──────────────────┘

┌──────────────────┐     ┌──────────────────┐
│ pdufa_catalysts  │     │ ai_pipeline_logs │
│──────────────────│     │──────────────────│
│ id               │     │ id               │
│ symbol           │     │ symbol           │
│ drugName         │     │ source           │
│ indication       │     │ entityType       │
│ therapeuticArea  │     │ entityId         │
│ pdufaDate        │     │ status           │
│ eventType        │     │ tier             │
│ outcome (null)   │     │ tierReason       │
│ odinTier         │     │ finbertScore     │
│ odinScore        │     │ finbertConfidence│
│ scrapedAt        │     │ inputText        │
│ createdAt        │     │ pdufaContext      │
│ updatedAt        │     │ requestPayload   │
└──────────────────┘     │ responsePayload  │
                         │ finbertDurationMs│
                         │ azureDurationMs  │
                         │ errorMessage     │
                         │ sentimentScoreId │
                         │ createdAt        │
                         └──────────────────┘

┌──────────────────┐
│  system_logs     │
│──────────────────│
│ id               │
│ createdAt        │
│ module           │
│ className        │
│ functionName     │
│ status           │
│ durationMs       │
│ input (JSONB)    │
│ output (JSONB)   │
│ errorMessage     │
└──────────────────┘

┌────────────────────────┐     ┌────────────────────────┐
│    options_flow        │     │options_volume_baseline  │
│────────────────────────│     │────────────────────────│
│ id                     │     │ id                     │
│ symbol (INDEX)         │     │ occSymbol (UNIQUE)     │
│ occSymbol              │     │ symbol (INDEX)         │
│ optionType (call/put)  │     │ avgVolume20d           │
│ strike                 │     │ dataPoints (max 20)    │
│ underlyingPrice        │     │ lastVolume             │
│ expiry                 │     │ lastUpdated            │
│ dte                    │     └────────────────────────┘
│ dailyVolume            │
│ avgVolume20d           │
│ volumeSpikeRatio       │
│ isOtm                  │
│ otmDistance             │
│ conviction [-1, +1]    │
│ direction              │
│ pdufaBoosted           │
│ sessionDate (INDEX)    │
│ collectedAt            │
│ UK(occSymbol,session)  │
└────────────────────────┘
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
