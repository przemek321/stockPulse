# Backtest H7 — CLUSTER-BUY: pre-rejestracja kryteriów (2026-07-02)

> **PRE-REJESTRACJA.** Ten plik zapisany ZANIM policzono jakąkolwiek statystykę hipotezy H7.
> Fiksuje regułę decyzyjną, żeby wynik nie mógł być naginany post-hoc. Metodyka i konwencje
> odziedziczone z backtestu V5 (`scripts/backtest/analyzer.py`, commit f69cfa8) i ściągi
> `doc/STOCKPULSE-CHEATSHEET-2026-04-17.md` (źródło prawdy dla H1-H6, Bonferroni, metryk).

## Kontekst i motywacja

INSIDER_CLUSTER był w V4/V5 testowany głównie jako SELL (brak edge → TASK-09 wyłączyło
detekcję cluster BUY). Kierunek **BUY nigdy nie był testowany jako osobna hipoteza z entry
w momencie drugiego BUY** (V5 `cluster_buy_vs_single_buy` kotwiczył entry na OSTATNIEJ dacie
klastra i dawał p>0.37, ale to nie jest reguła live). Forward 2026 dostarczył przykłady:

- **PODD 03.06** — 2 różnych Directors, ~$897K, ten sam dzień
- **SMMT 12.06** — 2 Co-CEO, ~$100M (spoza uniwersum backtestu)
- **COR 18-22.06** — 2 Directors, ~$1.25M, 4 dni (spoza uniwersum backtestu)

H7 sprawdza, czy **klaster ≥2 różnych insiderów BUY w 7 dniach** daje statystyczną przewagę
zwrotu forward 7d nad **pojedynczym dyskrecjonalnym BUY** — z entry kotwiczonym tak, jak
strzelałaby reguła live (moment drugiego BUY).

## H7 — sformułowanie hipotezy

**H7:** Tickery z klastrem **≥2 dyskrecjonalnych BUY od ≥2 RÓŻNYCH insiderów** w oknie
**7 dni kalendarzowych** mają wyższy zwrot forward **7d** niż pojedyncze dyskrecjonalne BUY
(BUY bez innego BUY innego insidera w oknie ±7 dni kalendarzowych).

- H0: brak różnicy zwrotu 7d między klastrem a single BUY (d ≤ 0).
- H1 (alt): klaster > single (d > 0).

## Definicje operacyjne (fiksowane)

### Zakres (scope)
- **PRIMARY (decyzja):** uniwersum **healthcare** (`HEALTHCARE_TICKERS`, 28 tickerów z
  `config.py`) — spójne z V5 H1/H5, gdzie udokumentowany jest edge BUY (V5 7d d=+0.92 C-suite),
  i zgodne z produkcyjnym uniwersum delivery.
- **SECONDARY (robustness, nie-decyzyjne):** pełne uniwersum backtestu (healthcare + control,
  53 tickery). Raportowane dla kontekstu, NIE wchodzi do reguły PASS/FAIL.

### Filtry transakcji (spójne z V5 `run_analysis`)
1. Filtr dat: `transaction_date` i `filing_date` matchują `^20\d{2}-` (odsiew zepsutych dat SEC).
2. Deduplikacja per `(symbol, insider_name, isoweek, transaction_type)` — zostaje transakcja
   o największym `total_value` (zapobiega pompowaniu N przez wewnątrz-tickerowe korelacje).
3. Tylko `transaction_type == "BUY"`.
4. `is_10b51_plan == False` (dyskrecjonalne). **OGRANICZENIE — patrz niżej.**

### Event klastra (entry live-accurate)
- Per symbol, dyskrecjonalne BUY sortowane rosnąco po `filing_date`.
- Okno kotwiczone na pierwszym BUY: `[data_i, data_i + 7 dni kalendarzowych]`.
- Klaster = w tym oknie występują **≥2 RÓŻNI insiderzy** (`insider_name`).
- **Entry (moment eventu) = `filing_date` BUY, przy którym pojawia się DRUGI RÓŻNY insider**
  (moment, w którym reguła live wykryłaby klaster). NIE ostatnia data klastra (to różnica
  vs V5 `cluster_buy_vs_single_buy`).
- **Nakładające się klastry = 1 event:** po zarejestrowaniu klastra przeskakujemy pointer za
  wszystkie transakcje okna (greedy jump), nie multiplikujemy par insiderów.

### Event single BUY (grupa porównawcza)
- Dyskrecjonalny BUY, dla którego **NIE ma** innego dyskrecjonalnego BUY **innego insidera**
  w oknie **±7 dni kalendarzowych** (przed lub po). Entry = jego `filing_date`.

### Zwroty (spójne z V5)
- Entry price = `Close` pierwszego dnia handlowego `>= filing_date` (`get_price_at_date` offset 0).
- Zwrot horyzontu = `(future_close - entry_close) / entry_close * 100`.
- **Horyzont primary = 7d = 5 dni handlowych** (`HORIZONS["7d"]=5` w `config.py`).
- Raportowane też 1d/3d/30d (=1/3/21 dni handl.) dla kontekstu.
- Źródło cen: cache yfinance `data/prices/*.csv` (`Close`, auto_adjust=True).

### Metryki i testy statystyczne
- **Metryka decyzyjna:** Cohen's d klaster vs single (direct) na horyzoncie 7d, gdzie
  `d = (mean_cluster - mean_single) / pooled_sd`, pooled_sd = sqrt((var_c+var_s)/2), var ddof=1,
  winsoryzacja 1% (identycznie jak V5 `_cohens_d` / `_direct_cluster_vs_single`).
  **d>0 = klaster ma wyższy zwrot niż single.**
- **Test istotności:** Welch's t-test (`equal_var=False`) klaster vs single, dwustronny.
- **Hit-rate:** BUY → hit = zwrot > 0. Raportowany dla klastra i single + baseline hit-rate.
- **Baseline (kontekst):** `_compute_baseline` V5 (losowe daty na tych samych tickerach) —
  do hit-rate i d vs baseline. NIE jest metryką decyzyjną (decyzja = cluster vs single direct).
- **Alpha sektorowa:** NIEDOSTĘPNA w infrastrukturze V5 (`analyzer.py` nie ma benchmarku XBI/IBB;
  brak pliku XBI/IBB w `data/prices/`). Raportujemy surowy zwrot + baseline. Ograniczenie.

## Reguła decyzyjna (rodzina k=7: H1-H6 + H7, Bonferroni α=0.05/7 ≈ 0.007143)

Decyzja na PRIMARY scope (healthcare), horyzont 7d:

- **PASS** ⇔ `p_Welch < 0.007143` **ORAZ** `d ≥ +0.3` (klaster vs single).
- **INSUFFICIENT_N** ⇔ liczba eventów klastrowych `< 15` (nadrzędne — raportujemy opisowo,
  bez werdyktu istotności).
- **FAIL** ⇔ w każdym innym przypadku (N≥15, ale nie spełniono progu p i/lub d).

Kolejność ewaluacji: najpierw INSUFFICIENT_N (N<15), potem PASS, inaczej FAIL.

## Ograniczenia zadeklarowane z góry

1. **Flaga 10b5-1 = zawsze False.** W zamrożonym `form4_transactions.csv` (40 874 wierszy)
   kolumna `is_10b51_plan` ma wyłącznie `False` — per-transakcyjny parser Pythona nie znalazł
   żadnego planu (zgodne z V5 H3 "10b5-1 N=0"). Filtr dyskrecjonalności jest więc de facto
   no-op: **liczymy na WSZYSTKICH BUY (kod P).** Odnotowane jako ograniczenie zgodnie z KROK 2.
2. **Brak alphy sektorowej** (brak benchmarku XBI/IBB w infrze V5) — tylko surowy zwrot 7d.
3. **Uniwersum backtestu** = 53 tickery zamrożonego CSV (nie 61). SMMT i COR (motywacja forward)
   są POZA uniwersum — backtest nie może się o nich wypowiedzieć. PODD jest w uniwersum.
4. **Mała próbka BUY** (healthcare disc BUY = 127 wierszy pre-dedup) → realne ryzyko
   INSUFFICIENT_N na klastrach. To jest właśnie sytuacja, którą próg N<15 ma uczciwie wychwycić.
5. **N klastrów po greedy-collapse** może być niski; Cohen's d przy N<30 niestabilne (ostrożna
   interpretacja per ściąga sekcja 2).

## Artefakty
- Skrypt: `scripts/backtest/backtest_h7_cluster_buy.py`
- Wyniki JSON: `scripts/backtest/data/results/h7_cluster_buy_results.json`
- Podsumowanie MD: `scripts/backtest/data/results/h7_cluster_buy_summary.md`
- Wyniki V5 (NIE nadpisywane): `scripts/backtest/data/results/backtest_results.json`
