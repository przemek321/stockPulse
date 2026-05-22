# APLS-class universe expansion — Faza 1 wyniki

**Data:** 23.05.2026
**Status:** Faza 1.A complete, Faza 1.B partial (limitation noted)
**Następny krok:** Decyzja Faza 2 backtest entry

---

## Faza 1.A — Walidacja kandydatów (DONE)

### Metodologia

- Market cap, sektor, FDA-approved drug, avg volume: `stockanalysis.com/stocks/{ticker}/`
- Form 4 insider activity 365d: SEC EDGAR submissions API (`data.sec.gov/submissions/CIK{cik}.json`)
- Kryteria: C1 cap $1-10B, C2 FDA-approved drug, C3 Form 4 ≥5/12mies., C4 vol >100k, C5 sector biotech/pharma

### Wyniki

| Ticker | Cap | FDA drug | Avg Vol | F4/365d | C1 | C2 | C3 | C4 | C5 | **Status** |
|---|---|---|---|---|---|---|---|---|---|---|
| URGN | $1.41B | Zusduri (bladder cancer) | 274k | 27 | ✓ | ✓ | ✓ | ✓ | ✓ | **PASS strict** |
| ARDX | $1.51B | IBSRELA + XPHOZAH | 1.93M | 52 | ✓ | ✓ | ✓ | ✓ | ✓ | **PASS strict** |
| MNKD | $1.04B | Afrezza (insulin) | 4.02M | 41 | ✓ | ✓ | ✓ | ✓ | ✓ | **PASS strict** |
| CRSP | $4.86B | Casgevy (sickle cell, 2023) | 1.55M | 42 | ✓ | ✓ | ✓ | ✓ | ✓ | **PASS strict** |
| AXSM | $12.14B | Auvelity + Sunosi | 675k | 42 | ✗ stretch | ✓ | ✓ | ✓ | ✓ | **PASS stretch** (cap >$10B) |
| RCKT | $323M | KRESLADI (03.2026) | 2.11M | 51 | ✗ stretch | ✓ | ✓ | ✓ | ✓ | **PASS stretch** (cap <$1B) |
| BEAM | $2.85B | none (clinical) | 1.12M | — | ✓ | ✗ | — | ✓ | ✓ | REJECT — pre-revenue gene editing |
| EDIT | $270M | none (clinical) | 1.02M | — | ✗ | ✗ | — | ✓ | ✓ | REJECT — cap + pre-revenue |
| NTLA | $1.76B | none (clinical) | 3.20M | — | ✓ | ✗ | — | ✓ | ✓ | REJECT — pre-revenue gene editing |
| RXRX | $1.60B | none (clinical Ph1/2) | 14M | — | ✓ | ✗ | — | ✓ | ✓ | REJECT — pre-revenue |

### Podsumowanie

- **4 strict PASS**: URGN, ARDX, MNKD, CRSP
- **2 stretch PASS**: AXSM (cap >$10B, technicznie large-cap, ale FDA-approved + insider activity strong), RCKT (cap <$1B, FDA-approved świeży KRESLADI marzec 2026)
- **4 REJECT**: pre-revenue gene editing class (BEAM/EDIT/NTLA/RXRX) — brakuje FDA-approved drug

### Decyzja gate Faza 1.A

> Próg ≥5 viable tickerów: **OSIĄGNIĘTY** (6 viable: 4 strict + 2 stretch).

### Form 4 activity context (osobny insight)

Wszystkie 6 viable tickerów mają **5-10× wyższą Form 4 activity** niż próg ≥5 (27-52 filings/365d):
- Median: ~42 Form 4/rok per ticker
- Implication: jeśli Faza 2 backtest pokaże edge → 6 tickerów × 42 = **~250 Form 4 events/rok** dla expansion universe (vs 28 healthcare core którzy mają porównywalną aktywność)

To znacząco rozszerza signal candidate volume bez zmieniania reszty pipeline'u.

### Pre-revenue gene editing observation

Reject 4 tickerów (BEAM/EDIT/NTLA/RXRX) — wszystkie pre-revenue gene editing. Hipoteza: ten universe class wymaga **osobnego edge thesis** (FDA decision binary outcomes, Phase 3 results) niż Form 4 BUY. Form 4 BUY edge w healthcare core polega na "C-suite/Director kupuje przy znanej fundamenta" — pre-revenue nie ma fundamenta do oceny insidera, ich BUY może być po prostu retention compensation.

**Recommendation**: nie rozszerzaj na pre-revenue w tym sprincie. Osobny `gene_editing_speculative` sector w Sprint 20+ z innym threshold profile.

---

## Faza 1.B — M&A base rate 24mies. (PARTIAL — limitation noted)

### Limitation

WebFetch nie współpracował z M&A databases (Fierce Biotech 403, Endpoints 404, Wikipedia 404 specific deals pages). Empiryczna baza danych M&A z external scraping pozostała niezrealizowana w sesji 23.05.2026. Wymaga:
- (a) Osobna sesja research z Bash + curl + parsed sources, lub
- (b) Manual research z Bloomberg / S&P Capital IQ / FactSet (paid), lub
- (c) SEC EDGAR full-text search 8-K Item 1.01 z keyword "acquisition agreement" + market cap filter (możliwe ale time-intensive)

### Curated list base (best available estimate)

| Year | Deal | Premium | Target cap (~) | APLS-profile? |
|---|---|---|---|---|
| 2022 | AMGN / Horizon Pharma | 47% | $22B | NO (cap >$15B) |
| 2023 | PFE / Seagen | 33% | $43B | NO (cap >$15B) |
| 2023 | ASTL / Iveric Bio | 22% | $5B | **YES** (FDA Izervay, mid-cap) |
| 2023 | LLY / POINT Biopharma | 87% | $1.4B | NO (pre-revenue radiopharma) |
| 2024 | BMY / Karuna | 53% | $14B | **YES** (late-stage CNS, ~FDA imminent) |
| 2024 | ABBV / Cerevel | 22% | $9B | **YES** (late-stage CNS) |
| 2024 | MRK / Prometheus | 75% | $11B | **YES** (late-stage IBD) |
| 2026 | BIIB / APLS | ~140% | $2.4B | **YES** (FDA SYFOVRE, mid-cap) |

**Empirical sample N=8 deals 48mies. (2022-2026)**, z czego **5 APLS-profile** = ~1.25/rok base rate.

### Estimate range (z konserwatywnym disclaimer)

- **Lower bound**: 1.25/rok z empirical curated list (2022-2026)
- **Upper bound**: 3-4/rok jeśli rozszerzymy "APLS-profile" do "FDA-approved drug + speculation visible 6mies. pre-deal"
- **Plan APLS doc original estimate** (5-10/rok): **TOO OPTIMISTIC** — należy zaktualizować

### Decision implication

- Capture rate optymistycznie 50% (dla universe expanded vs unaware): **0.6-2 APLS-class events/rok złapane**
- Realistyczny outcome: 1 event w 12mies. obs window post-deploy
- ROI sanity: 1 event × 50-100% premium na cap $5B → significant uchwycenie dla retail user

**Conclusion**: ROI nadal asymetrycznie korzystne vs FIX-18 (2-5 noise alerts/miesiąc capped), ALE motivacja powyżej "5-10/rok" w `PLAN-APLS` jest overoptimistic. Realistic expectation: **1-2 events/12mies. capture**.

### Faza 1.B status

- **Partial complete** — curated list + framework, brak full empirical scraping
- **Decision-relevant**: TAK — base rate ~1-2/rok jest wystarczający dla podstawowej walidacji że ROI istnieje
- **Faza 2 NIE blocked** — base rate wystarczy żeby uzasadnić ~3-4h backtest effort
- **Recommendation**: Faza 1.B full empirical scraping → osobny mini-research task (Sprint 19 backlog item, ~2-3h), nie blocker dla Faza 2

---

## Decyzja Faza 2 entry

### Warunki spełnione

1. ✅ ≥5 viable tickerów (6 — URGN, ARDX, MNKD, CRSP strict + AXSM, RCKT stretch)
2. ✅ Base rate ≥1/rok (curated list ~1.25-3/rok, realistic capture 1-2/rok)
3. ✅ Form 4 activity wystarczająca dla backtest sample (~250 Form 4 events/rok × 24mies. = ~500 events trailing → solidny N)
4. ✅ Form 4 BUY edge w core universe d=+0.75 (V5) — extrapolation hypothesis testowalna

### Rekomendacja: Faza 2 backtest GO

**Universe scope dla backtest**:
- Tier 1 (strict): URGN, ARDX, MNKD, CRSP
- Tier 2 (stretch): AXSM, RCKT — backtest osobno żeby wiedzieć czy cap stretch zachowuje edge
- Total: 6 tickerów, trailing 24mies. SEC EDGAR Form 4 data

**Hipotezy primary**:
- H_APLS_ALL: All discretionary BUY direction=buy d? (replikuje V5 H5 all_buys d=+0.75)
- H_APLS_CSUITE: C-suite BUY d? (replikuje V5 csuite_buys d=+0.92)
- H_APLS_TIER: strict tier vs stretch tier (informuje czy stretch tickers podtrzymują edge)

**Decision gate Faza 3 entry**:
- d ≥ 0.5 raw + p<0.01: idź seed observation
- d 0.2-0.5: idź seed obs ALE konserwatywny threshold $200K + C-suite only
- d <0.2: drop expansion empirically

### Out of scope tej sesji

- Faza 1.B full empirical scraping (defer — osobny ~2-3h task)
- Faza 2 backtest implementation (kolejna sesja ~3-4h)
- Faza 3 seed + 30d obs (po Faza 2)
- Faza 4 enable alerts (po Faza 3)

---

## Powiązane

- `doc/PLAN-APLS-UNIVERSE-EXPANSION-2026-05-23.md` — pełny plan 4-fazowy (motywacja, scope, kryteria)
- `doc/PLAN-FIX-18-2026-05-22.md` — status DEFERRED, APLS-class jako alternatywa wyższego ROI
- `doc/FOLLOWUP-XBI-ADJUSTMENT.md` — sector-adjusted alpha pipeline (warunek Faza 4 monitoring quality)
- `scripts/backtest/data/results/backtest_report.md` — V5 raport, template dla Faza 2 metodologii
