# StockPulse — Raport Tygodniowy

**Okres**: 7-13 marca 2026
**Wygenerowany**: 13 marca 2026, 23:00 UTC
**Środowisko**: Jetson Orin NX (aarch64), CUDA, FinBERT na GPU

---

## Podsumowanie Wykonawcze

System StockPulse przepracował pełny tydzień operacyjny z **zerową liczbą błędów systemowych** (36 315 operacji, 100% success rate). Przetworzono **9 028 sygnałów sentymentu**, wygenerowano **131 alertów** (100% dostarczonych przez Telegram) na **24 tickerach**. Hit rate kierunkowy systemu wynosi **55.4% (1d)** i **59.3% (3d)**, co jest powyżej poziomu losowego, ale z istotnym potencjałem do poprawy.

Kluczowe wydarzenie tygodnia: **HIMS +57.7%** po ogłoszeniu współpracy z Novo Nordisk — system trafnie wychwycił sygnał i wygenerował alerty przed rajdem. Drugi wyróżnik: **CNC -17.1%** (8-K Material Event) — precyzyjny alert negatywny.

### Kluczowe metryki tygodnia

| Metryka | Wartość |
|---------|---------|
| Sygnały sentymentu | 9 028 |
| Eskalacje do GPT (Tier 1+2) | 3 772 (41.8%) |
| Alerty Telegram | 131 (100% delivered) |
| Unikalne tickery w alertach | 24 |
| SEC filings zebrane | 68 |
| Insider trades | 283 |
| Artykuły newsowe | 724 |
| Raw mentions (StockTwits) | 11 789 |
| Hit rate 1d | 55.43% |
| Hit rate 3d | 59.32% |
| Błędy systemowe | 0 |
| Błędy AI pipeline | 1 (timeout Azure VM) |
| Uptime kolektorów | 100% |

---

## 1. Pipeline Sentymentu i AI

### 1.1 Wolumen i rozkład

Łącznie **9 028 rekordów** sentiment_scores:

| Źródło | Model | Ilość | Udział |
|--------|-------|-------|--------|
| STOCKTWITS | finbert | 5 066 | 56.1% |
| STOCKTWITS | finbert+gpt-4o-mini | 3 312 | 36.7% |
| FINNHUB | finbert+gpt-4o-mini | 460 | 5.1% |
| FINNHUB | finbert | 190 | 2.1% |

**41.8%** sygnałów przeszło przez 2-etapowy pipeline (FinBERT → GPT), reszta zakończyła na FinBERT (Tier 3 lub SKIPPED_SHORT).

### 1.2 Tier Breakdown (AI Pipeline)

| Tier | Status | Ilość | Avg FinBERT (ms) | Avg Azure (ms) |
|------|--------|-------|------------------|-----------------|
| Tier 1 (silne) | AI_ESCALATED | 1 511 | 46 | 2 383 |
| Tier 1 (silne) | AI_FAILED | 1 | 59 | 30 005 |
| Tier 2 (średnie) | AI_ESCALATED | 2 260 | 46 | 2 203 |
| Tier 3 (słabe) | FINBERT_ONLY | 5 255 | 43 | — |
| — | SKIPPED_SHORT | 1 804 | — | — |

- **FinBERT**: stabilne ~43-46ms na GPU Orin
- **Azure OpenAI**: stabilne ~2.2-2.4s (akceptowalne)
- **Success rate AI**: 3 771/3 772 = **99.97%** (1 failure — timeout 30s)

### 1.3 Jakość sygnałów per Tier

| Tier | Ilość | Avg Relevance | Avg Novelty | Avg AI Confidence |
|------|-------|---------------|-------------|-------------------|
| Tier 1 | 1 512 | 0.3678 | 0.2669 | 0.4213 |
| Tier 2 | 2 260 | 0.2227 | 0.2074 | 0.2963 |

Tier 1 ma wyraźnie wyższe metryki jakości: **+65% relevance**, **+29% novelty**, **+42% confidence** vs Tier 2. Tier-based eskalacja działa zgodnie z założeniami.

### 1.4 Dzienny rozkład sentymentu

| Dzień | Sygnały | Avg FinBERT | Avg Conviction | Avg EffectiveScore | Strong+ | Strong- |
|-------|---------|-------------|----------------|--------------------|---------|---------|
| 08.03 (sob) | 40 | -0.0558 | 0.0003 | 0.0001 | 0 | 0 |
| 09.03 (ndz) | 2 746 | 0.0134 | 0.0176 | 0.0138 | 5 | 0 |
| 10.03 (pon) | 1 916 | 0.0480 | 0.0232 | 0.0199 | 2 | 0 |
| 11.03 (wt) | 1 809 | 0.0108 | 0.0104 | 0.0131 | 1 | 0 |
| 12.03 (śr) | 1 428 | 0.0148 | 0.0140 | 0.0138 | 1 | 0 |
| 13.03 (pt) | 1 089 | -0.0052 | 0.0040 | 0.0097 | 0 | 0 |

- **9 sygnałów strong positive** (effectiveScore > 0.3), **0 strong negative** w całym tygodniu
- Sentyment generalnie neutralny z lekkim pozytywnym bias
- Szczytowa aktywność w niedzielę (2 746) — spekulacje przed otwarciem rynku + news HIMS/Novo

### 1.5 Rozkład catalyst_type (GPT)

| Catalyst Type | Ilość | Avg Conviction | Avg EffectiveScore |
|---------------|-------|----------------|--------------------|
| other | 3 373 | 0.0082 | 0.0041 |
| analyst | 108 | 0.0627 | 0.0314 |
| clinical_trial | 78 | **0.1611** | **0.0806** |
| fda | 57 | 0.0968 | 0.0484 |
| ma (M&A) | 40 | 0.1232 | 0.0616 |
| earnings | 39 | 0.0004 | 0.0002 |
| regulatory | 34 | 0.0011 | 0.0005 |
| legal | 21 | -0.0332 | -0.0166 |
| insider | 18 | 0.0021 | 0.0010 |
| fda\|clinical_trial | 1 | **0.7560** | **0.3780** |

**Najsilniejsze katalizatory**: clinical_trial (avg conviction 0.16) i M&A (0.12). "other" dominuje wolumenowo (89.4%) ale jest niemal neutralne. Legal jedyny negatywny (-0.03).

---

## 2. Alerty Telegram

### 2.1 Podsumowanie

| Metryka | Wartość |
|---------|---------|
| Łączna liczba alertów | 131 |
| Dostarczonych | 131 (100%) |
| Unikalne tickery | 24 |
| Unikalne reguły | 10 (z 18 aktywnych) |
| Alertów HIGH | 120 (91.6%) |
| Alertów CRITICAL | 11 (8.4%) |
| Alertów MEDIUM/LOW | 0 |

### 2.2 Alerty dziennie

| Dzień | Alerty | Tickery | HIGH | CRITICAL |
|-------|--------|---------|------|----------|
| 07.03 (pt) | 1 | 1 | 0 | 1 |
| 08.03 (sob) | 1 | 1 | 1 | 0 |
| 09.03 (ndz) | **39** | 11 | 36 | 3 |
| 10.03 (pon) | 33 | 14 | 31 | 2 |
| 11.03 (wt) | 24 | 10 | 22 | 2 |
| 12.03 (śr) | 22 | 8 | 20 | 2 |
| 13.03 (pt) | 11 | 7 | 10 | 1 |

Szczyt 9 marca (39 alertów) — news HIMS/Novo Nordisk. Trend spadkowy w tygodniu.

### 2.3 Reguły alertów — aktywność

| Reguła | Priority | Alerty | Tickery | Hit Rate 1d |
|--------|----------|--------|---------|-------------|
| Urgent AI Signal | HIGH | 89 | 21 | 51.3% |
| 8-K Material Event | HIGH | 9 | 9 | **85.7%** |
| Correlated Signal | HIGH | 9 | 3 | — |
| Bullish Signal Override | HIGH | 6 | 3 | **80.0%** |
| Form 4 Insider Signal | HIGH | 6 | 6 | — |
| Insider Trade Large | CRITICAL | 6 | 6 | 50.0% |
| Correlated Signal | CRITICAL | 2 | 2 | — |
| Strong FinBERT Signal | HIGH | 1 | 1 | — |
| 8-K Material Event GPT | CRITICAL | 1 | 1 | — |
| Sentiment Crash | CRITICAL | 1 | 1 | — |
| 8-K Earnings Miss | CRITICAL | 1 | 1 | — |

**Najlepsza reguła**: 8-K Material Event — **85.7% hit rate** (6/7 trafnych) z avg 4.68% ruchem cenowym.

**8 z 18 reguł (44%) nieaktywnych** w tym tygodniu: CMS Regulatory Event, 8-K Bankruptcy, 8-K Leadership Change, Bearish Signal Override, Cross-Sector Correlation, High Conviction Signal, Mention Volume Spike, Earnings Date Approaching.

### 2.4 Top tickery wg alertów

| # | Ticker | Alerty | HIGH | CRITICAL | Reguły | Catalyst Types |
|---|--------|--------|------|----------|--------|----------------|
| 1 | **HIMS** | 31 | 31 | 0 | 4 reguły | 7 typów catalyst |
| 2 | **VRTX** | 14 | 13 | 1 | 3 reguły | clinical_trial, fda, insider |
| 3 | **BMY** | 11 | 11 | 0 | 2 reguły | clinical_trial, fda, earnings |
| 4 | **LLY** | 9 | 9 | 0 | 2 reguły | fda |
| 5 | **ISRG** | 8 | 7 | 1 | 3 reguły | fda, insider, ma |
| 6 | UHS | 7 | 7 | 0 | 3 reguły | FILING_CONFIRMS_NEWS, ma |
| 7 | VEEV | 6 | 5 | 1 | 4 reguły | INSIDER_CLUSTER, insider, ma |
| 8 | CNC | 5 | 5 | 0 | 2 reguły | other, regulatory |
| 9 | TDOC | 4 | 3 | 1 | 3 reguły | analyst, earnings, insider |
| 10 | THC | 4 | 1 | **3** | 4 reguły | INSIDER_CLUSTER, insider |

### 2.5 Rozkład kierunku alertów

| Kierunek | Ilość | Udział |
|----------|-------|--------|
| Positive (bullish) | 77 | 58.8% |
| Negative (bearish) | 33 | 25.2% |
| Brak kierunku | 21 | 16.0% |

### 2.6 Analiza throttlingu — najczęstsze kombinacje

| Ticker | Reguła | Catalyst | Ilość | Okres |
|--------|--------|----------|-------|-------|
| HIMS | Urgent AI Signal | other | **15** | 4 dni |
| VRTX | Urgent AI Signal | clinical_trial | 10 | 2 dni |
| LLY | Urgent AI Signal | fda | 8 | 3 dni |
| BMY | Urgent AI Signal | clinical_trial | 5 | 2 dni |
| HIMS | Bullish Signal Override | other | 4 | 2 dni |
| HIMS | Correlated Signal | FILING_CONFIRMS_NEWS | 4 | 2 dni |

**Wniosek**: Throttling 60 min dla Urgent AI Signal jest za niski na gorące tematy. HIMS generuje ~3.75 alertów/dzień tego samego typu.

---

## 3. Trafność Systemu (Price Outcome)

### 3.1 Kompletność danych cenowych

| Metryka | Ilość | Pokrycie |
|---------|-------|----------|
| Alerty z priceAtAlert | 110 | 83.97% |
| Z ceną 1h | 105 | 80.15% |
| Z ceną 4h | 104 | 79.39% |
| Z ceną 1d | 92 | 70.23% |
| Z ceną 3d | 59 | 45.04% |
| priceOutcomeDone | 59 | 45.04% |

21 alertów (16%) nie ma ceny w momencie alertu — wysłane poza godzinami NYSE lub problem z Finnhub API.

### 3.2 Overall Hit Rate

| Horyzont | Trafne | Total | Hit Rate |
|----------|--------|-------|----------|
| **1 dzień** | 51 | 92 | **55.43%** |
| **3 dni** | 35 | 59 | **59.32%** |

System jest lepszy niż rzut monetą, z poprawą w dłuższym horyzoncie. Katalizatory wykrywane przez system potrzebują czasu na „przerobienie" przez rynek.

### 3.3 Hit rate per kierunek

| Kierunek | Hit Rate 1d | Hit Rate 3d |
|----------|-------------|-------------|
| Positive (bullish) | 52.1% | 55.1% |
| **Negative (bearish)** | **66.7%** | **80.0%** |

**Alerty negatywne są znacząco trafniejsze** — 80% trafność w 3d. System lepiej identyfikuje zagrożenia niż okazje.

### 3.4 Średni ruch ceny po alertach

| Kierunek | Avg 1h | Avg 4h | Avg 1d | Avg 3d |
|----------|--------|--------|--------|--------|
| Positive | +3.25% | +3.97% | +4.84% | **+7.38%** |
| Negative | -2.72% | -2.84% | -2.03% | **-3.54%** |

**Oba kierunki zgodne z prognozą** — kluczowy sygnał, że system wychwytuje realne katalizatory.

### 3.5 Trafność per ticker (min. 2 alerty, 14 dni)

| Ticker | Alerty | Avg 1d % | Avg 3d % | Kierunek | Ocena |
|--------|--------|----------|----------|----------|-------|
| **HIMS** | 23 | **+14.29%** | **+21.64%** | positive | TRAFNE |
| **CNC** | 4 | **-6.91%** | **-19.48%** | negative | TRAFNE |
| HUM | 2 | -3.27% | -5.84% | negative | TRAFNE |
| VRTX | 12 | +1.86% | +0.44% | positive | TRAFNE (słabe) |
| ELV | 2 | +1.55% | +4.78% | negative | BŁĘDNE |
| UHS | 4 | +1.43% | +2.15% | positive | TRAFNE (słabe) |
| VEEV | 2 | -1.32% | -6.58% | negative | TRAFNE |
| TDOC | 2 | -1.17% | -4.85% | positive | BŁĘDNE |
| LLY | 7 | -0.23% | -0.78% | positive | BŁĘDNE (marginalnie) |
| BMY | 10 | -0.13% | -1.98% | positive | BŁĘDNE |

### 3.6 Największe ruchy cen po alertach

| # | Ticker | Reguła | Kierunek | Cena alertu | Ruch 1d | Ruch 3d |
|---|--------|--------|----------|-------------|---------|---------|
| 1 | **HIMS** | Urgent AI Signal | positive | $15.74 | **+57.69%** | **+61.63%** |
| 2 | HIMS | Bullish Signal Override | positive | $15.74 | +57.69% | +61.63% |
| 3 | HIMS | Urgent AI Signal | positive | $22.86 | +18.11% | +4.20% |
| 4 | **CNC** | 8-K Material Event | negative | $43.32 | **-17.06%** | **-19.48%** |
| 5 | VRTX | Urgent AI Signal | positive | $460.87 | +7.25% | +4.26% |

---

## 4. SEC Filings i Insider Trades

### 4.1 SEC Filings — podsumowanie

| Metryka | Wartość |
|---------|---------|
| Filings zebrane | 68 |
| Przeanalizowane GPT | 13 (19.1%) |
| Z priceImpactDirection | 13 |
| Unikalne tickery | 21 |

| Form Type | Ilość | GPT Coverage |
|-----------|-------|--------------|
| Form 4 (insider) | 56 | 6 (10.7%) |
| 8-K (material event) | 9 | **7 (77.8%)** |
| Form 3 | 2 | 0 |
| 10-K | 1 | 0 |

### 4.2 Najsilniejsze sygnały z GPT SEC

| Ticker | Form | Conviction | Catalyst | Price Impact | Confidence |
|--------|------|------------|----------|--------------|------------|
| **HCAT** | 8-K | **+1.5** | earnings | positive/high | 0.9 |
| **HUM** | 8-K | **+1.0** | contract | positive/high | 0.8 |
| VRTX | Form 4 | +0.9 | insider | negative/med | 0.7 |
| ISRG | Form 4 | +0.9 | insider | negative/med | 0.7 |
| **THC** | Form 4 | **-0.9** | insider | negative/med | 0.7 |
| **VEEV** | Form 4 | **-0.8** | insider | negative/med | 0.7 |

### 4.3 Price Impact Direction (SEC GPT)

| Kierunek | Ilość | Udział |
|----------|-------|--------|
| Negative | 6 | 46.2% |
| Neutral | 5 | 38.5% |
| Positive | 2 | 15.4% |

Przewaga sygnałów negatywnych — głównie insider selling/tax z Form 4.

### 4.4 Insider Trades — podsumowanie

| Metryka | Wartość |
|---------|---------|
| Łączna liczba transakcji | 283 |
| Unikalne tickery | 16 |
| Łączna wartość | **$181.1 mln** |
| Średnia wartość | $639.9 tys. |

| Typ transakcji | Ilość | Udział |
|----------------|-------|--------|
| EXERCISE (realizacja opcji) | 110 | 38.9% |
| GRANT (przyznanie) | 66 | 23.3% |
| TAX (zwrot na podatek) | 60 | 21.2% |
| OTHER | 35 | 12.4% |
| **SELL (open-market)** | **12** | **4.2%** |
| BUY (open-market) | 0 | 0% |

**12 transakcji SELL, 0 BUY** — wyłącznie sprzedaż open-market, brak zakupów insiderskich. Dominują EXERCISE/TAX (sezon vestingowy). **Wszystkie 12 SELL to discretionary (is10b5-1Plan = false)** — realny sygnał bearish, nie automatyczny plan.

Kluczowe SELL (discretionary):

| Ticker | Insider | Rola | Akcje | Wartość | Data |
|--------|---------|------|-------|---------|------|
| VRTX | McKechnie Duncan | EVP, CCO | 2 633 | $1.31M | 11.03 |
| THC | Arnst Thomas W | EVP, CAO & GC | 8 000 (2×) | $1.91M | 09.03 |
| ELV | Kendrick Charles | EVP, President Commercial | 3 196 | $911K | 06.03 |
| VEEV | Schwenger Thomas | President & CCO | 1 000 | $200K | 05.03 |
| TDOC | Divita Charles III | CEO | 27 731 | $152K | 11.03 |

### 4.5 Top insider trades wg wartości

| Ticker | Insider | Rola | Typ | Wartość |
|--------|---------|------|-----|---------|
| AMGN | Bradway Robert A | CEO | TAX | **$32.0 mln** |
| UHS | Miller Alan B | Exec. Chairman | TAX | $21.7 mln |
| AMGN | Bradway Robert A | CEO | EXERCISE | $18.7 mln |
| UHS | Miller Marc D | CEO | TAX | $16.4 mln |
| UHS | Filton Steve | CFO | TAX | $13.8 mln |

**Anomalie**:
- **BMY**: 168 transakcji insiderskich — niezwykle dużo, sugeruje masowy vesting event
- **UHS insider cluster**: CEO + Exec. Chairman + CFO wykonują masowe EXERCISE + TAX 10-12 marca za >$100 mln — CorrelationService poprawnie wykrył INSIDER_CLUSTER

---

## 5. Dane Źródłowe i Kolektory

### 5.1 Wolumeny per źródło

| Źródło | Typ | Zebrano | Unikalne tickery |
|--------|-----|---------|------------------|
| StockTwits | Raw mentions | 11 789 | 34 |
| Finnhub (Yahoo, Benzinga, SeekingAlpha, CNBC, ChartMill, Fintel) | News articles | 724 | 29 |
| SEC EDGAR | Filings | 68 | 21 |
| PDUFA.bio | Catalysts | 0 (nowych) | — |
| Reddit | Mentions | 0 (nieaktywny) | — |

### 5.2 Social Media Buzz — Top tickery StockTwits

| # | Ticker | Mentions | Udział |
|---|--------|----------|--------|
| 1 | **HIMS** | 9 699 | **82.3%** |
| 2 | UNH | 334 | 2.8% |
| 3 | TDOC | 299 | 2.5% |
| 4 | LLY | 181 | 1.5% |
| 5 | MRNA | 156 | 1.3% |
| 6 | CNC | 115 | 1.0% |
| 7 | VRTX | 105 | 0.9% |
| 8 | DXCM | 101 | 0.9% |
| 9 | HUM | 98 | 0.8% |
| 10 | OSCR | 86 | 0.7% |

**Ekstremalnie skośny rozkład** — HIMS = 82.3% całego social media buzz.

### 5.3 StockTwits Sentiment

| Oznaczenie | Ilość | Udział |
|------------|-------|--------|
| Bullish | 5 531 | 46.9% |
| Bez oznaczenia | 5 486 | 46.5% |
| Bearish | 772 | 6.6% |

**Stosunek Bull/Bear: 7.2:1** — silna przewaga byczego sentymentu.

### 5.4 News Sentiment per źródło

| Źródło | Artykuły | Avg Sentiment |
|--------|----------|---------------|
| Yahoo | 460 | +0.192 |
| Benzinga | 133 | +0.184 |
| SeekingAlpha | 69 | +0.094 |
| ChartMill | 33 | +0.209 |
| **CNBC** | 22 | **-0.146** |
| Fintel | 7 | +0.079 |

CNBC jedyne źródło z negatywnym sentymentem.

### 5.5 News Sentiment per ticker (top)

| Ticker | Artykuły | Avg Sentiment | Ocena |
|--------|----------|---------------|-------|
| BMY | 36 | **+0.450** | Bardzo pozytywny |
| AMGN | 17 | +0.403 | Pozytywny |
| GILD | 18 | +0.400 | Pozytywny |
| ABBV | 38 | +0.371 | Pozytywny |
| VRTX | 58 | +0.343 | Pozytywny |
| HIMS | 128 | +0.233 | Lekko pozytywny |
| LLY | 106 | +0.156 | Lekko pozytywny |
| **MRNA** | 21 | **-0.313** | Negatywny |
| **CNC** | 19 | **-0.302** | Negatywny |
| **PODD** | 20 | **-0.179** | Negatywny |

### 5.6 Profil aktywności (godzinowy, UTC)

```
Aktywność StockTwits (UTC):
05:00-07:00  ▏  ~150/h   (noc US)
08:00-12:00  ██  ~300/h   (pre-market)
13:00-15:00  █████  ~1200/h  (otwarcie NYSE — szczyt)
16:00-18:00  ███  ~700/h   (sesja)
19:00        ████  ~880/h   (popołudniowy handel)
21:00-23:00  ▎  ~200/h   (after hours)
```

### 5.7 PDUFA Catalysts — nadchodzące

| Data | Ticker | Lek | Wskazanie |
|------|--------|-----|-----------|
| 20.03 | RYTM | Imcivree | Hypothalamic Obesity |
| 24.03 | GSK | Linerixibat | Cholestatic Pruritus (PBC) |
| **25.03** | **LLY** | **Orforglipron** | **Type 2 Diabetes** |
| 28.03 | RCKT | Kresladi | LAD-I |
| 29.03 | LNTH | Ga68-edotreotide | GEP-NETs Imaging |
| 05.04 | DNLI | Tividenofusp alfa | MPS-IIIA |

**LLY Orforglipron (25.03)** — potencjalnie najważniejsze wydarzenie: doustny GLP-1 agonista dla cukrzycy T2. System już generuje alerty FDA na LLY (8 alertów w tym tygodniu).

---

## 6. Korelacje i Wzorce

### 6.1 Aktywność CorrelationService

| Metryka | Wartość |
|---------|---------|
| Sygnały zapisane | 118 |
| Detekcje wzorców | 108 |
| Alerty Correlated Signal | 11 (9 HIGH + 2 CRITICAL) |

### 6.2 Wykryte wzorce korelacji

| Wzorzec | Ticker | Opis |
|---------|--------|------|
| FILING_CONFIRMS_NEWS | HIMS (×4), UHS (×2) | 8-K potwierdza wcześniejszy news w oknie 48h |
| INSIDER_CLUSTER | VEEV, THC | Klaster transakcji insiderskich w 7 dni |
| INSIDER_PLUS_8K | ELV | Insider trade + 8-K w oknie 24h |
| ESCALATING_SIGNAL | HIMS | Eskalujący sygnał w 72h |

---

## 7. Zdrowie Systemu

### 7.1 Uptime i błędy

| Komponent | Operacje | Błędy | Uptime |
|-----------|----------|-------|--------|
| System logs (wszystkie) | 36 315 | **0** | **100%** |
| AI Pipeline | 10 831 | 1 (timeout) | 99.99% |
| Kolektory (wszystkie) | 3 412 runs | **0** | **100%** |
| Telegram | 193 msgs | 0 | 100% |

### 7.2 Performance kolektorów

| Kolektor | Uruchomienia | Avg czas | Items/run | Total items |
|----------|-------------|----------|-----------|-------------|
| STOCKTWITS | 2 015 | 87.6s | 5.8 | 11 758 |
| FINNHUB | 1 008 | 58.3s | 0.7 | 723 |
| SEC_EDGAR | 337 | 17.2s | 0.2 | 68 |
| PDUFA_BIO | 52 | 0.6s | 0.0 | 0 |

### 7.3 BullMQ Queues (Redis)

| Kolejka | Wait | Active | Completed | Failed |
|---------|------|--------|-----------|--------|
| sentiment-analysis | 0 | 0 | 100 | **500** |

**500 failed jobów w Redis** — wymaga przeglądu. Mogą to być stare joby lub timeout Azure VM.

### 7.4 Rozmiar bazy danych

| Tabela | Rozmiar | Wierszy |
|--------|---------|---------|
| system_logs | 37 MB | 36 316 |
| ai_pipeline_logs | 13 MB | 10 834 |
| sentiment_scores | 11 MB | 9 029 |
| raw_mentions | 7.6 MB | 24 507 |
| news_articles | 1.7 MB | 3 027 |
| collection_logs | 1.2 MB | 13 558 |
| **Łącznie** | **~73 MB** | — |

### 7.5 Totale systemu (all time)

| Tabela | Rekordów |
|--------|----------|
| system_logs | 36 318 |
| raw_mentions | 24 507 |
| collection_logs | 13 558 |
| ai_pipeline_logs | 10 832 |
| sentiment_scores | 9 029 |
| news_articles | 3 027 |
| insider_trades | 1 792 |
| sec_filings | 785 |
| alerts | 676 |
| pdufa_catalysts | 19 |

---

## 8. Top 10 Najsilniejszych Sygnałów Tygodnia

| # | Ticker | EffectiveScore | FinBERT | GPT Conviction | Catalyst | Źródło | Wydarzenie |
|---|--------|----------------|---------|----------------|----------|--------|------------|
| 1 | **UNH** | **+0.618** | 0.618/0.794 | — (fallback) | — | FINNHUB | UNH rośnie wbrew spadkom rynku |
| 2 | **GILD** | **+0.504** | 0.856/0.865 | 1.008 | M&A | FINNHUB | Przejęcie Arcellx za $7.8 mld |
| 3 | **BMY** | **+0.432** | 0.935/0.951 | 0.864 | FDA | FINNHUB | FDA approval — Sotyktu label expansion |
| 4 | BMY | +0.378 | 0.832/0.841 | 0.756 | fda\|clinical | FINNHUB | Pipeline update — TYK2 + CELMoD |
| 5 | BMY | +0.378 | 0.408/0.536 | 0.756 | clinical_trial | FINNHUB | Phase 3 SUCCESSOR-2 pozytywne wyniki |
| 6 | **HIMS** | **+0.360** | 0.836/0.904 | 0.720 | other | FINNHUB | HIMS surge po deal z Novo Nordisk |
| 7 | HIMS | +0.324 | 0.926/0.953 | 0.648 | other | FINNHUB | Novo Nordisk deal — stock soars |
| 8 | HIMS | +0.324 | 0.560/0.738 | 0.648 | other | FINNHUB | Novo deal ends legal feud |
| 9 | HIMS | +0.303 | 0.928/0.946 | 0.605 | other | FINNHUB | HIMS +44% na wiadomości o deal |
| 10 | HIMS | +0.284 | 0.932/0.954 | 0.567 | other | FINNHUB | Why HIMS stock is up today |

**Wszystkie z FINNHUB** (artykuły newsowe). BMY 3× (FDA + clinical), HIMS 5× (Novo deal). UNH #1 to Strong FinBERT Signal fallback (brak GPT).

---

## 9. Wnioski i Rekomendacje

### 9.1 Co działa dobrze

1. **Stabilność systemu** — 0 błędów, 100% uptime kolektorów, 99.97% success rate AI pipeline
2. **8-K Material Event** — najlepsza reguła (85.7% hit rate), system dobrze wychwytuje material events
3. **Alerty negatywne** — 80% trafność w 3d, system skutecznie identyfikuje zagrożenia
4. **HIMS catch** — system precyzyjnie wychwycił rajd +57.7% generując alerty przed ruchem
5. **CNC catch** — trafny alert negative przed spadkiem -17.1%
6. **CorrelationService** — wykrywa realne wzorce (FILING_CONFIRMS_NEWS, INSIDER_CLUSTER)
7. **Tier-based eskalacja** — Tier 1 ma +65% wyższą relevance niż Tier 2

### 9.2 Co wymaga poprawy

1. **Hit rate positive alertów (52.1% 1d)** — ledwie powyżej losowego, wymaga kalibracji conviction thresholds
2. **Throttling Urgent AI Signal** — 60 min za niski na gorące tematy (HIMS: 15 alertów same'go typu w 4 dni)
3. **Dominacja HIMS (82% wzmianek)** — skośny rozkład zaburza ogólne metryki, warto rozważyć normalizację
4. **catalyst_type "other" (89.4%)** — zbyt wiele sygnałów nie ma przypisanego konkretnego katalizatora
5. **BMY/LLY/ABBV — positive alerty, ale cena spada** — fałszywe sygnały w dużych capach
6. **500 failed jobów BullMQ** — wymagają przeglądu i ewentualnego czyszczenia
7. **Reddit nieaktywny** — brak danych z drugiego kanału social media
8. **21 alertów bez priceAtAlert** — luka w trackingu cen (poza godzinami NYSE?)
9. **PDUFA outcomes puste** — brak outcome/odin_tier dla przeszłych eventów BMY (06.03)

### 9.3 Rekomendacje na kolejny tydzień

| Priorytet | Akcja | Uzasadnienie |
|-----------|-------|--------------|
| **WYSOKI** | Podnieść throttle Urgent AI Signal do 120-180 min | Redukcja szumu (15 HIMS alertów same'go typu) |
| **WYSOKI** | Monitorować LLY przed PDUFA 25.03 (Orforglipron) | Potencjalnie najważniejszy katalizator — doustny GLP-1 |
| ŚREDNI | Zbadać i wyczyścić 500 failed jobów BullMQ | Porządek w kolejkach |
| ŚREDNI | Poprawić klasyfikację catalyst_type | 89.4% "other" jest zbyt dużo |
| ŚREDNI | Kalibacja positive conviction — podnieść MIN_CONVICTION | Hit rate 52% jest słaby |
| NISKI | Reaktywować Reddit kolektor lub usunąć z health check | Status "degraded" jest mylący |
| NISKI | Uzupełnić PDUFA outcomes dla przeszłych eventów | Brak danych outcome dla BMY (06.03) |

---

## 10. Podsumowanie Finansowe — Kluczowe Wydarzenie Tygodnia

### HIMS & Hers Health (HIMS) — Deal z Novo Nordisk

- **Wydarzenie**: Novo Nordisk ogłosił dystrybucję leków na odchudzanie przez platformę HIMS, co zakończyło spór prawny między firmami
- **Reakcja rynku**: +57.7% w 1 dzień ($15.74 → $24.82), +61.6% w 3 dni
- **Detekcja systemu**: Pierwszy alert 09.03 o 10:20 UTC, łącznie 31 alertów w tygodniu
- **Reguły aktywowane**: Urgent AI Signal, Bullish Signal Override, Correlated Signal (FILING_CONFIRMS_NEWS), 8-K Material Event
- **Ocena**: System **prawidłowo** wychwycił sygnał z wieloma potwierdzeniami (multi-source convergence)

### Inne istotne ruchy

| Ticker | Ruch | Kontekst |
|--------|------|----------|
| CNC | -19.5% (3d) | 8-K Material Event — spadek członkostwa ACA |
| GILD | pozytywny sygnał | Przejęcie Arcellx za $7.8 mld |
| BMY | 3× FDA/clinical | Sotyktu label expansion + Phase 3 SUCCESSOR-2 |
| PODD | negatywny | Wycofanie Omnipod 5 — 18 zgłoszeń działań niepożądanych |
| HCAT | -15% | Mieszane Q4, prognoza Q1 poniżej oczekiwań |

---

*Raport wygenerowany automatycznie z bazy danych StockPulse. Dane za okres 7-13 marca 2026.*
