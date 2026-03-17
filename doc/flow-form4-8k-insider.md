# Przepływ funkcyjny: Form 4 + Insider Trade Large + 8-K

> Kompletna dokumentacja przepływu danych od momentu pobrania z SEC EDGAR / Finnhub aż do alertu Telegram i detekcji korelacji.

---

## Changelog

### 2026-03-17 — Sprint 9: fixy z raportu tygodniowego (9% edge / 85% noise)

1. **Fix conviction sign (Form 4)** — prompt + safety net w pipeline
   - `form4.prompt.ts`: jawna instrukcja SELL=ujemna, BUY=dodatnia
   - `form4.pipeline.ts`: post-GPT korekcja znaku na podstawie `price_impact.direction`
   - Bug: GPT zwracał +0.90 dla SELL (3 z 5 insider signals miało odwrócony znak)

2. **Fix dual signal** — usunięcie rejestracji korelacji z AlertEvaluator insider batch
   - `alert-evaluator.service.ts`: `flushInsiderBatch()` nie wywołuje `storeSignal()`
   - Sygnały form4 w CorrelationService wyłącznie z Form4Pipeline (GPT-enriched)
   - Bug: każdy trade rejestrował 2 sygnały (value-based + GPT-based), psując INSIDER_CLUSTER

3. **Silent rules** — Sentiment Crash + Strong FinBERT zapisywane do DB, nie wysyłane na Telegram
   - 80 alertów/tydzień (44%) bez edge → wyciszone
   - Dane zachowane w DB do analizy retrospektywnej

4. **Per-symbol daily limit** — max 5 alertów Telegram per ticker per dzień (UTC)
   - HIMS: 46 alertów/tydzień → max ~35 (5/dzień × 7)
   - Silent rules nie liczą się do limitu

---

## Spis treści

1. [Diagram przepływu](#1-diagram-przepływu)
2. [Zbieranie danych — SEC EDGAR](#2-zbieranie-danych--sec-edgar)
3. [Zbieranie danych — Finnhub Insider](#3-zbieranie-danych--finnhub-insider)
4. [Parsowanie Form 4 XML](#4-parsowanie-form-4-xml)
5. [Parsowanie 8-K (detekcja Items)](#5-parsowanie-8-k-detekcja-items)
6. [Event System — co uruchamia co](#6-event-system--co-uruchamia-co)
7. [Alert Evaluator — Insider Trade Large](#7-alert-evaluator--insider-trade-large)
8. [Form 4 GPT Pipeline](#8-form-4-gpt-pipeline)
9. [8-K GPT Pipeline](#9-8-k-gpt-pipeline)
10. [Prompty GPT (per typ)](#10-prompty-gpt-per-typ)
11. [Scoring i priorytetyzacja alertów](#11-scoring-i-priorytetyzacja-alertów)
12. [Correlation Service — detekcja wzorców](#12-correlation-service--detekcja-wzorców)
13. [Telegram — formatowanie alertów](#13-telegram--formatowanie-alertów)
14. [Encje bazy danych](#14-encje-bazy-danych)
15. [Backfill endpoint](#15-backfill-endpoint)
16. [Mapa plików](#16-mapa-plików)

---

## 1. Diagram przepływu

```
                        ┌─────────────────────────────────────┐
                        │         SEC EDGAR API               │
                        │  (submissions.json, co 30 min)      │
                        └──────────┬──────────────────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    ▼                              ▼
            ┌──────────────┐              ┌──────────────┐
            │   Form 4     │              │    8-K       │
            │  (XML file)  │              │  (filing)    │
            └──────┬───────┘              └──────┬───────┘
                   │                              │
                   ▼                              ▼
          ┌────────────────┐            ┌─────────────────┐
          │ form4-parser   │            │ SecFiling zapis  │
          │ parseForm4Xml  │            │ do PostgreSQL    │
          └────────┬───────┘            └─────────┬───────┘
                   │                              │
                   ▼                              ▼
          ┌────────────────┐            ┌─────────────────┐
          │ InsiderTrade   │            │ emit            │
          │ zapis do DB    │            │ NEW_FILING      │
          └────────┬───────┘            └────────┬────────┘
                   │                              │
                   ▼                     ┌────────┴────────┐
          ┌────────────────┐             ▼                 ▼
          │ emit           │    ┌──────────────┐  ┌──────────────────┐
          │ NEW_INSIDER_   │    │ AlertEval    │  │ Form8kPipeline   │
          │ TRADE          │    │ onFiling()   │  │ onFiling()       │
          └────────┬───────┘    └──────┬───────┘  └──────┬───────────┘
                   │                   │                  │
          ┌────────┴──────┐            │           ┌──────┴───────┐
          ▼               ▼            │           ▼              ▼
  ┌──────────────┐ ┌──────────────┐    │    ┌───────────┐  ┌──────────┐
  │ AlertEval    │ │ Form4Pipeline│    │    │ Detekcja  │  │ Prompt   │
  │ onInsider    │ │ onInsider    │    │    │ Items     │  │ per Item │
  │ Trade()      │ │ Trade()      │    │    │ (parser)  │  │ → GPT    │
  └──────┬───────┘ └──────┬───────┘    │    └─────┬─────┘  └────┬─────┘
         │                │            │          │              │
         ▼                ▼            │          ▼              ▼
  ┌──────────────┐ ┌──────────────┐    │    ┌───────────────────────┐
  │ Batch 5 min  │ │ GPT gpt-4o  │    │    │ Zod walidacja + zapis │
  │ → flush      │ │ -mini       │    │    │ gptAnalysis do DB     │
  └──────┬───────┘ └──────┬───────┘    │    └───────────┬───────────┘
         │                │            │                │
         ▼                ▼            ▼                ▼
  ┌──────────────────────────────────────────────────────────────┐
  │                     sendAlert()                              │
  │  1. Format Telegram (per typ alertu)                         │
  │  2. Zapis Alert do PostgreSQL + priceAtAlert (Finnhub)       │
  │  3. Rejestracja sygnału → CorrelationService.storeSignal()   │
  │  4. schedulePatternCheck(ticker) → 10s debounce              │
  └──────────────────────────┬───────────────────────────────────┘
                             │
                             ▼
                   ┌─────────────────────┐
                   │ CorrelationService   │
                   │ runPatternDetection  │
                   │ (5 detektorów)       │
                   └─────────┬───────────┘
                             │
                   ┌─────────┴───────────────────┐
                   ▼                              ▼
           ┌──────────────┐              ┌──────────────────┐
           │ Pattern      │              │ Correlated Alert │
           │ znaleziony?  │─── TAK ────→ │ (Telegram)       │
           │ conv ≥ 0.20  │              └──────────────────┘
           └──────────────┘
```

Dodatkowo **Finnhub** dostarcza dane MSPR (Monthly Summary of Insider Purchases and Resales), ale te mają `totalValue=0` więc nie przechodzą progu $100K w AlertEvaluator.

---

## 2. Zbieranie danych — SEC EDGAR

**Plik:** `src/collectors/sec-edgar/sec-edgar.service.ts`

### Metoda `collect()` — CRON co 30 min

```
Dla każdego aktywnego tickera:
  1. Pobierz submissions.json z SEC (https://data.sec.gov/submissions/CIK{cik}.json)
  2. Iteruj po recent filings
  3. Sprawdź duplikaty (accessionNumber w DB)
  4. Rozpoznaj typ formularza:
     - "4" → Form 4 (insider trade)
     - "8-K" → 8-K (material event)
     - inne → zapisz SecFiling, bez dalszej akcji
```

### Metoda `parseAndSaveForm4(symbol, accessionNumber, xmlUrl)` — dla Form 4

```
1. Pobierz XML z SEC EDGAR (xmlUrl)
2. Parsuj → parseForm4Xml(xml) → Form4Transaction[]
3. Dla każdej transakcji:
   a. Utwórz/aktualizuj InsiderTrade w PostgreSQL
   b. Emit EventType.NEW_INSIDER_TRADE z danymi transakcji
4. Utwórz SecFiling (formType='4') jeśli nie istnieje
5. Emit EventType.NEW_FILING
```

### Metoda `collectFilings()` — dla 8-K

```
1. Wykryj formType='8-K' w submissions.json
2. Utwórz SecFiling w PostgreSQL (accessionNumber, documentUrl, opis)
3. Emit EventType.NEW_FILING z payload: { symbol, formType: '8-K', filingId, accessionNumber }
```

---

## 3. Zbieranie danych — Finnhub Insider

**Plik:** `src/collectors/finnhub/finnhub.service.ts`

### Metoda `collectInsiderTrades(symbol)` — CRON co 10 min (razem z news)

```
1. GET /stock/insider-sentiment?symbol={symbol} z Finnhub API
2. Dla każdego wpisu MSPR:
   a. Utwórz InsiderTrade:
      - insiderName: "Aggregate MSPR"
      - transactionType: mspr > 0 ? 'BUY' : 'SELL'
      - shares: Math.abs(change)
      - totalValue: 0   ← WAŻNE: nie przejdzie progu $100K
      - accessionNumber: `mspr_${symbol}_${year}_${month}`
   b. Emit EventType.NEW_INSIDER_TRADE
```

**Uwaga:** MSPR to zagregowane dane sentymentu insiderów — nie faktyczne transakcje. `totalValue=0` oznacza, że nie generują alertów "Insider Trade Large", ale mogą wpływać na korelacje.

---

## 4. Parsowanie Form 4 XML

**Plik:** `src/collectors/sec-edgar/form4-parser.ts`

### Funkcja `parseForm4Xml(xml)` → `Form4Transaction[]`

```
Wejście: surowy XML z SEC EDGAR (format XBRL)
Wyjście: tablica transakcji

Dla każdej transakcji (nonDerivativeTransaction + derivativeTransaction):
  - insiderName     ← rptOwnerName LUB rptOwnerCik
  - insiderRole     ← mapowanie flag SEC:
      isOfficer=true → "Officer" (+ officerTitle jeśli dostępny)
      isDirector=true → "Director"
      isTenPercentOwner=true → "10% Owner"
      inne → "Other"
  - transactionType ← mapowanie kodów SEC:
      P → BUY
      S → SELL
      M → EXERCISE
      A → GRANT
      F → TAX
      inne → OTHER
  - shares          ← transactionShares (float)
  - pricePerShare   ← transactionPricePerShare (float, 0 jeśli brak)
  - totalValue      ← shares × pricePerShare
  - transactionDate ← YYYY-MM-DD
  - is10b51Plan     ← transactionTimeliness === '1' LUB isPartOfPlan
  - sharesOwnedAfter ← sharesOwnedFollowingTransaction
```

**Kluczowe:** `is10b51Plan` = `true` oznacza zaplanowaną sprzedaż (szum), `false` = decyzja dyskrecjonalna (prawdziwy sygnał).

---

## 5. Parsowanie 8-K (detekcja Items)

**Plik:** `src/sec-filings/parsers/form8k.parser.ts`

### Funkcja `detectItems(filingText)` → `string[]`

```
Regex: /Item\s+(\d+\.\d{2})/gi
Wynik: np. ["1.01", "2.02", "5.02"]
Deduplikacja + sortowanie
```

### Funkcja `extractItemText(filingText, itemNumber)` → `string`

```
1. Znajdź pozycję "Item {itemNumber}" w tekście
2. Wytnij tekst od tej pozycji do następnego Item LUB "SIGNATURES"
3. Ogranicz do 4000 znaków (limit promptu GPT)
```

### Funkcja `selectPromptBuilder(item)` → `Function`

```
Mapowanie Item → prompt builder:
  "1.01" → buildForm8k_1_01_Prompt  (Material Definitive Agreement)
  "1.03" → BANKRUPTCY → nie idzie do GPT, natychmiastowy CRITICAL
  "2.02" → buildForm8k_2_02_Prompt  (Results of Operations / Earnings)
  "5.02" → buildForm8k_5_02_Prompt  (Departure/Appointment Officers)
  "7.01" → buildForm8kOtherPrompt   (Regulation FD Disclosure)
  "8.01" → buildForm8kOtherPrompt   (Other Events)
  inne   → buildForm8kOtherPrompt   (catch-all)
```

### Funkcja `stripHtml(html)` → `string`

```
Usuwa tagi HTML, dekoduje encje (&amp; → &), normalizuje whitespace.
Używane do czyszczenia tekstu 8-K przed wysłaniem do GPT.
```

---

## 6. Event System — co uruchamia co

**Plik:** `src/events/event-types.ts`

```
EventType.NEW_INSIDER_TRADE
  ├── AlertEvaluatorService.onInsiderTrade()    ← @OnEvent('NEW_INSIDER_TRADE')
  └── Form4Pipeline.onInsiderTrade()            ← @OnEvent('NEW_INSIDER_TRADE')

EventType.NEW_FILING (formType='8-K')
  ├── AlertEvaluatorService.onFiling()          ← @OnEvent('NEW_FILING')  [opcjonalnie]
  └── Form8kPipeline.onFiling()                 ← @OnEvent('NEW_FILING')

EventType.SENTIMENT_SCORED
  └── AlertEvaluatorService.onSentimentScored() ← @OnEvent('SENTIMENT_SCORED')
      (6 równoległych checków, w tym High Conviction i Urgent AI Signal)

EventType.CORRELATION_DETECTED
  └── (logowanie / frontend refresh)
```

**Oba handlery (`AlertEvaluator` i `Pipeline`) uruchamiają się RÓWNOLEGLE** na ten sam event — niezależne ścieżki.

---

## 7. Alert Evaluator — Insider Trade Large

**Plik:** `src/alerts/alert-evaluator.service.ts`
**Metoda:** `onInsiderTrade(payload)` → `@OnEvent('NEW_INSIDER_TRADE')`

### Przepływ krok po kroku:

```
1. FILTR wstępny:
   - totalValue > $100,000?          → NIE → SKIP (za mały trade)
   - transactionType in [BUY, SELL]? → NIE → SKIP (EXERCISE, TAX, GRANT ignorowane)

2. BATCHING (grupowanie per ticker):
   - Dodaj trade do mapy: pendingInsiderBatches[symbol]
   - Jeśli pierwszy trade dla tego symbolu → ustaw timer 5 min
   - Jeśli timer już istnieje → dodaj do istniejącego batcha

3. Po 5 minutach → flushInsiderBatch(symbol):
   a. Pobierz regułę "Insider Trade Large" z cache (TTL 5 min)
   b. Sprawdź czy reguła aktywna (isActive=true)
   c. THROTTLING: sprawdź w tabeli alerts po (ruleName, symbol, sentAt > cutoff)
   d. Agreguj dane batcha:
      - totalBuys, totalSells, totalBuyValue, totalSellValue
   e. sendAlert() — BEZ rejestracji w CorrelationService:
      - Format: TelegramFormatterService.formatInsiderBatchAlert()
      - Zapis Alert do DB z priceAtAlert (Finnhub /quote)
      - ⚠️ NIE rejestruje sygnału w CorrelationService (od Sprint 9)
        Form4Pipeline robi to z GPT-enriched conviction i poprawnym catalyst_type
```

> **Zmiana Sprint 9 (17.03.2026):** AlertEvaluator NIE rejestruje sygnału korelacji
> dla insider trades. Wcześniej dual signal (value-based + GPT-based) zaśmiecał
> INSIDER_CLUSTER mieszanymi conviction values.

### sendAlert() — mechanizmy ochronne (Sprint 9):

```
1. SILENT RULES: Sentiment Crash, Strong FinBERT Signal
   → zapis do DB, NIE wysyłanie na Telegram (80 alertów/tydzień bez edge)

2. PER-SYMBOL DAILY LIMIT: max 5 alertów Telegram per ticker per dzień (UTC)
   → count alertów z delivered=true dla symbolu dziś
   → silent rules nie liczą się do limitu
   → HIMS: 46/tydzień → max 35 (5/dzień × 7)
```

### Progi decyzyjne:

| Warunek | Wartość | Efekt |
|---------|---------|-------|
| totalValue | > $100K | Minimalny próg alertu |
| transactionType | BUY, SELL | Jedyne alertowalne typy |
| throttle | rule.throttleMinutes | Blokada powtórzeń per ticker |
| daily limit | 5/ticker/dzień | Ochrona przed spamem (HIMS) |

---

## 8. Form 4 GPT Pipeline

**Plik:** `src/sec-filings/pipelines/form4.pipeline.ts`
**Metoda:** `onInsiderTrade(payload)` → `@OnEvent('NEW_INSIDER_TRADE')`

### Przepływ krok po kroku:

```
1. FILTR wstępny (identyczny jak AlertEvaluator):
   - totalValue > $100K?
   - transactionType in [BUY, SELL]?

2. DAILY CAP (Redis):
   - Key: `secfil:gpt:form4:${symbol}` (TTL = do końca dnia)
   - INCR → jeśli > 20 → SKIP (max 20 wywołań GPT na ticker dziennie)

3. POBRANIE KONTEKSTU:
   - InsiderTrade pełny rekord z DB
   - Ostatnie 30 dni trades dla tego tickera (wzorce klasterowe)

4. BUDOWANIE PROMPTU (buildForm4Prompt):
   - Dane bieżącej transakcji (insider, rola, typ, wartość, is10b51Plan)
   - Historia 30-dniowa (inne transakcje insiderów)
   - SIGN CONVENTION: SELL → conviction MUSI być ujemna, BUY → dodatnia
   - Skala conviction: -0.1 to -0.4 / +0.1 to +0.4 (rutynowe) → ±1.7-2.0 (ekstremalnie)

5. WYSŁANIE DO GPT:
   - AzureOpenaiClientService.analyzeCustomPrompt(prompt)
   - Endpoint: Azure VM 74.248.113.3:3100 POST /analyze/custom
   - Model: gpt-4o-mini

6. WALIDACJA ODPOWIEDZI (Zod):
   - SecFilingAnalysisSchema.parse(response)
   - Jeśli fail → retry 1 raz
   - Jeśli nadal fail → log błędu, SKIP

7. SAFETY NET — korekcja znaku conviction (Sprint 9):
   - Jeśli price_impact.direction='negative' a conviction > 0 → flip na ujemny
   - Jeśli price_impact.direction='positive' a conviction < 0 → flip na dodatni
   - GPT zawsze ustawia direction poprawnie, ale conviction bywa bez znaku

8. ZAPIS DO DB:
   - SecFiling.gptAnalysis = validated JSON (po korekcji znaku)
   - SecFiling.priceImpactDirection = analysis.price_impact.direction

9. PRIORYTETYZACJA — scoreForm4Priority (Sprint 9 — osobne progi):
   - CRITICAL: requires_immediate_attention + |conviction| ≥ 0.3
             LUB |conviction| ≥ 0.8 + confidence ≥ 0.6
   - HIGH:    |conviction| ≥ 0.4 + non-low magnitude + confidence ≥ 0.5
             LUB magnitude=high + confidence ≥ 0.6
   - MEDIUM:  |conviction| ≥ 0.2 + medium magnitude
   - null:    nie wysyłaj alertu (za niski scoring)

10. MAPOWANIE REGUŁY (mapToRuleName):
    - Form 4 → zawsze "Form 4 Insider Signal"

11. THROTTLING:
    - Sprawdzenie w tabeli alerts po (ruleName, symbol, catalyst_type, sentAt > cutoff)

12. ALERT TELEGRAM:
    - TelegramFormatterService.formatForm4GptAlert(filing, analysis, trades)
    - Treść: wniosek GPT, kluczowe fakty, conviction, price impact

13. ZAPIS ALERT DO DB + priceAtAlert

14. REJESTRACJA SYGNAŁU W CORRELATION SERVICE (jedyne źródło form4):
    - conviction: GPT [-2.0, +2.0] → normalizacja /2.0 → [-1.0, +1.0]
    - source_category: 'form4'
    - direction: conviction ≥ 0 ? 'positive' : 'negative' (po safety net)
    - catalyst_type: z analizy GPT (np. 'insider')

15. schedulePatternCheck(symbol) → 10s debounce
```

### Format odpowiedzi GPT (SecFilingAnalysis):

```json
{
  "price_impact": {
    "direction": "positive" | "negative" | "neutral",
    "magnitude": "high" | "medium" | "low",
    "confidence": 0.0-1.0,
    "time_horizon": "immediate" | "short_term" | "medium_term"
  },
  "conviction": -2.0 do +2.0,
  "summary": "Jedno zdanie po polsku",
  "conclusion": "1-2 zdania po polsku — wniosek",
  "key_facts": ["fakt 1", "fakt 2", "fakt 3"],
  "catalyst_type": "insider",
  "requires_immediate_attention": true | false
}
```

---

## 9. 8-K GPT Pipeline

**Plik:** `src/sec-filings/pipelines/form8k.pipeline.ts`
**Metoda:** `onFiling(payload)` → `@OnEvent('NEW_FILING')`

### Przepływ krok po kroku:

```
1. FILTR: formType === '8-K'? → NIE → SKIP (ignoruj Form 4, 10-K itd.)

2. DAILY CAP: tak jak Form 4 (max 20/ticker/dzień)

3. DUPLIKAT: filing.gptAnalysis !== null? → SKIP (już zanalizowany)

4. POBRANIE TEKSTU FILINGU:
   a. Próba 1: GET index.json dla accessionNumber
      → znajdź główny dokument (.htm/.html/.txt)
      → GET treść dokumentu
   b. Fallback: GET documentUrl bezpośrednio
   c. stripHtml() → czysty tekst

5. DETEKCJA ITEMS: detectItems(text) → np. ["2.02", "7.01"]

6. SPRAWDZENIE BANKRUCTWA:
   - Czy Items zawierają "1.03"?
   - TAK → handleBankruptcy():
     - Natychmiastowy alert CRITICAL
     - BEZ GPT (nie czekamy na analizę)
     - Telegram: formatBankruptcyAlert()
     - Rejestracja w CorrelationService (conviction = -1.0)
     - RETURN (koniec przepływu)

7. WYBÓR GŁÓWNEGO ITEM: pierwszy non-bankruptcy Item z listy

8. EKSTRAKCJA TEKSTU ITEM: extractItemText(text, itemNumber) → max 4000 znaków

9. WYBÓR PROMPT BUILDERA:
   - "1.01" → buildForm8k_1_01_Prompt (Material Definitive Agreement)
   - "2.02" → buildForm8k_2_02_Prompt (Results of Operations)
   - "5.02" → buildForm8k_5_02_Prompt (Departure/Appointment Officers)
   - inne   → buildForm8kOtherPrompt  (catch-all)

10. BUDOWANIE I WYSŁANIE PROMPTU → GPT gpt-4o-mini

11. WALIDACJA (Zod) → retry 1 raz jeśli fail

12. ZAPIS: SecFiling.gptAnalysis + priceImpactDirection

13. PRIORYTETYZACJA (scoreToAlertPriority) — identyczna jak Form 4

14. MAPOWANIE REGUŁY (mapToRuleName):
    - catalyst_type 'earnings'   → "8-K Earnings Miss"
    - catalyst_type 'leadership' → "8-K Leadership Change"
    - domyślnie                  → "8-K Material Event GPT"

15. THROTTLING → per (ruleName, symbol, catalyst_type)

16. ALERT TELEGRAM: formatForm8kGptAlert(filing, analysis, itemNumber)

17. ZAPIS ALERT + priceAtAlert

18. REJESTRACJA SYGNAŁU W CORRELATION SERVICE:
    - source_category: '8k'
    - conviction: normalizacja [-2,+2] → [-1,+1]
    - catalyst_type: z GPT

19. schedulePatternCheck(symbol)
```

### Specjalny przypadek: Item 1.03 (Bankruptcy)

```
Item 1.03 = "Bankruptcy or Receivership"
→ Natychmiastowy alert CRITICAL bez GPT
→ conviction = -1.0 (maximum negatywny)
→ Telegram: "⚠️ CRITICAL: {symbol} — Item 1.03 Bankruptcy or Receivership"
```

---

## 10. Prompty GPT (per typ)

### Form 4 — `src/sec-filings/prompts/form4.prompt.ts`

```
Kontekst:
- Dane transakcji: insider, rola, typ (BUY/SELL), wartość, is10b51Plan
- Historia 30-dniowa: inne trades insiderów (cluster detection)

Wskazówki dla GPT:
- Zakupy CEO/CFO = bullish (szczególnie BEZ planu 10b5-1)
- Sprzedaże mniej informacyjne, CHYBA ŻE: brak planu + duży % holdingów
- Cluster selling (2+ insiderów w 7 dni) → silny sygnał bearish
- Plan 10b5-1 = szum (zaplanowane z góry)

Skala conviction:
  ±0.1-0.4  rutynowe (typowy grant/exercise)
  ±0.5-0.8  godne uwagi (single insider large trade)
  ±0.9-1.2  istotne (CEO buy, cluster pattern)
  ±1.3-1.6  bardzo istotne (CEO massive buy, multi-insider same direction)
  ±1.7-2.0  ekstremalnie istotne (CEO buys $10M+ bez planu)
```

### 8-K Item 1.01 — `src/sec-filings/prompts/form8k-1-01.prompt.ts`

```
"Material Definitive Agreement"
Fokus: wartość kontraktu, kontrahent, czas trwania, warunki wypowiedzenia,
       znaczenie strategiczne, wpływ na revenue
```

### 8-K Item 2.02 — `src/sec-filings/prompts/form8k-2-02.prompt.ts`

```
"Results of Operations and Financial Condition" (wyniki kwartalne)
Fokus: EPS beat/miss, revenue vs guidance, MLR (managed care ratio),
       membership changes, outlook revisions
Specjalne: requires_immediate_attention: true (zawsze ważne)
```

### 8-K Item 5.02 — `src/sec-filings/prompts/form8k-5-02.prompt.ts`

```
"Departure/Appointment of Directors or Officers"
Fokus: kto odszedł, kto przyszedł, powód, okres przejściowy
Kluczowe: odejście CEO/CFO = bardziej bearish niż rotacja dyrektora
```

### 8-K inne — `src/sec-filings/prompts/form8k-other.prompt.ts`

```
Items 7.01, 8.01 i niezmapowane
Watch for: FDA approval/CRL, CMS rates, DOJ/FTC investigation,
           wyniki badań klinicznych, M&A, litigation, restatement
Conviction: ta sama skala ±0.1-2.0
```

---

## 11. Scoring i priorytetyzacja alertów

**Plik:** `src/sec-filings/scoring/price-impact.scorer.ts`

### `scoreToAlertPriority(analysis, formType)` → Priority | null

> **Sprint 9 (17.03.2026):** Osobne progi dla Form 4 i 8-K. Form 4 insider trades to
> leading signals (niższe progi), 8-K to często reaktywne filingi (wyższe progi).

#### Form 4 — `scoreForm4Priority()` (niższe progi)

```
CRITICAL jeśli:
  (requires_immediate_attention AND |conviction| ≥ 0.3)
  LUB
  (|conviction| ≥ 0.8 AND confidence ≥ 0.6)

HIGH jeśli:
  (|conviction| ≥ 0.4 AND magnitude != 'low' AND confidence ≥ 0.5)
  LUB
  (magnitude='high' AND confidence ≥ 0.6)

MEDIUM jeśli:
  (|conviction| ≥ 0.2 AND magnitude='medium')

null: za niski scoring
```

#### 8-K — `score8kPriority()` (wyższe progi)

```
CRITICAL jeśli:
  (requires_immediate_attention AND |conviction| ≥ 0.4 AND magnitude='high')
  LUB
  (magnitude='high' AND confidence ≥ 0.7)

HIGH jeśli:
  (magnitude='medium' AND confidence ≥ 0.6)
  LUB
  (magnitude='high' AND confidence < 0.7)

null: za niski scoring (brak MEDIUM dla 8-K)
```

### `mapToRuleName(analysis, formType)` → string

```
Form 4 → "Form 4 Insider Signal"

8-K + catalyst_type='earnings'    → "8-K Earnings Miss"
8-K + catalyst_type='leadership'  → "8-K Leadership Change"
8-K + domyślnie                   → "8-K Material Event GPT"
```

---

## 12. Correlation Service — detekcja wzorców

**Plik:** `src/correlation/correlation.service.ts`
**Typy:** `src/correlation/types/correlation.types.ts`

### Przechowywanie sygnałów (Redis Sorted Sets)

```
storeSignal(signal):
  1. Filtr: |conviction| ≥ 0.05 (MIN_CONVICTION)
  2. Klucz Redis:
     - source_category 'form4'     → signals:insider:{ticker}  (TTL 14 dni)
     - source_category '8k'/'news'/'options' → signals:short:{ticker}    (TTL 72h — podniesiony z 48h, options muszą przeżyć do Form 4 filing delay)
  3. Score = timestamp (ms) — do range queries
  4. Cleanup: ZREMRANGEBYSCORE stale, max 50 per key
```

### 6 detektorów wzorców (`runPatternDetection(ticker)`)

#### 1. INSIDER_PLUS_8K (insider + 8-K w 24h)

```
Warunek: Form 4 sygnał + 8-K sygnał w ciągu 24h, TEN SAM kierunek
Throttle: 2h
Conviction: średnia conviction obu sygnałów × 1.5 (boost)
Przykład: insider sell + 8-K bad earnings w tym samym dniu
```

#### 2. FILING_CONFIRMS_NEWS (filing potwierdza wcześniejsze newsy)

```
Warunek: News PRZED 8-K (max 48h), ten sam catalyst_type
         (catalyst_type 'unknown' IGNOROWANY)
Throttle: 4h
Conviction: średnia × 1.3
Przykład: plotki o przejęciu → 8-K potwierdza M&A
```

#### 3. MULTI_SOURCE_CONVERGENCE (3+ źródła, ten sam kierunek)

```
Warunek: Sygnały z 3+ kategorii (social, news, form4, 8k) w 24h
         Wszystkie w tym samym kierunku (positive/negative)
Throttle: 2h
Conviction: średnia × 1.4
Przykład: Reddit + Finnhub news + insider buy — all positive
```

#### 4. INSIDER_CLUSTER (klaster insiderów)

```
Warunek: 2+ sygnały Form 4, ten sam kierunek, w ciągu 7 dni
Throttle: 24h
Conviction: średnia × 1.2
Przykład: CEO + CFO + VP sprzedają w tym samym tygodniu
```

#### 5. ESCALATING_SIGNAL (narastająca conviction)

```
Warunek: 3+ sygnały w 72h, ten sam kierunek, rosnąca conviction
Throttle: 6h
Conviction: max conviction × 1.3
Przykład: słaby sygnał → silniejszy → najsilniejszy (eskalacja)
```

#### 6. INSIDER_PLUS_OPTIONS (insider + unusual options w 72h)

```
Warunek: Form 4 sygnał + options flow sygnał w ciągu 72h, TEN SAM kierunek
         (72h bo: Form 4 ma 2-dniowy filing delay, opcje EOD raz/dobę)
Throttle: 2h
Conviction: agregacja (najsilniejszy per kategoria, boost +20% per dodatkowe źródło)
Przykład: insider sell poniedziałek + spike put options środa → konwergencja bearish
Źródło options: Polygon.io Free Tier EOD, volume spike ≥ 3× avg20d
```

### Decyzja alertu korelacji

```
triggerCorrelatedAlert():
  1. |correlated_conviction| ≥ 0.20 (MIN_CORRELATED_CONVICTION)? → NIE → SKIP
  2. Deduplikacja: Redis key `corr:sent:{ticker}:{patternType}` z TTL = throttle
  3. Priority:
     - |conviction| ≥ 0.6 → CRITICAL
     - inaczej            → HIGH
  4. Zapis Alert z ruleName='Correlated Signal'
  5. Telegram: formatCorrelatedAlert() z listą sygnałów składowych
```

---

## 13. Telegram — formatowanie alertów

**Plik:** `src/alerts/telegram/telegram-formatter.service.ts`

### Formatery per typ alertu:

| Metoda | Użycie | Zawartość |
|--------|--------|-----------|
| `formatInsiderTradeAlert()` | Pojedynczy insider trade | Insider, rola, typ, wartość |
| `formatInsiderBatchAlert()` | Batch po 5 min | Agregacja: ile BUY/SELL, łączna wartość |
| `formatForm4GptAlert()` | Form 4 + GPT | Wniosek GPT, key facts, conviction, price impact |
| `formatForm8kGptAlert()` | 8-K + GPT | Item number, catalyst_type, wniosek GPT |
| `formatBankruptcyAlert()` | Item 1.03 | CRITICAL alert, bez GPT |
| `formatCorrelatedAlert()` | Korelacja | Pattern type, sygnały składowe, conviction boost |
| `formatSentimentAlert()` | Sentiment crash | Score + enriched analysis |
| `formatConvictionAlert()` | High conviction ("Silny Sygnał") | Conviction value + catalyst |
| `formatUrgentAiAlert()` | Urgent AI Signal ("Pilny Sygnał AI") | Conviction value + catalyst |
| `formatSignalOverrideAlert()` | FinBERT vs GPT | Konflikt: FinBERT mówi X, GPT mówi Y |
| `formatStrongFinbertAlert()` | VM offline | Score (unconfirmed) |

Wszystkie wiadomości:
- Po polsku
- Escaped MarkdownV2 (wymóg Telegram API)
- Zawierają symbol tickera, timestamp, priorytet

---

## 14. Encje bazy danych

### InsiderTrade — `src/entities/insider-trade.entity.ts`

```
id              serial PK
symbol          varchar       — ticker (np. "MRNA")
insiderName     varchar       — imię i nazwisko (lub "Aggregate MSPR")
insiderRole     varchar       — CEO, Director, Officer, 10% Owner, Other
transactionType varchar       — BUY, SELL, EXERCISE, GRANT, TAX, OTHER
shares          float         — liczba akcji
pricePerShare   float         — cena za akcję (0 dla MSPR)
totalValue      float         — shares × pricePerShare
transactionDate date          — data transakcji
accessionNumber varchar UNIQUE — identyfikator SEC (lub mspr_...)
is10b51Plan     boolean       — true = zaplanowany plan (szum)
sharesOwnedAfter float        — ile akcji po transakcji
createdAt       timestamp
```

### SecFiling — `src/entities/sec-filing.entity.ts`

```
id                   serial PK
symbol               varchar       — ticker
cik                  varchar       — SEC CIK number
formType             varchar       — "4", "8-K", "10-K" itd.
accessionNumber      varchar UNIQUE
filingDate           date
description          text          — opis z SEC
documentUrl          text          — URL do dokumentu
gptAnalysis          jsonb NULL    — wynik GPT (SecFilingAnalysis)
priceImpactDirection varchar NULL  — 'positive'/'negative'/'neutral'
createdAt            timestamp
```

### AlertRule — `src/entities/alert-rule.entity.ts`

```
id               serial PK
name             varchar UNIQUE — np. "Insider Trade Large", "8-K Material Event GPT"
condition        text           — opis warunku
priority         enum           — INFO, MEDIUM, HIGH, CRITICAL
throttleMinutes  integer        — min. czas między alertami per ticker
isActive         boolean        — czy reguła aktywna
createdAt        timestamp
```

Relevantne reguły:
- **Insider Trade Large** — batch insider trades > $100K
- **Form 4 Insider Signal** — GPT analiza Form 4
- **8-K Material Event GPT** — GPT analiza 8-K (domyślna)
- **8-K Earnings Miss** — GPT analiza Item 2.02
- **8-K Leadership Change** — GPT analiza Item 5.02
- **Correlated Signal** — pattern detection (korelacja)

---

## 15. Backfill endpoint

**Plik:** `src/sec-filings/sec-filings.controller.ts`

```
POST /api/sec-filings/backfill-gpt
  Query params: limit (default 50, max 50)

  1. Pobierz SecFilings WHERE formType='8-K' AND gptAnalysis IS NULL
  2. Dla każdego: wywołaj Form8kPipeline.onFiling() bezpośrednio
  3. Zwróć { processed: N, total: M }

Użycie: re-analiza starych filingów które nie przeszły GPT
         (np. po naprawie promptu, po dodaniu nowego Item parsera)
```

---

## 16. Mapa plików

```
src/
├── collectors/
│   ├── sec-edgar/
│   │   ├── sec-edgar.service.ts       ← Kolektor EDGAR (CRON 30 min)
│   │   ├── sec-edgar.processor.ts     ← BullMQ worker
│   │   ├── form4-parser.ts            ← Parser XML Form 4
│   │   └── sec-edgar.module.ts        ← Moduł NestJS
│   └── finnhub/
│       ├── finnhub.service.ts         ← Kolektor Finnhub (insider MSPR)
│       └── finnhub.module.ts
│
├── sec-filings/
│   ├── pipelines/
│   │   ├── form4.pipeline.ts          ← GPT pipeline Form 4
│   │   └── form8k.pipeline.ts         ← GPT pipeline 8-K
│   ├── prompts/
│   │   ├── form4.prompt.ts            ← Prompt Form 4
│   │   ├── form8k-1-01.prompt.ts      ← Prompt Item 1.01
│   │   ├── form8k-2-02.prompt.ts      ← Prompt Item 2.02
│   │   ├── form8k-5-02.prompt.ts      ← Prompt Item 5.02
│   │   └── form8k-other.prompt.ts     ← Prompt inne Items
│   ├── parsers/
│   │   └── form8k.parser.ts           ← Parser 8-K (Items, HTML strip)
│   ├── scoring/
│   │   └── price-impact.scorer.ts     ← Priorytetyzacja + mapowanie reguł
│   ├── types/
│   │   └── sec-filing-analysis.ts     ← Typy + Zod walidacja
│   ├── sec-filings.controller.ts      ← Backfill endpoint
│   └── sec-filings.module.ts          ← Moduł NestJS
│
├── correlation/
│   ├── correlation.service.ts         ← 6 detektorów wzorców (Redis, w tym INSIDER_PLUS_OPTIONS)
│   ├── correlation.module.ts
│   └── types/
│       └── correlation.types.ts       ← StoredSignal, PatternType (+ 'options', + INSIDER_PLUS_OPTIONS)
│
├── collectors/options-flow/
│   ├── options-flow.service.ts        ← Kolektor Polygon.io (EOD, CRON 22:15 UTC)
│   ├── options-flow.processor.ts      ← BullMQ worker
│   ├── options-flow.scheduler.ts      ← CRON pon-pt po sesji NYSE
│   ├── options-flow.module.ts
│   └── unusual-activity-detector.ts   ← Detekcja volume spike (3× avg20d)
│
├── options-flow/
│   ├── options-flow-scoring.service.ts ← Heurystyka conviction (bez GPT)
│   ├── options-flow-alert.service.ts   ← @OnEvent → scoring → correlation → Telegram
│   └── options-flow.module.ts
│
├── alerts/
│   ├── alert-evaluator.service.ts     ← 5 checków / 6 reguł + batch insider
│   └── telegram/
│       └── telegram-formatter.service.ts ← 11 formaterów Telegram (+ formatOptionsFlowAlert)
│
├── entities/
│   ├── sec-filing.entity.ts           ← Tabela sec_filings
│   ├── insider-trade.entity.ts        ← Tabela insider_trades
│   └── alert-rule.entity.ts           ← Tabela alert_rules
│
└── events/
    └── event-types.ts                 ← Enum eventów (NEW_INSIDER_TRADE, NEW_FILING...)
```
