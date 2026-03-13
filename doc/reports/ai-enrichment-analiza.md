# Analiza danych pod kątem AI Enrichment

> Wygenerowano: 2026-02-28 | Baza: 16 dni zbierania (12-28 lut 2026)
> Analiza na podstawie WSZYSTKICH 9 487 rekordów sentiment_scores

## 1. Stan bazy danych

| Tabela | Rekordów | Okres |
|--------|----------|-------|
| raw_mentions | 9 368 | 12-28 lut |
| news_articles | 1 480 | 12-28 lut |
| sentiment_scores | 9 487 | 13-28 lut |
| alerts | 375 | 13-28 lut |

Po deduplikacji (identyczny tekst + ticker): **9 372 unikalnych rekordów**.

## 2. Klasyfikacja treści — co jest w bazie?

Przeanalizowałem **WSZYSTKIE** rekordy pod kątem zawartości informacyjnej (regexem po słowach kluczowych: earnings, FDA, analyst, legal, Medicare, insider, M&A itp.):

### Finnhub news (1 458 unikalnych)

| Kategoria | Rekordów | % | Avg długość | Avg |score| |
|-----------|----------|---|-------------|-------------|
| **FUNDAMENTAL** (earnings, FDA, analyst, legal, Medicare, M&A) | **1 080** | **74.1%** | 262 zn | 0.590 |
| TECHNICAL (support, RSI, chart) | 26 | 1.8% | 292 zn | 0.491 |
| NOISE (brak słów kluczowych) | 352 | 24.1% | 208 zn | 0.444 |

**Finnhub "noise" to NIE szum** — to artykuły ogólnorynkowe typu:
- "12 Health Care Stocks Moving In Thursday's Session" — ticker wspomniany w roundupie
- "Which S&P500 stocks are moving on Monday?" — generyczne przeglądy
- "Here is What to Know Beyond Why HIMS is a Trending Stock" — ogólne podsumowania

AI enrichment pomoże odfiltrować te generyczne roundupy od artykułów o konkretnych fundamentach.

### StockTwits (7 914 unikalnych)

| Kategoria | Rekordów | % | Avg długość | Avg |score| |
|-----------|----------|---|-------------|-------------|
| **FUNDAMENTAL** (earnings, FDA, analyst, legal, Medicare, M&A) | **1 595** | **20.2%** | 207 zn | 0.371 |
| TECHNICAL (RSI, support, squeeze, options) | 452 | 5.7% | 192 zn | 0.299 |
| **NOISE** (emocje, memy, spekulacje bez info) | **5 867** | **74.1%** | 83 zn | 0.222 |

**StockTwits noise (74%) to rzeczywiście bezwartościowy szum:**
- "$HIMS let pump this sht lmao"
- "$UNH friday run......"
- "$HIMS this hit $17.5 premarket 😂😂😂"
- "$HIMS what is the good buy price? I'm thinking $6"
- "$HIMS whenever you think it's gonna one thing it does the exact opposite"
- "$HIMS Absolute diarrhea fest in here good grief"

### Szczegółowa tematyka (teksty > 50 znaków, z nakładaniem kategorii)

| Temat | Finnhub | StockTwits | **Razem** |
|-------|---------|------------|-----------|
| **Earnings** (EPS, revenue, guidance, beat/miss) | 579 | 812 | **1 391** |
| **Analyst** (price target, upgrade, downgrade, rating) | 453 | 1 006 | **1 459** |
| **FDA/Drug** (FDA, GLP, semaglutide, Wegovy, clinical trial) | 228 | 257 | **485** |
| **Insider/M&A** (buyback, acquisition, CEO, stake) | — | — | **463** |
| **Legal/Regulatory** (lawsuit, DOJ, SEC, regulatory) | 192 | 253 | **445** |
| **Medicare/Insurance** (CMS, Medicaid, managed care) | 100 | 254 | **354** |
| **Technical trading** (RSI, support, squeeze, options) | 169 | 1 276 | **1 777** |
| **Emocjonalny szum** (🚀, moon, scam, garbage, lol) | 7 | 514 | **521** |

## 3. Parametry AI enrichment — ocena po analizie danych

### a) Relevance / Istotność — TAK, KLUCZOWE

**Problem**: Wiele artykułów Finnhub wspomina ticker pobocznie w roundupie rynkowym:
- "Sector Update: Health Care Stocks Decline Monday Afternoon" → wspomina MOH, ale artykuł o całym sektorze
- "12 Health Care Stocks Moving In Wednesday's Intraday Session" → generic list
- "Stocks Rise Pre-Bell Ahead of Key Jobs Report" → ticker w tle

**AI potrafi ocenić**: czy artykuł jest O tej spółce (relevance 0.8+) czy tylko ją wspomina (relevance 0.2).

**Szacunek**: Z 1 080 fundamentalnych Finnhub, ~30% to poboczne wzmianki → relevance odfiltruje ~300 rekordów, zostawiając ~750 prawdziwie istotnych.

### b) Temporal Signal — TAK, UŻYTECZNE

Wyraźne różnice w danych:
- **immediate**: "FDA warned against illegal copycat drugs" / "shares tumble after earnings"
- **short_term**: "BTIG downgraded to Neutral, citing weak Q1 guidance"
- **medium_term**: "Medicare Advantage rates nearly flat in 2027" / "Insulin Pump Market 2020 to 2035"

**Z 1 391 earnings-related** tekstów: większość to immediate (po wynikach) lub short_term (guidance).
**Z 354 Medicare/insurance**: większość to medium_term (propozycje CMS, zmiany stawek).
**Z 485 FDA/drug**: mix immediate (decyzja) i medium_term (trial results).

### c) Novelty / Nowość — TAK, BARDZO WAŻNE

**Problem widoczny w danych**: HIMS ma 5 238 analiz sentymentu. W dzień earnings (24 lut) — 1 392 rekordów. Ale informacja jest jedna: "Q4 beat, soft 2026 guidance, stock drops".

Konkretne powtórzenia tego samego:
1. "Hims & Hers beats on Q4 earnings, shares down" (Finnhub, -0.967)
2. "Hims & Hers Stock Drops. Why Earnings Are Underwhelming" (Finnhub, -0.965)
3. "Hims & Hers Falls Apart, Again" (Finnhub, -0.965)
4. "Hims & Hers Reports Mixed Q4 Earnings" (Finnhub, -0.943)
5. "$HIMS down after earnings" (StockTwits, -0.96)
6. ...i tak 190+ razy tego samego dnia

**Novelty pozwoli zredukować 195 rekordów HIMS 24 lut do ~10-15 unikalnych informacji:**
- Earnings beat (revenue $618M, EPS $1.55 vs $1.46)
- Soft Q1 guidance
- BTIG downgrade
- Citigroup maintains Sell, target $13.25
- Subscriber milestone 2.5M
- International expansion (Eucalyptus)
- SEC investigation
- NVO lawsuit update
- Stock -8.6% after-hours

### d) Source Authority — NIE WYMAGA AI, HARDCODE

Mapowanie statyczne per source (nie trzeba wysyłać do AI):

| Źródło | source_authority | Uzasadnienie |
|--------|-----------------|--------------|
| SEC EDGAR (8-K, 10-K) | 1.0 | Oficjalne filingi |
| SeekingAlpha | 0.6 | Analiza, ale czasem spekulatywna |
| Yahoo Finance | 0.5 | Agregator, mix jakości |
| Benzinga | 0.5 | Agregator newsów |
| ChartMill | 0.4 | Skaner techniczny |
| StockTwits (z declared Bullish/Bearish) | 0.2 | Opinia retail, deklaruje sentyment |
| StockTwits (bez declared sentiment) | 0.15 | Opinia retail, brak kontekstu |

### e) Catalyst Type — TAK, BARDZO UŻYTECZNE

Dane **idealnie** się kategoryzują na katalysatory. Rozkład w bazie:

| Catalyst | Przykład z bazy | Ile rekordów (Finnhub) |
|----------|-----------------|----------------------|
| **earnings** | "HIMS Q4 EPS Beats; Soft 2026 Outlook" | ~579 (41%) |
| **analyst** | "Citigroup Maintains Sell on HIMS, Lowers PT to $13.25" | ~453 (32%) |
| **fda** / **drug_approval** | "FDA Vows to Restrict Copycat GLP-1 Pill" | ~228 (16%) |
| **legal** | "Novo sues Hims & Hers after company launches $49 pill" | ~192 (14%) |
| **cms_rate** | "Medicare Advantage rates nearly flat in 2027" | ~100 (7%) |
| **insider** | "CEO sold large amount of stock at peak" | mało, ale silny sygnał |
| **ma** | "Eucalyptus acquisition, $200M incremental revenue" | kilka |
| **clinical_trial** | "Phase 2 Results with Encouraging Reductions" | kilka |

Healthcare-specific katalysatory **mają sens** — FDA, CMS, clinical trial to kluczowe eventy w tym sektorze.

### f) Confidence / Pewność — TAK, ALE TYLKO DLA STOCKTWITS

Finnhub news to w 95% fakty (raporty, komunikaty, wyniki). Confidence ~1.0 dla prawie wszystkich.

**StockTwits to mix:**
- FAKT: "$HIMS Revenue $618M for the quarter, +28% increase YoY" → confidence 1.0
- OPINIA: "this will go back to $40 in 3-6 months" → confidence 0.3
- SPEKULACJA: "the lawsuit will be dropped / settled for pennies" → confidence 0.2
- PLOTKA: "CEO engaged in pump & dump type tweet" → confidence 0.4

Confidence jest przydatne **głównie** do filtrowania StockTwits spekulacji od faktów.

## 4. CO WYSYŁAĆ do AI — rekomendacja finalna

### WYSYŁAĆ:

| Grupa | Rekordów | Tokenów (~) | Uzasadnienie |
|-------|----------|-------------|--------------|
| **Finnhub news > 100 zn** | **1 271** | **~88K** | 74% fundamentalne, profesjonalne źródła |
| **StockTwits FUNDAMENTAL > 80 zn** | **~1 500** | **~78K** | Posty z earnings, FDA, analyst info |
| **Razem** | **~2 770** | **~166K** | |

### NIE WYSYŁAĆ:

| Grupa | Rekordów | Powód |
|-------|----------|-------|
| StockTwits NOISE < 80 zn | ~5 000 | Szum, emocje, memy, zero info |
| StockTwits TECHNICAL | ~450 | RSI/MACD — FinBERT score wystarcza |
| Bardzo krótkie < 50 zn | ~2 800 | Brak kontekstu do analizy |
| Duplikaty | 115 | Identyczny tekst |

### Filtr SQL (gotowy do implementacji):

```sql
-- Rekordy do AI enrichment
SELECT DISTINCT ON (symbol, "rawText") *
FROM sentiment_scores
WHERE "rawText" IS NOT NULL
  AND (
    -- Finnhub news: wszystko > 100 znaków
    (source = 'FINNHUB' AND LENGTH("rawText") > 100)
    OR
    -- StockTwits: > 80 znaków + zawiera słowa kluczowe fundamentalne
    (source = 'STOCKTWITS' AND LENGTH("rawText") > 80 AND "rawText" ~*
     '(earnings|EPS|revenue|quarter|Q[1-4]|guidance|beat|miss|results|reported|FDA|drug|approval|GLP|semaglutide|Wegovy|Ozempic|clinical|trial|pharma|analyst|price target|upgrade|downgrade|maintains|rating|lawsuit|legal|sue|DOJ|SEC|investigation|regulatory|Medicare|Medicaid|CMS|insurance|Advantage|managed care|insider|buyback|acquisition|merger|dividend|patent)')
  );
```

## 5. Jakie parametry AI ma zwrócić — rekomendacja

### Parametry, które mają sens (na podstawie danych):

| Parametr | Sens? | Dlaczego |
|----------|-------|----------|
| **relevance** | TAK | ~30% Finnhub to roundupy z poboczną wzmianką tickera |
| **temporal_signal** | TAK | Wyraźne różnice: earnings=immediate, CMS=medium_term |
| **novelty** | TAK, KLUCZOWE | HIMS: 195 rekordów/dzień, ~10 unikalnych informacji |
| **catalyst_type** | TAK | Healthcare-specific: earnings/fda/analyst/legal/cms_rate/clinical_trial |
| **confidence** | TAK (głównie ST) | StockTwits: mix faktów, opinii i spekulacji |
| **source_authority** | NIE (hardcode) | Statyczne per source, nie wymaga AI |

### Przykładowy output AI per rekord:

```json
{
  "relevance": 0.95,
  "temporal_signal": "immediate",
  "novelty": 0.9,
  "catalyst_type": "earnings",
  "confidence": 1.0,
  "reasoning": "Direct Q4 earnings report: revenue $618M (+28% YoY), EPS beat by 6%. First report of these numbers."
}
```

### Batching

Wysyłać **per ticker-day** (max 20 tekstów per batch). AI widzi kontekst grupowy i może ocenić novelty (czy to nowa informacja vs powtórka). 257 grup ticker-day, średnio 8.9 rekordów/grupa.

## 6. Koszt

| Model | Input cost | Output cost | **Razem** |
|-------|-----------|-------------|-----------|
| **Haiku** ($0.25/$1.25 per 1M tokens) | ~$0.24 | ~$0.52 | **~$0.76** |
| Sonnet ($3/$15 per 1M tokens) | ~$2.88 | ~$6.23 | **~$9.11** |

**Rekomendacja: Haiku** — wystarczający do klasyfikacji, 12× tańszy niż Sonnet. Jeśli jakość nie satysfakcjonuje, upgrade do Sonnet.

## 7. Podsumowanie

Z **9 487 rekordów** w bazie:
- **~2 770 (29%)** ma sens wysyłać do AI enrichment
- **~6 700 (71%)** to szum, krótkie emocjonalne posty, techniczna analiza — FinBERT score wystarcza
- 5 parametrów AI ma sens (relevance, temporal, novelty, catalyst, confidence)
- 1 parametr (source_authority) → hardcode bez AI
- Koszt jednorazowy: **~$0.76 (Haiku)** za 16 dni danych
- Przy ciągłym przetwarzaniu: **~$1.50/miesiąc** na Haiku
