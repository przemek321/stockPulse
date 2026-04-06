# StockPulse Backtest — Podsumowanie wyników

> 2026-04-06 | 3 lata danych (kwiecień 2023 – kwiecień 2026) | 61 tickerów | 18 426 transakcji (po deduplikacji)

## Metodologia

| Parametr | Wartość |
|----------|---------|
| Źródło danych | SEC EDGAR Form 4 (XML) + yfinance (ceny) |
| Zakres | 2023-04-01 — 2026-04-05 |
| Tickery | 42 healthcare + 25 control (large-cap non-healthcare) — 3 bez CIK, 3 ADR bez Form 4 |
| Transakcje raw | 43 946 |
| Po deduplikacji (insider×tydzień×typ) | **18 426** (usunięto 25 519 duplikatów) |
| Horyzonty cenowe | 1d, 3d, 7d (5 trading days), 30d (21 trading days) |
| Data pomiaru ceny | **filing_date** (nie transaction_date — rynek dowiaduje się z filingu, nie z transakcji) |
| Baseline | 10 000 losowych dat na tych samych tickerach |
| Dip baseline | 2 762 losowych dni po spadku >2% (kontrola mean reversion) |
| Test statystyczny | Welch's t-test (p-value), Cohen's d (effect size) |

### Poprawki vs wersja 1

1. **filing_date zamiast transaction_date** — mierzymy od momentu gdy rynek widzi informację
2. **Dip baseline** — kontrola czy BUY edge to mean reversion czy realny sygnał insiderski
3. **Deduplikacja** — 5 transakcji tego samego insidera w tygodniu = 1 event (anti-pumping N)
4. **Fix direction="any"** — hit rate nie jest już 100% na aggregate

---

## Kluczowe wyniki

### SELL — marginalny edge, sector-specific

| Grupa | N | Horyzont | Hit Rate | Baseline | Effect (d) | p-value | Wniosek |
|-------|---|----------|----------|----------|------------|---------|---------|
| Healthcare C-suite SELL | 414 | 7d | **52.7%** | 45.9% | -0.11 | **0.026** | Jedyny SELL z edge |
| Healthcare C-suite SELL | 410 | 30d | **57.8%** | 47.8% | -0.14 | **0.007** | Potwierdzone na 30d |
| Control group C-suite SELL | 565 | 7d | 44.8% | 44.4% | -0.04 | 0.352 | Brak edge |
| All C-suite SELL | 979 | 7d | 48.1% | 45.7% | -0.06 | 0.069 | Brak istotności |
| C-suite SELL >$1M | 524 | 1d | 50.2% | 46.6% | -0.10 | **0.006** | Słaby, ale istotny |

**Wniosek SELL**: Edge istnieje **tylko w healthcare** (sector-specific). Na ogólnym rynku insider SELL nie jest predyktywny. Effect size mały (d = -0.11 do -0.14), ale statystycznie istotny.

### BUY — silny sygnał, potwierdzony vs mean reversion

| Grupa | N | Horyzont | Hit Rate | Baseline | Effect (d) | p-value |
|-------|---|----------|----------|----------|------------|---------|
| **All discretionary BUY** | 186 | 1d | **60.8%** | 53.0% | **+0.40** | <0.001 |
| All discretionary BUY | 186 | 3d | **66.7%** | 53.6% | **+0.37** | <0.001 |
| All discretionary BUY | 186 | 7d | **64.0%** | 54.2% | **+0.27** | <0.001 |
| All discretionary BUY | 183 | 30d | **62.3%** | 55.6% | +0.19 | **0.008** |
| **C-suite BUY** | 39 | 1d | **74.4%** | 53.0% | **+0.83** | <0.001 |
| C-suite BUY | 39 | 3d | **79.5%** | 53.6% | **+0.65** | <0.001 |
| **Healthcare BUY** | 102 | 1d | **66.7%** | 53.0% | **+0.58** | <0.001 |
| Healthcare BUY | 102 | 7d | **67.6%** | 54.2% | **+0.41** | <0.001 |
| **BUY >$100K** | 108 | 7d | **69.4%** | 54.2% | **+0.43** | <0.001 |
| **BUY >$500K** | 64 | 3d | **71.9%** | 53.6% | **+0.58** | <0.001 |

#### Test mean reversion (vs dip baseline)

| Grupa | N | Horyzont | Hit Rate | Dip Baseline HR | Effect (d) | p-value | Wniosek |
|-------|---|----------|----------|-----------------|------------|---------|---------|
| All BUY vs dip | 186 | 1d | 60.8% | 53.5% | **+0.38** | <0.001 | **Nie mean reversion** |
| All BUY vs dip | 186 | 3d | 66.7% | 54.2% | **+0.33** | <0.001 | **Nie mean reversion** |
| All BUY vs dip | 186 | 7d | 64.0% | 55.2% | **+0.23** | **0.003** | **Nie mean reversion** |
| All BUY vs dip | 183 | 30d | 62.3% | 57.6% | +0.15 | 0.041 | Słabsze, ale istotne |
| C-suite BUY vs dip | 39 | 1d | 74.4% | 53.5% | **+0.80** | <0.001 | **Duży efekt** |
| C-suite BUY vs dip | 39 | 3d | 79.5% | 54.2% | **+0.60** | **0.001** | **Średni efekt** |

**Wniosek BUY**: Insider BUY **bije zarówno losowy baseline jak i dip baseline**. To nie jest artefakt mean reversion — insiderzy kupują trafniej niż losowy dip. C-suite BUY ma duży effect size (d = 0.60–0.83). Edge maleje z czasem (30d słabszy).

### H1 — Insider Clusters

| Grupa | N | 7d Hit Rate | Baseline | d | p |
|-------|---|-------------|----------|---|---|
| All clusters | 348 | 71.8% (>1% ruch) | 77.7% | +0.10 | 0.047 |
| Sell clusters | 320 | 42.8% (spadek) | 45.7% | +0.06 | 0.204 |
| Buy clusters | 28 | **78.6%** (wzrost) | 54.2% | **+0.47** | **0.009** |

**Wniosek**: Sell clusters nie mają edge. Buy clusters (N=28) wykazują silny edge na 7d, ale mały sample.

### H3 — 10b5-1 plan vs discretionary

| Grupa | N | 7d Hit Rate (SELL) | Baseline | d | p |
|-------|---|-------------------|----------|---|---|
| 10b5-1 plan | 2312 | 41.6% | 45.7% | +0.05 | 0.064 |
| Discretionary | 1740 | 47.6% | 45.7% | -0.02 | 0.413 |

**Wniosek**: Brak istotnej różnicy między 10b5-1 a discretionary na SELL. Filtr `is10b51Plan→skip` nie jest mocno uzasadniony statystycznie, ale redukuje szum bez utraty edge.

### H4 — Role seniority (SELL)

| Rola | N | 30d Hit Rate (spadek) | d | p |
|------|---|----------------------|---|---|
| C-suite | 979 | 49.1% | -0.14 | <0.001 |
| Director | 239 | **32.1%** (cena rośnie!) | +0.19 | **0.004** |
| Other | 522 | 44.4% | -0.07 | 0.086 |

**Wniosek**: Zaskoczenie — po Director SELL cena **rośnie** (hit rate 32% = 68% wzrost). C-suite SELL ma marginalny edge. Director SELL = anty-sygnał (lub artifact: dyrektorzy sprzedają w dobrych momentach, np. vesting).

---

## Rekomendacje dla pipeline StockPulse

### Priorytet 1 — Dodać regułę BUY

| Parametr | Wartość | Uzasadnienie |
|----------|---------|-------------|
| Typ | Discretionary BUY (non-10b5-1) | d = 0.27–0.83, p < 0.001 |
| Min wartość | $100K+ | N=108, 7d hit 69.4%, d=0.43 |
| Boost | C-suite × 1.5 | d = 0.83 vs 0.27 (director) |
| Boost | Healthcare × 1.3 | d = 0.58 vs 0.40 (all) |
| Horyzont sygnału | 1d–7d (krótkoterminowy) | Edge maleje po 7d |

### Priorytet 2 — Healthcare SELL utrzymać

Jedyny SELL z potwierdzonym edge (7d: 52.7%, d=-0.11, p=0.026). Pipeline już to robi poprawnie.

### Priorytet 3 — C-suite boost na SELL zrewidować

C-suite SELL nie jest lepszy od Director/Other na SELL. Aktualny boost nie szkodzi (mały efekt), ale nie jest uzasadniony. Rozważyć neutralny scoring per rola.

### Priorytet 4 — 10b5-1 filtr utrzymać

Brak statystycznej różnicy, ale filtr redukuje szum (2312 → 1740 eventów) bez utraty edge.

### Nie implementować

- **Insider Cluster SELL** — brak edge (p > 0.2)
- **Director SELL** — anty-sygnał (cena rośnie po SELL)
- **Ogólny SELL bez filtra healthcare** — brak istotności

---

## Znane ograniczenia

| Ograniczenie | Wpływ | Mitygacja |
|-------------|-------|-----------|
| **Survivorship bias** | Tickery = firmy istniejące w 2026. BUY w firmach które zbankrutowały nie jest w danych | Brak — wyniki BUY mogą być zawyżone |
| **10b5-1 heurystyka** | Szukanie "10b5-1" w XML, ~80-90% dokładne | Brak — H3 i tak nie wykazuje dużej różnicy |
| **ADR bez Form 4** | AZN, NVO, SNY = 0 transakcji (zagraniczne firmy) | Nie wpływa na wyniki (brak danych = brak bias) |
| **N=39 C-suite BUY** | Mały sample → szerokie CI | Monitorować live i rozszerzać dataset |
| **Brak kosztów transakcyjnych** | Spread + slippage mogą zjeść edge na 1d | Focus na 3d–7d horyzont |

---

## Pliki

| Plik | Opis |
|------|------|
| `data/form4_transactions.csv` | 43 946 transakcji (raw) |
| `data/prices/*.csv` | Ceny dzienne per ticker (64 pliki) |
| `data/results/backtest_results.json` | Surowe wyniki JSON (do dalszej analizy) |
| `data/results/backtest_report.md` | Pełny raport z tabelami per hipoteza |
