# StockPulse — Mapa logiki systemu

> Dokument do weryfikacji: co skąd bierze, jak dane przepływają, jakie warunki decydują o akcji.
> Ostatnia aktualizacja: 2026-03-09

---

## Przepływ danych — schemat ogólny

```
KOLEKTORY (co X min)
  │
  ├─ StockTwits (5 min) ──→ raw_mentions ──→ emit NEW_MENTION
  ├─ Finnhub (10 min) ────→ news_articles ──→ emit NEW_ARTICLE
  │                        → insider_trades ──→ emit NEW_INSIDER_TRADE
  ├─ SEC EDGAR (30 min) ──→ sec_filings ────→ emit NEW_FILING
  │                        → insider_trades ──→ emit NEW_INSIDER_TRADE
  └─ PDUFA.bio (6h) ──────→ pdufa_catalysts → emit NEW_PDUFA_EVENT (kontekst dla GPT)
         │
         ▼
SENTIMENT PIPELINE (BullMQ)
  │  NEW_MENTION / NEW_ARTICLE → kolejka → FinBERT → tier → Azure GPT → sentiment_scores
  │                                                                        │
  │                                                              emit SENTIMENT_SCORED
  │                                                                        │
  ▼                                                                        ▼
SEC FILING GPT PIPELINE                                    ALERT EVALUATOR (6 reguł)
  │  NEW_FILING → Form8kPipeline                             │  SENTIMENT_SCORED → 6 checków
  │  NEW_INSIDER_TRADE → Form4Pipeline                       │  NEW_FILING → alert 8-K
  │  → GPT analiza → sec_filings.gptAnalysis                 │  NEW_INSIDER_TRADE → batch → alert
  │  → alert Telegram                                        │  → alert Telegram
  │  → CorrelationService.storeSignal()                      │  → CorrelationService.storeSignal()
  │                                                          │
  ▼                                                          ▼
CORRELATION SERVICE (Redis Sorted Sets)
  │  5 detektorów wzorców → alert Telegram
  │
  ▼
PRICE OUTCOME TRACKER (CRON co 1h)
  │  alerts.priceAtAlert → Finnhub /quote → price1h/4h/1d/3d
```

---

## 1. KOLEKTORY

### 1.1 StockTwits (`src/collectors/stocktwits/`)

| Parametr | Wartość |
|----------|---------|
| Interwał | co 5 min (BullMQ repeatable job) |
| API | `api.stocktwits.com/api/2/streams/symbol/{ticker}.json` |
| Rate limit | 200 req/hour → 2s delay między symbolami |
| Deduplikacja | po `externalId` = `st_{messageId}` |
| Zapis | `raw_mentions` (source='stocktwits') |
| Event | `NEW_MENTION` → {mentionId, symbol, source} |
| Decorator | `@Logged('collectors')` (przez BaseCollectorService) |

**Przepływ:**
1. `StocktwitsScheduler` → BullMQ job co 5 min
2. `StocktwitsProcessor` → `StocktwitsService.runCollectionCycle()`
3. Iteruje aktywne tickery → pobiera wiadomości
4. Deduplikacja po externalId → zapis do `raw_mentions`
5. Emit `NEW_MENTION` per nowa wzmianka

---

### 1.2 Finnhub (`src/collectors/finnhub/`)

| Parametr | Wartość |
|----------|---------|
| Interwał | co 10 min (BullMQ repeatable job) |
| API | `finnhub.io/api/v1/company-news` + `/stock/insider-sentiment` |
| Rate limit | 60 req/min → 1.5s delay między symbolami |
| Zapis | `news_articles` + `insider_trades` |
| Eventy | `NEW_ARTICLE` + `NEW_INSIDER_TRADE` |
| Decorator | `@Logged('collectors')` |

**Przepływ:**
1. `FinnhubScheduler` → BullMQ job co 10 min
2. `FinnhubProcessor` → `FinnhubService.runCollectionCycle()`
3. Per ticker:
   - Pobiera newsy → deduplikacja → zapis do `news_articles` → emit `NEW_ARTICLE`
   - Pobiera insider sentiment (MSPR) → zapis do `insider_trades` → emit `NEW_INSIDER_TRADE`

---

### 1.3 SEC EDGAR (`src/collectors/sec-edgar/`)

| Parametr | Wartość |
|----------|---------|
| Interwał | co 30 min (BullMQ repeatable job) |
| API | `data.sec.gov/submissions/CIK{cik}.json` |
| Rate limit | 10 req/sec → 200ms delay per ticker |
| Zapis | `sec_filings` + `insider_trades` |
| Eventy | `NEW_FILING` + `NEW_INSIDER_TRADE` |
| Decorator | `@Logged('collectors')` |

**Przepływ:**
1. `SecEdgarScheduler` → BullMQ job co 30 min
2. `SecEdgarProcessor` → `SecEdgarService.runCollectionCycle()`
3. Per ticker (musi mieć CIK):
   - Pobiera ostatnie 20 filingów
   - Filtruje typy: 10-K, 10-Q, 8-K, 4, 3, 5, 13F-HR, S-1, 14A
   - **8-K**: parsuje Items z XML → zapis do `sec_filings` → emit `NEW_FILING`
   - **Form 4**: parsuje transakcje insider → zapis do `insider_trades` → emit `NEW_INSIDER_TRADE`

**Eventy emitowane:**
- `NEW_FILING` → {filingId, symbol, formType} — słuchają: **AlertEvaluator** + **Form8kPipeline**
- `NEW_INSIDER_TRADE` → {tradeId, symbol, totalValue, ...} — słuchają: **AlertEvaluator** + **Form4Pipeline**

---

### 1.4 PDUFA.bio (`src/collectors/pdufa-bio/`)

| Parametr | Wartość |
|----------|---------|
| Interwał | co 6h + natychmiast po starcie |
| Źródło | `pdufa.bio/pdufa-calendar-{year}` (scraping HTML) |
| Zapis | `pdufa_catalysts` |
| Event | `NEW_PDUFA_EVENT` |
| Rola | **kontekst** wstrzykiwany do prompta GPT (nie generuje alertów bezpośrednio) |

---

## 2. SENTIMENT PIPELINE (2-etapowy)

**Pliki:** `src/sentiment/`

### 2.1 Wejście — SentimentListenerService

| Event | Priorytet kolejki | Źródło |
|-------|-------------------|--------|
| `NEW_MENTION` | 5 (StockTwits) / 10 (Reddit) | StockTwits collector |
| `NEW_ARTICLE` | 3 (newsy ważniejsze) | Finnhub collector |

Dodaje job do kolejki BullMQ `sentiment-analysis` z payloadem `{type, entityId, symbol, source}`.

### 2.2 Przetwarzanie — SentimentProcessorService

**Etap 1: FinBERT (GPU sidecar, ~67ms)**
```
Tekst → POST http://finbert:8000/api/sentiment
       → {label, score [-1.0, +1.0], confidence [0-1]}
```

**Klasyfikacja Tier (decyzja o eskalacji do GPT):**

| Tier | Warunek | Akcja |
|------|---------|-------|
| Tier 1 (złoty) | confidence > 0.7 **AND** \|score\| > 0.5 | **ZAWSZE** do GPT |
| Tier 2 (średni) | confidence > 0.3 **AND** \|score\| > 0.2 | Do GPT jeśli VM aktywna |
| Tier 3 (śmieci) | reszta | Tylko FinBERT, skip GPT |

**Etap 2: Azure OpenAI gpt-4o-mini (eskalacja)**
```
POST http://74.248.113.3:3100/analyze
  → tekst (500 znaków) + symbol + escalation_reason + pdufaContext
  ← EnrichedAnalysis: {
       sentiment, urgency, relevance, novelty, source_authority,
       conviction [-2.0, +2.0], catalyst_type, price_impact,
       summary, prompt_used
     }
```

**Normalizacja i zapis:**
- `effectiveScore` = gptConviction / 2.0 (zakres [-1.0, +1.0]) — **źródło prawdy**
- Jeśli brak GPT: effectiveScore = finbertScore
- Zapis do: `sentiment_scores` (z enrichedAnalysis JSONB) + `ai_pipeline_logs`

**Event wyjściowy:** `SENTIMENT_SCORED` → {scoreId, symbol, score, confidence, effectiveScore, enrichedAnalysis, ...}

**Guardy (skip):**
- Tekst < 20 znaków → SKIPPED_SHORT
- Encja nie znaleziona w DB → SKIPPED_NOT_FOUND
- Azure VM niedostępna → AI_DISABLED (tylko FinBERT)
- Azure zwraca null → AI_FAILED (tylko FinBERT)

---

## 3. ALERT EVALUATOR

**Plik:** `src/alerts/alert-evaluator.service.ts`

### 3.1 Handler: NEW_INSIDER_TRADE

```
@OnEvent(NEW_INSIDER_TRADE) → @Logged('alerts')
```

| Guard | Wartość |
|-------|---------|
| totalValue | >= $100,000 |
| transactionType | BUY lub SELL (odrzuca inne) |

**Logika:**
1. Aggreguje trades per ticker w 5-minutowym oknie (batch)
2. Po 5 min → `flushInsiderBatch()`:
   - Kierunek: positive jeśli więcej BUY, negative jeśli więcej SELL
   - Reguła: "Insider Trade Large"
3. Wysyła alert Telegram → zapisuje do `alerts` → `CorrelationService.storeSignal()`

### 3.2 Handler: NEW_FILING

```
@OnEvent(NEW_FILING) → @Logged('alerts')
```

| Guard | Wartość |
|-------|---------|
| formType | tylko '8-K' |

**Logika:**
1. Prosty alert "8-K Material Event" — **bez analizy GPT** (to robi Form8kPipeline osobno)
2. Pobiera nazwę firmy z `tickerRepo`
3. Wysyła alert Telegram → zapisuje do `alerts` → `CorrelationService.storeSignal()`

### 3.3 Handler: SENTIMENT_SCORED (6 reguł równolegle)

```
@OnEvent(SENTIMENT_SCORED) → @Logged('alerts')
```

Wszystkie 6 sprawdzeń leci w `Promise.all`:

| # | Reguła | Warunek | Priorytet |
|---|--------|---------|-----------|
| 1 | **Sentiment Crash** | effectiveScore < -0.5 AND confidence > 0.7 | CRITICAL |
| 2 | **Bullish Signal Override** | FinBERT < -0.5 ale effectiveScore > 0.1 (GPT skorygował) | HIGH |
| 3 | **Bearish Signal Override** | FinBERT > 0.5 ale effectiveScore < -0.1 (GPT skorygował) | HIGH |
| 4 | **High Conviction Signal** | \|gptConviction\| > 1.5 (surowy, [-2,+2]) | CRITICAL |
| 5 | **Strong FinBERT Signal** | model=finbert AND \|score\| > 0.7 AND confidence > 0.8 | HIGH |
| 6 | **Urgent AI Signal** | urgency=HIGH AND relevance ≥ 0.7 AND confidence ≥ 0.6 AND \|conviction\| ≥ 0.1 | HIGH |

**Wspólna logika per reguła:**
1. Sprawdź warunek → jeśli nie spełniony: SKIP
2. Pobierz regułę z cache (TTL 5 min) → jeśli nieaktywna: SKIP
3. Sprawdź throttling: czy istnieje alert z (ruleName, symbol, [catalystType]) w oknie throttleMinutes → jeśli tak: THROTTLED
4. Wyślij alert Telegram
5. Zapisz do `alerts` z: `priceAtAlert` (Finnhub /quote), `alertDirection`, `catalystType`
6. `CorrelationService.storeSignal()` + `schedulePatternCheck()`

**Logowanie decyzji:** każda reguła loguje `SKIP` / `THROTTLED` / `ALERT_SENT` do konsoli.

---

## 4. SEC FILING GPT PIPELINE

**Pliki:** `src/sec-filings/`

### 4.1 Form8kPipeline (8-K filingi)

```
@OnEvent(NEW_FILING) → @Logged('sec-filings')
```

**UWAGA:** Działa **równolegle** z AlertEvaluator.onFiling() — oba słuchają tego samego eventu.

| Krok | Akcja | Guard/warunek |
|------|-------|---------------|
| 1 | Filtruj typ | `formType !== '8-K'` → return |
| 2 | Daily cap | `DailyCapService.canCallGpt(symbol)` → max 20/ticker/dzień |
| 3 | Pobierz filing z DB | `filingRepo.findOne({id})` → brak lub brak documentUrl → return |
| 4 | Już przeanalizowany? | `filing.gptAnalysis` istnieje → return |
| 5 | Pobierz tekst z SEC EDGAR | `fetchFilingText(documentUrl)` → < 100 znaków → return |
| 6 | Wykryj Items | `detectItems(filingText)` → brak Items → return |
| 7 | **Bankruptcy check** | Item 1.03 → **natychmiastowy CRITICAL** bez GPT |
| 8 | Wybierz prompt | `selectPromptBuilder(mainItem)` → per-Item prompt |
| 9 | Wyślij do GPT | `azureOpenai.analyzeCustomPrompt(prompt)` → null jeśli VM offline → return |
| 10 | Zarejestruj wywołanie | `dailyCap.recordGptCall(symbol)` |
| 11 | Walidacja Zod | `parseGptResponse()` → retry 1x jeśli błąd JSON |
| 12 | Zapis do DB | `filing.gptAnalysis = analysis`, `filing.priceImpactDirection` |
| 13 | Oblicz priorytet | `scoreToAlertPriority(analysis, '8-K')` → null = brak alertu |
| 14 | Sprawdź regułę + throttling | `ruleRepo.findOne()` + `checkThrottled()` |
| 15 | Alert Telegram | `formatter.formatForm8kGptAlert()` |
| 16 | Zapis alertu | `alertRepo.save()` |
| 17 | Korelacja | `correlation.storeSignal()` z conviction/2.0 (normalizacja) |

**Per-Item prompty:**

| Item | Plik prompta | Typ catalyst |
|------|-------------|-------------|
| 1.01 | form8k-1-01.prompt.ts | contract (Material Agreement) |
| 1.03 | — (bez GPT) | bankruptcy → CRITICAL |
| 2.02 | form8k-2-02.prompt.ts | earnings (Results of Operations) |
| 5.02 | form8k-5-02.prompt.ts | leadership (CEO/CFO change) |
| inne | form8k-other.prompt.ts | auto-detect |

### 4.2 Form4Pipeline (insider trades)

```
@OnEvent(NEW_INSIDER_TRADE) → @Logged('sec-filings')
```

**UWAGA:** Działa **równolegle** z AlertEvaluator.onInsiderTrade() — oba słuchają tego samego eventu.

| Krok | Akcja | Guard/warunek |
|------|-------|---------------|
| 1 | Filtruj wartość | totalValue < $100K → return |
| 2 | Filtruj typ | transactionType nie BUY/SELL → return |
| 3 | Daily cap | `DailyCapService.canCallGpt(symbol)` |
| 4 | Pobierz trade z DB | `tradeRepo.findOne({id})` |
| 5 | Pobierz historię 30d | Ostatnie 20 transakcji tego tickera |
| 6 | Zbuduj prompt | `buildForm4Prompt()` z danymi + historią |
| 7 | Wyślij do GPT | `azureOpenai.analyzeCustomPrompt()` |
| 8 | Walidacja Zod | `parseGptResponse()` |
| 9 | Zapis do DB | `gptAnalysis` do powiązanego `sec_filings` |
| 10 | Oblicz priorytet + alert | jak Form8k |
| 11 | Korelacja | `correlation.storeSignal()` z conviction/2.0 |

### 4.3 DailyCapService (Redis)

```
Klucz Redis: gpt:daily:{ticker}:{YYYY-MM-DD}
TTL: 86400s (24h)
Limit: 20 wywołań GPT / ticker / dzień
```

**Atomowa operacja:**
1. `canCallGpt()` → `INCR` klucza
2. Jeśli wynik > 20 → `DECR` (rollback) → return false
3. Jeśli wynik ≤ 20 → return true (slot zarezerwowany)
4. `recordGptCall()` → no-op (slot już zarezerwowany w canCallGpt)

### 4.4 Backfill endpoint

```
POST /api/sec-filings/backfill-gpt?limit=50
```

- Szuka 8-K z `gptAnalysis IS NULL`
- Wywołuje `Form8kPipeline.onFiling()` **bezpośrednio** (nie przez event)
- 2s delay między wywołaniami
- **Nie obsługuje Form 4** — tylko 8-K

---

## 5. CORRELATION SERVICE

**Pliki:** `src/correlation/`

### 5.1 Przechowywanie sygnałów (Redis Sorted Sets)

| Kategoria | Klucz Redis | TTL | Okno detekcji |
|-----------|-------------|-----|---------------|
| form4 (insider) | `corr:signals:insider:{TICKER}` | 14 dni | 7 dni (cluster) |
| 8k, news, social | `corr:signals:short:{TICKER}` | 48h | 24-72h (zależy od wzorca) |

**UWAGA:** Redis provider ma `keyPrefix: 'corr:'` — rzeczywisty klucz w Redis to np. `corr:signals:short:HIMS`.

**storeSignal() — kto wywołuje:**
- `AlertEvaluatorService.sendAlert()` — po każdym alercie sentymentu/insider/8K
- `Form8kPipeline.onFiling()` — po analizie GPT 8-K
- `Form4Pipeline.onInsiderTrade()` — po analizie GPT Form 4

**Guard:** `|conviction| >= 0.05` (MIN_CONVICTION) — poniżej = szum, nie zapisuj.

**Normalizacja conviction przy zapisie:**
- SEC pipeline: conviction [-2.0, +2.0] → `/2.0` → [-1.0, +1.0] przed zapisem
- Sentiment pipeline: effectiveScore już w [-1.0, +1.0]

### 5.2 Detekcja wzorców (5 detektorów)

Odpalane przez `schedulePatternCheck(ticker)` — **debounce 10s** per ticker (żeby poczekać na wszystkie sygnały z jednej partii SEC EDGAR).

| # | Wzorzec | Okno | Warunek | Min conviction |
|---|---------|------|---------|----------------|
| 1 | **Insider + 8-K** | 24h | Form4 + 8-K, ten sam kierunek | 0.20 |
| 2 | **Filing Confirms News** | 48h | News PRZED 8-K, ten sam catalyst_type (≠'unknown') | 0.20 |
| 3 | **Multi-Source Convergence** | 24h | 3+ różne kategorie źródeł, ten sam kierunek | 0.20 |
| 4 | **Insider Cluster** | 7 dni | 2+ insider trades, ten sam kierunek | 0.10 |
| 5 | **Escalating Signal** | 72h | 3+ sygnały z rosnącym \|conviction\|, ten sam kierunek | 0.25 |

**Agregacja conviction:**
- Bazowy = najsilniejszy sygnał z jednej kategorii
- Boost = +20% za każdą dodatkową kategorię potwierdzającą ten sam kierunek
- Cap: [-1.0, +1.0]

**Dominujący kierunek:** wymaga ≥66% sygnałów w jednym kierunku (przy remisie → nie koreluj).

### 5.3 Alert skorelowany

| Parametr | Wartość |
|----------|---------|
| Min conviction | 0.20 (MIN_CORRELATED_CONVICTION) |
| Throttling | per (ticker, pattern_type) — Redis klucz `corr:fired:{ticker}:{type}` |
| Throttle czasy | INSIDER_PLUS_8K: 2h, FILING_CONFIRMS_NEWS: 4h, MULTI_SOURCE_CONVERGENCE: 2h, INSIDER_CLUSTER: 24h, ESCALATING_SIGNAL: 6h |
| Priorytet | \|conviction\| ≥ 0.6 → CRITICAL, inaczej HIGH |
| Reguła w DB | "Correlated Signal" |

---

## 6. PRICE OUTCOME TRACKER

**Plik:** `src/price-outcome/price-outcome.service.ts`

### 6.1 Zapis ceny alertu

**Gdzie:** `AlertEvaluatorService.sendAlert()` — w momencie wysyłania alertu
**Jak:** `FinnhubService.getQuote(symbol)` → `priceAtAlert`
**Problem:** Odpytuje Finnhub **bez guardu NYSE** — w weekendy zwraca starą cenę

### 6.2 CRON uzupełnianie cen

```
@Cron('0 * * * *')  — co pełną godzinę
@Logged('price-outcome')
```

| Krok | Akcja |
|------|-------|
| 1 | **Guard NYSE** | `isNyseOpen()` → skip jeśli weekend lub poza 9:30-16:00 ET |
| 2 | Znajdź alerty | `priceOutcomeDone=false AND priceAtAlert IS NOT NULL` |
| 3 | Grupuj po symbolu | 1 zapytanie Finnhub per symbol (nie per alert) |
| 4 | Sprawdź sloty czasowe | alertTime + 1h/4h/24h/72h ≤ now → wypełnij |
| 5 | Max API calls | 30 zapytań Finnhub /quote per cykl |
| 6 | Mark done | Wszystkie 4 sloty wypełnione LUB 7-dniowy hard timeout |

**Helper:** `isNyseOpen()` w `src/common/utils/market-hours.util.ts`
- Poniedziałek-piątek, 9:30-16:00 ET
- Nie uwzględnia świąt federalnych

### 6.3 Kolumny w tabeli `alerts`

| Kolumna | Kiedy wypełniana | Przez |
|---------|------------------|-------|
| `priceAtAlert` | Moment alertu | AlertEvaluator.sendAlert() |
| `price1h` | alert + 1h (gdy NYSE otwarta) | CRON |
| `price4h` | alert + 4h | CRON |
| `price1d` | alert + 24h | CRON |
| `price3d` | alert + 72h | CRON |
| `priceOutcomeDone` | gdy wszystkie wypełnione lub timeout 7d | CRON |

---

## 7. SYSTEM LOGOWANIA

### 7.1 Decorator @Logged(module)

**Plik:** `src/common/decorators/logged.decorator.ts`

**Działanie:** owija async metodę, mierzy czas, zapisuje do `system_logs` (fire-and-forget).

**WAŻNE — kolejność dekoratorów:**
```typescript
// ✅ PRAWIDŁOWO:
@OnEvent(EventType.XXX)   // NAD — ustawia metadata na wrapperze
@Logged('module')          // POD — podmienia descriptor.value

// ❌ BŁĘDNIE (pipeline nie będzie wywołany!):
@Logged('module')          // podmienia descriptor.value
@OnEvent(EventType.XXX)   // ustawia metadata na oryginalnej (już nieużywanej) funkcji
```

### 7.2 Metody z @Logged

| Moduł | Klasa | Metoda |
|-------|-------|--------|
| collectors | BaseCollectorService | runCollectionCycle() |
| sentiment | FinbertClientService | analyze() |
| sentiment | SentimentProcessorService | process() |
| alerts | AlertEvaluatorService | onInsiderTrade() |
| alerts | AlertEvaluatorService | onFiling() |
| alerts | AlertEvaluatorService | onSentimentScored() |
| sec-filings | Form4Pipeline | onInsiderTrade() |
| sec-filings | Form8kPipeline | onFiling() |
| correlation | CorrelationService | storeSignal() |
| correlation | CorrelationService | runPatternDetection() |
| price-outcome | PriceOutcomeService | fillPriceOutcomes() |

### 7.3 Tabela `system_logs`

| Kolumna | Typ | Opis |
|---------|-----|------|
| module | varchar | np. 'collectors', 'alerts', 'sec-filings' |
| className | varchar | np. 'Form8kPipeline' |
| functionName | varchar | np. 'onFiling' |
| status | varchar | 'success' lub 'error' |
| durationMs | int | czas wykonania |
| input | jsonb | argumenty metody (obcięte do 2000 znaków) |
| output | jsonb | wynik metody |
| errorMessage | text | stack trace przy błędzie |
| created_at | timestamp | |

**Cleanup:** CRON `0 3 * * *` — usuwa logi starsze niż 7 dni.

---

## 8. KLUCZOWE PROGI I GUARDY

### 8.1 Sentiment

| Próg | Wartość | Gdzie użyty |
|------|---------|-------------|
| Min tekst | 20 znaków | SentimentProcessor (skip short) |
| Tier 1 | conf > 0.7 AND \|score\| > 0.5 | classifyTier() — zawsze do GPT |
| Tier 2 | conf > 0.3 AND \|score\| > 0.2 | classifyTier() — do GPT jeśli VM |
| Sentiment Crash | effectiveScore < -0.5 AND conf > 0.7 | AlertEvaluator |
| Signal Override | FinBERT i GPT w przeciwnych kierunkach | AlertEvaluator |
| High Conviction | \|gptConviction\| > 1.5 | AlertEvaluator |
| Strong FinBERT | \|score\| > 0.7 AND conf > 0.8 | AlertEvaluator (fallback bez GPT) |
| Urgent Signal | urgency=HIGH AND relevance ≥ 0.7 | AlertEvaluator |

### 8.2 SEC Filing

| Próg | Wartość | Gdzie użyty |
|------|---------|-------------|
| Min transakcja | $100K | Form4Pipeline + AlertEvaluator |
| Daily GPT cap | 20 / ticker / dzień | DailyCapService (Redis INCR) |
| Min tekst 8-K | 100 znaków | Form8kPipeline |
| Bankruptcy | Item 1.03 | CRITICAL bez GPT |

### 8.3 Correlation

| Próg | Wartość | Gdzie użyty |
|------|---------|-------------|
| MIN_CONVICTION | 0.05 | storeSignal() — poniżej nie zapisuj |
| MIN_CORRELATED_CONVICTION | 0.20 | triggerCorrelatedAlert() |
| Dominant direction | ≥ 66% sygnałów | getDominantDirection() |
| Debounce | 10s | schedulePatternCheck() |
| Throttle per pattern | 2h-24h (zależy od wzorca) | Redis `corr:fired:{ticker}:{type}` |

### 8.4 Price Outcome

| Próg | Wartość | Gdzie użyty |
|------|---------|-------------|
| NYSE guard | pon-pt 9:30-16:00 ET | isNyseOpen() |
| Max API calls/cykl | 30 | fillPriceOutcomes() |
| Hard timeout | 7 dni | mark done nawet bez wszystkich slotów |

### 8.5 Rate limits zewnętrznych API

| API | Limit | Delay w kodzie |
|-----|-------|----------------|
| StockTwits | 200 req/hour | 2s między symbolami |
| Finnhub | 60 req/min | 1.5s między symbolami |
| SEC EDGAR | 10 req/sec | 200ms per ticker |
| Azure OpenAI VM | brak (self-hosted) | — |

---

## 9. TABELE BAZY DANYCH — kto pisze, kto czyta

| Tabela | Pisze | Czyta |
|--------|-------|-------|
| `raw_mentions` | StocktwitsService | SentimentProcessor |
| `news_articles` | FinnhubService | SentimentProcessor, frontend |
| `sec_filings` | SecEdgarService, Form8kPipeline, Form4Pipeline | Form8kPipeline, backfill, frontend |
| `insider_trades` | SecEdgarService, FinnhubService | Form4Pipeline, AlertEvaluator, frontend |
| `pdufa_catalysts` | PdufaBioService | SentimentProcessor (kontekst), frontend |
| `sentiment_scores` | SentimentProcessor | AlertEvaluator (scores), frontend |
| `ai_pipeline_logs` | SentimentProcessor | frontend (Pipeline AI panel) |
| `alerts` | AlertEvaluator, CorrelationService | PriceOutcomeService, frontend |
| `alert_rules` | seed.ts | AlertEvaluator (cache 5 min) |
| `tickers` | seed.ts | Kolektory, pipelines |
| `collection_logs` | BaseCollectorService | frontend (health) |
| `system_logs` | SystemLogService (@Logged) | frontend (System Logs tab) |

---

## 10. ZNANE PROBLEMY I UWAGI

1. **priceAtAlert w weekendy** — `sendAlert()` odpytuje Finnhub bez guardu NYSE. Cena może być nieaktualna (stara/cachowana). Dotyczy tylko `priceAtAlert`, nie CRON (CRON ma guard).

2. **Kolejność dekoratorów** — `@OnEvent` musi być NAD `@Logged`. Odwrotnie = martwy listener (naprawione 2026-03-09, sekcja 7.6 w PROGRESS-STATUS.md).

3. **Backfill tylko 8-K** — endpoint `/backfill-gpt` nie obsługuje Form 4. Historyczne insider trades bez analizy GPT.

4. **Dwa handlery na ten sam event** — `NEW_FILING` słuchany przez AlertEvaluator (prosty alert) I Form8kPipeline (GPT analiza). Oba działają niezależnie. Analogicznie `NEW_INSIDER_TRADE` → AlertEvaluator + Form4Pipeline.

5. **isNyseOpen() nie uwzględnia świąt** — sprawdza tylko dzień tygodnia i godziny. W święta federalne (np. MLK Day) CRON odpali się mimo zamkniętej giełdy.

6. **Redis reset przy restart** — korelacje, daily cap, throttling wzorców — tracone przy restarcie Dockera. Odbudowują się automatycznie z nowych danych.
