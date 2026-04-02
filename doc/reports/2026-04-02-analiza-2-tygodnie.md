# Pełna analiza StockPulse — 19.03–02.04.2026 (2 tygodnie)

**Data raportu**: 2026-04-02

## Dane w analizowanym okresie

| Tabela | Rekordy |
|--------|---------|
| Alerty | 965 |
| Sentiment scores | 6 411 |
| Insider trades | 76 |
| SEC filings (GPT) | 15 |
| Options flow | 653 |
| AI pipeline logs | 7 374 |

---

## 1. Globalna trafność alertów

**Hit rate kierunkowy (1d): 55,5%** (416/749 ocenionych) — lekko powyżej losowego 50%.

### Ranking reguł po trafności

| Reguła | Alerty | Hit rate | Avg ruch 1d |
|--------|--------|----------|-------------|
| **High Conviction Signal** | 24 | **60,0%** | 1,67% |
| **Urgent AI Signal** | 70 | **57,6%** | 1,96% |
| Sentiment Crash | 243 | 56,4% | 2,50% |
| Strong FinBERT Signal | 378 | 55,7% | 2,44% |
| 8-K Material Event | 10 | 55,6% | 2,39% |
| Unusual Options Activity | 107 | 52,5% | 2,05% |
| Correlated Signal | 108 | **brak danych** | — |

**Problem**: 108 alertów Correlated Signal + Form 4 Insider Signal **nie mają `priceAtAlert`** — niemierzalny hit rate.

### Ranking symboli po trafności (min. 5 alertów)

| Symbol | Hit rate | Alerty | Kierunek |
|--------|----------|--------|----------|
| **CNC** | **81,8%** | 23 | spadkowy trend |
| **MOH** | **80,0%** | 5 | — |
| **GSK** | **75,0%** | 8 | wzrostowy |
| **REGN** | **71,4%** | 9 | FDA catalyst |
| **GILD** | **68,2%** | 25 | wzrostowy |
| OSCR | 68,0% | 55 | spadkowy |
| ISRG | **10,0%** | 11 | katastrofa |
| MRNA | **32,3%** | 33 | słabo |

---

## 2. Najlepsze sygnały okresu (potwierdzone ceną)

### TOP 5 trafnych sygnałów

| # | Sygnał | Symbol | Data | Ruch | Co się stało |
|---|--------|--------|------|------|-------------|
| 1 | **GPT FDA conviction +1.296** | LLY | 01-02.04 | **+10,2% (3d)** | FDA approval Foundayo (orforglipron) — najsilniejszy sygnał w historii systemu |
| 2 | **INSIDER_PLUS_OPTIONS** | HIMS | 20.03 | **-10 do -12,5% (3d)** | CFO Okupe sprzedał 9 217 akcji + opcje bearish — potwierdzone spadkiem |
| 3 | **CEO SELL discretionary** | GILD | 27.03 | **-1,29% (1d/3d)** | CEO O'Day sprzedał 10 000 akcji za 1,37M — cena spadła i utrzymała się niżej |
| 4 | **8-K Leadership -1.2** | CERT | 31.03 | **-7,72% (1d)** | Odejście CEO bez następcy — rynek mocno ukarał |
| 5 | **AMGN regulatory -1.152** | AMGN | 31.03 | spadek | FDA: Tavneos → uszkodzenia wątroby, 76 zgonów |

### TOP 5 nietrafionych sygnałów

| # | Sygnał | Symbol | Predykcja | Realny ruch | Problem |
|---|--------|--------|-----------|-------------|---------|
| 1 | GPT Leadership -1.2 | TDOC | negatywny | **+5,84%** | Rynek odebrał odejście CEO jako pozytywne ("relief rally") |
| 2 | Sentiment Crash negative | HIMS | spadek | **+11,02%** | Kontradykcyjne alerty — system wysyłał bearish i bullish jednocześnie |
| 3 | Strong FinBERT positive | HIMS | wzrost | **-11,18%** | Sprzeczne kierunki w tym samym oknie czasowym |
| 4 | GPT insider -0.8 | GILD | spadek | **+3,05%** | CEO sell nie przełożył się na krótki termin |
| 5 | Options call 5032× spike | MRNA | wzrost | **spadek** | Mega spike ratio nie potwierdził się ceną |

---

## 3. Kluczowe wydarzenia rynkowe w okresie

### LLY — Foundayo FDA Approval (01.04.2026)
- **Najsilniejszy sygnał GPT ever**: conviction +1.296 (FDA, urgency HIGH)
- 112 alertów wygenerowanych, spike wolumenu do 160 wzmianek/dzień
- Options flow z PDUFA boost (jedyny ticker z pdufaBoosted=true)
- Cena: ~878 → ~967 USD (**+10,2% w 3 dni**)
- Pipeline PDUFA context działa doskonale

### Fala odejść CEO w healthcare (30-31.03)
- TDOC, THC, UHS, GDRX, CNC, CERT — 6 spółek z leadership change
- GPT nadał WSZYSTKIM conviction -1.2 (szablonowo)
- Realność: TDOC +5,84%, THC +1,04%, CERT -7,72%, UHS -2,72%
- **Hit rate leadership: 50%** — GPT nie różnicuje kontekstu

### Insiderzy — zero BUY w całym okresie
- 76 transakcji: SELL + GRANT + TAX + EXERCISE, **zero BUY**
- Największe SELL: BMY CFO 1,85M, GILD CEO 1,37M, VRTX CMO 1,05M
- GILD i HIMS SELL potwierdzone spadkami cen
- **Discretionary CEO/CFO sell = najlepszy leading indicator**

---

## 4. Szczegóły per moduł

### 4.1 Sentyment (6 411 rekordów)

- **StockTwits**: 5 247 wzmianek, 0 eskalacji GPT (zgodnie z projektem od 14.03)
- **Finnhub**: 1 114 wzmianek, 74,2% eskalowanych do GPT (827 wywołań, ~59/dzień roboczy)
- **HIMS dominuje** wolumenem StockTwits: 2 362 wzmianki (~45%), stale ujemny sentyment (-0.031)
- GPT skutecznie filtruje szum: LLY artykuł o Katarze → conviction=0, ISRG +0.249 → -0.001

Największe zmiany sentymentu między tygodniami:
- **MOH**: +0.093 → -0.099 (zwrot negatywny, shift -0.191)
- **GILD**: +0.245 → +0.063 (ochłodzenie, shift -0.182)
- **CNC**: -0.095 → +0.024 (poprawa, shift +0.119)

Najsilniejsze sygnały GPT:
| Symbol | Conviction | Catalyst | Data | Opis |
|--------|-----------|----------|------|------|
| LLY | +1.296 | fda | 02.04 | FDA approval Foundayo (orforglipron) |
| BIIB | +1.152 | fda | 30.03 | FDA high dose SPINRAZA |
| AMGN | -1.152 | regulatory | 31.03 | Tavneos liver injuries |
| VRTX | +1.152 | fda | 01.04 | ALYFTREK label extension |
| REGN | +1.152 | fda | 02.04 | EYLEA HD approved |
| LLY | +1.008 | ma | 31.03 | Przejęcie Centessa $7.8B |
| BIIB | +1.008 | ma | 31.03 | Przejęcie Apellis $5.6B |

### 4.2 SEC Filings GPT (15 filingów)

- **Form 4**: 5 filingów, wszystkie ujemne (avg conviction -0.66) — same sprzedaże insiderów
- **8-K**: 10 filingów, 7 leadership changes (avg conviction -1.0), 2 pozytywne (BIIB contract, CYH M&A)
- **Hit rate GPT SEC: 36,4%** (4/11) — poniżej losowego, ale mała próbka zdominowana przez leadership
- GPT szablonowo: -1.2 dla WSZYSTKICH odejść CEO bez różnicowania kontekstu

### 4.3 Insider Trades (76 transakcji)

- **Zero BUY** — insiderzy healthcare nie kupują (ostrożność: Medicaid cuts, cła)
- Największe discretionary SELL:
  - BMY CFO Elkins: 30 000 akcji, 1,85M USD (01.04)
  - GILD CEO O'Day: 10 000 akcji, 1,37M USD (27.03) — **potwierdzone spadkiem -1,29%**
  - VRTX CMO Bozic: 2 329 akcji, 1,05M USD (27.03)
  - HIMS CFO Okupe: 9 217 akcji, 219k USD (20.03) — **potwierdzone spadkiem -5 do -12,5%**
- **Wszystkie 76 transakcji discretionary** (is10b51Plan=false)
- CVS 31.03: masowy grant equity dla 8 C-suite (70,6M) — standardowe wynagrodzenie, nie sygnał

### 4.4 Correlated Signals (108 alertów)

| Wzorzec | Alerty | Symbole | Ocena |
|---------|--------|---------|-------|
| INSIDER_PLUS_OPTIONS | 41 | BMY, GILD, HIMS | **najsilniejszy** — HIMS -12,5% potwierdzone |
| ESCALATING_SIGNAL | 34 | 15 symboli | średni — zmienny jakościowo |
| MULTI_SOURCE_CONVERGENCE | 16 | ABBV, BMY, CVS, GILD | dobry — solidny ale mało liczny |
| FILING_CONFIRMS_NEWS | 9 | CNC, GDRX, TDOC | dobry — precyzyjny niszowy |
| INSIDER_CLUSTER | 4 | HIMS, THC, VRTX | za mała próbka |
| INSIDER_PLUS_8K | 3 | VRTX | za mała próbka |

**Brak `priceAtAlert`** uniemożliwia automatyczny pomiar hit rate.

### 4.5 Options Flow (653 rekordów)

- 28 tickerów, 10 sesji giełdowych, dominacja byków (60% call / 40% put)
- **LLY**: jedyny ticker z PDUFA boost (8 rekordów), conviction 0.8063 — sygnał 6 dni przed FDA approval
- **HIMS**: najwyższy conviction 0.8208 (30.03), 46 rekordów, mixed signals
- **MRNA**: anomalny spike ratio 5032× (27.03) — false positive, cena spadła
- **OSCR**: 96 rekordów, idealnie zbalansowane (48 bycze / 48 niedźwiedzie) — sygnał niepewny
- **DXCM**: jedyny ticker z wyłącznie niedźwiedzimi sygnałami

### 4.6 PDUFA Catalysts

| Symbol | Lek | Data PDUFA | Alerty | Status |
|--------|-----|-----------|--------|--------|
| **LLY** | Orforglipron | 25.03 | **112** | Zatwierdzony — cena +10,2% |
| GSK | Linerixibat | 24.03 | 10 | Monitorowany |
| BMY | Deucravacitinib | 06.03 | — | Przeszły |
| DNLI | Tividenofusp alfa | 05.04 | 0 | Nadchodzący |
| RYTM, RCKT, LNTH | — | 20-29.03 | 0 | Brak pokrycia w systemie |

---

## 5. Co działa, co nie

### Działa dobrze
- **GPT FDA catalyst**: trafnie wykrywa zatwierdzenia FDA z conviction > 1.0
- **GPT filtrowanie szumu**: artykuły sektorowe → conviction=0 (poprawnie odrzucane)
- **StockTwits FinBERT-only**: 5 247 wzmianek, 0 eskalacji GPT — oszczędność zgodna z projektem
- **INSIDER_PLUS_OPTIONS**: najsilniejszy wieloźródłowy sygnał (HIMS -12,5%)
- **PDUFA boost**: LLY sygnał opcyjny 6 dni przed approval
- **Discretionary CEO/CFO SELL**: najlepszy leading indicator krótkoterminowy

### Wymaga poprawy
- **`priceAtAlert` = NULL** dla Correlated Signal, Form 4, 8-K — 120+ alertów niemierzalnych
- **GPT Leadership szablonowy**: -1.2 bez różnicowania (TDOC +5,84% vs CERT -7,72%)
- **HIMS kontradykcyjne alerty**: positive + negative w tym samym oknie
- **ISRG hit rate 10%**: błędna klasyfikacja stable-growth jako negative
- **MRNA spike ratio 5032× = false positive**: ekstremalny spike bez potwierdzenia ceną
- **ESCALATING_SIGNAL z catalyst_type=unknown**: niski sygnał/szum
- **Hit rate GPT SEC filings: 36,4%** — poniżej losowego (mała próbka)

---

## 6. Rekomendacje zmian (priorytet)

| # | Zmiana | Wpływ |
|---|--------|-------|
| 1 | **Dodać `priceAtAlert` do Correlated Signal / Form 4 / 8-K** | Mierzalność 120+ alertów/2tyg |
| 2 | **GPT leadership differentiation**: voluntary vs fired, następca, kontekst | Fix 50% miss rate na leadership |
| 3 | **Filtr sprzeczności**: blokada positive+negative dla tego samego tickera w oknie <6h | Eliminacja szumu HIMS |
| 4 | **ISRG: wyłączyć Sentiment Crash** lub bias correction dla stable-growth | Fix 10% hit rate |
| 5 | **ESCALATING_SIGNAL: ignorować catalyst_type=unknown** | Mniejszy szum |
| 6 | **Options flow: cap na spike_ratio** (np. >1000× → flaga podejrzane) | Eliminacja false positives |
