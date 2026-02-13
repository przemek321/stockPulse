# StockPulse — Plan Działania

> Sprint-by-Sprint Implementation Guide v1.0 — Luty 2026

| Parametr | Wartość |
|----------|---------|
| **Czas całkowity** | 18-32 tygodnie (4 fazy) |
| **Faza 1 (MVP)** | Sprint 1-3 (6 tygodni) |
| **Faza 2 (Core)** | Sprint 4-7 (8 tygodni) |
| **Faza 3 (Advanced)** | Sprint 8-13 (12 tygodni) |
| **Budżet MVP** | $280-465/msc |

---

## Struktura planu

Ten dokument rozpisuje każdy sprint na konkretne zadania z estymowanym czasem, deliverable'ami i checklistami. Każdy sprint trwa 2 tygodnie. Całość zakłada pracę po godzinach/weekendach (~15-20h/tydzień), nie full-time.

| Sprint | Tytuł | Kluczowy output | Faza |
|--------|-------|-----------------|------|
| S1 | Fundament | Monorepo + Docker + DB działa | FAZA 1 — MVP |
| S2 | Pierwsze dane | Reddit collector + FinBERT scoring | FAZA 1 — MVP |
| S3 | Alerty + API | Telegram bot + REST API + E2E flow | FAZA 1 — MVP |
| S4 | News pipeline | Finnhub + RSS + deduplikacja | FAZA 2 — Core |
| S5 | SEC + insiderzy | EDGAR monitor + insider trade alerts | FAZA 2 — Core |
| S6 | Smart analysis | Claude Haiku + anomaly detection | FAZA 2 — Core |
| S7 | Dashboard v1 | React + WebSocket + heatmap | FAZA 2 — Core |
| S8-9 | Scoring + korelacje | Composite score + cross-source | FAZA 3 — Adv |
| S10-11 | Alt data + backtest | Google Trends + backtesting engine | FAZA 3 — Adv |
| S12-13 | Production + API | Azure deploy + GraphQL + docs | FAZA 3 — Adv |

---

## Krok 0: Przygotowanie (przed Sprintem 1)

Zanim zaczniesz kodować, załatw te rzeczy — każda zajmie max kilka godzin, ale bez nich stracisz czas w trakcie sprintów.

### Konta i klucze API

| Zadanie | Deliverable | Czas |
|---------|-------------|------|
| Załóż Twitter/X Developer Account (Basic $100/mo) | API Key + Bearer Token | 1h |
| Załóż Reddit App (script type, OAuth2) | Client ID + Secret | 30min |
| Załóż Finnhub Free Account | API Key (60 req/min) | 15min |
| Zarejestruj się na SEC EDGAR (User-Agent) | Email + company w User-Agent | 15min |
| Załóż Anthropic API account (Claude Haiku) | API Key + billing | 30min |
| Stwórz Telegram Bot via BotFather | Bot Token + Chat ID | 15min |

### Przygotowanie lokalne

| Zadanie | Deliverable | Czas |
|---------|-------------|------|
| Zainstaluj Docker Desktop + Docker Compose | `docker compose --version` działa | 30min |
| Zainstaluj Node.js 20 LTS + pnpm | `node -v` + `pnpm -v` | 15min |
| Zainstaluj NestJS CLI: `npm i -g @nestjs/cli` | `nest --version` | 5min |
| Przygotuj Python 3.11+ (dla FinBERT sidecar) | `python3 --version` | 15min |
| Zainstaluj CUDA toolkit (dla GPU FinBERT) | `nvidia-smi` + `torch.cuda.is_available()` | 1h |
| Utwórz GitHub repo: stockpulse | Repo z .gitignore + README | 15min |

**Szacowany czas kroku 0: ~4-5 godzin (jednorazowo)**

---

## FAZA 1 — MVP (Sprint 1-3, 6 tygodni)

**Cel fazy:** Działający pipeline end-to-end: Reddit → FinBERT → TimescaleDB → Telegram alert. Dowodzisz, że koncept działa.

### SPRINT 1 — Fundament (Tygodnie 1-2)

**Cel:** Postawiony monorepo NestJS z infrastrukturą (Docker), bazami danych i pierwszym szkieletem modułów.

#### Dzień 1-3: Scaffold projektu

| Zadanie | Deliverable | Czas |
|---------|-------------|------|
| `nest new stockpulse --package-manager pnpm` | Działający NestJS app | 30min |
| Struktura modułów: collector, processor, storage, delivery | 4 NestJS modules | 2h |
| Konfiguracja: `@nestjs/config` + .env + validation | ConfigModule z typed env | 1h |
| Shared module: common DTOs, interfaces, constants | SharedModule z typami | 1h |

#### Dzień 4-7: Docker + bazy danych

| Zadanie | Deliverable | Czas |
|---------|-------------|------|
| docker-compose.yml: PostgreSQL 16 + TimescaleDB | DB działa na localhost:5432 | 1h |
| docker-compose.yml: Redis 7+ | Redis na localhost:6379 | 30min |
| TypeORM setup + TimescaleDB connection | TypeORM connected, migrations run | 2h |
| Schema v1: raw_articles, sentiment_scores, tickers, alerts | 4 tabele + hypertable | 3h |
| BullMQ setup: collector-queue, processor-queue | 2 kolejki w Redis | 1h |

#### Dzień 8-10: FinBERT sidecar

| Zadanie | Deliverable | Czas |
|---------|-------------|------|
| Python FastAPI app: /api/sentiment endpoint | POST /api/sentiment zwraca score | 2h |
| Załaduj FinBERT z HuggingFace (ProsusAI/finbert) | Model loaded na GPU | 1h |
| Batch endpoint: /api/sentiment/batch (max 32 tekstów) | Batch inference działa | 1h |
| Dockerfile dla FinBERT sidecar (CUDA base image) | Docker build + run działa | 2h |
| Health check + Prometheus metrics | /health + /metrics | 1h |

**Output Sprintu 1:** Odpalasz `docker compose up` i masz: NestJS app, PostgreSQL+TimescaleDB, Redis, FinBERT sidecar — wszystko connected, puste ale gotowe.

---

### SPRINT 2 — Pierwsze dane (Tygodnie 3-4)

**Cel:** Pierwszy kolektor (Reddit) zbiera prawdziwe dane, FinBERT je ocenia, wyniki lądują w bazie.

#### Dzień 1-4: Reddit Collector

| Zadanie | Deliverable | Czas |
|---------|-------------|------|
| RedditCollectorService: OAuth2 token management | Auto-refresh tokena | 2h |
| Subreddit polling: r/wallstreetbets, r/stocks, r/investing | Nowe posty co 30s | 3h |
| Ticker extraction z tytułów i treści ($AAPL, "Apple") | Regex + lookup table | 2h |
| Rate limiter: max 100 req/min, exponential backoff | Nigdy nie przekracza limitu | 1h |
| BullMQ job: każdy post → raw_articles + add to processor-queue | Posty w bazie | 2h |

#### Dzień 5-7: Sentiment Pipeline

| Zadanie | Deliverable | Czas |
|---------|-------------|------|
| SentimentProcessorService: konsumuje processor-queue | Worker przetwarza joby | 2h |
| HTTP call do FinBERT sidecar (/api/sentiment/batch) | Scores wracają z GPU | 1h |
| Zapis do sentiment_scores (ticker, score, confidence, source, ts) | Dane w TimescaleDB | 1h |
| Error handling: retry 3x, dead letter queue | Failed jobs nie giną | 1h |

#### Dzień 8-10: Weryfikacja + Twitter prep

| Zadanie | Deliverable | Czas |
|---------|-------------|------|
| E2E test: Reddit post → FinBERT → DB. Sprawdź dane. | Poprawne scores w bazie | 2h |
| Prosty SQL: AVG sentiment per ticker z ostatniej godziny | Query działa, dane sensowne | 1h |
| TwitterCollectorService: Filtered Stream v2 setup | Stream łączy się, rules dodane | 3h |
| Twitter → ten sam pipeline (BullMQ → FinBERT → DB) | 2 źródła działają | 2h |

**Output Sprintu 2:** Dane płyną z Reddita i Twittera, FinBERT ocenia sentiment, wyniki w TimescaleDB. Możesz odpytać SQL: "jaki jest średni sentiment $TSLA z ostatniej godziny?"

---

### SPRINT 3 — Alerty + API (Tygodnie 5-6)

**Cel:** System sam Cię powiadamia o ważnych zmianach. REST API do odpytywania. MVP gotowy.

#### Dzień 1-3: Telegram Alert System

| Zadanie | Deliverable | Czas |
|---------|-------------|------|
| TelegramService: node-telegram-bot-api integration | Bot wysyła wiadomości | 1h |
| AlertRulesEngine: konfigurowalne reguły per ticker | JSON config z thresholds | 2h |
| Alert triggers: sentiment < -0.5, mention spike > 3σ | 2 typy alertów | 2h |
| Throttling: max 1 alert per ticker per 15min | Redis-based cooldown | 1h |
| Format wiadomości: emoji + ticker + score + źródło | Ładne alerty na Telegramie | 1h |

#### Dzień 4-7: REST API

| Zadanie | Deliverable | Czas |
|---------|-------------|------|
| GET /api/sentiment/:ticker — bieżący + historia | JSON z scores | 2h |
| GET /api/sentiment/:ticker/history?hours=24 | Time-series data | 1h |
| GET /api/tickers/trending — top 10 po volume wzmianek | Sorted list | 1h |
| GET /api/alerts/recent — ostatnie alerty | Alert history | 1h |
| Swagger/OpenAPI docs (@nestjs/swagger) | /api/docs działa | 1h |
| Basic API key auth (header X-API-Key) | Guard + decorator | 1h |

#### Dzień 8-10: Polish + E2E

| Zadanie | Deliverable | Czas |
|---------|-------------|------|
| Continuous aggregate: avg_sentiment_hourly | TimescaleDB auto-rollup | 1h |
| Mention volume tracking per ticker (Redis sorted set) | Trending działa | 1h |
| E2E test: post na Reddit → alert na Telegramie | Cały flow działa | 2h |
| README.md z setup instructions | Nowy dev może postawić | 1h |
| docker-compose.yml: pełny stack jednym poleceniem | `docker compose up` = all | 1h |

### MILESTONE: MVP GOTOWY

> Po Sprincie 3 masz działający system: Reddit + Twitter → FinBERT → TimescaleDB → Telegram alerty + REST API. Możesz go używać do śledzenia sentimentu wybranych tickerów w real-time.

---

## FAZA 2 — Core (Sprint 4-7, 8 tygodni)

**Cel fazy:** Pełny pipeline z wieloma źródłami, inteligentną analizą (Claude Haiku, anomaly detection) i pierwszym dashboardem.

### SPRINT 4 — News Pipeline (Tygodnie 7-8)

| Zadanie | Deliverable | Czas |
|---------|-------------|------|
| FinnhubCollectorService: news API integration | Artykuły z Finnhub w DB | 3h |
| RSSCollectorService: Yahoo Finance + Google News RSS | RSS polling co 30s | 3h |
| Deduplikacja: SimHash na treści artykułów | Unikalne artykuły, dupes marked | 4h |
| Source tracking: ilość źródeł publikujących tę samą news | source_count w tabeli | 2h |
| News → FinBERT pipeline (reuse z Sprintu 2) | Sentiment na artykułach | 2h |
| Rozszerzenie API: GET /api/news/:ticker | News endpoint działa | 1h |

### SPRINT 5 — SEC + Insiderzy (Tygodnie 9-10)

| Zadanie | Deliverable | Czas |
|---------|-------------|------|
| SECCollectorService: EDGAR XBRL API polling co 60s | Nowe filingi w DB | 4h |
| Form 4 parser: insider buy/sell, ilość, wartość | Structured insider trades | 4h |
| 8-K parser: material events extraction | Event type + summary | 3h |
| Insider trade alert: trades > $100K → CRITICAL alert | Telegram: CEO X kupił $2M | 2h |
| GET /api/filings/:ticker + GET /api/insiders/:ticker | 2 nowe endpoints | 2h |

### SPRINT 6 — Smart Analysis (Tygodnie 11-12)

| Zadanie | Deliverable | Czas |
|---------|-------------|------|
| ClaudeHaikuService: Anthropic SDK integration | API call działa | 1h |
| Event Classification prompt: earnings/FDA/M&A/upgrade | Classifier z priority score | 3h |
| Nuanced sentiment: Claude na high-priority items only | Score + reasoning text | 2h |
| Decision logic: FinBERT confidence < 0.7 → escalate to Claude | 2-stage pipeline działa | 2h |
| AnomalyDetectorService: z-score na mention volume | Alert gdy > 3σ | 3h |
| Sentiment shift detection: rapid change w 15min window | Shift alert | 2h |
| Cross-source check: anomalia w > 2 źródłach = HIGH priority | Multi-source correlation | 2h |

### SPRINT 7 — Dashboard v1 (Tygodnie 13-14)

| Zadanie | Deliverable | Czas |
|---------|-------------|------|
| React app: Vite + TanStack Query + dark theme | Szkielet UI działa | 2h |
| WebSocket gateway w NestJS (@nestjs/websockets) | Real-time push do frontu | 2h |
| Sentiment Heatmap: grid tickerów z kolorami -1 do +1 | Heatmap component | 4h |
| Trending Tickers: top 10 z volume + zmianą sentimentu | Trending sidebar | 2h |
| Alert Feed: live stream alertów z timestamp + priority | Alert list component | 2h |
| Ticker Detail: kliknij ticker → sentiment chart + news list | Recharts line chart | 3h |
| Watchlist: dodaj/usuń ticker z listy obserwowanych | LocalStorage + API | 2h |

### MILESTONE: CORE GOTOWY

> Po Sprincie 7: pełny pipeline z 5+ źródłami, 2-stage AI (FinBERT + Claude Haiku), anomaly detection, insider trade monitoring, żywy dashboard z WebSocket. System jest używalny jako prawdziwe narzędzie tradingowe.

---

## FAZA 3 — Advanced (Sprint 8-13, 12 tygodni)

**Cel fazy:** Composite scoring, backtesting, alt data, production deployment, GraphQL API. System staje się profesjonalnym narzędziem.

### SPRINT 8-9 — Scoring + Korelacje (Tygodnie 15-18)

| Zadanie | Deliverable | Czas |
|---------|-------------|------|
| ScoringEngineService: composite score per ticker | Score -100 do +100 | 4h |
| Wagi: news 30%, social 25%, insider 20%, momentum 15%, alt 10% | Configurable weights | 2h |
| Etykiety: STRONG SELL / SELL / NEUTRAL / BUY / STRONG BUY | Label per ticker | 1h |
| Historical score tracking (daily snapshot) | Score history w DB | 2h |
| Cross-source correlation: sentiment consistency check | Consistency score | 4h |
| Sector correlation: spillover detection (np. MOH → CNC) | Related tickers alert | 4h |
| Dashboard: Scoring view z sortowaniem + filtrami | Score table component | 3h |
| Dashboard: sector heatmap (healthcare, tech, finance...) | Sector view | 3h |

### SPRINT 10-11 — Alt Data + Backtesting (Tygodnie 19-22)

| Zadanie | Deliverable | Czas |
|---------|-------------|------|
| GoogleTrendsCollector: daily batch per watchlist ticker | Trends data w DB | 3h |
| JobPostingsCollector: Indeed/LinkedIn scraping (basic) | Job count per company | 4h |
| Alt data → score integration (10% waga) | Composite score updated | 2h |
| Historical price data: Alpha Vantage / yfinance integration | Daily OHLCV w DB | 3h |
| BacktestingService: sentiment signal vs price change | Correlation analysis | 6h |
| Backtest report: accuracy %, best/worst signals, lag analysis | JSON report | 3h |
| Dashboard: Backtest results view | Performance charts | 3h |
| Elasticsearch setup: full-text search na artykułach | Search endpoint działa | 4h |

### SPRINT 12-13 — Production + API (Tygodnie 23-26)

| Zadanie | Deliverable | Czas |
|---------|-------------|------|
| Azure Container Apps: Terraform/Bicep config | IaC ready | 4h |
| CI/CD: GitHub Actions (test → build → deploy) | Auto-deploy on merge | 3h |
| GraphQL API: @nestjs/graphql setup | GraphQL playground | 3h |
| GraphQL: sentiment, tickers, alerts, filings queries | Full schema | 4h |
| API rate limiting: @nestjs/throttler | 100 req/min per key | 1h |
| Monitoring: health checks + basic alerting | Uptime monitoring | 2h |
| Logging: structured logs (pino/winston) | Searchable logs | 2h |
| OpenAPI docs finalization | Kompletna dokumentacja | 2h |
| Security audit: env vars, API keys, CORS | Security checklist done | 2h |
| Dashboard v2: responsive, production-ready | Deployed frontend | 4h |

### MILESTONE: PRODUCTION READY

> Po Sprincie 13: pełny system na Azure z composite scoring, backtesting, alt data, GraphQL API, live dashboard. Możesz zacząć myśleć o SaaS lub otwartym dostępie.

---

## Zasady pracy

### Reguły jakości kodu

- **Każdy moduł ma swój folder:** `src/collector/`, `src/processor/`, `src/storage/`, `src/delivery/`
- **Każdy serwis ma interfejs:** `ICollector`, `ISentimentEngine`, `IAlertService` — dla testowalności i DI
- **Testy:** minimum unit test na każdy serwis. E2E test na każdy pipeline flow.
- **Linting:** ESLint + Prettier z strict config. Zerowatość warningów.
- **Git:** feature branches + PR review (choćby self-review). Conventional commits.

### Reguły EDA (Event-Driven)

- **Każdy event ma typed interface:** `NewArticleEvent { ticker, source, content, timestamp }`
- **Moduły nie importują siebie nawzajem:** komunikacja TYLKO przez Event Bus (BullMQ)
- **Idempotentność:** każdy handler może być wywołany wielokrotnie bez efektu ubocznego
- **Dead Letter Queue:** każda kolejka ma DLQ. Failed jobs lądują tam, nie giną.

### Reguły operacyjne

- **Env vars:** NIGDY hardcoded secrets. Wszystko w `.env` / Azure Key Vault.
- **Rate limits:** każdy collector ma rate limiter. NIGDY nie przekraczamy limitów API.
- **Graceful shutdown:** każdy serwis obsługuje SIGTERM. Dokończ aktualny job, zamknij connections.
- **Monitoring od dnia 1:** health check endpoint + /metrics. Nawet w MVP.

---

## Struktura projektu

Docelowa struktura katalogów NestJS monorepo:

```
stockpulse/
├── apps/
│   ├── api/                        # Główna aplikacja NestJS
│   │   ├── src/
│   │   │   ├── collector/          # Warstwa 1: Reddit, Twitter, News, SEC
│   │   │   ├── processor/          # Warstwa 2: Sentiment, NER, Classifier
│   │   │   ├── storage/            # Warstwa 3: DB repos, cache, search
│   │   │   ├── delivery/           # Warstwa 4: API, alerts, WebSocket
│   │   │   ├── shared/             # DTOs, interfaces, constants
│   │   │   └── app.module.ts
│   │   └── test/
│   ├── dashboard/                  # React frontend
│   └── finbert-sidecar/            # Python FinBERT microservice
├── libs/                           # Shared libraries
│   ├── common/                     # Typy, utils, helpers
│   └── database/                   # TypeORM entities, migrations
├── docker/
│   ├── docker-compose.yml
│   ├── docker-compose.prod.yml
│   └── Dockerfile.*
├── infra/                          # Terraform / Bicep (Azure)
├── .env.example
├── pnpm-workspace.yaml
└── README.md
```

---

## Rejestr ryzyk

| Ryzyko | Prawdop. | Wpływ | Mitygacja |
|--------|----------|-------|-----------|
| Twitter API zmiana cen/limitów | MEDIUM | HIGH | Reddit + News jako backup. System działa bez Twittera. |
| Rate limit exceeded na API | HIGH | MEDIUM | Exponential backoff + token bucket. Monitoring użycia. |
| FinBERT niska dokładność | MEDIUM | MEDIUM | 2-stage: niska confidence → eskalacja do Claude Haiku. |
| Koszty Claude API rosną | LOW | MEDIUM | FinBERT pokrywa 80%. Batch processing. Prompt optimization. |
| TimescaleDB performance | LOW | HIGH | Continuous aggregates + retention policy. Partitioning. |
| Zbyt mało czasu (po godzinach) | HIGH | HIGH | MVP w 3 sprintach. Każdy sprint daje użyteczny output. |
| Reddit API ograniczenia | MEDIUM | LOW | 100 req/min wystarczy. Alternatywa: Pushshift archive. |

---

## Definition of Done per Faza

### Faza 1 — MVP

- [ ] `docker compose up` uruchamia cały stack
- [ ] Reddit + Twitter zbierają posty w real-time
- [ ] FinBERT ocenia sentiment każdego posta
- [ ] Wyniki w TimescaleDB z timestampem
- [ ] Telegram bot wysyła alerty na sentiment < -0.5 lub spike > 3σ
- [ ] REST API zwraca sentiment per ticker + historię
- [ ] Swagger docs działają na /api/docs

### Faza 2 — Core

- [ ] 5+ źródeł danych (Reddit, Twitter, Finnhub, RSS, SEC EDGAR)
- [ ] 2-stage AI: FinBERT (bulk) + Claude Haiku (high-priority)
- [ ] Event classification: earnings/FDA/M&A/insider/analyst
- [ ] Anomaly detection z z-score + cross-source validation
- [ ] Insider trade monitoring z alertami > $100K
- [ ] React dashboard z sentiment heatmap, trending, alert feed
- [ ] WebSocket real-time updates na dashboardzie

### Faza 3 — Advanced

- [ ] Composite score -100 do +100 z etykietami per ticker
- [ ] Backtesting: korelacja sygnałów vs historyczne ceny
- [ ] Alt data: Google Trends + job postings zintegrowane
- [ ] Elasticsearch: pełnotekstowe wyszukiwanie artykułów
- [ ] GraphQL API + OpenAPI docs kompletne
- [ ] Azure deployment z CI/CD + monitoring
- [ ] Dashboard v2: watchlisty, scoring view, sector heatmap
