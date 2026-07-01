# Backtest H7 — CLUSTER-BUY: podsumowanie wyników (2026-07-02)

> Pre-rejestracja: `doc/BACKTEST-H7-CLUSTER-BUY-KRYTERIA-2026-07-02.md`
> Skrypt: `scripts/backtest/backtest_h7_cluster_buy.py`
> Pełne wyniki: `scripts/backtest/data/results/h7_cluster_buy_results.json`
> **NIE nadpisuje** wyników V5 (`backtest_results.json`).

## Werdykt (wg pre-rejestracji)

| Scope | Rola | N klaster (7d) | N single | d (winsor, 7d) | p Welch (7d) | Werdykt |
|---|---|---|---|---|---|---|
| **healthcare** | **PRIMARY (decyzja)** | **9** | 52 | **+0.723** | 0.153 | **INSUFFICIENT_N** |
| full universe | secondary (robustness) | 15 | 125 | +0.494 | 0.217 | FAIL |

**PRIMARY = INSUFFICIENT_N** — klastrowych eventów healthcare jest 9 < 15 (próg pre-rejestracji).
Nie orzekamy istotności na primary. Kierunek efektu wyglądał na dodatni i niemały (d=+0.72 na 7d,
hit-rate 89% vs baseline 52%), ale **weryfikacja adwersaryjna go zdyskontowała — patrz sekcja
niżej: po scaleniu encji OSCR d spada do +0.25** (poniżej progu d≥0.3).

Na secondary (pełne uniwersum, N=15) efekt spada do d=+0.49 i p=0.217 → **FAIL** progu
istotności Bonferroni (α=0.05/7≈0.00714), mimo że d przekracza +0.3.

## ⚠️ Weryfikacja adwersaryjna (niezależny agent, 02.07) — KOREKTA

Wszystkie liczby decyzyjne odtworzone idealnie niezależną implementacją (N=9/52, d=+0.723,
p=0.153109, identyczne zbiory eventów). Pre-rejestracja potwierdzona (mtime kryteriów <
skryptu < wyników). ALE ręczna inspekcja 9 klastrów wykryła, że **klaster OSCR jest fikcyjny**:
„Kushner Joshua" i „Thrive Partners VII Growth GP, LLC" (fundusz Kushnera) **co-filowały TE SAME
zakupy** na dwóch równoległych Form 4 (identyczne shares/ceny/daty tx, accessions
0000950170-24-126664 vs -126662). Jeden decydent policzony jako „2 różnych insiderów" — a jego
+26.11% to największy dodatni zwrot w grupie klastrów (wartość $17.4M też podwójna, realnie ~$8.7M).
Systematyczny skan (symbol, tx_date, shares, price → ≥2 nazwy) potwierdza: to JEDYNY taki
przypadek w zbiorze; pozostałych 8 klastrów to autentycznie różne osoby.

**Po korekcie (scalenie encji OSCR):**

| Scope | N klaster | d (winsor, 7d) | p Welch | Werdykt |
|---|---|---|---|---|
| primary healthcare | **8** | **+0.253** (< progu 0.3) | 0.403 | INSUFFICIENT_N (bez zmian) |
| secondary full | 14 (< 15) | — | — | FAIL → **INSUFFICIENT_N** |

Pozostałe zastrzeżenia weryfikatora (bez wpływu na werdykt, do wiadomości przy re-run):
- Asymetryczna winsoryzacja: `_winsorize` z analyzer.py to no-op dla N<10 → grupa klastrów (N=9)
  NIE była winsoryzowana, single (N=52) tak; symetryczne surowe d=+0.614.
- Wzór pooled_sd: decyzja użyła wariantu V5 (pooling ważony, d=+0.723); literalny wzór z pliku
  kryteriów dałby +0.629 — wybrany wariant był korzystniejszy.
- Bonferroni α=0.05/7 (rodzina hipotez) łagodniejsze niż konwencja V5 (α/128 per liczba testów) —
  pre-rejestrowane, ale odnotowana zmiana konwencji.
- Entry = Close dnia filingu (dziedziczone z V5, symetryczne) — lekki same-day look-ahead.
- Definicja singla używa okna ±7d (informacja z przyszłości) — H7 nie mierzy inkrementu
  „czekania na drugiego insidera" względem reguły single-BUY live.
- **Przy forward-trackingu klastrów (PODD/SMMT/COR) stosować dedup encji powiązanych**
  (osoba + jej fundusz co-filing tych samych akcji; klucz: accession/shares/price/tx_date).
  Uwaga: SMMT 12.06 (Duggan + Zanganeh, 2× Co-CEO) to osobne osoby, ale blisko powiązani
  decydenci — sprawdzić accessions zanim policzy się to jako niezależny klaster.

## Zbiór danych

- CSV: `data/form4_transactions.csv`, 40 874 wierszy (nie 43 946 — to starszy odnośnik z pamięci),
  53 tickery.
- Po filtrze zepsutych dat + dedup per (symbol, insider, isoweek, typ): **16 651 wierszy**
  (usunięto 24 222 duplikaty).
- **Flaga `is_10b51_plan` = zawsze False** (per-transakcyjny parser nie wykrył planów) → filtr
  dyskrecjonalności to no-op, liczono na WSZYSTKICH BUY (kod P). Ograniczenie.
- **Brak benchmarku sektorowego** (XBI/IBB) w infrze V5 → alpha sektorowa niedostępna, tylko
  surowy zwrot 7d.
- **Eventów odrzuconych z braku cen: 0** (klaster i single — wszystkie miały dane cenowe).

## PRIMARY (healthcare) — direct comparison klaster vs single

| Horyzont | mean klaster | mean single | mediana klaster | mediana single | d (winsor) | d (raw) | p Welch |
|---|---|---|---|---|---|---|---|
| 1d | +5.03% | +0.84% | +3.29% | +0.69% | +1.097 | +0.803 | 0.096 |
| 3d | +6.23% | +1.89% | +3.23% | +1.24% | +0.830 | +0.681 | 0.127 |
| **7d** | **+6.92%** | **+2.27%** | +5.22% | +1.68% | **+0.723** | +0.614 | **0.153** |
| 30d | +3.06% | +5.26% | +5.22% | +3.33% | −0.182 | −0.194 | 0.584 |

Efekt (klaster > single) jest największy na krótkim horyzoncie i **zanika/odwraca się na 30d** —
spójne z tezą, że sygnał insiderski jest krótkoterminowy.

### Klaster BUY vs baseline (kontekst hit-rate, healthcare)

| Horyzont | N | avg zwrot | hit-rate | baseline hit | d vs baseline | p |
|---|---|---|---|---|---|---|
| 1d | 9 | +5.03% | 77.8% | 51.7% | +2.17 | 0.053 |
| 3d | 9 | +6.23% | 88.9% | 51.4% | +1.50 | 0.040 |
| 7d | 9 | +6.92% | 88.9% | 51.8% | +1.26 | 0.046 |
| 30d | 9 | +3.06% | 77.8% | 50.4% | +0.22 | 0.525 |

## 9 eventów klastrowych healthcare (transparentność N)

| Data | Ticker | #insiderów | C-suite | wartość | zwrot 7d |
|---|---|---|---|---|---|
| 2024-11-13 | CNC | 2 | tak | $1.25M | +1.83% |
| 2024-11-13 | OSCR ⚠️ FIKCYJNY | 2→1 | tak | $17.4M→$8.7M | +26.11% |
| 2024-12-17 | CNC | 5 | nie | $2.02M | +5.22% |
| 2025-02-21 | BMY | 2 | tak | $0.21M | +6.79% |
| 2025-03-04 | MRNA | 2 | tak | $4.20M | +11.16% |
| 2025-05-16 | UNH | 5 | tak | $31.6M | +1.25% |
| 2025-08-07 | VRTX | 2 | tak | $3.54M | +3.91% |
| 2025-08-12 | LLY | 8 | tak | $4.10M | +10.22% |
| 2026-02-26 | PODD | 2 | tak | $1.53M | −4.20% |

7 z 9 dodatnie na 7d (hit 89%). Jeden z eventów motywacyjnych — **PODD 2026-02-26** — złapany
przez definicję, ale jego okno backtestowe dało −4.2%. SMMT i COR (motywacja forward) są POZA
uniwersum backtestu (53 tickery) → backtest się o nich nie wypowiada.

## Wniosek

Hipoteza H7 **nie została potwierdzona** wg pre-rejestrowanych kryteriów: primary scope ma za
mało eventów (N=9<15 → po korekcie OSCR N=8, INSUFFICIENT_N), a robustness na pełnym uniwersum
nie przechodzi progu istotności. Po scaleniu fikcyjnego klastra OSCR sygnał kierunkowy jest
**słaby** (d=+0.25 < progu 0.3, p=0.40) — pierwotne „zachęcające d=+0.72" było artefaktem
duplikatu co-filingu. To NIE jest podstawa do włączenia reguły cluster-BUY na Telegram, ani do
traktowania kierunku jako obiecującego. Rozsądna droga: bierny forward-tracking klastrów
(z dedupem encji powiązanych!) i re-run wyłącznie gdy uzbiera się ≥15 CZYSTYCH eventów
klastrowych healthcare.
