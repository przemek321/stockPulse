# FOLLOWUP: Sector-adjusted alpha pipeline (XBI/IBB benchmark)

**Data:** 23.05.2026
**Trigger:** BIIB 14.05.2026 outcome interpretation ambiguity. BIIB alert id 2406 pokazał `price1d=-5.59%`, `price3d=-5.50%`. Surowy priceChange interpretowany jako "real signal" w dyskusji FIX-18, ale BIIB to high-beta large-cap pharma — bez sector context to może być noise (jeśli XBI tego okna -4 do -6%) lub real signal (jeśli XBI flat). Decyzja FIX-18 zależy od interpretation którego nie możemy zrobić.
**Status:** PENDING — Sprint 16 backlog item, BIIB case wyciąga to z deprioritization.

---

## Problem

System rejestruje `priceAtAlert`, `price1h`, `price4h`, `price1d`, `price3d` (Finnhub `/quote` snapshot) w `alerts` entity. Outcome analysis we wszystkich raportach + backtests + decisions używa **surowy priceChange %**:

```sql
(price_1d - price_at_alert) / price_at_alert * 100
```

To miesza dwa sygnały:
1. **Alpha** — edge alertu vs random day (chcemy mierzyć)
2. **Sector beta exposure** — ekspozycja na ruch sektora niezależny od katalizatora alertu (szum)

Dla biotech (typowa beta vs XBI 1.0-2.5) sektor regime tego okna może dominować outcome. Przykład:
- BIIB -5.5% 3d w okno gdzie XBI -4% → BIIB alpha ≈ -1.5%, **noise zone**
- BIIB -5.5% 3d w okno gdzie XBI flat → BIIB alpha = -5.5%, **real signal**

Bez sector-adjustment **nie wiemy który scenariusz mamy**. To dotyczy:
- **Każdej decyzji** FIX-X / drop-X opartej na outcome data z DB
- **Weekly raportów** outcome distribution
- **Backtest baselines** (V5 częściowo używa "random dni same ticker" co kontroluje per-ticker variance, ale nie sector regime)
- **Forward validation** alert rules po Sprint 17 changes
- **Live vs backtest hit rate comparison** (`SPRINT-19-BACKLOG.md` Research #12)

## Status historyczny

- **Sprint 16** (16.04.2026): zidentyfikowane jako pending fix w Python backtest baseline. Nie ukończone.
- **V5 backtest** (18.04.2026): używa per-ticker baseline (random dni same ticker, 5000 samples) jako częściowy proxy. Lepszy niż uniform baseline, ale nie kontroluje sector regime per event window.
- **22.05.2026 FIX-18 dyskusja**: BIIB case wymusił świadomość że surowy priceChange jest niewystarczający dla outcome interpretation. Eskalacja z "backlog" do "warunek revisit dla FIX-18".

## Scope

### A. Data source

**XBI** (SPDR S&P Biotech ETF) — equal-weight biotech, beta proxy najlepszy dla mid-cap biotech (większość portfolio $1-10B). Już używany jako sector benchmark w V5 prose.

**IBB** (iShares Biotechnology) — market-cap weighted, lepszy proxy dla large-cap pharma (BIIB-class).

**Decyzja**: oba — `xbi_close` i `ibb_close` w outcome record. Per-alert classify który benchmark "fairer fit" (mid-cap → XBI, large-cap >$10B → IBB).

**Provider**:
- Finnhub `/quote` — free tier, używamy już dla `priceAtAlert`. Symbol `XBI` / `IBB` dostępne ✓
- Polygon EOD — alternatywne, EOD only (nie 1h/4h sloty). Backup
- yfinance/Yahoo Finance — ostatnia opcja, brittle

Default: Finnhub (zero infra change).

### B. Schema change

`alerts` entity (`src/entities/alert.entity.ts`) dodać kolumny:

```ts
@Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
xbiAtAlert: number | null;

@Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
xbi1d: number | null;

@Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
xbi3d: number | null;

@Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
ibbAtAlert: number | null;

@Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
ibb1d: number | null;

@Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
ibb3d: number | null;
```

TypeORM `synchronize: true` auto-doda kolumny. **Skip price1h/4h** — sektor benchmark 1h/4h ma niski signal-to-noise dla intraday, focus 1d/3d.

### C. Capture logic

`PriceOutcomeService` (`src/price-outcome/price-outcome.service.ts`):

1. Przy `priceAtAlert` snapshot: również snapshot `xbiAtAlert`, `ibbAtAlert` (parallel Finnhub fetch).
2. Przy CRON co 1h slot fill (NYSE open): dla każdego pending outcome, fetch też XBI/IBB current price.
3. Snapshot logic identyczna jak dla per-ticker — równoległy fetch żeby snapshot był spójny w czasie.

**Rate limit**: Finnhub free 60 req/min. Worst case 30 ticker alerts/godzinę + 2 sector tickers/godzinę → 32 fetches/godzinę, dalek od limitu.

### D. Sector-adjusted alpha computation

Pure function w `src/price-outcome/sector-alpha.ts`:

```ts
export function computeSectorAlpha(
  tickerChangePct: number,
  benchmarkChangePct: number,
  beta: number = 1.0,  // optional: per-ticker historical beta, default 1.0
): number {
  return tickerChangePct - (beta * benchmarkChangePct);
}
```

**Beta computation**: out of scope first pass — używamy beta=1.0 default. Faza 2 może dodać per-ticker historical beta (TTM, 60-day rolling) jako enhancement. Beta=1.0 to consensus dla biotech ETF members, błąd rzędu ±20% acceptable for outcome interpretation.

### E. Retroactive backfill

Historic alerts (~12mies. data) potrzebują backfill XBI/IBB historical prices.

**Approach**:
1. Single script `scripts/backfill/sector-prices-backfill.ts`
2. Iterate over `alerts` z `priceAtAlert IS NOT NULL AND xbiAtAlert IS NULL`
3. Per alert: fetch historical XBI/IBB close dla daty `sentAt` (Finnhub historical quote endpoint)
4. Update record
5. Rate limit 60 req/min — dla ~2000 historic alertów ~33min total

**Skip raw price1h/4h backfill** — nie wszystkie alerty mają 1h/4h zachowane historic; focus 1d/3d adjustment.

### F. Reports + API surface

1. **API endpoint** `/api/alerts/outcomes` rozszerz response o:
   - `xbiAlpha1d = price1dPct - xbi1dPct`
   - `ibbAlpha1d = price1dPct - ibb1dPct`
   - `xbiAlpha3d`, `ibbAlpha3d`
2. **Frontend** `App.tsx` dashboard outcome column: dodaj toggle "Raw / Alpha" (default Alpha).
3. **Weekly raport SQL** (`scripts/reports/`): zamień raw priceChange na sector-adjusted alpha w outcome distribution.

### G. Backtest integration

`scripts/backtest/` Python analyzer:

1. Load XBI/IBB historical prices (Yahoo Finance bulk fetch, daily close 3 lata)
2. W `_compute_outcome` per event: compute alpha = ticker_return - xbi_return
3. Welch's t-test + Cohen's d na **alpha distribution** zamiast raw return
4. Baseline również alpha (random day - same day XBI)

**Decyzja**: dual-track — backtest report pokazuje BOTH raw d AND alpha-adjusted d. Jeśli rozjazd <0.1 → raw był wystarczający (niska sector regime contamination). Jeśli rozjazd >0.3 → alpha-adjusted to source of truth.

---

## Estimate

| Subtask | Effort |
|---|---|
| Schema change + entity + migration | 30min |
| PriceOutcomeService snapshot integration | 1h |
| Sector-alpha pure function + tests | 45min |
| Retroactive backfill script + run | 1h script + 33min run |
| API endpoint extension | 30min |
| Frontend toggle Raw/Alpha | 1h |
| Weekly raport SQL update | 30min |
| Backtest analyzer integration (Python) | 2h |
| **TOTAL** | **~7-8h** |

**Effort/value**: 1 dzień dev → fundamentally lepsze outcome interpretation dla każdego future decision. ROI compounding (każdy backtest, każdy raport, każda decyzja FIX-X benefits). Prawdopodobnie **highest leverage Sprint 19 task** (vs FIX-X które dotyczą single bugs).

---

## Powiązane

- `doc/PLAN-FIX-18-2026-05-22.md` — status DEFERRED, warunek #2 revisit = ten dokument shipped
- `doc/PLAN-APLS-UNIVERSE-EXPANSION-2026-05-23.md` — Faza 4 monitoring potrzebuje sector-adjusted alpha
- `doc/SPRINT-19-BACKLOG.md` — Research #12 "Live vs backtest hit rate comparison" zależy od tego pipeline'u
- `doc/STOCKPULSE-CHEATSHEET-2026-04-17.md` — Sprint 16 backtest pending tasks (gdzie ten item był pierwotnie deprioritized)
- V5 backtest `scripts/backtest/data/results/backtest_report.md` — używa per-ticker baseline jako częściowy proxy; ten pipeline dodaje sector-regime control

## Decyzja Sprint 19

- Schedule: **TAK** — strongly recommend Sprint 19 prio item
- Block FIX-18 revisit: TAK (warunek #2 w `PLAN-FIX-18`)
- Block APLS-class Faza 4: SOFT (Faza 4 enable może iść z surowymi outcomes; sector-adjusted alpha podnosi monitoring quality ale nie jest gating)
- Block weekly raport quality: TAK (raporty od shipped → sector-adjusted defaultem)
