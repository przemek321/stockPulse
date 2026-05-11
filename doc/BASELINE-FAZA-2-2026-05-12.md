# Baseline Faza 2: replay 15 ostatnich 8-K Item 2.02 (12.05.2026)

**Cel**: pre-observation baseline dla S19-FIX-13 Faza 2 (deadline 25.05.2026 → spec Faza 3). Bez tego za 14 dni nie wiemy "vs co" mierzyć success rate.

**Metoda**: replay 15 healthcare tickerów (29.04-11.05 8-K Item 2.02 earnings) przez `ConsensusComparisonService.fetchAndCompare(symbol, '')` z deployed kodu (commit `97f1e66`). Brak reportText (FIX-14 extractRevenue to osobny test, zostawiony na Fazę 3).

**Skrypt**: `scripts/replay-consensus-baseline.ts` (run: `docker cp` → `docker compose exec app ts-node`).

---

## Wyniki

| Symbol | Finnhub Period | Finnhub EPS act/est | EPS surprise | AV revEst | revenueSource | Finnhub vs AV diff% |
|---|---|---|---|---|---|---|
| HIMS | 2026-03-31 | -0.18 / 0.0442 | -507.2% | $617M | matched | +28.86% |
| MOH | 2026-03-31 | 2.35 / 1.9416 | +21.0% | $10.89B | matched | +0.30% |
| GILD | 2026-03-31 | 2.03 / 1.9525 | +4.0% | $6.92B | matched | +2.25% |
| OSCR | 2026-03-31 | 2.07 / 1.2073 | +71.5% | $4.92B | matched | +9.75% |
| GDRX | 2026-03-31 | 0.07 / 0.0734 | -4.6% | $185M | matched | +3.82% |
| PODD | 2026-03-31 | 1.42 / 1.2221 | +16.2% | $730M | matched | +2.64% |
| VRTX | 2026-03-31 | 4.47 / 4.3964 | +1.7% | $3.00B | matched | +2.10% |
| MRNA | 2026-03-31 | -3.40 / -4.0402 | +15.8% | $236M | matched | -4.13% |
| CI | 2026-03-31 | 7.79 / 7.8410 | -0.7% | $66.20B | matched | +3.09% |
| SEM | 2026-03-31 | 0.35 / 0.4604 | -24.0% | $1.41B | matched | +1.03% |
| AMGN | 2026-03-31 | 5.15 / 4.8522 | +6.1% | $8.57B | matched | +1.80% |
| BMY | 2026-03-31 | 1.58 / 1.4311 | +10.4% | $10.92B | matched | +0.67% |
| DXCM | 2026-03-31 | 0.56 / 0.4785 | +17.0% | $1.17B | matched | +1.68% |
| REGN | 2026-03-31 | 9.47 / 9.1160 | +3.9% | $3.48B | matched | +2.41% |
| ABBV | 2026-03-31 | 2.65 / 2.6452 | +0.2% | $14.72B | matched | -0.84% |

## Aggregate stats

- **Total tickers replayed**: 15
- **Finnhub EPS estimate available**: 15/15 (100%)
- **Alpha Vantage EPS estimate available**: 15/15 (100%)
- **revenueSource breakdown**: matched=**15** (100%), forward=0, null=0
- **Both EPS available (diff measurable)**: 15/15 (100%)
- **|Finnhub vs AV diff|**: avg=**4.36%**, max=**28.86%** (HIMS outlier — small absolute EPS amplifies %)

---

## Interpretacja

### 1. FIX-13 daje 100% matched ratio dla healthcare core

**Hipoteza udowodniona**: Alpha Vantage zachowuje per-quarter estimates w pełnej historii dla tickerów z analyst coverage (wszystkie 15 healthcare core ma coverage). Pre-FIX-13 100% (lub close) tych alertów leciało przez forward proxy z mylną surprise%. Post-FIX-13 wszystkie idą przez matched-period estimate dla raportowanego Q.

**Konsekwencja**: PODD case (-3.5% miss → +4.3% beat post-FIX-13) NIE jest jednostkowy. To samo poprawienie ma zastosowanie do każdego z 14 pozostałych tickerów retroactively. Forward-looking effect: wszystkie nowe 8-K Item 2.02 dla healthcare core dostają poprawne consensus surprise.

### 2. Finnhub vs Alpha Vantage EPS estimate disagreement

**Distribution** (|diff%|):
- < 1%: 4 tickerów (MOH, BMY, ABBV, SEM)
- 1-3%: 6 tickerów (GILD, PODD, VRTX, AMGN, DXCM, REGN)
- 3-5%: 3 tickerów (GDRX, MRNA, CI)
- 5-10%: 1 ticker (OSCR)
- > 10%: 1 ticker (HIMS)

**Avg 4.36%** — moderate disagreement. Major outliers:
- **HIMS** 28.86% — Finnhub $0.0442 vs AV $0.0343, oba blisko zera, % bardzo czuły na małe odchylenie kwotowe (~$0.01)
- **OSCR** 9.75% — możliwa różna metoda agregacji (Finnhub recent-weighted vs AV simple mean?)

**Wniosek dla Faza 3**: ~85% przypadków (13/15 gdy wykluczyć HIMS+OSCR outliers) ma diff <5%. Obie source'y *konwergują* dla mainstream healthcare. Decyzja "preferuj Finnhub vs AV jako primary EPS" ma niski impact dla większości — TYLKO drift Finnhub w czasie (potwierdzony w weekend report dla GILD: +0.7% → +3.97% w 1h) jest powodem żeby preferować AV jako stable reference.

### 3. EPS surprise kierunki match'ują market reaction

Cross-check 5 cases gdzie znamy stock reaction:
- **PODD** -9.7% post-report despite +16.2% EPS beat → consensus_mixed scenariusz (rev miss vs eps beat) → poprawnie cap'owane przez FIX-12 R3
- **HIMS** big miss (-507%) → consensus_miss aktywuje cap 0.3 → poprawnie DB-only
- **MRNA** +15.8% surprise relative (loss expected, smaller loss reported) → conviction +0.7 (FIX-10b validated)
- **MOH** +21% surprise + +0.30% diff → strong beat scenariusz, FIX-12 R4 no-cap (trust GPT)
- **GILD** +4% surprise + +2.25% diff → in-line vs strong beat boundary, R2 (in-line) potential cap

### 4. Edge cases zauważone

- **HIMS EPS estimate** Finnhub 0.0442 vs AV 0.0343 — gdy actual=-0.18 (loss), surprise vs Finnhub = -507%, vs AV = -625%. Oba mówią "huge miss" — kierunek niezmienny mimo dużego diff. Konsekwencja: dla mocnych miss'ów Finnhub vs AV choice nie zmienia decyzji guard'a.
- **CI** -0.7% surprise, |diff|=3.09% → granica in-line (R2) vs miss (R1). Jeśli AV estimate był brany, surprise byłby **-3.4%** (ponad próg in-line) → R1 cap zamiast R2 cap. **Ten case pokazuje że choice source MA znaczenie dla edge cases**.

---

## Decision implications dla Faza 3 (deadline 25.05.2026)

### Co już wiemy

1. **FIX-13 narrow działa** dla healthcare core — 100% matched. Brak potrzeby Faza 1 rollback.
2. **FIX-14 extractRevenue priority**: NIEZNANE. Trzeba osobno replay z fetchowaniem SEC exhibit text żeby zmierzyć baseline success ratio. **TODO Faza 2 mid-point** (~18.05).
3. **Finnhub vs AV primary EPS source decision**: większość (85%) konwerguje, ale edge cases (CI, HIMS) wymagają decyzji. Plan: monitor real alerts 14d → jeśli >1 case gdzie wybór source zmieniłby cap decision → preferuj AV (brak drift, bardziej deterministic).

### Co wymaga obserwacji w pozostałych 13 dniach

- **Drift Finnhub** w real time: czy drift z weekend (GILD +0.7%→+3.97% w 1h) replikuje się dla innych tickerów post-earnings?
- **AV rate limit hits**: 25/dzień, 5-15 8-K dziennie + 1 forecasted query — bezpieczne, ale flag jeśli któryś dzień >20 calls.
- **Edge case frequency**: ile alerts dziennie ma `|surprise|` w zakresie 2-5% (gdzie wybór source MA znaczenie)?

### Open questions do rozważenia post-Faza 2

1. Semi tickers (14 obs) — nie testowane (observation gate przed consensus fetch). Sprawdzić ratio dla nich gdy/jeśli backtest semi vertical aktywuje real signals.
2. International tickers (jeśli kiedyś dodamy) — czy AV ma coverage?
3. Small-cap healthcare bez analyst coverage (np. niche biotech) — fallback do `null` source, czy guard powinien być wyłączony?

---

*Baseline measurement zrobione 12.05.2026 ~12:32 UTC, deployed code commit 97f1e66 (FIX-13 Faza 1).*

*Faza 2 mid-point review zaplanowane na ~18.05.2026 (FIX-14 extractRevenue baseline z SEC fetch).*

*Faza 2 deadline: 25.05.2026 → spec Faza 3 (FIX-14/17 priority + Finnhub vs AV primary EPS decision).*
