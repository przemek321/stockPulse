# StockPulse — Status projektu i plan działania

> **To jest główny plik śledzący postęp rozwoju projektu.** Każda faza, sprint i zadanie są tu dokumentowane z checkboxami `[x]` / `[ ]`.

> Ostatnia aktualizacja: 2026-04-03

## Gdzie jesteśmy

**Sprint 11 — Przebudowa: focus na edge** (ukończony 2026-04-03) + **Sprint 11b — Cleanup martwego kodu** (2026-04-03). Analiza 2 tygodni (962 alertów, 55.5% hit rate) wykazała brak edge'u na sentymencie. System przebudowany: wyłączenie szumu (StockTwits, Finnhub news, 6 reguł sentymentowych + Insider Trade Large, 3 wzorców korelacji), focus na insider pipeline + PDUFA + korelacje insider×options. Sprint 11b: audyt spójności docs vs kod → wyłączenie Finnhub scheduler, early return w AlertEvaluator, usunięcie martwego kodu insider aggregation.

**Aktywny pipeline**: SEC EDGAR (Form 4 + 8-K) → GPT analiza → 3 wzorce korelacji (INSIDER_CLUSTER, INSIDER_PLUS_8K, INSIDER_PLUS_OPTIONS) → alerty Telegram. Options Flow z PDUFA boost → standalone alert tylko z pdufaBoosted=true. Form4Pipeline: discretionary C-suite only (is10b51Plan=true → skip). 7 aktywnych reguł alertów, 12 wyłączonych. Cel: 3-5 alertów/tydzień z realnym edge zamiast 50/dzień z szumem. Raporty tygodniowe w [doc/reports/](doc/reports/).

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
  - **Tier 2 (średnie)**: confidence > 0.3 AND absScore > 0.2 → do AI jeśli VM aktywna
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
- [x] **Fix conviction: AI suppress + source-based kalibracja** (commit cddc7f3):
  - **Bug: AI override suppression** — stara logika wymagała OBIE warunki (low conviction AND low urgency) do supresji, co przepuszczało garbage. Fix: usunięto dual-condition suppress, `effectiveScore = gptConviction / 2.0` bez warunków supresji. Reguła `checkUrgentSignal` łapie sygnały z urgency=HIGH nawet przy niskim conviction.
  - **Bug: flat conviction** — `source` nie był przekazywany z NestJS → Azure VM → `buildPrompt()`, więc GPT nie mógł różnicować StockTwits (0.1-0.3) od SEC EDGAR (0.9-1.0). Fix: `source` dodany do payloadu `AzureOpenaiClientService.analyze()`, `processor.js buildPrompt()` ma `calibrationMap` per platforma (STOCKTWITS, REDDIT, FINNHUB, SEC_EDGAR)
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
  - `CorrelationService` (~400 linii) — 5 detektorów wzorców:
    - `detectInsiderPlus8K` — Form 4 (z `signals:insider`) + 8-K (z `signals:short`) w ciągu 24h
    - `detectFilingConfirmsNews` — news → 8-K w 48h (catalyst_type `'unknown'` ignorowany przy matchowaniu)
    - `detectMultiSourceConvergence` — 3+ kategorie źródeł, ten sam kierunek, 24h
    - `detectInsiderCluster` — 2+ Form 4 jednego tickera w 7 dni
    - `detectEscalatingSignal` — rosnąca conviction w 72h, min |conviction| > 0.25
  - Redis Sorted Sets z `ZREMRANGEBYSCORE` (fix: prawidłowe czyszczenie starych danych)
  - Debounce 10s per ticker, deduplikacja Redis, throttling per pattern type
  - `aggregateConviction()` — bazowy najsilniejszy + 20% boost/źródło, cap 1.0
  - `getDominantDirection()` — wymaga 66% przewagi
  - **Progi**: MIN_CONVICTION=0.05 (zapis do Redis), MIN_CORRELATED_CONVICTION=0.20 (wyzwolenie alertu)

#### 4.2 Rozszerzenia istniejących modułów
- [x] **Encje** — rozszerzenie `SecFiling` (+gptAnalysis JSONB, +priceImpactDirection) i `InsiderTrade` (+is10b51Plan, +sharesOwnedAfter)
- [x] **Form4 parser** — nowe pola: `is10b51Plan` (Rule 10b5-1 transaction), `sharesOwnedAfter`
- [x] **AzureOpenaiClientService** — nowa metoda `analyzeCustomPrompt(prompt)`, graceful degradation (VM 404 → null)
- [x] **TelegramFormatterService** — 4 nowe formaty: `formatForm4GptAlert()`, `formatForm8kGptAlert()`, `formatBankruptcyAlert()`, `formatCorrelatedAlert()`
- [x] **TelegramModule** — wydzielony z AlertsModule (unikanie circular dependency)
- [x] **AlertEvaluatorService** — wiring `storeSignal()` po każdym sendAlert → CorrelationService
- [x] **Event types** — `SEC_FILING_ANALYZED`, `CORRELATION_DETECTED`
- [x] **6 nowych reguł alertów**: 8-K Material Event GPT, 8-K Earnings Miss, 8-K Leadership Change, Form 4 Insider Signal, 8-K Bankruptcy, Correlated Signal

### Sprint 4b: Dashboard GPT Filingów + polskie tłumaczenia + kalibracja conviction (ukończony 2026-03-08)
- [x] **Frontend: 2 nowe panele**:
  - "Analiza GPT Filingów SEC" — wyniki analizy GPT per filing (ticker, typ, wpływ cenowy, conviction, podsumowanie, data)
  - "Skorelowane Sygnały" — alerty z CorrelationService (ticker, priorytet, wzorzec, wiadomość, data)
- [x] **Nowe endpointy REST**:
  - `GET /api/sentiment/filings-gpt` — filingi SEC z gptAnalysis (nie-null)
  - `POST /api/sec-filings/backfill-gpt?limit=N` — backfill GPT analizy dla istniejących 8-K filingów (max 50)
- [x] **Polskie tłumaczenia**:
  - TelegramFormatterService — wszystkie etykiety, nagłówki, kierunki (BYCZY/NIEDŹWIEDZI) po polsku
  - 5 promptów SEC (Form 4, 8-K Items 1.01/2.02/5.02/other) — `summary`, `conclusion`, `key_facts` po polsku
  - processor.js (Azure VM) — pole `summary` po polsku
- [x] **Kalibracja conviction w promptach SEC** — skala CONVICTION SCALE per typ filingu:
  - Form 4: rutynowe 10b5-1 = ±0.1-0.3, klaster insiderski = ±0.9-1.2, ekstremalnie = ±1.7-2.0
  - 8-K 2.02 (earnings): in-line = ±0.1-0.4, duży beat/miss + guidance = ±1.3-1.6
  - 8-K 5.02 (leadership): planowana emerytura = ±0.1-0.3, nagłe odejście CEO = ±0.8-1.2
  - 8-K 1.01 (kontrakty): rutynowy kontrakt = ±0.3-0.6, transformacyjna umowa = ±1.3-1.6
  - 8-K other: rutynowe ujawnienie = ±0.1-0.4, FDA decyzja = ±1.3-1.6
  - Jawny zakaz defaultowania do ±1.5, instrukcja użycia pełnego zakresu

### Sprint 5: System Logowania — decorator @Logged() + zakładka System Logs (ukończony 2026-03-08)

Globalny system logowania funkcji z automatycznym pomiarem czasu, rejestracją wejścia/wyjścia i osobną zakładką na froncie.

#### 5.1 Backend: Decorator @Logged() + SystemLogService
- [x] **Encja `SystemLog`** (`src/entities/system-log.entity.ts`) — tabela `system_logs`:
  - id, createdAt, module, className, functionName, status, durationMs, input (JSONB), output (JSONB), errorMessage
  - Indeksy: (module, createdAt), status, functionName
- [x] **SystemLogService** (`src/system-log/system-log.service.ts`) — globalny singleton:
  - `log(data)` — fire-and-forget zapis (nie blokuje pipeline)
  - `findAll(filters)` — QueryBuilder z filtrami (module, function, status, dateFrom, dateTo, limit, offset)
  - `cleanup()` — `@Cron('0 3 * * *')` usuwa logi starsze niż 7 dni
- [x] **SystemLogModule** (`src/system-log/system-log.module.ts`) — `@Global()` moduł
- [x] **Decorator `@Logged(module)`** (`src/common/decorators/logged.decorator.ts`):
  - Wrappuje metody async, mierzy czas, przechwytuje input/output
  - `truncateForLog()` — obsługa circular refs (WeakSet), obcinanie stringów >500 znaków, JSON >2000 znaków
  - `serializeArgs()` — wyciąga `.data` z BullMQ Job
  - Fire-and-forget via `SystemLogService.getInstance()?.log(...)`
- [x] **Kontroler** (`src/api/system-logs/system-logs.controller.ts`):
  - `GET /api/system-logs?module=&function=&status=&dateFrom=&dateTo=&limit=&offset=`

#### 5.2 Zastosowanie @Logged() — ~13 metod w 8 serwisach
- [x] `BaseCollectorService.runCollectionCycle()` — moduł `collectors`
- [x] `FinbertClientService.analyze()` — moduł `sentiment`
- [x] `AzureOpenaiClientService.analyze()` — moduł `sentiment`
- [x] `SentimentProcessorService.process()` — moduł `sentiment`
- [x] `Form4Pipeline.onInsiderTrade()` — moduł `sec-filings`
- [x] `Form8kPipeline.onFiling()` — moduł `sec-filings`
- [x] `CorrelationService.storeSignal()`, `runPatternDetection()` — moduł `correlation`
- [x] `AlertEvaluatorService.onSentimentScored()`, `onInsiderTrade()` — moduł `alerts`

#### 5.3 Frontend: zakładka System Logs
- [x] **MUI Tabs** w `App.tsx` — Dashboard + System Logs (2 zakładki)
- [x] **SystemLogsTab** (`frontend/src/components/SystemLogsTab.tsx`):
  - Filtry: moduł (dropdown), status (dropdown), auto-refresh 30s (toggle)
  - Tabela MUI z sortowaniem: Czas, Moduł, Klasa, Funkcja, Status, Czas trwania
  - Rozwijane wiersze z INPUT/OUTPUT JSON w `<pre>`, ERROR na czerwono
  - Paginacja (50/stronę), Export JSON (do 500 logów)
  - Czas trwania >5s podświetlony na pomarańczowo
- [x] **Wykres sentymentu** — schowany w Accordion (domyślnie zwinięty, rozwija się po kliknięciu)
- [x] **api.ts** — interfejsy `SystemLog`, `SystemLogFilters`, funkcja `fetchSystemLogs()`

### Sprint 6: Price Outcome Tracker + Urgent AI Signal (ukończony 2026-03-08)

Mierzenie trafności alertów — zapis ceny akcji w momencie alertu i śledzenie zmian w 4 horyzontach czasowych + nowa reguła Urgent AI Signal.

#### 6.1 Price Outcome Tracker
- [x] **Rozszerzenie encji Alert** — 7 nowych pól: `alertDirection`, `priceAtAlert`, `price1h`, `price4h`, `price1d`, `price3d`, `priceOutcomeDone`
- [x] **FinnhubService.getQuote()** — pobieranie bieżącej ceny z endpointu `/quote`
- [x] **PriceOutcomeModule** (`src/price-outcome/`) — nowy moduł:
  - `PriceOutcomeService` — CRON `0 * * * *` (co godzinę), max 30 zapytań Finnhub/cykl
  - 4 sloty czasowe: 1h → 4h → 1d → 3d
  - **NYSE market hours guard** — odpytuje Finnhub TYLKO gdy giełda otwarta (pon-pt 9:30-16:00 ET). Poza sesją cena = last close (identyczna dla wielu slotów, bezwartościowa). Helper `isNyseOpen()` w `src/common/utils/market-hours.util.ts` (Intl.DateTimeFormat, auto DST).
  - `priceOutcomeDone` gdy: wszystkie 4 sloty wypełnione LUB hard timeout 7d (zamiast starych 72h — uwzględnia weekendy i święta)
- [x] **Wiring w sendAlert()** — zapis `priceAtAlert` i `alertDirection` w momencie wysyłki alertu
- [x] **Endpoint REST**: `GET /api/alerts/outcomes?limit=100&symbol=UNH` — alerty z cenami + delty % + `directionCorrect`
- [x] **Frontend: panel "Trafność Alertów (Price Outcome)"** — tabela z kolumnami: ticker, reguła, kierunek (▲/▼), cena alertu, +1h%, +4h%, +1d%, +3d%, trafny? (✓/✗/—)

#### 6.2 AlertEvaluator — decyzje w logach + nowa reguła
- [x] **Decyzje w logach** — metody check*() zwracają string z decyzją (SKIP/THROTTLED/ALERT_SENT) → zapisywane do system_logs przez @Logged
- [x] **onSentimentScored()** zwraca obiekt z 6 decyzjami (sentimentCrash, signalOverride, highConviction, strongFinbert, urgentSignal, checkUrgentSignal)
- [x] **Nowa reguła checkUrgentSignal()** — łapie sygnały z `urgency=HIGH`, `relevance≥0.7`, `confidence≥0.6`, `|conviction|≥0.3` (próg podniesiony z 0.1 — conviction 0.1 to "GPT powiedział cokolwiek", bez wartości predykcyjnej). Throttle 180 min.
- [x] **Reguła w JSON**: "Urgent AI Signal" (priority HIGH, throttle 180 min)
- [x] **Osobna etykieta Telegram**: `formatUrgentAiAlert()` → "Pilny Sygnał AI" (zamiast wspólnego "Silny Sygnał" z High Conviction)

#### 6.3 AlertEvaluator — bugfix + optymalizacje (2026-03-08)
9 fixów w `alert-evaluator.service.ts` + 21 nowych testów jednostkowych:
- [x] **Fix: podwójny save w sendAlert()** — `getQuote()` przed `create()`, 1 zapis do DB zamiast 2
- [x] **Fix: enrichedAnalysis! non-null assertion** — `enrichedAnalysis ?? {}` zamiast `!` (crash gdy null)
- [x] **Fix: OnModuleDestroy** — czyszczenie timerów insider batches przy shutdownie NestJS
- [x] **Fix: onFiling nazwa firmy** — pobiera z `tickerRepo` zamiast używać symbolu
- [x] **Fix: @Logged na onFiling** — dodany brakujący decorator (spójność z innymi handlerami)
- [x] **Fix: filtr transactionType** — odrzuca trades bez `transactionType` (wcześniej undefined trafiało jako UNKNOWN)
- [x] **Opt: cache reguł alertów** — `getRule()` z TTL 5 min, eliminuje ~5 zapytań DB na event sentymentu
- [x] **Opt: isThrottled count()** — `alertRepo.count()` zamiast `findOne()` (lżejsze zapytanie)
- [x] **Opt: typ FindOptionsWhere** — `FindOptionsWhere<Alert>` zamiast `any`
- [x] **Testy**: `test/unit/alert-evaluator.spec.ts` — 21 testów pokrywających wszystkie fixy

### Sprint 7: Przegląd logiki + 9 krytycznych fixów (ukończony 2026-03-09)

Kompleksowy code review backendu i frontendu pod kątem spójności logicznej, race conditions, anty-wzorców React i brakującej persystencji danych.

#### 7.1 Frontend (React)
- [x] **Fix: setState w useMemo** — `SentimentChart.tsx`: `setSelectedTicker()` przeniesiony z `useMemo` do `useEffect` (naruszenie zasad Reacta, potencjalne nieskończone re-rendery)
- [x] **Fix: zbędny fetchTickers()** — `SentimentChart.tsx`: usunięte wywołanie `fetchTickers()` w `Promise.all` z odrzucanym wynikiem (zbędne zapytanie API)

#### 7.2 Backend — persystencja i type safety
- [x] **Fix: Form4Pipeline brak zapisu GPT** — analiza GPT Form 4 nie była zapisywana do bazy (utrata danych). Dodany `@InjectRepository(SecFiling)`, zapis `gptAnalysis` + `priceImpactDirection` do SecFiling po bazowym accessionNumber (`trade.accessionNumber.replace(/_\d+$/, '')`)
- [x] **Fix: SentimentController getRepository string** — `getRepository('SecFiling')` zmienione na `getRepository(SecFiling)` z klasą (type safety)

#### 7.3 Backend — conviction scale i direction
- [x] **Fix: conviction scale mismatch** — Form4Pipeline i Form8kPipeline przekazywały surowy conviction [-2.0, +2.0] do CorrelationService, podczas gdy reszta systemu normalizuje do [-1.0, +1.0]. SEC filingi miały 2x większą wagę w detektorach korelacji. Fix: `conviction / 2.0` z clamp przed zapisem do Redis.
- [x] **Fix: neutral direction** — AlertEvaluator wymuszał `direction='positive'` gdy neutral. Fix: derywacja z `conviction >= 0 ? 'positive' : 'negative'`

#### 7.4 Backend — race condition i throttling
- [x] **Fix: DailyCapService race condition** — `canCallGpt()` (GET) + `recordGptCall()` (INCR) nie były atomowe → dwa równoczesne eventy mogły przekroczyć daily cap. Fix: atomowy `INCR` + `DECR` rollback w `canCallGpt()`, `recordGptCall()` jest teraz no-op (slot rezerwowany atomowo).
- [x] **Fix: Tier 2 OR → AND** — `classifyTier()` używał OR zamiast AND, co eskalowało ~33% więcej sygnałów do Azure. Sygnał z confidence=0.25 i absScore=0.21 nie powinien iść do AI.
- [x] **Fix: Form4 catalyst_type throttling** — Form4Pipeline nie przekazywał `catalyst_type` do `checkThrottled()` (w przeciwieństwie do Form8k). CEO SELL + CFO SELL tego samego dnia były throttlowane razem. Fix: dodany parametr `catalystType` do `checkThrottled()`.

#### 7.5 Backend — cleanup
- [x] **Fix: CorrelationService OnModuleDestroy** — brak cleanup timerów `pendingChecks` (setTimeout) przy zamknięciu modułu → potencjalny memory leak. Fix: implementacja `OnModuleDestroy` z `clearTimeout` + `clear()`.

#### 7.6 SEC Filing Pipeline — martwe listenery (2026-03-09)
- [x] **Fix: kolejność dekoratorów @OnEvent/@Logged** — `Form8kPipeline.onFiling()` i `Form4Pipeline.onInsiderTrade()` miały `@Logged` NAD `@OnEvent`. TypeScript stosuje dekoratory od dołu: `@OnEvent` (wewnętrzny) ustawiał metadata na oryginalnej funkcji przez `SetMetadata`, potem `@Logged` (zewnętrzny) podmieniał `descriptor.value` na wrapper — metadata zostawała na starej referencji. NestJS EventEmitter nie znajdował listenera → pipeline GPT dla SEC filingów **nigdy się nie uruchamiał** (0 wpisów w `system_logs` dla `module='sec-filings'`). Fix: zamiana kolejności na `@OnEvent` (góra) → `@Logged` (dół), spójnie z `alert-evaluator.service.ts` gdzie kolejność była prawidłowa.
  - Dotyczy: `src/sec-filings/pipelines/form8k.pipeline.ts`, `src/sec-filings/pipelines/form4.pipeline.ts`

### Sprint 8: Optymalizacja pipeline + analiza tygodniowa (ukończony 2026-03-14)

Analiza tygodniowa systemu (7-13 marca) ujawniła 3 problemy. Wdrożone na serwer produkcyjny (Jetson Orin NX).

#### 8.1 Wyłączenie StockTwits z eskalacji GPT
- [x] **Optymalizacja: StockTwits → FinBERT-only** — 78.1% conviction z GPT było flat (-0.01 do 0.01). Przyczyna: GPT przypisuje StockTwits `source_authority=0.15`, co zeruje conviction (conviction = sent × rel × nov × **auth** × conf × mag). 83% wywołań Azure VM generowało wartość ~0. Fix: `isGptEligibleSource = source !== DataSource.STOCKTWITS` w warunku `shouldEscalate`. Plik: `src/sentiment/sentiment-processor.service.ts:133-140`. Redukcja wywołań Azure VM o ~83% (z ~3 773 do ~640/tydzień).

#### 8.2 Czyszczenie BullMQ + korekta raportu
- [x] **Fix: 500 failed jobów BullMQ** — wszystkie "fetch failed" z 20.02.2026 (jednorazowy incident). Wyczyszczone `ZREMRANGEBYSCORE`.
- [x] **Fix: insider trades breakdown** — agent SQL szukał kodów SEC (`'P'`/`'S'`), kolektor zapisuje pełne słowa (`'SELL'`/`'BUY'`). Poprawiony raport: 12 SELL (discretionary, is10b5-1Plan=false), 0 BUY.

#### 8.3 Raport tygodniowy (7-13 marca 2026)
- [x] **Raport**: [doc/reports/2026-03-13-weekly-report.md](doc/reports/2026-03-13-weekly-report.md) — 9 028 sygnałów, 131 alertów, 24 tickery. Hit rate: 55.4% (1d), 59.3% (3d). Alerty negatywne: 80% trafność 3d. Top: HIMS +57.7% (deal z Novo Nordisk), CNC -17.1% (8-K). Najlepsza reguła: 8-K Material Event (85.7% hit rate).
- [x] **Changelog**: [doc/reports/2026-03-14-zmiany.md](doc/reports/2026-03-14-zmiany.md)

#### 8.4 Optymalizacja system_logs (analiza 36 379 wierszy → 6 zmian)
- [x] **Usunięcie @Logged z FinBERT analyze()** — podwójne logowanie (analyze + process) generowało 35% wolumenu. Dane FinBERTa już w output process().
- [x] **Return values zamiast void** — 6 metod (onInsiderTrade ×2, onFiling ×2, storeSignal, runPatternDetection) zwracało void → 930 wierszy/tydzień z null output. Teraz zwracają `{ action: 'SKIP_LOW_VALUE' | 'BATCHED' | 'STORED' | ... }`.
- [x] **Nazwa kolektora w runCollectionCycle** — input był null (brak argumentów), output `{value: N}` bez kontekstu. Teraz zwraca `{ collector: 'STOCKTWITS', count: N }`.
- [x] **Próg highConviction: 1.5 → 0.7** — stary próg nieosiągalny (max conviction w historii = 1.008, 0 wyzwoleń ever). Nowy 0.7 łapie naprawdę silne sygnały.
- [x] **JSDoc AlertEvaluator** — dodano brakującą regułę Urgent AI Signal do komentarza.
- [x] **Dokumentacja** — CLAUDE.md: 5 checków / 6 reguł, ~13 metod @Logged.

### Sprint 9: Fixy z raportu tygodniowego — conviction sign, dual signal, noise reduction (ukończony 2026-03-17)

Raport tygodniowy (10-17 marca) ujawnił 9% edge / 85% noise (180 alertów, 17 potencjalnie użytecznych). Walidacja na danych giełdowych: THC insider cluster = trafny (-15% w 6 dni), reszta insider signals miała odwrócony conviction sign.

#### 9.1 Fix conviction sign dla Form 4 (prompt + safety net)
- [x] **Prompt sign convention** — jawna instrukcja w `form4.prompt.ts`: SELL = conviction ujemna, BUY = conviction dodatnia. Skala zmieniona z `±0.1-0.4` na `-0.1 to -0.4 / +0.1 to +0.4`
- [x] **Safety net post-GPT** — `form4.pipeline.ts` i `form8k.pipeline.ts`: jeśli `price_impact.direction` nie zgadza się ze znakiem `conviction`, flip sign + warn log. GPT zawsze ustawia direction poprawnie, nawet gdy sign conviction jest odwrócony.
  - Bug: 3 z 5 insider signals (VRTX, TDOC, ISRG) miały conviction +0.90 przy SELL — zielone emoji zamiast czerwonego
  - Przyczyna: prompt mówił `±0.9` — GPT interpretował jako magnitude, ignorując kierunek

#### 9.2 Fix dual signal (AlertEvaluator + Form4Pipeline)
- [x] **Usunięcie rejestracji korelacji z AlertEvaluator** — `flushInsiderBatch()` nie wywołuje `storeSignal()` ani `schedulePatternCheck()`. Sygnały form4 w CorrelationService wyłącznie z Form4Pipeline (GPT-enriched conviction + catalyst_type)
  - Bug: każdy insider trade rejestrował 2 sygnały w Redis — value-based (AlertEval, conviction=totalValue/$1M, catalyst='unknown') + GPT-based (Form4Pipeline, conviction z GPT, catalyst='insider')
  - Efekt: INSIDER_CLUSTER łączył mieszane conviction values (np. THC: -0.45, +1.00, -0.45 — ta +1.00 to AlertEval)
  - Fix ELV INSIDER_PLUS_8K: pozytywne składowe → negatywny aggregate — wynikał z dual signal + conviction sign bug

#### 9.3 Silent rules — Sentiment Crash + Strong FinBERT wyłączone z Telegrama
- [x] **SILENT_RULES** w `alert-evaluator.service.ts` — Set z nazwami reguł zapisywanych do DB bez wysyłki Telegram
  - Raport: 80 alertów/tydzień (44%) = czysty szum StockTwits, zero edge
  - Dane zachowane w DB do analizy retrospektywnej (reguły aktywne, throttling działa, brak `delivered`)

#### 9.4 Per-symbol daily alert limit
- [x] **MAX_TELEGRAM_ALERTS_PER_SYMBOL_PER_DAY = 5** w `alert-evaluator.service.ts`
  - Sprawdzenie w `sendAlert()`: count alertów z `delivered=true` dla symbolu dziś (UTC)
  - Silent rules nie liczą się do limitu
  - Raport: HIMS 46 alertów/tydzień (~6.5/dzień) — limit 5/dzień obcina najgorszy spam

#### 9.5 Osobne progi priorytetów Form4 vs 8-K
- [x] **scoreToAlertPriority rozbity na scoreForm4Priority + score8kPriority** w `price-impact.scorer.ts`
  - Form 4 (leading signals): niższe progi — CRITICAL od |conviction|≥0.8, HIGH od |conviction|≥0.4, nowy MEDIUM od |conviction|≥0.2
  - 8-K (reaktywne): wyższe progi — bez zmian vs poprzednia wersja
  - Uzasadnienie: insider SELL $150K z conviction -0.5 to inny kaliber niż 8-K z conviction -0.5

#### 9.6 Cleanup martwego kodu
- [x] **recordGptCall() usunięty** — metoda była no-op po fix race condition w Sprint 7 (`canCallGpt()` robi atomowy INCR). Usunięta z `daily-cap.service.ts`, `form4.pipeline.ts`, `form8k.pipeline.ts`.

#### 9.7 Dokumentacja
- [x] **doc/flow-form4-8k-insider.md** — nowy plik: kompletny przepływ Form 4 + 8-K + Insider Trade Large z diagramem ASCII, 16 sekcji, mapa plików

#### 9.8 alertDirection w SEC pipeline
- [x] **Form4Pipeline i Form8kPipeline ustawiają alertDirection** przy zapisie alertu — `analysis.price_impact.direction`, fallback na conviction sign przy `neutral`. Bankruptcy = `'negative'`.
  - Blocker: bez tego pola Price Outcome Tracker nie mógł obliczyć hit rate dla najważniejszych sygnałów (insider, 8-K). AlertEvaluator ustawiał `alertDirection` tylko dla korelacji.

#### 9.9 Price Outcomes w raporcie tygodniowym
- [x] **3 nowe zapytania SQL** w `GET /api/health/weekly-report`:
  - **priceOutcomes** — lista alertów z wypełnionymi cenami, deltami procentowymi (1h/1d/3d), direction_correct (1d + 3d)
  - **hitRateByRule** — hit rate per `rule_name`: total, evaluated, correct, % trafności (1d + 3d)
  - **hitRateByCatalyst** — hit rate per `catalyst_type`: to samo w rozbiciu na typ katalizatora
  - Automatyczna odpowiedź na pytanie "czy alerty z tego tygodnia były trafne?" bez ręcznego sprawdzania giełdy

#### 9.10 Frontend: Edge Signals + paginacja
- [x] **Sekcja "Edge Signals — SEC & Insider"** na górze zakładki Kluczowe — wyróżniona wizualnie (amber border), 3 panele: GPT Filings, Insider Trades (z kolumną 10b5-1), Alerty SEC & Insider (filtr edge rules + kolumna Delivered/Silent)
- [x] **Paginacja w DataPanel** — 25/50/100 wierszy na stronę (TablePagination MUI), reset przy sortowaniu. Fix lagów przy otwieraniu panelu Analiza AI.
- [x] **Cleanup doc/** — usunięcie 8 obsolete plików md zastąpionych przez CLAUDE.md i PROGRESS-STATUS.md

### Sprint 10: Options Flow — Polygon.io EOD volume spike detection (ukończony 2026-03-17)

#### 10.1 Infrastruktura
- [x] **Nowy DataSource**: `POLYGON` w enum, `NEW_OPTIONS_FLOW` w EventType, `OPTIONS_FLOW` w QUEUE_NAMES
- [x] **2 nowe encje**: `options_flow` (wykryte anomalie per kontrakt per sesja) + `options_volume_baseline` (rolling 20d avg volume per kontrakt)
- [x] **POLYGON_API_KEY** w `.env.example`

#### 10.2 Kolektor Options Flow (4 pliki)
- [x] `options-flow.service.ts` — extends BaseCollectorService, fetch Polygon API (reference/contracts + daily aggregates), rate limit 12.5s, filter po DTE ≤ 60 i OTM ≤ 30%
- [x] `options-flow.processor.ts` — BullMQ WorkerHost
- [x] `options-flow.scheduler.ts` — CRON `15 22 * * 1-5` (22:15 UTC, pon-pt, po sesji NYSE)
- [x] `options-flow.module.ts` → CollectorsModule

#### 10.3 Unusual Activity Detector
- [x] `unusual-activity-detector.ts` — pure functions: `filterContracts()`, `detectSpike()`, `aggregatePerTicker()`, `updateRollingAverage()`, `calcOtmInfo()`, `calcDte()`
- [x] Volume spike detection: `todayVolume ≥ 3× avg20d AND todayVolume ≥ 100 AND dataPoints ≥ 5`
- [x] Agregacja per ticker: call/put ratio, headline contract (max spikeRatio)

#### 10.4 Scoring heurystyczny (bez GPT)
- [x] `options-flow-scoring.service.ts` — 5 komponentów z wagami:
  - 0.35 × spike ratio (volume/avg, najważniejszy)
  - 0.20 × absolutny volume (skala log)
  - 0.15 × OTM distance
  - 0.15 × DTE (krócej = pilniej)
  - 0.15 × call/put dominance clarity
- [x] **Direction**: callPutRatio > 0.65 → positive, < 0.35 → negative, else → mixed (conviction × 0.7 penalty)
- [x] **PDUFA boost** ×1.3 gdy nadchodząca data FDA < 30 dni (cap ±1.0)
- [x] **Progi**: |conviction| ≥ 0.25 → CorrelationService, ≥ 0.50 → Telegram alert, ≥ 0.70 → CRITICAL

#### 10.5 Alert service + Telegram
- [x] `options-flow-alert.service.ts` — @OnEvent(NEW_OPTIONS_FLOW), scoring, correlation store, alert send
- [x] `formatOptionsFlowAlert()` w TelegramFormatterService — "Unusual Options", direction, conviction, headline contract (volume, spike ratio, OTM, DTE), PDUFA boost
- [x] Reguła "Unusual Options Activity" (priority HIGH, throttle 120 min) w healthcare-universe.json

#### 10.6 CorrelationService — nowy detektor
- [x] **SourceCategory** += `'options'`
- [x] **PatternType** += `'INSIDER_PLUS_OPTIONS'` — Form 4 + unusual options w oknie 72h (najsilniejszy cross-signal)
- [x] `detectInsiderPlusOptions()` — filtruje form4 i options z 72h, wymaga 66% agreement kierunku
- [x] **`signals:short` TTL 48h → 72h** — options sygnały muszą przeżyć do Form 4 filing delay (2 dni)
- [x] Throttle: 7200s (2h)

#### 10.7 REST API + backfill
- [x] `GET /api/options-flow` — lista wykrytych anomalii (limit, symbol, session_date)
- [x] `GET /api/options-flow/stats` — statystyki per ticker
- [x] `POST /api/options-flow/backfill` — jednorazowe wypełnienie 20d baseline (~2-3h z rate limiting)
- [x] `OptionsFlowController` w ApiModule

#### 10.8 Testy (54 testy)
- [x] `unusual-activity-detector.spec.ts` — 30 testów (filter, spike, aggregate, rolling avg, OTM, DTE)
- [x] `options-flow-scoring.spec.ts` — 13 testów (direction, conviction range, PDUFA boost, komponenty)
- [x] `options-flow-agent.spec.ts` — 11 testów (routing, correlation, throttling, priority)

#### 10.9 Fixy post-review (2026-03-18)
- [x] **Daily limit fix**: `sentAt: exact match` → `MoreThanOrEqual(todayStart)` — daily limit per ticker nie działał (szukał exact timestamp zamiast >= dzisiaj)
- [x] **PDUFA query fix**: `LessThan(+30d)` → `Between(now, +30d)` — łapał wszystkie historyczne daty PDUFA zamiast tylko nadchodzących
- [x] **Panel frontend**: nowy DataPanel "Options Flow — Nietypowa Aktywność Opcyjna" w zakładce Kluczowe (Ticker, Typ call/put, Strike, Underlying, DTE, Volume, Spike ratio, OTM%, Conviction, Kierunek, PDUFA boost, Sesja)

#### 10.10 Bugfix z code review (2026-03-18)
- [x] **Form4 parser**: brak daty transakcji → `continue` zamiast `new Date()` (korupcja danych historycznych)
- [x] **Options Flow storeSignal**: dodany `await` (race condition — pattern detection przed zapisem sygnału)
- [x] **Escalating signal**: boost ×1.3 zachowuje znak conviction (zamiast abs→cap→sign = zawsze ±1.0)
- [x] **AlertEvaluator daily limit**: `MoreThan` → `MoreThanOrEqual` (alerty o północy UTC nie liczone)
- [x] **Options Flow duplikat sesji**: `String().slice(0,10)` zamiast kruchego `.toString()` (Date vs string)
- [x] **Weekly report days**: `Math.max(1, Math.min(..., 90))` — ograniczenie zakresu 1-90 dni (DoS protection)

### Sprint 11b: Cleanup martwego kodu — audyt spójności (ukończony 2026-04-03)

Audyt spójności CLAUDE.md / PROGRESS-STATUS.md vs kod ujawnił martwy kod i niespójności. Cleanup bez zmiany zachowania systemu.

#### 11b.1 Finnhub Scheduler wyłączony
- [x] **FinnhubScheduler** — scheduler dodawał repeatable job co 10 min mimo wyłączenia kolektora (news/MSPR). Puste joby BullMQ marnotrawiły zasoby. Fix: scheduler czyści repeatable jobs przy starcie (identycznie jak StockTwits). `/quote` zachowany dla Price Outcome Tracker.

#### 11b.2 AlertEvaluator — czyste wyłączenie martwego kodu
- [x] **`onSentimentScored()` — early return** — handler wołał 5 reguł sentymentowych (checkSentimentCrash, checkSignalOverride, checkHighConviction, checkStrongFinbert, checkUrgentSignal), które wszystkie miały isActive=false → getRule() zwracał null → cichy skip. Early return z logiem `POMINIĘTY (Sprint 11)` zamiast zbędnych zapytań do DB. Private metody check*() zachowane na wypadek reaktywacji.
- [x] **`onInsiderTrade()` — early return** — reguła "Insider Trade Large" ma isActive=false. Handler agregował surowe trades bez GPT (dual signal bug z raportu 2026-03-17). Early return `SKIP_RULE_INACTIVE`. Form4Pipeline obsługuje insider trades z GPT-enriched conviction.
- [x] **Usunięty martwy kod** — `InsiderBatch` interface, `insiderBatches` Map, `INSIDER_AGGREGATION_WINDOW_MS`, `flushInsiderBatch()`, `OnModuleDestroy` (cleanup timerów insiderBatches).

#### 11b.3 Testy zaktualizowane
- [x] **alert-evaluator.spec.ts** — testy insider batches/OnModuleDestroy zastąpione testami SKIP_RULE_INACTIVE, testy onSentimentScored sprawdzają Sprint 11 early return
- [x] **alert-evaluator-agent.spec.ts** — insider aggregation, OnModuleDestroy, flushInsiderBatch direction testy zastąpione Sprint 11 testami

#### 11b.4 Dokumentacja
- [x] **CLAUDE.md** — zaktualizowany opis schedulerów (Finnhub/StockTwits czyszczą repeatable jobs), AlertEvaluator (early return, usunięty martwy kod)
- [x] **PROGRESS-STATUS.md** — dodana sekcja Sprint 11b

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
- [x] Panel "Analiza GPT Filingów SEC" — wyniki analizy GPT per filing SEC (conviction, wpływ cenowy, podsumowanie)
- [x] Panel "Skorelowane Sygnały" — alerty z CorrelationService (wzorzec, priorytet, wiadomość)
- [x] Panel "Trafność Alertów (Price Outcome)" — cena alertu, delty %, trafność kierunku (✓/✗/—)
- [x] Panel "Options Flow — Nietypowa Aktywność Opcyjna" — volume spike'i z Polygon.io (call/put, spike ratio, conviction, PDUFA boost)
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

### Sprint 11: Przebudowa — focus na edge (ukończony 2026-04-03)

Analiza 2 tygodni (19.03–02.04.2026): 962 alertów, 55.5% global hit rate = moneta. FinBERT/Sentiment Crash/Options bez PDUFA = szum. Realny edge: discretionary insider SELL (GILD CEO -1.29%, HIMS CFO -12.5%), INSIDER_PLUS_OPTIONS, FDA/PDUFA catalyst.

**Faza A — Wyciszenie szumu (odwracalne)**:
- [x] 12 reguł alertów → `isActive=false` w DB seed (odwracalne SQL)
- [x] StockTwits collector: scheduler czyści repeatable joby, loguje WARN
- [x] Finnhub collector: `collect()` zwraca 0, endpoint `/quote` zachowany (Price Outcome)
- [x] Sentiment listener: `@OnEvent` dekoratory usunięte z onNewMention/onNewArticle
- [x] 3 wzorce korelacji wyłączone: FILING_CONFIRMS_NEWS, MULTI_SOURCE_CONVERGENCE, ESCALATING_SIGNAL

**Faza B — Wzmocnienie edge'u**:
- [x] Form4Pipeline: skip `is10b51Plan=true`, C-suite regex boost (CEO/CFO/President/Chairman/EVP)
- [x] Options: standalone alert **tylko z pdufaBoosted=true** (reszta → do Redis dla korelacji)
- [x] Spike ratio > 1000 → suspicious flag, conviction ×0.5 (safety net anomalii danych)
- [x] 8-K Item 5.02 prompt: voluntary+successor vs crisis+no successor vs relief rally
- [x] `priceAtAlert` fix: dodany Finnhub getQuote do CorrelationService, Form4Pipeline, Form8kPipeline

**Faza C — Dokumentacja**:
- [x] `CLAUDE.md` — architektura zsynchronizowana ze Sprint 11
- [x] `PROGRESS-STATUS.md` — Sprint 11 + Kluczowe liczby
- [x] `doc/reports/2026-04-02-analiza-2-tygodnie.md` — pełna analiza danych

## Kluczowe liczby

- **Tickery do monitorowania**: ~37 healthcare (zdefiniowane w healthcare-universe.json)
- **Słowa kluczowe**: 180+
- **Subreddity**: 18
- **Pliki źródłowe**: ~90 plików TypeScript w `src/` + 2 Python w `finbert-sidecar/` + 2 JS na Azure VM
- **Reguły alertów**: 19 total — **7 aktywnych** (Form 4 Insider Signal, 8-K Material Event GPT, 8-K Earnings Miss, 8-K Leadership Change, 8-K Bankruptcy, Correlated Signal, Unusual Options Activity), **12 wyłączonych** (isActive=false — sentyment, niezaimplementowane)
- **Encje bazy danych**: 14 tabel (alerts z 7 polami price outcome + priceAtAlert, sentiment_scores, pdufa_catalysts, ai_pipeline_logs, system_logs, sec_filings z gptAnalysis jsonb, insider_trades z is10b51Plan, options_flow, options_volume_baseline)
- **Kolejki BullMQ**: 8 (6 kolektorów + sentiment-analysis + alerts) — StockTwits/Finnhub schedulery wyłączone
- **Endpointy REST**: 23 (health x2, tickers x2, sentiment x8, alerts x3 incl. outcomes, sec-filings/backfill-gpt x1, system-logs x1, options-flow x3, pipeline-logs x1, pdufa x1, insider-trades x1)
- **Źródła danych**: **3 aktywne kolektory** (SEC EDGAR, PDUFA.bio, Polygon.io Options Flow), **3 wyłączone** (StockTwits, Finnhub news/MSPR, Reddit placeholder). Finnhub `/quote` zachowany.
- **Modele AI**: Azure OpenAI gpt-4o-mini (Form 4 + 8-K). FinBERT sidecar (kontener działa, nie otrzymuje jobów — pipeline sentymentu wyłączony)
- **Infrastruktura**: 6 kontenerów Docker (app, finbert, frontend, postgres, redis, pgadmin) + Azure VM (processor.js + api.js na PM2)
- **Środowiska**: Laptop WSL2 (dev), serwer produkcyjny z NVIDIA CUDA, Azure VM z gpt-4o-mini
- **Nowe moduły (Sprint 4)**: SecFilingsModule (5 promptów, parser 8-K, scorer, Zod validation, daily cap), CorrelationModule (**3 aktywne** detektory wzorców, Redis Sorted Sets)
- **Nowe moduły (Sprint 6)**: PriceOutcomeModule (CRON co 1h, Finnhub /quote, max 30 zapytań/cykl, 4 sloty: 1h/4h/1d/3d, NYSE market hours guard, hard timeout 7d)
- **Nowe moduły (Sprint 10)**: OptionsFlowCollectorModule (kolektor CRON 22:15 UTC, Polygon.io Free Tier, volume spike detection), OptionsFlowModule (scoring + alert + CorrelationService INSIDER_PLUS_OPTIONS)
- **Sprint 11**: Przebudowa — focus na edge. Wyłączenie szumu (StockTwits, Finnhub news, sentiment pipeline, 12 reguł, 3 wzorców korelacji). Wzmocnienie: Form4 discretionary C-suite filter, spike ratio cap, 8-K leadership prompt fix, priceAtAlert fix
- **Testy jednostkowe**: 8 suite'ów, 145 testów (correlation, form4-parser, form8k-parser, price-impact-scorer, alert-evaluator, unusual-activity-detector, options-flow-scoring, options-flow-agent)
