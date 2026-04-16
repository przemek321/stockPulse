# StockPulse — Status projektu i plan działania

> **To jest główny plik śledzący postęp rozwoju projektu.** Każda faza, sprint i zadanie są tu dokumentowane z checkboxami `[x]` / `[ ]`.

> Ostatnia aktualizacja: 2026-04-16

## Stan walidacji (10.04.2026)

**Sprint 15 V2** (re-run po P0/P0.5 fixach): edge **C-suite BUY d=0.725** na 28-tickerowym overlap universe (V1 d=0.83 cherry-picked był zawyżony), **All BUY d=0.542** (V1 d=0.27 — wzrost 2x), **BUY >$1M d=0.706** z monotoniczną gradacją ($100K→$500K→$1M), **bez top-3 hit rate 80%** (edge dystrybuowany, NIE single narrative), point-in-time clean. **Pending**: H6 balanced re-run, BUY threshold replication ($750K/$1.5M/$2M), XBI-adjusted alpha, per-(insider, year) deduplikacja, pure survivorship test (delisted CIKs).

> ⛔ **Sprint 16 = validation only.** NIE ClinicalTrials/Polymarket/nowe reguły/zmiany boost ×1.3/×1.2. Sprint 17 = rekalibracja parametrów na podstawie pełnej walidacji. Sprint 18 = nowe features. Rozdzielaj research od development.

## Gdzie jesteśmy

**Sprint 16 — Walidacja Sprint 15** (10.04.2026, w toku). Survivorship check (selection bias 3.2% pokrycia, ale nie pure survivorship), P0 koncentracja (top-3 V1=35.9%, V2=46.4%, ale bez top-3 hit rate 80% → edge dystrybuowany), P0.5 backtest-production mismatch (zawężenie do 28 healthcare overlap, soft delete 9 production-only tickerów: ALHC, CERT, CVS, CYH, DVA, GSK, HCAT, VEEV, WBA), backtest V2 (re-run na 28 czystych HC — edge wzmocniony nie osłabiony), point-in-time audit (TickerProfileService używa NOW(), brak look-ahead w production runtime, backtest nie używa serwisu), soft delete dla alertów (`alerts.archived` column + endpoint, od dziś nie kasujemy hard-delete).

**Sprint 17 — Semi Supply Chain observation layer** (ukończony 2026-04-09). 14 nowych tickerów z sektora półprzewodników (3 koszyki: Memory Producers, Equipment & Packaging, OEM Anti-Signal) w **observation mode** — alerty zapisywane do DB, brak Telegramu dopóki backtest nie potwierdzi edge'u. Nowe kolumny: `tickers.sector`, `tickers.observationOnly`, `alerts.nonDeliveryReason`. Healthcare boost guard fix (`sector === 'healthcare'`). Observation gate w Form4Pipeline, Form8kPipeline, AlertEvaluator.

**Aktywny pipeline**: SEC EDGAR (Form 4 + 8-K) → **Claude Sonnet** analiza (Anthropic API) → 3 wzorce korelacji (INSIDER_CLUSTER [SELL=observation], INSIDER_PLUS_8K, INSIDER_PLUS_OPTIONS) → alerty Telegram. Options Flow z PDUFA boost → standalone alert tylko z pdufaBoosted=true. Form4Pipeline: discretionary only (is10b51Plan→skip), **Director SELL→hard skip** (backtest: anty-sygnał), **BUY boosty** (C-suite ×1.3, healthcare ×1.2). **Observation mode** dla semi supply chain tickerów (delivered=false, nonDeliveryReason='observation'). **8 aktywnych reguł** alertów (w tym nowa Form 4 Insider BUY), 12 wyłączonych. **42 aktywnych tickerów** (28 zwalidowanych healthcare + 14 semi observation) + 9 soft-deleted (`isActive=false`). Raporty tygodniowe w [doc/reports/](doc/reports/).

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
- [x] 14 encji w `src/entities/` (ticker, sentiment_score, raw_mention, news_article, sec_filing, insider_trade, alert, alert_rule, collection_log, pdufa_catalyst, ai_pipeline_log, system_log, options_flow, options_volume_baseline)
- [x] Tabele tworzone automatycznie przez `synchronize: true`

### Krok 3: Kolejki BullMQ
- [x] `src/queues/` — 8 kolejek (6 kolektorów + sentiment + alerts)
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

- [x] **Seed tickerów** — ~37 spółek healthcare z `healthcare-universe.json`
- [x] **Seed reguł alertów** — 19 reguł z `healthcare-universe.json` (7 aktywnych, 12 wyłączonych)
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

### Sprint 2d: Azure OpenAI gpt-4o-mini — analiza niuansowa (ukończony 2026-03-01, **zastąpiony w Sprint 12 przez Anthropic Claude Sonnet**)
- [x] ~~Azure OpenAI gpt-4o-mini~~ → **Anthropic Claude Sonnet** (Sprint 12) — 2-etapowy pipeline: FinBERT (szybki bulk) → Claude Sonnet (high-priority)
- [x] Eskalacja do LLM gdy: confidence < 0.6 lub |score| < 0.3 (niezdecydowany)
- [x] Kolumna `enrichedAnalysis` (jsonb) w SentimentScore — wielowymiarowa analiza
- [x] `AnthropicClientService` — NestJS injectable, SDK `@anthropic-ai/sdk`, bezpośrednio do API (bez pośrednika Azure VM)
- [x] `AzureOpenaiClientService` — provider alias → AnthropicClientService (backward compatible)
- [x] Graceful degradation — bez `ANTHROPIC_API_KEY` pipeline działa bez AI
- [x] Azure VM (`74.248.113.3:3100`) — na standby jako fallback
- [x] Zmienne środowiskowe: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (domyślnie `claude-sonnet-4-6`)

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
  - `CorrelationService` (~400 linii) — 6 detektorów wzorców (**3 aktywne**, 3 wyłączone Sprint 11):
    - `detectInsiderPlus8K` — Form 4 + 8-K w ciągu 24h (**AKTYWNY**)
    - `detectInsiderCluster` — 2+ Form 4 jednego tickera w 7 dni (**AKTYWNY**)
    - `detectInsiderPlusOptions` — Form 4 + unusual options w 120h/5d (**AKTYWNY**, Sprint 10, okno rozszerzone Sprint 15)
    - ~~`detectFilingConfirmsNews`~~ — news → 8-K w 48h (WYŁĄCZONY Sprint 11 — wymaga sentymentu)
    - ~~`detectMultiSourceConvergence`~~ — 3+ kategorie źródeł, 24h (WYŁĄCZONY Sprint 11)
    - ~~`detectEscalatingSignal`~~ — rosnąca conviction w 72h (WYŁĄCZONY Sprint 11)
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
  - Form 4: rutynowe 10b5-1 = ±0.1-0.4, klaster insiderski = ±0.9-1.2, ekstremalnie = ±1.7-2.0
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

#### 5.2 Zastosowanie @Logged() — ~15 metod w 10 serwisach
- [x] `BaseCollectorService.runCollectionCycle()` — moduł `collectors`
- [x] ~~`FinbertClientService.analyze()`~~ — usunięty @Logged (Sprint 8 — podwójne logowanie)
- [x] `AnthropicClientService.analyze()` — moduł `sentiment`
- [x] `SentimentProcessorService.process()` — moduł `sentiment`
- [x] `Form4Pipeline.onInsiderTrade()` — moduł `sec-filings`
- [x] `Form8kPipeline.onFiling()` — moduł `sec-filings`
- [x] `CorrelationService.storeSignal()`, `runPatternDetection()` — moduł `correlation`
- [x] `AlertEvaluatorService.onSentimentScored()`, `onInsiderTrade()`, `onFiling()` — moduł `alerts`
- [x] `TelegramService.sendMarkdown()` — moduł `telegram`
- [x] `OptionsFlowAlertService.onOptionsFlow()` — moduł `options-flow`
- [x] `PriceOutcomeService.fillPriceOutcomes()` — moduł `price-outcome`

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

### Sprint 12: Migracja AI (Claude Sonnet) + Dashboard Status + fix 8-K parser (ukończony 2026-04-04)

Migracja AI pipeline z Azure OpenAI gpt-4o-mini na Anthropic Claude Sonnet, nowy panel Status Systemu na dashboardzie, fix parsowania 8-K (inline XBRL), hard delete starych alertów.

#### 12.1 Migracja AI: Azure OpenAI gpt-4o-mini → Anthropic Claude Sonnet
- [x] **AnthropicClientService** (`src/sentiment/anthropic-client.service.ts`) — nowy serwis NestJS z SDK `@anthropic-ai/sdk`. Bezpośrednie wywołanie Anthropic API bez pośrednika Azure VM. Identyczny interfejs publiczny z `AzureOpenaiClientService` (`isEnabled()`, `analyze()`, `analyzeCustomPrompt()`).
- [x] **Provider alias** w `SentimentModule` — `{ provide: AzureOpenaiClientService, useExisting: AnthropicClientService }`. Zero zmian w Form4Pipeline, Form8kPipeline, promptach, Zod schema. Rollback = zmiana jednej linii.
- [x] **Konfiguracja** — `ANTHROPIC_API_KEY` (wymagany), `ANTHROPIC_MODEL` (domyślnie `claude-sonnet-4-6`), `ANTHROPIC_TIMEOUT_MS` (domyślnie 30000). `.env.example` zaktualizowany.
- [x] **Graceful degradation** — brak klucza → pipeline GPT wyłączony (jak wcześniej z Azure VM).
- [x] **Azure VM** (`74.248.113.3:3100`) — na standby jako fallback. PM2 processy nadal uruchomione.
- [x] **Oczekiwane poprawy**: lepszy rozkład conviction (pełna skala zamiast flat ±0.3), lepsza interpretacja 8-K 5.02 (voluntary vs crisis vs relief rally), lepsze polskie podsumowania.

#### 12.2 Panel Status Systemu na dashboardzie
- [x] **Nowy endpoint** `GET /api/health/system-overview` — szybki przegląd zdrowia: status kolektorów (OK/WARNING/CRITICAL), błędy 24h, statystyki alertów 7d, pipeline AI 24h, failed jobs.
- [x] **Nowy komponent** `SystemHealthPanel` (`frontend/src/components/SystemHealthPanel.tsx`) — karty 3 aktywnych kolektorów (SEC EDGAR, PDUFA.bio, Polygon), statystyki alertów, rozwijalna tabela błędów systemowych. Auto-refresh 60s.
- [x] **Formatowanie czasu** — czytelna forma (`8h 52m` zamiast `31970.5s`).
- [x] **Lokalizacja** — sekcja Kluczowe na dashboardzie, przed Edge Signals.

#### 12.3 Hard delete alertów z wyłączonych reguł
- [x] **Usunięto 1585 alertów** z wyłączonych reguł (Sentiment Crash, Strong FinBERT, Urgent AI, High Conviction, Signal Override, Insider Trade Large). Zostało 340 alertów z 7 aktywnych reguł.
- [x] **Czysty dashboard** — API `/api/alerts` i `/api/alerts/outcomes` pokazują tylko realne sygnały edge.

#### 12.4 Fix parsowania 8-K (inline XBRL)
- [x] **Filtr plików** — `fetchFilingText()` wybierał `index.html` (metadane) zamiast `form8-k.htm` (właściwy dokument). Fix: wykluczenie plików z `index` i `headers` w nazwie.
- [x] **stripHtml cleanup XBRL** — usunięcie ukrytych divów z `display:none` (metadane XBRL) i `<ix:header>` przed strippowaniem tagów HTML.
- [x] **Dekodowanie encji HTML** — dodane `&#160;`, `&#8217;`, `&#8220;`, `&#8221;` + catch-all `&#\d+;`.
- [x] **Efekt**: przed fixem Claude dostawał "metadane i strukturę pliku", po fixie — właściwą treść ("Susan H. Alexander, Chief Legal Officer, will depart...").

### Sprint 13: Signal Timeline — widok sekwencji sygnałów per ticker (ukończony 2026-04-05)

Nowy widok chronologicznej sekwencji sygnałów na danym tickerze. Pokazuje delty cenowe między sygnałami, odstępy czasowe, zgodność kierunków i conviction score. Fundament pod wstrzykiwanie historii do promptu AI (Task 03).

#### 13.1 Backend: 2 nowe endpointy
- [x] **`GET /api/alerts/timeline`** — sekwencja alertów per ticker z window functions (LAG). Parametry: `symbol` (wymagany), `days` (domyślnie 30), `limit` (domyślnie 50). Zwraca: alerty + `priceDeltaFromPrevPct`, `hoursSincePrev`, `sameDirectionAsPrev`, `directionCorrect1d`, `conviction` (wyciągnięty z message regex z MarkdownV2 unescaping). Summary: `totalAlerts`, `avgHoursBetween`, `directionConsistency` (%), `hitRate1d` (%), `dominantDirection`.
- [x] **`GET /api/alerts/timeline/symbols`** — tickery z >=2 alertami w ostatnich N dni, posortowane po ilości. Do dropdown na froncie.

#### 13.2 Frontend: komponent SignalTimeline + nowa zakładka
- [x] **`SignalTimeline.tsx`** — MUI Autocomplete (dropdown tickerów), ToggleButtons (7/14/30/60/90d), summary bar (consistency %, hit rate, avg gap), pionowa lista kart sygnałów.
- [x] **Karty sygnałów** — kierunek (▲/▼), reguła, catalyst type, conviction chip (kolor wg siły: >=0.7 czerwony, >=0.4 pomarańczowy), cena + delty 1h/4h/1d/3d, trafność (✓/✗).
- [x] **Gap separatory** — między kartami: zielony border (zgodny kierunek = pattern się buduje), czerwony (sprzeczny = mixed signal). Czas gap + delta cenowa od poprzedniego.
- [x] **Rozwijane karty** — kliknięcie → rozwinięcie → "Pokaż pełną treść alertu" (TextDialog).
- [x] **Nowa zakładka** "Signal Timeline" w App.tsx (między Dashboard a System Logs). Auto-refresh 60s.

#### 13.3 Conviction score na timeline
- [x] **Ekstrakcja conviction z message** — regex z MarkdownV2 unescaping (`\\.` → `.`, `\\-` → `-`). Obsługuje wszystkie typy alertów (Form 4, 8-K, Options, Correlated).
- [x] **Chip conviction** — widoczna różnica między granicznym conv=-0.50 (pomarańczowy) a silnym conv=+0.74 (czerwony border).

#### 13.4 Fix Price Outcome: sloty od otwarcia NYSE
- [x] **Problem**: alerty pre-market (Options Flow 22:15 UTC, SEC 7:00 UTC) miały identyczne price1h i price4h — oba wypełniane w pierwszym CRON po otwarciu NYSE tą samą ceną.
- [x] **`getEffectiveStartTime()`** (`src/common/utils/market-hours.util.ts`) — dla alertów poza sesją zwraca najbliższe otwarcie NYSE (9:30 ET). Alerty w trakcie sesji — bez zmian.
- [x] **`PriceOutcomeService`** — sloty 1h/4h/1d/3d liczone od `effectiveStart` zamiast `sentAt`. Hard timeout 7d nadal od `sentAt`.
- [x] **Efekt**: price1h = cena 1h po open (10:30 ET), price4h = cena 4h po open (13:30 ET). Realne zmiany intraday zamiast identycznych wartości.
- [x] **Reset** 30 alertów z identycznymi price1h/price4h do ponownego wypełnienia przez CRON.

### Sprint 14: TickerProfileService — kontekst historyczny w promptach Claude (ukończony 2026-04-05)

Profil historyczny per ticker (200-400 tokenów) wstrzykiwany do promptów Claude Sonnet. Claude kalibruje conviction na podstawie track recordu (hit rate, dominant direction, recent signals).

#### 14.1 TickerProfileService
- [x] **Nowy moduł** `src/ticker-profile/` — `TickerProfileModule` + `TickerProfileService`
- [x] **`getSignalProfile(symbol)`** — pobiera alerty z 90 dni (min 3 z price1d), oblicza metryki: hit rate 1d, avgAbsMove1d, ruleBreakdown (per reguła), dominantDirection, directionConsistency, recentSignals (ostatnie 3)
- [x] **In-memory cache** — Map z TTL 2h (42 tickery × ~300 znaków = trivial, Redis overkill)
- [x] **Skrócone nazwy reguł** — Form4, 8-K, Options, Correlated (oszczędność tokenów)
- [x] **Calibration Rules** — konkretne instrukcje: hit rate >70% → boost |conviction| 0.1-0.3, <40% → reduce

#### 14.2 Wstrzyknięcie w pipeline
- [x] **Form4Pipeline** — inject TickerProfileService, wywołanie `getSignalProfile()` przed `buildForm4Prompt()`
- [x] **Form8kPipeline** — analogicznie, profil przekazywany do prompt buildera
- [x] **5 promptów** zaktualizowanych — `form4.prompt.ts`, `form8k-1-01/2-02/5-02/other.prompt.ts` — parametr `tickerProfile`, wstawiony po danych transakcji przed CONVICTION SCALE
- [x] **Fallback** — "No historical signal data available" dla tickerów z <3 alertami
- [x] **`selectPromptBuilder()`** — zaktualizowana sygnatura z `tickerProfile`

#### 14.3 Słownik terminów
- [x] **`doc/slownik-terminow.md`** — kompletny słownik terminów i skrótów (10 tabel)
- [x] **Zakładka "Słownik"** na dashboardzie (`GlossaryTab.tsx`) — 9 rozwijalnych sekcji z pełnymi wyjaśnieniami, przykładami, instrukcją "Jak czytać Signal Timeline"
- [x] **4 zakładki** na dashboardzie: Dashboard + Signal Timeline + System Logs + Słownik

### Sprint 15: Backtest 3Y insider trading + BUY rule + bugfixy (ukończony 2026-04-06)

Backtest 3 lat danych SEC EDGAR Form 4 (kwiecień 2023 – kwiecień 2026), walidacja hipotez z Welch's t-test + Cohen's d, implementacja wyników w pipeline, naprawa 7 bugów, przebudowa raportu 8h.

#### 15.1 Backtest (`scripts/backtest/`)
- [x] **Skrypty backtesta** — `run_backtest.py` (orchestrator), `edgar_fetcher.py` (SEC EDGAR Form 4 XML), `price_fetcher.py` (yfinance), `analyzer.py` (6 hipotez), `report_generator.py`, `config.py`
- [x] **Dane**: 43 946 transakcji, 61 tickerów (42 healthcare + 25 control), 64 z cenami (3 ADR bez Form 4)
- [x] **Fixy backtesta**: `from __future__ import annotations` (Python 3.8), `multitasking==0.0.11` (yfinance), fix XML URL (`www.sec.gov` + strip XSLT prefix), fix cluster index (`i += ...`)
- [x] **Fixy analizy**: `filing_date` zamiast `transaction_date`, dip baseline (mean reversion control), deduplikacja per insider×tydzień, fix `direction="any"` bug (hit rate 100%)
- [x] **6 hipotez**: H1 Insider Clusters, H2 Single C-suite, H3 10b5-1 vs discretionary, H4 Role seniority, H5 BUY signals, H6 Healthcare vs Control
- [x] **Wyniki**: `scripts/backtest/data/results/backtest_summary.md` — insider BUY d=0.43 (7d, p<0.001), C-suite BUY d=0.83, Healthcare SELL d=-0.11 (jedyny SELL z edge), Director SELL = anty-sygnał (68% cena rośnie)

#### 15.2 Pipeline changes
- [x] **Nowa reguła "Form 4 Insider BUY"** — min $100K, C-suite ×1.3, healthcare ×1.2, osobna reguła w DB (backtest-backed)
- [x] **Director SELL → hard skip** w Form4Pipeline — anty-sygnał, nie wysyłaj do GPT
- [x] **INSIDER_CLUSTER SELL → observation mode** — zapis do DB bez Telegramu (backtest: brak edge, p=0.204)
- [x] **Seed**: 20 reguł (dodana Form 4 Insider BUY)

#### 15.3 Bugfixy (7 bugów)
- [x] **CRITICAL**: Race condition INCR/DECR w `daily-cap.service.ts` → Lua atomic script
- [x] **CRITICAL**: Telegram send failure bez logowania → `logger.error` w 5 miejscach (form4, form8k×2, options-flow, correlation)
- [x] **CRITICAL**: Debounce nadpisujący timery w CorrelationService → skip-if-scheduled
- [x] **HIGH**: Memory leak `pendingChecks` Map → cleanup stale entries >60s
- [x] **HIGH**: `alertRepo.save()` bez try/catch w 4 plikach → wrapped
- [x] **HIGH**: Filing not found → `logger.warn` (GPT analysis nie tracona cicho)
- [x] **MEDIUM**: Redis storeSignal bez try/catch → graceful degradation

#### 15.4 Raport 8h
- [x] **Usunięcie sentymentu** z raportu 8h (SentimentScore nie generuje danych od Sprint 11)
- [x] **Nowy raport**: alerty per reguła + insider trades BUY/SELL + nadchodzące PDUFA

#### 15.5 Frontend — Signal Timeline redesign
- [x] **Kolorowa lewa krawędź** karty (zielona=bullish, czerwona=bearish)
- [x] **TRAFIONY/PUDŁO** badge zamiast małego ✓/✗
- [x] **Wyniki cenowe** w kolumnach (1h/4h/1d/3d) z hit/miss paskiem
- [x] **Summary bar** w kolumnach (Sygnały/Kierunek/Hit rate/Avg gap)
- [x] **Gap separator** wycentrowany, proporcjonalny do czasu, biały tekst
- [x] **Conviction badge** z kolorowym tłem proporcjonalnym do siły
- [x] **Domyślny widok** — ostatnie alerty ze wszystkich tickerów (bez wymagania wyboru tickera)
- [x] **Ticker na karcie** — niebieski, widoczny na każdej karcie sygnału
- [x] **Sortowanie** — zawsze od najnowszych (sentAt DESC)

#### 15.6 Poprawki parsera i narzędzia
- [x] **8-K parser fix** — `documentUrl` z `primaryDocument` (pełny URL do `.htm`) zamiast katalogu archiwum
- [x] **Endpoint reprocess** — `POST /api/alerts/reprocess-filing?id=X` (czyści gptAnalysis, emituje NEW_FILING)
- [x] **Options Flow CRON** — 20:30 UTC (22:30 CEST), 30 min po NYSE close (było 22:15 UTC = 2h15m po close)
- [x] **Hard delete 344 alertów** — czysty start walidacji live nowego pipeline (2026-04-07)

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

### Audyt systemu + Tier 1 Observability (ukończony 2026-04-16)

Pełny audyt kodu `src/` (~12k LOC), 16 bugów znalezionych (raport: [doc/STOCKPULSE-AUDIT-2026-04-16.md](doc/STOCKPULSE-AUDIT-2026-04-16.md)). Phase 1 (5 bugów) + Tier 1 observability zaimplementowane.

#### Phase 1 — bugfixy krytyczne (5 commitów)
- [x] **BUG #1 (P0)**: `BaseCollectorService.runCollectionCycle` — re-throw w catch block (wcześniej swallow exception, @Logged widział success, BullMQ nie robił retry)
- [x] **BUG #3 (P0)**: Redis password — dodany `password: config.get('REDIS_PASSWORD') || undefined` do 3 providerów (BullMQ, CorrelationService, SecFilings daily cap)
- [x] **BUG #4 (P1)**: Archived alerty w analytics — dodany filtr `archived=false` w 5 zapytaniach (outcomes, timeline, timeline/symbols, getRecentTimeline, TickerProfileService)
- [x] **BUG #7 (P1)**: `synchronize: true` jako stała (nie zależna od NODE_ENV — zero migracji w repo)
- [x] **BUG #9 (P2)**: `POLYGON_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_TIMEOUT_MS` dodane do env.validation.ts

#### Tier 1 Observability (4 commity backend + 1 frontend)
- [x] **Entity extension**: 5 nowych nullable kolumn w `system_logs` — `trace_id`, `parent_trace_id`, `level`, `ticker`, `decision_reason`. Indexy: (traceId), (ticker, createdAt), (level).
- [x] **SystemLogService**: rozszerzony DTO + log mapping, tiered cleanup (debug 2d / info 7d / warn+error 30d), 3 query helpers (findByTrace, findByTicker, getDecisionStats)
- [x] **@Logged decorator**: `extractLogMeta()` — automatyczna ekstrakcja traceId/ticker/action z args i result, action→level mapping, MAX_LOG_LENGTH 2000→4000
- [x] **BUG #2 (P0)**: Rozbicie `ALERT_SENT` na 6 granularnych action values (`ALERT_SENT_TELEGRAM`, `ALERT_TELEGRAM_FAILED`, `ALERT_DB_ONLY_OBSERVATION`, `ALERT_DB_ONLY_SILENT_RULE`, `ALERT_DB_ONLY_DAILY_LIMIT`, `ALERT_DB_ONLY_CLUSTER_SELL`) w 5 plikach
- [x] **BUG #10 (P2)**: `runPatternDetection` zwraca action (`TOO_FEW_SIGNALS`/`NO_PATTERNS`/`PATTERNS_DETECTED`)
- [x] **BUG #8 (P1)**: OptionsFlowAlertService throttle lookup filtruje `delivered: true`
- [x] **traceId propagacja**: SEC EDGAR (randomUUID per filing + per trade z parentTraceId), Options Flow (per flow), PDUFA (per event). Pipeline handlers przekazują traceId w return.
- [x] **ApiTokenGuard** (`src/common/guards/api-token.guard.ts`): wymaga `X-Api-Token` = `ADMIN_API_TOKEN` z .env
- [x] **3 nowe endpointy** za auth: `GET /api/system-logs/trace/:traceId`, `GET /api/system-logs/ticker/:symbol`, `GET /api/system-logs/decisions`
- [x] **Backend filtry**: `level` + `ticker` query params w `GET /api/system-logs`
- [x] **Frontend SystemLogsTab**: 3 nowe kolumny (Level chip, Ticker mono, Decision Reason z kolorowymi chipami), 2 nowe filtry (level dropdown, ticker input), trace_id w rozwinięciu z copy button

#### Pozostałe bugi (Phase 2-3 — planowane Sprint 18+)
- [ ] BUG #5 (P1): Daily limit bypass w Form4/Form8k/Correlation pipeline
- [ ] BUG #6 (P1): fetch() bez timeout w 7 miejscach
- [ ] BUG #11 (P2): DST fallback w getEffectiveStartTime
- [ ] BUG #12 (P2): Brak enableShutdownHooks() + ValidationPipe w main.ts
- [ ] BUG #13 (P2): Silent rules komentarz (kosmetyka)
- [ ] BUG #14 (P3): Regex conviction z message (docelowo: kolumna)
- [ ] BUG #15 (P3): Dokumentacja outdated
- [ ] BUG #16 (P3): Telegram 4xx vs 5xx rozróżnienie

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

### Sprint 16: UTC fix + Options Flow UX + SEC EDGAR tuning (ukończony 2026-04-08)

- [x] UTC fix: Options Flow CRON przesunięty na 20:30 UTC, `getLastTradingDay()` z `getUTCDay()`/`setUTCDate()` (fix: serwer Europe/Warsaw → błędny dzień handlowy)
- [x] INSIDER_PLUS_OPTIONS okno 72h → 120h/5d — pokrycie weekendu + Form 4 filing delay
- [x] Options Flow UX: kolumna Kurs z aktualną ceną + zmiana % od momentu sygnału
- [x] Signal Timeline: dropdown z wszystkimi tickerami (usunięto filtr `priceAtAlert IS NOT NULL` + `HAVING COUNT >= 2`), domyślny widok, gap czytelność (1d 0h→1d, biały tekst)
- [x] 8-K parser fix: primaryDocument URL
- [x] SEC EDGAR kolektor: skan 100 pozycji z oknem 7d zamiast limitu 20
- [x] Endpoint `reprocess-filing` + hard delete 344 starych alertów

### Sprint 17: Semi Supply Chain — observation layer (ukończony 2026-04-09)

Artykuł o wzroście cen pamięci/helu ujawnił katalizator w łańcuchu dostaw półprzewodników. Healthcare zostaje jako core (zwalidowany backtest). Semi dochodzi jako osobna warstwa obserwacyjna — zbieramy dane Form4/8-K, liczymy price outcomes, ale NIE wysyłamy na Telegram dopóki backtest nie potwierdzi edge'u.

**14 nowych tickerów w 3 koszykach**:
- Memory Producers (upstream): MU, WDC, STX
- Equipment & Packaging (picks & shovels): KLIC, AMKR, ONTO, CAMT, NVMI, ASX
- OEM Anti-Signal (margin squeeze): DELL, HPQ, HPE, SMCI, NTAP

**Faza 1 — Setup obserwacyjny**:
- [x] Ticker entity: kolumny `sector` (default `'healthcare'`) + `observationOnly` (default `false`)
- [x] Alert entity: kolumna `nonDeliveryReason` (`'observation'` / `'silent_hour'` / `'daily_limit'` / `null`)
- [x] JSON config: `doc/stockpulse-semi-supply-chain.json` — 14 tickerów z CIK z SEC EDGAR
- [x] Seed script: refactor na `seedTickers()` — obsługa wielu plików JSON + `sector` + `observationOnly`
- [x] Healthcare boost guard: `ticker?.subsector` → `ticker?.sector === 'healthcare'` (fix: semi nie dostaje fałszywego ×1.2)
- [x] Observation gate — Form4Pipeline: `ticker?.observationOnly === true` → `delivered=false`, `nonDeliveryReason='observation'`
- [x] Observation gate — Form8kPipeline: 2 miejsca (główny alert + bankruptcy handler)
- [x] Observation gate — AlertEvaluator: `sendAlert()` sprawdza `observationOnly` przed Telegram
- [x] Observation gate — CorrelationService: `triggerCorrelatedAlert()` sprawdza `observationOnly` (fix: Telegram leak)
- [x] Observation gate — OptionsFlowAlertService: `sendAlert()` sprawdza `observationOnly` (fix: Telegram leak)
- [x] TypeORM synchronize: kolumny dodane automatycznie (ALTER TABLE)
- [x] Build test: `tsc --noEmit` clean, `npm run test` 362/370 (8 pre-existing failures)
- [x] Seed test: 51 tickerów (37 healthcare + 14 semi observation mode)
- [x] DB weryfikacja: sector, observationOnly, CIK — poprawne dla wszystkich 14 tickerów

**Następne kroki** (plan w `doc/plan-semi-supply-chain.md`):
- [ ] Faza 2: Backtest historyczny (5 hipotez, 2018-2025, yfinance/Polygon)
- [ ] Faza 3: 8-K SUPPLY_DISRUPTION classifier (sektor-agnostyczny)
- [ ] Faza 4: Go/no-go decision (d ≥ 0.30, p < 0.05, ≥5 forward sygnałów)

## Kluczowe liczby

- **Tickery do monitorowania**: 51 total — 37 healthcare + 14 semi supply chain (observation mode). Config: `stockpulse-healthcare-universe.json` + `stockpulse-semi-supply-chain.json`
- **Słowa kluczowe**: 201
- **Subreddity**: 18
- **Pliki źródłowe**: ~90 plików TypeScript w `src/` + 2 Python w `finbert-sidecar/` + 2 JS na Azure VM
- **Reguły alertów**: 20 total — **8 aktywnych** (Form 4 Insider Signal, **Form 4 Insider BUY** [Sprint 15], 8-K Material Event GPT, 8-K Earnings Miss, 8-K Leadership Change, 8-K Bankruptcy, Correlated Signal, Unusual Options Activity), **12 wyłączonych** (isActive=false — sentyment, niezaimplementowane)
- **Encje bazy danych**: 14 tabel (alerts z 7 polami price outcome + priceAtAlert + nonDeliveryReason, tickers z sector + observationOnly, sentiment_scores, pdufa_catalysts, ai_pipeline_logs, system_logs, sec_filings z gptAnalysis jsonb, insider_trades z is10b51Plan, options_flow, options_volume_baseline)
- **Kolejki BullMQ**: 8 (6 kolektorów + sentiment-analysis + alerts) — StockTwits/Finnhub schedulery wyłączone
- **Endpointy REST**: 28 (health x5, tickers x2, sentiment x9, alerts x7 incl. timeline + reprocess-filing, sec-filings x1, system-logs x1, options-flow x3)
- **Źródła danych**: **3 aktywne kolektory** (SEC EDGAR, PDUFA.bio, Polygon.io Options Flow), **3 wyłączone** (StockTwits, Finnhub news/MSPR, Reddit placeholder). Finnhub `/quote` zachowany.
- **Modele AI**: **Anthropic Claude Sonnet** (`claude-sonnet-4-6`, SDK `@anthropic-ai/sdk`) — bezpośrednio z NestJS (Sprint 12). FinBERT sidecar (kontener działa, nie otrzymuje jobów). Azure VM (`74.248.113.3:3100`) na standby jako fallback.
- **Infrastruktura**: 6 kontenerów Docker (app, finbert, frontend, postgres, redis, pgadmin). Azure VM na standby (PM2: processor.js + api.js)
- **Środowiska**: Laptop WSL2 (dev), serwer produkcyjny z NVIDIA CUDA
- **Sprint 4**: SecFilingsModule (5 promptów, parser 8-K z cleanup inline XBRL, scorer, Zod validation, daily cap), CorrelationModule (**3 aktywne** detektory wzorców, Redis Sorted Sets)
- **Sprint 6**: PriceOutcomeModule (CRON co 1h, sloty od `getEffectiveStartTime()`, max 30 zapytań/cykl, 4 sloty: 1h/4h/1d/3d, NYSE market hours guard, hard timeout 7d)
- **Sprint 10**: OptionsFlowCollectorModule (kolektor CRON 22:15 UTC, Polygon.io Free Tier, volume spike detection), OptionsFlowModule (scoring + alert + CorrelationService INSIDER_PLUS_OPTIONS)
- **Sprint 11**: Przebudowa — focus na edge. Wyłączenie szumu (StockTwits, Finnhub news, sentiment pipeline, 12 reguł, 3 wzorców korelacji). Early return w AlertEvaluator, usunięty martwy kod insider aggregation.
- **Sprint 12**: Migracja AI (gpt-4o-mini → Claude Sonnet), panel Status Systemu (`/api/health/system-overview`), fix parsowania 8-K (inline XBRL + filtr index.html), hard delete 1585 alertów z wyłączonych reguł
- **Sprint 13**: Signal Timeline (`/api/alerts/timeline`) — sekwencja sygnałów per ticker z conviction, deltami cenowymi, gap czasowym. Fix Price Outcome: sloty od otwarcia NYSE (`getEffectiveStartTime`)
- **Sprint 14**: TickerProfileService — kontekst historyczny w promptach Claude (profil tickera 90d), słownik terminów na dashboardzie
- **Sprint 15**: Backtest 3Y (43 946 tx, 6 hipotez), BUY rule (d=0.43), Director SELL skip, INSIDER_CLUSTER SELL observation, 7 bugfixów, raport 8h bez sentymentu, Signal Timeline redesign
- **Sprint 16**: UTC fix (Options Flow CRON, getLastTradingDay), INSIDER_PLUS_OPTIONS 72h→120h/5d, Options Flow kolumna Kurs, Signal Timeline dropdown, SEC EDGAR skan 100 pozycji/7d, reprocess-filing endpoint
- **Sprint 17**: Semi Supply Chain observation layer — 14 nowych tickerów (3 koszyki: Memory, Equipment, OEM) w observation mode. Nowe kolumny: `tickers.sector` + `observationOnly`, `alerts.nonDeliveryReason`. Observation gate w Form4/Form8k/AlertEvaluator. Healthcare boost guard fix
- **Dashboard**: 4 zakładki (Dashboard + Signal Timeline + System Logs + Słownik), panel Status Systemu, 28 endpointów REST (w tym reprocess-filing)
- **Testy jednostkowe**: 14 plików spec.ts, ~420 testów (unit: correlation, form4-parser, form8k-parser, price-impact-scorer, alert-evaluator; agents: alert-evaluator-agent, correlation-agent, collectors-agent, price-outcome-agent, sec-filings-agent, sentiment-agent, options-flow-scoring, options-flow-agent, unusual-activity-detector)
