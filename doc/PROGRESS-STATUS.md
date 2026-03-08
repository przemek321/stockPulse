# StockPulse — Status projektu i plan działania

> **To jest główny plik śledzący postęp rozwoju projektu.** Każda faza, sprint i zadanie są tu dokumentowane z checkboxami `[x]` / `[ ]`.

> Ostatnia aktualizacja: 2026-03-08

## Gdzie jesteśmy

**Faza 2 — Analiza AI sentymentu** (ukończona) + **Sprint 4 — SEC Filing GPT Pipeline + CorrelationService** (ukończony)

Pełny 2-etapowy pipeline sentymentu z tier-based eskalacją + nowy pipeline GPT dla filingów SEC (Form 4 + 8-K) z per-typ promptami + CorrelationService do detekcji wzorców między źródłami sygnałów. Kolektory → eventy → BullMQ → FinBERT na GPU (1. etap) → tier-based eskalacja do Azure OpenAI gpt-4o-mini (2. etap). SEC filingi: Form 4 (insider trades) i 8-K (material events) analizowane GPT z per-Item promptami (Item 1.01 contracts, 2.02 earnings, 5.02 leadership, 1.03 bankruptcy natychmiastowy CRITICAL). CorrelationService: Redis Sorted Sets, 5 detektorów wzorców (insider+8K 24h, filing confirms news 48h, multi-source convergence, insider cluster 7d, escalating signal 72h). effectiveScore = gptConviction / 2.0 (znormalizowany [-1,+1]) jako źródło prawdy. 17 reguł alertów, 11 tabel PostgreSQL, 7 kolejek Redis, ~37 tickerów healthcare.

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
- [x] **Seed reguł alertów** — 9 reguł z `healthcare-universe.json` (w tym High Conviction Signal + Strong FinBERT Signal)
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

## Faza 2 — Analiza AI (ukończona)

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
- [x] **Frontend** — panel "Wyniki sentymentu" na dashboardzie (kolorowe score, confidence %, tekst, kolumna AI)

## Ukończone dodatkowe sprinty

### Sprint 2c: Backfill historycznych danych (ukończony 2026-02-13)
- [x] Przeanalizować istniejące dane FinBERT-em (1837 rekordów przetworzonych w 36s, 0 błędów)
- [x] Komenda `npm run backfill:sentiment` — batch processing istniejących rekordów (batche po 16)
- [x] Filtrowanie krótkich tekstów < 20 znaków (MIN_TEXT_LENGTH — odrzuca szum)
- [x] Skrypt idempotentny — pomija rekordy z istniejącym wynikiem w sentiment_scores

### Sprint 2d: Azure OpenAI gpt-4o-mini — analiza niuansowa (ukończony 2026-03-01)
- [x] Azure OpenAI gpt-4o-mini — 2-etapowy pipeline: FinBERT (szybki bulk) → gpt-4o-mini (high-priority)
- [x] Eskalacja do LLM gdy: confidence < 0.6 lub |score| < 0.3 (niezdecydowany)
- [x] Analiza kontekstu: sarkasm, porównania, złożone zdania finansowe
- [x] Kolumna `enrichedAnalysis` (jsonb) w SentimentScore — wielowymiarowa analiza (conviction, relevance, novelty, catalyst_type, price_impact)
- [x] `AzureOpenaiClientService` — NestJS injectable, wywołuje Azure VM HTTP endpoint (POST /analyze na :3100)
- [x] Graceful degradation — bez konfiguracji pipeline działa z FinBERT-only
- [x] Azure VM (`stockpulse-vm`, 74.248.113.3:3100) — PM2: processor.js (gpt-4o-mini) + api.js (signals :8000)
- [x] Zmienne środowiskowe: `AZURE_ANALYSIS_URL`, `AZURE_ANALYSIS_TIMEOUT_MS`

### Sprint 2e: Frontend AI + Telegram AI + ukrycie Reddit (ukończony 2026-03-01)
- [x] **Telegram alerty AI** — sekcja "Analiza AI (gpt-4o-mini)" w alertach sentymentu (sentiment, conviction, type, urgency, price impact, catalyst, summary)
- [x] **Raport 2h na Telegram** — liczba eskalacji AI w raporcie podsumowującym
- [x] **Frontend: wykres sentymentu** — fioletowe kropki dla AI-eskalowanych, badge AI w tooltip, statystyki AI
- [x] **Frontend: kolumna AI** w tabeli "Wyniki sentymentu" — sentiment + conviction z kolorami
- [x] **Frontend: zakładka "Analiza AI (gpt-4o-mini)"** — dedykowany panel z pełnymi danymi enrichedAnalysis:
  - AI Sentyment (BULLISH/BEARISH/NEUTRAL), Conviction, Pilność, Katalizator, Wpływ cenowy, Podsumowanie AI, Tekst źródłowy, Czas przetwarzania
- [x] **Backend: filtr `?ai_only=true`** na `/api/sentiment/scores` — zwraca tylko rekordy z analizą AI
- [x] **Ukrycie kolektora Reddit** z widoku frontend (placeholder, nie zbiera danych)
- [x] **Interfejs `EnrichedAnalysis`** w `frontend/src/api.ts` — pełna typizacja 16 pól analizy AI

### Sprint 2f: Tier-based eskalacja AI + High Conviction Signal (ukończony 2026-03-01)
- [x] **Tier-based eskalacja** w `SentimentProcessorService` — zastąpienie prostej bramki eskalacji (conf<0.6 OR abs<0.3) systemem 3-tierowym:
  - **Tier 1 (silne)**: confidence > 0.7 AND absScore > 0.5 → ZAWSZE do AI (złote sygnały)
  - **Tier 2 (średnie)**: confidence > 0.3 OR absScore > 0.2 → do AI jeśli VM aktywna
  - **Tier 3 (śmieci)**: skip AI, tylko FinBERT
- [x] **Nowa reguła alertów** "High Conviction Signal" — reguła w healthcare-universe.json
  - Warunek: |conviction| > 1.5 AND enrichedAnalysis IS NOT NULL
  - Priorytet: HIGH, throttle: 60 min per (ticker, catalyst_type)
- [x] **AlertEvaluator rozszerzony** — `onSentimentScored` rozbity na 3 niezależne sprawdzenia (równoległe):
  - `checkSentimentCrash()` — score < -0.5 AND confidence > 0.7
  - `checkHighConviction()` — |conviction| > 1.5 → alert na Telegram
  - `checkStrongFinbert()` — fallback: |score| > 0.7 AND conf > 0.8 AND brak AI → alert "(unconfirmed)"
- [x] **Format alertu conviction** — uproszczony `formatConvictionAlert()`:
  - Conviction score, kierunek (BULLISH/BEARISH), katalizator, summary, źródło (bez rozkładu wymiarów)

### Faza 1.6 — Insider trades parser (ukończona)
- [x] Form 4 XML parsing — wyciąganie shares, pricePerShare, totalValue, transactionType
- [x] Pełne dane z SEC EDGAR: nazwa insidera, rola, typ transakcji, wartość, liczba akcji
- [x] Alert insider trade z danymi z Form 4 XML

### Sprint 3a: Tuning conviction + alertów (ukończony 2026-03-01)
- [x] **Rebalans magnitude_multiplier** — zmiana z {low:1, med:2, high:3} na {low:1, med:1.5, high:2.0}
  - Conviction range: [-3.0, +3.0] → [-2.0, +2.0], próg alertu |conv|>1.5 bez zmian
  - Zmiana w `azure-api/processor.js` (Azure VM) + `telegram-formatter.service.ts`
- [x] **Throttling per catalyst_type** — throttle per (rule, symbol, catalyst_type) zamiast per (rule, symbol)
  - Nowa kolumna `catalystType` w `Alert` entity (TypeORM auto-sync)
  - FDA i earnings dla tego samego tickera nie blokują się wzajemnie
  - Insider trade / filing — throttle per (rule, symbol) jak dotąd
- [x] **Fallback "Strong FinBERT Signal"** gdy VM offline — 9. reguła alertów
  - Warunek: model=finbert AND |score|>0.7 AND confidence>0.8 AND brak conviction (brak AI)
  - Format: kierunek, FinBERT score/confidence, etykieta "(unconfirmed)"
  - Priorytet: HIGH, throttle: 60 min
- [x] **Uproszczenie formatu Telegram conviction** — usunięto rozkład wymiarów (sent×rel×nov×auth×conf×mag)
  - Nowy format: kierunek + conviction + katalizator + summary + źródło (~50% mniej tekstu)
- [x] **Frontend** — kolumna Katalizator w tabeli alertów, dynamiczny badge reguł (bez hardcode)

### Sprint 3b: PDUFA.bio + Context Layer + Pipeline Log Viewer (ukończony 2026-03-02)
- [x] **Kolektor PDUFA.bio** — scraping kalendarza FDA z pdufa.bio/pdufa-calendar-YYYY
  - `PdufaBioService` — scraping HTML, parsowanie eventów, deduplikacja (ticker+drug+date)
  - `PdufaBioProcessor` — BullMQ worker kolejki `pdufa-bio`
  - `PdufaBioScheduler` — repeatable job co 6h + natychmiastowy pierwszy run
  - `pdufa-parser.ts` — parser HTML tabeli PDUFA
  - Przechowuje WSZYSTKIE eventy (nie tylko nasze tickery)
- [x] **Entity `PdufaCatalyst`** — tabela `pdufa_catalysts`:
  - symbol, drugName, indication, therapeuticArea, pdufaDate, eventType, outcome (nullable), odinTier, odinScore, scrapedAt
  - UNIQUE constraint: (symbol, drugName, pdufaDate)
- [x] **PDUFA Context Layer** — wstrzykiwanie kontekstu FDA do prompta gpt-4o-mini:
  - `buildPdufaContext()` w PdufaBioService — format: "PDUFA: drugName, indication: X, date: YYYY-MM-DD (N days)"
  - `AzureOpenaiClientService.analyze()` — nowy parametr `pdufaContext`
  - `processor.js` (Azure VM) — wstrzyknięcie sekcji "UPCOMING FDA CATALYSTS" do prompta
  - `processor.js` — zwraca `prompt_used` w odpowiedzi (widoczność prompta)
- [x] **Entity `AiPipelineLog`** — tabela `ai_pipeline_logs`:
  - 17 kolumn: symbol, source, entityType, entityId, status, tier, tierReason, finbertScore, finbertConfidence, inputText, pdufaContext, requestPayload (jsonb), responsePayload (jsonb), finbertDurationMs, azureDurationMs, errorMessage, sentimentScoreId, createdAt
  - Statusy: AI_ESCALATED, FINBERT_ONLY, AI_FAILED, AI_DISABLED, FINBERT_FALLBACK, SKIPPED_SHORT, SKIPPED_NOT_FOUND, ERROR
- [x] **Instrumentacja SentimentProcessorService** — budowanie logu inkrementalnie przez cały pipeline, zapis na każdym punkcie wyjścia
- [x] **REST API**:
  - `GET /api/sentiment/pipeline-logs?status=&symbol=&limit=` — logi egzekucji pipeline AI
  - `GET /api/sentiment/pdufa?upcoming_only=true&limit=` — kalendarz PDUFA
  - `GET /api/health/stats` — rozszerzony o statystyki PDUFA
- [x] **Frontend**:
  - Panel "Pipeline AI — Logi Egzekucji" (15 kolumn: status, ticker, tier, źródło, FinBERT, confidence, powód, tekst, PDUFA, AI wynik, prompt, czasy, błąd, data)
  - Panel "PDUFA Kalendarz (Decyzje FDA)" (kolumny: data PDUFA z countdown, ticker, lek, wskazanie, obszar, wynik)
  - `TextDialog` — klikalne okna dialogowe zamiast tooltipów (prompt, tekst, błąd) z możliwością zaznaczania i kopiowania
- [x] **Telegram** — sekcja PDUFA w raportach 2h (nadchodzące katalizatory FDA w oknie 7 dni)

### Sprint 3c: effectiveScore + Signal Override + bugfixy (ukończony 2026-03-08)
- [x] **effectiveScore jako źródło prawdy** — `effectiveScore = gptConviction / 2.0` (znormalizowany [-1, +1]) zastępuje surowy FinBERT score w `AlertEvaluatorService`:
  - `checkSentimentCrash()` używa effectiveScore zamiast score → GPT BULLISH blokuje Crash
  - Usunięta stara logika supresji AI — effectiveScore przejmuje odpowiedzialność
- [x] **Bullish/Bearish Signal Override** — 2 nowe reguły alertów (łącznie 11 pre-Sprint 4):
  - Bullish Override: FinBERT < -0.5, ale GPT mówi BULLISH (effectiveScore > 0.1)
  - Bearish Override: FinBERT > 0.5, ale GPT mówi BEARISH (effectiveScore < -0.1)
  - Format alertu z `formatSignalOverrideAlert()` + kierunek + katalizator
- [x] **10 tickerów pharma/biotech** — rozszerzenie healthcare universe (łącznie ~37 tickerów):
  - ABBV, BMY, GILD, MRNA, REGN, VRTX, BIIB, AMGN + dodatkowe
- [x] **Frontend: filtr BUY/SELL** w insider trades — wyświetlaj tylko transakcje BUY i SELL (nie GRANT, EXERCISE itp.)
- [x] **Frontend: data kompilacji** w prawym dolnym rogu dashboardu
- [x] **Fix conviction: AI suppress < 0.1** — conviction < 0.1 supresowane + source-based kalibracja prompta
- [x] **Fix PDUFA context** — domyślne okno 90 dni (zamiast 30) dla wyszukiwania nadchodzących katalizatorów
- [x] **Fix 4 krytyczne bugi w pipeline alertów**:
  - JSON parse error: pharma_biotech inside tickers object
  - Fix insider trade aggregation (batch per ticker)
  - Fix throttling catalystType matching
  - Fix alert rule lookup case sensitivity

### Sprint 4: SEC Filing GPT Pipeline + CorrelationService (ukończony 2026-03-08)

Nowy pipeline analizy GPT dla filingów SEC (Form 4 + 8-K) z per-typ promptami + CorrelationService do detekcji wzorców między źródłami sygnałów.

#### 4.1 Nowe moduły
- [x] **SecFilingsModule** (`src/sec-filings/`) — pipeline GPT dla Form 4 i 8-K:
  - `Form4Pipeline` — event NEW_INSIDER_TRADE → GPT z kontekstem (rola, 10b5-1, historia 30d) → Zod walidacja → alert
  - `Form8kPipeline` — event NEW_FILING (8-K) → fetch tekstu z SEC EDGAR → per-Item prompt → GPT → alert
  - `DailyCapService` — Redis INCR, max 20 wywołań GPT/ticker/dzień
  - 5 promptów: Form 4, 8-K Item 1.01 (kontrakty), 2.02 (earnings), 5.02 (leadership), inne
  - Item 1.03 (Bankruptcy) → natychmiastowy alert CRITICAL bez GPT
  - Parser 8-K: `detectItems()`, `extractItemText()` (limit 8000 znaków), `stripHtml()`
  - Scorer: `scoreToAlertPriority()`, `mapToRuleName()`
  - Walidacja Zod z retry 1x, `SecFilingAnalysisSchema`
- [x] **CorrelationModule** (`src/correlation/`) — detekcja wzorców między źródłami:
  - `CorrelationService` (~300 linii) — 5 detektorów wzorców:
    - `detectInsiderPlus8K` — Form 4 + 8-K w ciągu 24h
    - `detectFilingConfirmsNews` — news → 8-K tego samego catalyst_type w 48h
    - `detectMultiSourceConvergence` — 3+ kategorie źródeł, ten sam kierunek, 24h
    - `detectInsiderCluster` — 2+ Form 4 jednego tickera w 7 dni
    - `detectEscalatingSignal` — rosnąca conviction w 72h, min |conviction| > 0.25
  - Redis Sorted Sets z `ZREMRANGEBYSCORE` (fix: prawidłowe czyszczenie starych danych)
  - Debounce 10s per ticker, deduplikacja Redis, throttling per pattern type
  - `aggregateConviction()` — bazowy najsilniejszy + 20% boost/źródło, cap 1.0
  - `getDominantDirection()` — wymaga 66% przewagi

#### 4.2 Rozszerzenia istniejących modułów
- [x] **Encje** — rozszerzenie `SecFiling` (+gptAnalysis JSONB, +priceImpactDirection) i `InsiderTrade` (+is10b51Plan, +sharesOwnedAfter)
- [x] **Form4 parser** — nowe pola: `is10b51Plan` (Rule 10b5-1 transaction), `sharesOwnedAfter`
- [x] **AzureOpenaiClientService** — nowa metoda `analyzeCustomPrompt(prompt)`, graceful degradation (VM 404 → null)
- [x] **TelegramFormatterService** — 4 nowe formaty: `formatForm4GptAlert()`, `formatForm8kGptAlert()`, `formatBankruptcyAlert()`, `formatCorrelatedAlert()`
- [x] **TelegramModule** — wydzielony z AlertsModule (unikanie circular dependency)
- [x] **AlertEvaluatorService** — wiring `storeSignal()` po każdym sendAlert → CorrelationService
- [x] **Event types** — `SEC_FILING_ANALYZED`, `CORRELATION_DETECTED`
- [x] **6 nowych reguł alertów**: 8-K Material Event GPT, 8-K Earnings Miss, 8-K Leadership Change, Form 4 Insider Signal, 8-K Bankruptcy, Correlated Signal

### Faza 1.7 — GDELT jako nowe źródło danych (priorytet NISKI)
GDELT (Global Database of Events, Language, and Tone) — darmowe, bez klucza API.
- [ ] **DOC API** (`api.gdeltproject.org/api/v2/doc`) — szukaj artykułów po keywords healthcare
- [ ] **GKG API** — tematy, osoby, organizacje z wbudowaną tonalnością (-10 do +10)
- [ ] **TV API** — monitoring wzmianek healthcare w CNBC, CNN, Fox Business
- **Rekomendacja**: uzupełnienie Finnhub, nie zamiennik. Interwał: co 15 min

### Faza 3 — Frontend React rozbudowa (w trakcie)
- [x] Wykres sentymentu per ticker (Recharts) — linia score w czasie, dropdown tickerów, statystyki (avg, pos/neg/neutral), kolorowe kropki, tooltip z tekstem
- [x] Zakładka "Analiza AI (gpt-4o-mini)" — pełne dane enrichedAnalysis w tabeli
- [x] Fioletowe kropki AI na wykresie sentymentu + badge AI w tooltip
- [x] Ukrycie kolektora Reddit z widoku (placeholder)
- [x] Panel "Pipeline AI — Logi Egzekucji" — 15 kolumn z pełną historią AI pipeline
- [x] Panel "PDUFA Kalendarz (Decyzje FDA)" — countdown do dat, kolory wg odległości
- [x] TextDialog — klikalne dialogi z kopiowaniem zamiast tooltipów (prompt, tekst, błąd)
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

- **Tickery do monitorowania**: ~37 healthcare (zdefiniowane w healthcare-universe.json)
- **Słowa kluczowe**: 180+
- **Subreddity**: 18
- **Pliki źródłowe**: ~90 plików TypeScript w `src/` + 2 Python w `finbert-sidecar/` + 2 JS na Azure VM
- **Reguły alertów**: 17 (11 sentyment/insider/filing + 6 nowych: 8-K Material Event GPT, 8-K Earnings Miss, 8-K Leadership Change, Form 4 Insider Signal, 8-K Bankruptcy, Correlated Signal)
- **Encje bazy danych**: 11 tabel (sentiment_scores z enrichedAnalysis jsonb, pdufa_catalysts, ai_pipeline_logs, sec_filings z gptAnalysis jsonb, insider_trades z is10b51Plan)
- **Kolejki BullMQ**: 7 (5 kolektorów + sentiment-analysis + alerts)
- **Endpointy REST**: 15 (health x2, tickers x2, sentiment x7 + ai_only + pipeline-logs + pdufa + insider-trades, alerts x2)
- **Źródła danych**: 4 aktywne kolektory (StockTwits, Finnhub, SEC EDGAR, PDUFA.bio), 1 placeholder (Reddit)
- **Modele AI**: 2 aktywne (FinBERT lokalnie na GPU, Azure OpenAI gpt-4o-mini na VM z PDUFA Context Layer + SEC Filing GPT Pipeline), 1 planowany (spaCy NER)
- **Infrastruktura**: 6 kontenerów Docker (app, finbert, frontend, postgres, redis, pgadmin) + Azure VM (processor.js + api.js na PM2)
- **Środowiska**: Laptop WSL2 (dev), serwer produkcyjny z NVIDIA CUDA, Azure VM z gpt-4o-mini
- **Nowe moduły (Sprint 4)**: SecFilingsModule (5 promptów, parser 8-K, scorer, Zod validation, daily cap), CorrelationModule (5 detektorów wzorców, Redis Sorted Sets)
