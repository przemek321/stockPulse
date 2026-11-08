# Backtest horyzontów 30/60/90 dni — Form 4 BUY healthcare (08.11.2026)

**To NIE jest sygnał ani zmiana reguł gry.** Backtest historyczny 04.2023–11.2026 według kryteriów
pre-rejestrowanych w [TECZKA-HORYZONT-30-60-90-2026-11-08.md](TECZKA-HORYZONT-30-60-90-2026-11-08.md)
(sekcja „Poprawka planu po recenzji" + „Dane i moc testu" zapisane PRZED uruchomieniem).
Liczby w tabelach generuje skrypt (`scripts/backtest/data/results/horizon_tables.md` z `horizon_results.json`).

## Werdykt

**Test główny (G1 healthcare, epizody, 63 sesje ≈ 90 dni): POZYTYWNY** — wszystkie cztery warunki spełnione:
p permutacyjne < 0,05, średni NET > 0, mediana NET > 0, ten sam znak po usunięciu dowolnego tickera.

- Średni NET (zwrot − benchmark podsektora − 1 pp) **+12,85 pp**, mediana **+4,87 pp**, hit 62%, N = 47 epizodów,
  p = 0,0001 (obserwacja wyższa niż wszystkie 10 000 przesunięć kalendarza; rozkład zerowy: średnia −0,60, sd 4,70).
- Efekt **rośnie z horyzontem**: 7d mediana +0,36 pp (zgodne z produkcją — brak edge na 7 dniach) → 30d +1,04 →
  60d +5,22 → 90d +4,87 pp. Ta sama zależność na wspólnej próbie 47 epizodów.
- Drugorzędne (Holm, 8 testów): żaden nie przechodzi po korekcie (najniższe p Holm = 0,10 dla G1 × 30d) —
  podgrupy C-suite (N = 20–21) i ≥ $100K są za małe na samodzielny wniosek, kierunek ten sam.

**Ale:** rozkład ma bardzo gruby prawy ogon (HIMS 11.2024: +218,9 pp; OSCR 04.2026: +88,0 pp; HUM 02.2026:
+60,0 pp), więc średnia +12,85 pp to głównie ogon — realistyczny rząd wielkości to mediana, ok. **+5 pp na 3 miesiące
po koszcie**. Wynik z jednego okresu (2023–2026) na 28 tickerach z listy ułożonej w 2026 r.

## Testy odporności (DODATKOWE — nie były pre-rejestrowane)

Plik: `scripts/backtest/data/results/horizon_robustness.txt` (ta sama permutacja kalendarza, B = 10 000).

| G1, statystyka | 30d | 60d | 90d |
|---|---|---|---|
| mediana | +1,04 (p 0,044) | +5,22 (p 0,002) | +4,87 (p 0,018) |
| średnia bez 3 najlepszych epizodów | +1,92 (p 0,004) | +4,05 (p 0,002) | +5,39 (p 0,003) |
| średnia bez HIMS i OSCR (N = 43) | +1,43 (p 0,098) | +3,84 (p 0,058) | +6,82 (p 0,028) |
| średnia vs XBI (benchmark produkcji) | +1,98 (p 0,029) | +3,93 (p 0,029) | +8,08 (p 0,003) |

90d przeżywa każdy wariant; 30d nie przeżywa usunięcia HIMS i OSCR.

## Weryfikacja (wykonana przed raportem)

- **Ręczne przeliczenie 3 epizodów z surowych CSV** — zgodne co do 0,01 pp: HIMS (wejście 15.11.2024 open 21,33 →
  19.02.2025 close 68,74; XLV +2,33%; NET +218,87), OSCR (CEO Bertolini $11,9 mln po 11,92; wejście 14,34 —
  luka +20% — → 30,81; IHF +25,96%; NET +87,97), LLY (639,56 → wejście 624,10 → 931,56; XLV +12,52%; NET +35,74).
- Dane: 45 230 wierszy, 0 nieudanych filingów, liczności per ticker identyczne z niezależnym pobraniem bazowym;
  ceny 58 symboli bez luk względem kalendarza SPY; 98,5% cen transakcji z bazy produkcyjnej w dziennym zakresie
  yfinance; skoki > 50% (OSCR 03.2023, MRNA 08.2026) sprawdzone jako realne.
- Kod: 127 testów w `scripts/backtest/tests` przechodzi (77 nowych: 66 backtestu horyzontów + 11 fetchera), 7/7 celowych uszkodzeń logiki wykrytych.
- `acceptanceDateTime` z EDGAR zweryfikowany jako UTC (nagłówek .hdr.sgml); wariant wejścia tego samego dnia
  (3 epizody przed otwarciem) nie zmienia wyniku.

## Odkrycie przy czyszczeniu danych — backtest Sprint 15 był skażony

Z 951 wierszy BUY tylko 201 to zakup akcji własnej spółki. Pozostałe to spółka z uniwersum jako 10% owner CUDZYCH
akcji: BAC → fundusze zamknięte (PMF, NZF, NMCO…), GS → SG, a w healthcare GILD → Arcus (RCUS, $354 mln),
Assembly, Xilio, Kyverna, Allovir; AMGN → Neumora; LLY → Sagimet. Fetcher Sprint 15 nie sprawdzał emitenta, więc
te transakcje liczyły się jako „insider BUY" tickera (w starym pliku BAC miał 652 „BUY"). Do tego C-suite był
wykrywany podłańcuchem („CTO" ⊂ „DIRECTOR"). Wyniki BUY ze Sprint 15 — zwłaszcza kontrola i C-suite — należy
traktować jako nieważne; ten backtest je zastępuje.

## Ograniczenia

- **N = 47** epizodów w teście głównym; MDE (zapisane przed wynikiem) 11,5 pp — test wykrywa tylko duże efekty,
  a wynik zależy od kilku dużych ruchów.
- **Jeden reżim rynkowy** (2023–2026), 28 tickerów, lista z 2026 r. (spółki „głośne" w 2025–2026, np. HIMS, OSCR).
  Uniwersum nie było dobierane według skuteczności sygnału insiderskiego (powstało 02.2026 jako lista monitoringu,
  zawężone 04.2026 do pokrycia z produkcją), ale ma ryzyko „widoczności".
- Beta = 1 względem ETF podsektora; ETF-y (IHF, IHI, IBB, XLV) to przybliżenie.
- Wynik jest historyczny. Wejście na otwarciu D+1 jest realizowalne, ale trzymanie 3 miesięcy oznacza ekspozycję
  na pojedyncze spółki (rozrzut: od −33 do +219 pp).

## Co z tego wynika (zgodnie z teczką)

1. Hipoteza „edge insider BUY w healthcare jest w miesiącach, nie w 7 dniach" **przechodzi test historyczny** —
   i tłumaczy, dlaczego produkcja mierzona na 7 dniach go nie widzi.
2. Zgodnie z pre-rejestracją to **hipoteza do forward-testu, nie zmiana reguł gry**. Decyzja najwcześniej przy
   werdykcie #3 (01.02.2027). Naturalny krok: dodać do produkcji pomiar 30/60/90 dni (sloty price outcome kończą
   się na 7d, hard timeout 11d) — osobna teczka z kryteriami.
3. Pytanie „sektor czy sygnał" (kontrola: 90d mediana +2,51 pp vs SPY, N = 25, bez testu) rozstrzyga zadanie 2
   ([TECZKA-SEKTOR-VS-SYGNAL-2026-11-08.md](TECZKA-SEKTOR-VS-SYGNAL-2026-11-08.md)) — nie wyciągać wniosku z tej
   tabeli.

## Tabele (wygenerowane)

**Test główny G1_hc_all × 90d: POZYTYWNY** (warunki: p_lt_alpha=✅, mean_gt_0=✅, median_gt_0=✅, loto_same_sign=✅; reguła negatywna: CI95 hi < 3.0 pp, CI95 hi = +25.60)

| Grupa | Horyzont | N | śr NET | med NET | hit % | śr wins. | p perm | p Holm | CI95 śr NET | max ticker |
|---|---|---|---|---|---|---|---|---|---|---|
| G1_hc_all | 7d | 48 | +1.66 | +0.36 | 54 | +1.59 | — | — | — | PODD 17% |
| G1_hc_all | 30d | 48 | +4.07 | +1.04 | 52 | +3.94 | 0.0128 | 0.1024 | [+0.33; +9.64] | PODD 17% |
| G1_hc_all | 60d | 48 | +6.29 | +5.22 | 65 | +6.11 | 0.0297 | 0.1782 | [+1.22; +12.56] | PODD 17% |
| G1_hc_all | 90d | 47 | +12.85 | +4.87 | 62 | +11.67 | 0.0001 | — | [+3.45; +25.60] | PODD 15% |
| G2_hc_csuite | 7d | 21 | +1.66 | +0.77 | 57 | +1.61 | — | — | — | PODD 19% |
| G2_hc_csuite | 30d | 21 | +3.09 | +1.98 | 52 | +2.99 | 0.1166 | 0.2020 | [+0.09; +6.84] | PODD 19% |
| G2_hc_csuite | 60d | 21 | +6.91 | +6.73 | 67 | +6.70 | 0.0706 | 0.2020 | [+0.11; +15.24] | PODD 19% |
| G2_hc_csuite | 90d | 20 | +12.30 | +7.59 | 60 | +12.06 | 0.0539 | 0.2020 | [+1.31; +24.65] | PODD 15% |
| G3_hc_100k | 7d | 40 | +2.05 | +0.66 | 55 | +2.00 | — | — | — | PODD 15% |
| G3_hc_100k | 30d | 40 | +4.07 | +1.20 | 52 | +3.94 | 0.0247 | 0.1729 | [-0.28; +10.69] | PODD 15% |
| G3_hc_100k | 60d | 40 | +5.27 | +2.65 | 60 | +5.08 | 0.0407 | 0.2020 | [-0.48; +12.15] | PODD 15% |
| G3_hc_100k | 90d | 39 | +11.21 | +1.48 | 54 | +10.02 | 0.0404 | 0.2020 | [-0.31; +26.47] | BMY 13% |
| CTRL_info | 7d | 26 | -0.90 | +0.30 | 54 | -0.87 | — | — | — | CAT 23% |
| CTRL_info | 30d | 25 | +1.50 | +2.36 | 64 | +1.45 | — | — | — | CAT 24% |
| CTRL_info | 60d | 25 | +1.10 | -0.58 | 48 | +1.13 | — | — | — | CAT 24% |
| CTRL_info | 90d | 25 | +2.49 | +2.51 | 64 | +2.49 | — | — | — | CAT 24% |

Kolumny: N = epizody z pełnym horyzontem · NET w pp · p perm = permutacja kalendarza (tylko testowane kombinacje) ·
p Holm = korekta dla 8 testów drugorzędnych · CI95 = bootstrap klastrowy po tickerach · max ticker = największy
udział tickera (⚠ > 25%). CTRL_info liczona vs SPY, bez testu.

## Odtworzenie

```bash
cd scripts/backtest && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt yfinance==1.8.0 pytest
BT_END_DATE=2026-11-07 BT_TX_FILE=data/form4_transactions_v6.csv .venv/bin/python -c "from edgar_fetcher import fetch_all_form4; fetch_all_form4(True)"
.venv/bin/python horizon_backtest.py prices --end 2026-11-08
export BT_TX_FILE=data/form4_transactions_v6.csv
.venv/bin/python horizon_backtest.py validate && .venv/bin/python horizon_backtest.py mde && .venv/bin/python horizon_backtest.py run
.venv/bin/python -m pytest tests -q
```
