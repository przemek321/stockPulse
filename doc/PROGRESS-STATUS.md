# StockPulse — Status projektu i plan działania

> Ostatnia aktualizacja: 2026-02-13

## Gdzie jesteśmy

**Faza 2 — Analiza AI sentymentu** (w trakcie)

Pełny pipeline sentymentu działa end-to-end: kolektory zbierają dane → eventy → kolejka BullMQ → FinBERT na GPU → wyniki w bazie → alerty na Telegramie. FinBERT sidecar (ProsusAI/finbert) działa w kontenerze Docker z GPU passthrough (NVIDIA Container Toolkit w WSL2). Backend NestJS z 4 kolektorami, 6 kolejkami, REST API. Frontend React z dashboardem. Baza PostgreSQL z 9 tabelami, Redis dla kolejek.

## Faza 0 — Setup i walidacja API (ukończona)

- [x] Repo na GitHubie: github.com/przemek321/stockPulse
- [x] `.gitignore` chroni `.env` z kluczami API
- [x] Docker Compose z PostgreSQL + TimescaleDB i Redis
- [x] `.env.example` z opisami zmiennych środowiskowych
- [x] Dokumentacja architektury w `doc/`
- [x] `CLAUDE.md` z kontekstem projektu
- [x] Skrypty testowe dla 5 API w `scripts/`
- [x] **Finnhub API** — działa (quotes, news, profile, insider sentiment, financials)
- [x] **SEC EDGAR** — działa (filings, Form 4, 8-K, CIK lookup)
- [x] **StockTwits** — działa (publiczne API, 200 req/hour)
- [x] **Telegram Bot** — działa (@stockpulse_alerts_bot, MarkdownV2)
- [ ] **Reddit API** — formularz wysłany, czekamy na zatwierdzenie

## Faza 1 — Backend NestJS MVP (ukończona)

### Krok 1: Szkielet NestJS
- [x] `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`
- [x] `src/main.ts` — bootstrap aplikacji, port z .env, prefix `/api`
- [x] `src/app.module.ts` — główny moduł
- [x] `src/config/` — ładowanie .env z walidacją Joi
- [x] `Dockerfile` + serwis `app` w docker-compose.yml

### Krok 2: Baza danych + encje TypeORM
- [x] `src/database/database.module.ts` — połączenie TypeORM z PostgreSQL
- [x] 9 encji w `src/entities/` (ticker, sentiment_score, raw_mention, news_article, sec_filing, insider_trade, alert, alert_rule, collection_log)
- [x] Tabele tworzone automatycznie przez `synchronize: true`

### Krok 3: Kolejki BullMQ
- [x] `src/queues/` — 6 kolejek (4 kolektory + sentiment + alerts)
- [x] Połączenie z Redis, domyślne retry (3 próby, exponential backoff)

### Krok 4: Kolektory danych
- [x] **StockTwits** — stream wiadomości per ticker, wbudowany sentyment, co 5 min
- [x] **Finnhub** — newsy spółek + insider sentiment (MSPR), co 10 min
- [x] **SEC EDGAR** — filingi (10-K, 10-Q, 8-K, Form 4), co 30 min
- [x] **Reddit** — OAuth2 + ekstrakcja tickerów, placeholder (czeka na API access)
- [x] `BaseCollectorService` — bazowa klasa z logowaniem cykli do collection_logs

### Krok 5: Alerty Telegram
- [x] `TelegramService` — wysyłka wiadomości (MarkdownV2 + plain text)
- [x] `TelegramFormatterService` — formatowanie alertów (sentyment, insider trade, filing)
- [x] `AlertEvaluatorService` — nasłuchuje eventów, ewaluuje reguły, throttling

### Krok 6: REST API
- [x] `GET /api/health` — status zdrowia kolektorów i systemu
- [x] `GET /api/tickers` — lista tickerów (filtrowanie po subsector)
- [x] `GET /api/tickers/:symbol` — szczegóły tickera
- [x] `GET /api/sentiment/:ticker` — wyniki sentymentu, wzmianki, newsy
- [x] `GET /api/alerts` — historia alertów (filtrowanie po symbol)
- [x] `GET /api/alerts/rules` — lista reguł alertów

## Faza 1.5 — Seed + monitoring (ukończona)

- [x] **Seed tickerów** — 27 spółek healthcare z `healthcare-universe.json` (5 ETF-ów osobno)
- [x] **Seed reguł alertów** — 7 reguł z `healthcare-universe.json`
- [x] Komenda `npm run seed` / `docker exec stockpulse-app npm run seed`
- [x] Weryfikacja kolektorów — dane zbierają się do bazy
- [x] **Fix alert spam** — naprawiony podwójny trigger Form 4 + minimalny throttle 1 min
- [x] **Nowe endpointy REST**:
  - `GET /api/sentiment/news` — newsy ze wszystkich tickerów
  - `GET /api/sentiment/mentions` — wzmianki social media
  - `GET /api/sentiment/filings` — filingi SEC
  - `GET /api/health/stats` — totale per tabela + interwały + countdown
- [x] **pgAdmin** — przeglądarka bazy na `localhost:5050`
- [x] **Frontend React** — dashboard na `localhost:3001` (MUI 5, dark theme)
  - Karty kolektorów z countdown do następnego pobrania
  - Rozwijane panele z tabelami danych (lazy loading)
  - Totale per tabela i rozmiar bazy

## Faza 2 — Analiza AI (w trakcie)

### Sprint 2a: FinBERT Sidecar (ukończony 2026-02-13)
- [x] **FinBERT sidecar** — Python FastAPI mikroserwis w kontenerze Docker
  - `finbert-sidecar/app/main.py` — FastAPI server (3 endpointy)
  - `finbert-sidecar/app/model.py` — wrapper na ProsusAI/finbert z batch inference
  - `finbert-sidecar/Dockerfile` — NVIDIA CUDA 12.4 runtime + Python 3.11
  - `finbert-sidecar/Dockerfile.cpu` — wersja CPU-only (lżejsza)
  - `docker-compose.cpu.yml` — override dla trybu CPU (laptop)
- [x] **Endpointy FinBERT**:
  - `GET /health` — status modelu, GPU info, VRAM usage
  - `POST /api/sentiment` — analiza pojedynczego tekstu
  - `POST /api/sentiment/batch` — batch analiza (do BATCH_SIZE tekstów)
- [x] **GPU passthrough** — NVIDIA Container Toolkit w WSL2
- [x] **Przetestowany** na RTX 1000 Ada (6GB VRAM):
  - Score: -0.97 (negative, 97.4% confidence) dla katastrofy wynikowej Molina
  - Score: +0.93 (positive, 95.2% confidence) dla earnings beat NVIDIA
  - Latency: ~67ms per request na GPU
- [x] **Cache modelu** — volume `finbert_cache` (model nie jest pobierany ponownie)
- [x] **Konfiguracja env**: `FINBERT_SIDECAR_URL`, `FINBERT_BATCH_SIZE`, `FINBERT_MODEL_NAME`

### Sprint 2b: Sentiment Pipeline NestJS (ukończony 2026-02-13)
- [x] **SentimentModule** (`src/sentiment/sentiment.module.ts`)
  - Podłączony do AppModule
  - Importuje TypeORM (SentimentScore, RawMention, NewsArticle) + BullMQ
- [x] **FinbertClientService** (`src/sentiment/finbert-client.service.ts`)
  - HTTP klient do sidecar (single + batch + health check)
  - Timeout konfigurowalny (`FINBERT_REQUEST_TIMEOUT_MS`)
- [x] **SentimentListenerService** (`src/sentiment/sentiment-listener.service.ts`)
  - `@OnEvent(NEW_MENTION)` → job do kolejki `sentiment-analysis`
  - `@OnEvent(NEW_ARTICLE)` → job do kolejki `sentiment-analysis`
  - Priority: artykuły news > wzmianki social
- [x] **SentimentProcessorService** (`src/sentiment/sentiment-processor.service.ts`)
  - BullMQ processor: pobiera tekst → FinBERT → zapis do `sentiment_scores`
  - Obsługuje oba typy: mention (title+body) i article (headline+summary)
  - Emituje `SENTIMENT_SCORED` po zapisie
  - Aktualizuje `sentimentScore` w `news_articles`
- [x] **AlertEvaluator rozszerzony** — nowy handler `@OnEvent(SENTIMENT_SCORED)`
  - Alert "Sentiment Crash" gdy score < -0.5 i confidence > 0.7
  - Throttling per ticker (reguła w bazie)
- [x] **Endpoint** `GET /api/sentiment/scores` — lista wyników sentymentu (wszystkie tickery)
- [x] **Frontend** — panel "Wyniki sentymentu FinBERT" na dashboardzie (kolorowe score, confidence %, tekst)

## Co czeka — Następne kroki

### Sprint 2c: Backfill historycznych danych (ukończony 2026-02-13)
- [x] Przeanalizować istniejące dane FinBERT-em (1837 rekordów przetworzonych w 36s, 0 błędów)
- [x] Komenda `npm run backfill:sentiment` — batch processing istniejących rekordów (batche po 16)
- [x] Filtrowanie krótkich tekstów < 20 znaków (MIN_TEXT_LENGTH — odrzuca szum)
- [x] Skrypt idempotentny — pomija rekordy z istniejącym wynikiem w sentiment_scores

### Sprint 2d: Claude Haiku — analiza niuansowa (priorytet ŚREDNI)
- [ ] Anthropic Claude API — 2-etapowy pipeline: FinBERT (szybki bulk) → Claude (high-priority)
- [ ] Eskalacja do Claude gdy: confidence < 0.6 lub score bliski zeru (niezdecydowany)
- [ ] Analiza kontekstu: sarkasm, porównania, złożone zdania finansowe

### Faza 1.6 — Naprawić insider trades parser (priorytet ŚREDNI)
- [ ] Form 4 XML parsing — wyciąganie shares, pricePerShare, totalValue, transactionType
- [ ] Aktualne dane mają totalValue=0 i transactionType=UNKNOWN

### Faza 1.7 — GDELT jako nowe źródło danych (priorytet NISKI)
GDELT (Global Database of Events, Language, and Tone) — darmowe, bez klucza API.
- [ ] **DOC API** (`api.gdeltproject.org/api/v2/doc`) — szukaj artykułów po keywords healthcare
- [ ] **GKG API** — tematy, osoby, organizacje z wbudowaną tonalnością (-10 do +10)
- [ ] **TV API** — monitoring wzmianek healthcare w CNBC, CNN, Fox Business
- **Rekomendacja**: uzupełnienie Finnhub, nie zamiennik. Interwał: co 15 min

### Faza 3 — Frontend React rozbudowa (w trakcie)
- [x] Wykres sentymentu per ticker (Recharts) — linia score w czasie, dropdown tickerów, statystyki (avg, pos/neg/neutral), kolorowe kropki, tooltip z tekstem
- [ ] WebSocket do real-time updates (nowe score'y na żywo)
- [ ] TanStack Query do zarządzania stanem
- [ ] Widok per ticker z historią sentymentu, newsami, wzmiankami

### Oczekujące (niski priorytet)
- [ ] Reddit API — czeka na zatwierdzenie formularza
- [ ] spaCy NER — ekstrakcja encji (osoby, firmy, produkty)
- [ ] TimescaleDB hypertable — konwersja `sentiment_scores` na hypertable
- [ ] Migracje TypeORM (zamiast synchronize w produkcji)
- [ ] ETF-y benchmarkowe (XLV, IHF, XHS, IHI, IBB) — dodać do seeda
- [ ] Swagger/OpenAPI — dokumentacja REST API
- [ ] API key auth — zabezpieczenie endpointów

## Komendy

```bash
# Infrastruktura — start / stop / rebuild
docker compose up -d                        # Start cały stack (postgres, redis, app, finbert, frontend)
docker compose down                         # Stop
docker compose up -d --build app            # Rebuild backend po zmianach w src/
docker compose up -d --build app frontend   # Rebuild backend + frontend
docker compose logs app --tail 50           # Logi aplikacji NestJS
docker compose logs finbert --tail 20       # Logi FinBERT sidecar

# Tryb CPU (bez GPU) — dla maszyn bez NVIDIA
docker compose -f docker-compose.yml -f docker-compose.cpu.yml up -d

# Seed bazy danych
docker exec stockpulse-app npm run seed

# Weryfikacja
curl http://localhost:3000/api/health           # Status systemu
curl http://localhost:3000/api/health/stats      # Totale per tabela + interwały
curl http://localhost:3000/api/tickers           # Lista tickerów
curl http://localhost:3000/api/sentiment/scores  # Wyniki sentymentu FinBERT
curl http://localhost:3000/api/alerts            # Historia alertów
curl http://localhost:3000/api/alerts/rules      # Reguły alertów

# FinBERT sidecar bezpośrednio
curl http://localhost:8000/health                                              # Status modelu
curl -X POST http://localhost:8000/api/sentiment -H "Content-Type: application/json" -d '{"text":"stock crashed"}'

# Testy integracji API (Faza 0)
npm run test:all
```

## Usługi i porty

| Usługa | Port | URL |
|--------|------|-----|
| NestJS API | 3000 | http://localhost:3000/api/ |
| Frontend React | 3001 | http://localhost:3001/ |
| FinBERT sidecar | 8000 | http://localhost:8000/ |
| pgAdmin | 5050 | http://localhost:5050/ |
| PostgreSQL | 5432 | — |
| Redis | 6379 | — |

## Kluczowe liczby

- **Tickery do monitorowania**: 27 healthcare (zdefiniowane w healthcare-universe.json)
- **Słowa kluczowe**: 180+
- **Subreddity**: 18
- **Pliki źródłowe**: ~55 plików TypeScript w `src/` + 2 Python w `finbert-sidecar/`
- **Encje bazy danych**: 9 tabel
- **Kolejki BullMQ**: 6 (4 kolektory + sentiment-analysis + alerts)
- **Endpointy REST**: 11 (health x2, tickers x2, sentiment x5, alerts x2)
- **Źródła danych**: 4 kolektory (StockTwits, Finnhub, SEC EDGAR, Reddit)
- **Modele AI**: 1 aktywny (FinBERT), 2 planowane (Claude Haiku, spaCy NER)
- **Kontenery Docker**: 6 (app, finbert, frontend, postgres, redis, pgadmin)
