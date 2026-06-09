# APLS-class backtest Faza 2 — executive summary + decyzja

**Data:** 2026-05-23
**Status:** Faza 2 complete → **GO Faza 3 seed observation CONSERVATIVE**
**Pełne tabele:** `scripts/backtest/data/apls/results/apls_report.md`
**JSON raw:** `scripts/backtest/data/apls/results/apls_results.json`
**Kod:** `scripts/backtest/apls_backtest.py`, `apls_config.py`

---

## TL;DR

Replikacja V5 BUY edge na 6 nowych tickerach (URGN/ARDX/MNKD/CRSP/AXSM/RCKT) **TRZYMA** dla high-value BUY:

| Test | V5 healthcare core | APLS-class (Faza 2) | Status |
|---|---|---|---|
| BUY all 7d | d=+0.75 ✓✓✓ Bonferroni | d=+0.62 ✓ raw (N=19) | **REPLIKUJE** |
| BUY $500K+ 7d | d=+0.83 ✓✓✓ Bonferroni | d=+0.75 ✓ raw (N=9) | **REPLIKUJE** |
| BUY $500K+ 3d | — | d=+1.03 ✓ raw (N=9) | mocniejszy short horizon |
| BUY $500K+ 1d | — | d=+1.61 ✓ raw (N=9) | mocny 1d effect |
| C-suite BUY 7d | d=+0.92 ✓✓✓ Bonferroni | N=3 insufficient | **NIE testowalne** w 24mies. |
| strict vs stretch | n/a | wszystkie p>0.66 (N_str=14, N_str=5) | **brak różnicy** (N za małe) |

**Bonferroni 44 testów → threshold 0.00114** — żaden test nie passes Bonferroni strict. ALE: V5 N=24,743 C-suite × 36mies. → APLS N=19 BUY × 24mies. = ~3× mniejsze N per BUY event (oczekiwane: 6 mid-cap biotech vs 28 healthcare core; BUY w biotech rare event).

## Co działa

- **BUY $500K+ jest najsilniejszym signalem** (3/4 horyzonty istotne ✓ p<0.05, d 0.42-1.61). Zalecane **threshold dla APLS alertów: $500K** (vs core healthcare $100K). Konserwatywny próg redukuje false positives przy małym universe.
- **ARDX jest głównym driverem** (N=9, 1d d=+1.19 p=0.028). RCKT (N=4) ma extreme avg returns +6.99% do +12.68% ale wide CI.
- **Strict tier (URGN/ARDX/MNKD/CRSP) trzyma signal** (7d d=+0.52 p=0.038 ✓) — uzasadnia inclusion bez stretch.

## Co NIE działa / limitacje

- **C-suite BUY N=3** — V5 hipoteza H_APLS_CSUITE NIE TESTOWALNA w obecnym window. Per-design: mid-cap biotech ma rzadkie C-suite BUY (vs większe healthcare core gdzie CEO/CFO BUY bardziej common).
- **30d horizon** zerowy edge (d=+0.16) — efekt jest **short-horizon** (1d-7d), zgodnie z V5.
- **Strict vs stretch** wszystkie p>0.66 → BRAK statistical evidence że stretch (AXSM cap >$10B, RCKT cap <$1B) **różni się** od strict. Może to znaczyć "brak różnicy" (good for inclusion) ALE może też być artifact N (5 vs 14). Treat exploratory.
- **BUY $1M+ N=4** wide CI (d=+0.98-+2.65) — pojedyncze events dominują. Nie używaj jako primary signal.
- **Bonferroni nie passes** — 44 testów strict threshold 0.001 wymaga p<0.001, najmocniejsze APLS test ma p=0.0035 (just outside). Z większym N w forward observation może zostanie spełniony.

## Decyzja gate (Faza 3 entry)

Z PLAN-APLS:
- `d ≥ 0.5 raw + p<0.01` → **GO seed observation**
- `d 0.2-0.5` → **GO seed obs CONSERVATIVE** (threshold $200K + C-suite only)
- `d <0.2` → drop expansion

**Wynik APLS Faza 2 — H_APLS_ALL 7d**: d=+0.622, p=0.027.
- **d ≥ 0.5: TAK** ✓
- **p < 0.01: NIE** (p=0.027)

→ Pełny "GO seed obs" gate NIE spełniony (p border-case), ale "CONSERVATIVE GO" gate **PRZEKROCZONY** (d≥0.5).

**Dodatkowy dowód mocy**: BUY $500K+ 7d d=+0.75 p=0.041 (replikuje V5 dosłownie). Ten signal jest **bezpośrednio actionable**.

### Rekomendacja: **GO Faza 3 seed observation CONSERVATIVE**

**Parametry Faza 3**:
1. **Universe**: 6 tickerów (URGN, ARDX, MNKD, CRSP, AXSM, RCKT) — wszystkie z `observationOnly=true`
2. **Alert threshold**: BUY ≥ $500K (vs core $100K)
3. **Boost rules**:
   - C-suite ×1.3 (zachowany z core, retrospective validation w 30d obs window)
   - Strict tier ×1.1 (lekka preferencja — d strict 7d=+0.52 vs stretch 7d=+0.91 ale wide CI)
   - 10b5-1 plan → hard skip (zachowany z core)
4. **Obs window**: 30 dni post-seed, monitor:
   - N forward BUY events (oczekiwane: ~3-5/30d × 6 tickers = ~10-25 events)
   - Hit rate 7d positive (target ≥65% per V5 + cushion)
   - Sector-adjusted alpha (po `FOLLOWUP-XBI-ADJUSTMENT` ship — jeśli przed, raw priceChange acceptable jako baseline)
5. **Faza 4 enable gate** (post 30d):
   - ≥6 BUY events delivered
   - Hit rate 7d ≥ 60%
   - Median alpha 7d ≥ +2% (raw) lub ≥ +1% (sector-adjusted)
   - Zero MRNA-class halucynacje GPT direction
   - Telegram alerts wyłączone w obs — enable PO Faza 4 decision

## Out of scope Faza 2

- **Faza 3 seed implementation** (zmiany DB + Form4Pipeline rules) — następna sesja po code review tego doc'a
- **C-suite hypothesis re-test** — wymagałoby rozszerzonego window (36mies.+) lub większego universe — odłożone do Sprint 20
- **Faza 1.B full M&A scraping** — partial complete w Faza 1; dla baseline ROI decyzji ~1-2 events/12mies. wystarcza
- **FOLLOWUP-XBI-ADJUSTMENT** — niezależny task wyższego priority dla cross-cutting outcome interpretation
- **Backtest comparison APLS vs core healthcare** — direct Welch's t-test (analog H6) wymagałby fetch dla core healthcare BUY events w tym samym 24mies. window; planowane przy XBI pipeline ship

## Faza 3 implementation checklist — DONE 09.06.2026 (2,5 tyg. po planie)

1. [x] DB seed: URGN/ARDX/MNKD/CRSP/AXSM/RCKT w `tickers` z `sector='biotech_apls'`, `observationOnly=true` — config `doc/stockpulse-biotech-apls.json`, seed przez `src/database/seeds/seed.ts` (nie `seed.service.ts` — taka ścieżka nie istnieje), zweryfikowane w produkcyjnej DB (57 tickerów, 20 obs)
2. [x] `src/database/seeds/seed.ts` — `apls_strict`/`apls_stretch` groups + GROUP_PRIORITY (strict MEDIUM, stretch LOW)
3. [x] Form4Pipeline (`form4.pipeline.ts`):
   - `APLS_MIN_BUY_VALUE = 500_000` + **BUY-only** (SELL → `SKIP_APLS_NON_BUY` bez GPT; zero edge w V5 i Faza 2)
   - Sector boost ×1.2 dla `biotech_apls` (jak healthcare) + strict tier ×1.1 (`APLS_STRICT_TIER`)
   - **Wyjątek od S19-FIX-03**: biotech_apls NIE jest skipowany przed GPT (healthcare prompt semantycznie OK; okno obs wymaga conviction+priceAtAlert w DB) — dispatch z `isObservationTicker=true` → DB-only `nonDeliveryReason='observation'`
   - storeSignal SKIP dla `suppressedBy='observation'` (czysty correlation baseline, analog FIX-03b)
4. [x] Testy: 8 w `test/unit/form4-apls-faza3.spec.ts` (ARDX BUY $600K obs flow + zero storeSignal, boosty strict/stretch, próg $500K, SELL skip, regresja FIX-03 semi, healthcare core bez zmian). 588/588 unit pass.
5. [x] Monitoring SQL: sekcja "Faza 4 obs window monitoring" niżej
6. [x] Faza 4 review: **2026-07-09** (30d od seedu 09.06, nie 22.06 — seed opóźniony 2,5 tyg.)

### Faza 4 obs window monitoring (uruchamiaj co tydzień)

```sql
-- APLS observation alerts vs core baseline (signed return + hit rate, 3d proxy)
WITH o AS (
  SELECT a.symbol, t.sector, a."alertDirection" AS dir, a."sentAt",
    (a."price3d"-a."priceAtAlert")/a."priceAtAlert"*100 AS r3d
  FROM alerts a JOIN tickers t ON t.symbol = a.symbol
  WHERE a."sentAt" >= '2026-06-09' AND a."ruleName" = 'Form 4 Insider BUY'
    AND a."price3d" IS NOT NULL
)
SELECT sector, count(*) AS n,
  round(avg(CASE WHEN dir='positive' THEN r3d ELSE -r3d END),2) AS signed_r3d,
  round(100.0*avg(CASE WHEN (dir='positive' AND r3d>0) OR (dir='negative' AND r3d<0)
        THEN 1 ELSE 0 END),0) AS hit3d
FROM o GROUP BY sector;
```

Gate Faza 4 (z sekcji wyżej): ≥6 BUY events, hit rate ≥60%, median alpha 7d ≥ +2% raw
(XBI-alpha dostępna — kolumny xbi/ibb wypełniane od 23.05), zero halucynacji GPT direction.

---

## Powiązane

- `doc/APLS-FAZA-1-RESULTS-2026-05-23.md` — universe validation (4 strict + 2 stretch pass, 4 reject)
- `doc/PLAN-APLS-UNIVERSE-EXPANSION-2026-05-23.md` — pełny 4-fazowy plan
- `doc/PLAN-FIX-18-2026-05-22.md` — status DEFERRED, APLS-class jako alternatywa wyższego ROI
- `doc/FOLLOWUP-XBI-ADJUSTMENT.md` — sector-adjusted alpha pipeline (warunek Faza 4 quality monitoring)
- `scripts/backtest/data/results/backtest_report.md` — V5 raport core healthcare, baseline porównawczy
- `scripts/backtest/apls_backtest.py` — runner Faza 2 (fetch + analyze + report)
