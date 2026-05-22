# Plan: APLS-class universe expansion — mid-cap biotech M&A targets

**Data:** 23.05.2026
**Trigger:** APLS deal 31.03.2026 (Biogen acquisition, 140% premium do close z dnia przed). StockPulse universe (28 healthcare core + 14 semi observation) NIE zawierał APLS — mid-cap biotech z FDA-approved drug i M&A speculation crawling >12 mies. Stracony trade który system fundamentalnie powinien był złapać.
**Status:** Plan v3 framework — pre-work walidacja → backtest narrow → seed observation → enable alerts.

---

## Motywacja

### Asymetria ROI vs alternatives

| Initiative | Effort | Expected ROI 12mies. |
|---|---|---|
| FIX-18 (derivative cap) | ~5h dev | 2-5 noise alerts/miesiąc capped. Marginalna oszczędność uwagi |
| **APLS-class expansion** | ~1-2 dni dev + 30d observation | **1-2 M&A target captures/rok × 50-150% premia = systemic value** |

1 missed APLS-class event (140% premium) > suma wszystkich potencjalnych FIX-18 oszczędności z 12 mies. Asymetria niezależna od FIX-18 outcome.

### Hipoteza testowalna (Sprint 11 edge-not-volume principle)

> Mid-cap biotech ($1-10B) z FDA-approved drug + insider activity baseline + M&A speculation → systematycznie wyższy edge na Form 4 BUY niż large-cap healthcare (analyst coverage >25 → market efficient).

V5 backtest pokazał Form 4 BUY edge **w universie healthcare core** d=+0.75 7d (Bonferroni ✓✓✓). Otwarte pytanie: czy ten edge replikuje się w mid-cap biotech? Hipoteza: TAK, prawdopodobnie wyższy (mniej analyst coverage → więcej info asymmetry).

### Empiryczna baza

Historia M&A premiums w mid-cap biotech 24mies.:

| Deal | Date | Premium | Pre-deal cap | Target profile |
|---|---|---|---|---|
| BIIB/APLS | 03.2026 | ~140% | $2.4B | FDA-approved (SYFOVRE), 12mies. M&A speculation |
| ASTL/IVRC (Iveric/Astellas) | 2023 | ~22% | $5B | FDA-approved (Izervay), retina |
| AMGN/CHE (Horizon) | 2022 | ~47% | $22B | FDA-approved portfolio (Tepezza) |
| PFE/SGEN (Seagen) | 2023 | ~33% | $43B | FDA-approved oncology |
| LLY/POINT | 2023 | ~87% | $1.4B | Pre-revenue radiopharma |
| BMY/KARO (Karuna) | 2024 | ~53% | $14B | Late-stage CNS |
| ABBV/CERE (Cerevel) | 2024 | ~22% | $9B | Late-stage CNS |
| MRK/PRMP (Prometheus) | 2023 | ~75% | $11B | Late-stage IBD |
| RHHBY/TLRY (Telavant) | 2023 | n/a private | — | — |

**Base rate estimate** (pre-work Faza 1 verifikuje): ~5-10 healthcare M&A target events/rok z premia >40% w cap range $1-15B. Universe expansion celuje w 50-80% capture rate na tej kategorii.

---

## Faza 1: Pre-work walidacja (~75min)

### A. Validate kandydatów (per ticker, ~5min × 10-12 tickers)

Lista kandydatów (Twoja + URGN poprawka):
- **ARDX** (Ardelyx) — FDA-approved (Ibsrela, Xphozah)
- **MNKD** (MannKind) — FDA-approved (Afrezza)
- **AXSM** (Axsome) — FDA-approved (Auvelity, Sunosi)
- **CRSP** (CRISPR Therapeutics) — FDA-approved (Casgevy 2023)
- **BEAM** (Beam Therapeutics) — pre-revenue gene editing
- **EDIT** (Editas Medicine) — pre-revenue gene editing
- **NTLA** (Intellia) — pre-revenue gene editing
- **RXRX** (Recursion) — pre-revenue AI drug discovery
- **RCKT** (Rocket Pharmaceuticals) — pre-revenue gene therapy
- **URGN** (UroGen — Twoja sugestia zamiast ULAA) — FDA-approved (Zusduri/Jelmyto, bladder cancer), cap $1.41B, vol 274k ✓ **wstępnie verified**

Kryteria per ticker (verify każdy przed seed):
1. **Market cap $1-10B** (mid-cap zone — APLS pre-deal był $2.4B)
2. **FDA-approved drug** (>=1 commercial product) lub **late-stage Phase 3** (commercial within 12mies.)
3. **Form 4 insider activity 12mies.** (>=5 filings — żeby był sygnał do złapania)
4. **Avg daily volume >100k shares** (liquidity dla retail)
5. **Sector biotech/pharma** (US listed)

**Tool**: WebFetch na stockanalysis.com / SEC EDGAR API (już używamy User-Agent), 5min per ticker.

**Deliverable**: tabela 10-12 wierszy ze status `VERIFIED` / `REJECTED` per kryterium.

### B. M&A base rate w sektorze 24mies. (~45min)

Empiryczna podstawa "ile M&A targets/rok można złapać":

1. SEC EDGAR full-text search: `8-K Item 1.01` z biotech tickerami market cap $1-15B 2024-2026
2. Filter na "merger agreement", "acquisition agreement", premium >30%
3. Output: lista 10-20 deals z (date, target_ticker, premium, pre-deal cap)
4. Sub-sample do "APLS-profile" (FDA-approved + M&A speculation visible ex-ante): ~30-40% z full lista
5. Base rate: deals/year w "APLS-profile" = expected annual captures po expansion

**Decyzja gate (Faza 2 entry)**:
- Jeśli base rate ≥5/rok → expansion ma podstawę, idź Faza 2
- Jeśli ≤2/rok → odłóż, prawdopodobnie current healthcare core już łapie większość (sprawdź alerts.archived dla APLS-class events 12mies.)

**Out of scope**: orientational base rate (5-10/rok) z motywacji powyżej to estimate, base rate computation z SEC EDGAR podaje empiryczną liczbę.

---

## Faza 2: Backtest V5-style narrow (~3-4h)

### Replikacja V5 metodologii na expanded universe

Cel: validate że Form 4 BUY edge replikuje się dla 10-12 nowych tickerów PRZED enable alerts.

**Setup**:
- Universe: tylko nowe tickery (10-12) z Faza 1 status=VERIFIED
- Dane: SEC EDGAR Form 4 24mies. (analogicznie do V5 zakresu)
- Hipoteza primary: **H_APLS — All discretionary BUY direction=buy edge** (replikacja V5 H5 sub-group `all_buys` d=+0.75)
- Hipoteza secondary: **H_APLS_CSUITE** (analogicznie do csuite_buys d=+0.92 V5)

**Test**:
- Welch's t-test + Cohen's d (winsorized 1%, ddof=1, pooled)
- Baseline: random dni na tych samych tickerach (~5000 samples)
- Bonferroni threshold: 0.05 / N_tests (typowo 10-20 testów w narrow scope)

**Decyzja gate (Faza 3 entry)**:
- d ≥ 0.5 ze średnio-strong evidence (raw p<0.01, Bonferroni borderline) → idź Faza 3
- d 0.2-0.5 → idź Faza 3 ALE z konserwatywnym threshold $200K (zamiast $100K) i tylko C-suite
- d < 0.2 → drop expansion, motywacja obalona empirycznie

**Powiązane**: V5 raport `scripts/backtest/data/results/backtest_report.md` jako template.

---

## Faza 3: Seed + observation mode (~30min seed, 30d observation)

### A. Seed nowych tickerów

1. Update `doc/stockpulse-healthcare-universe.json` lub nowy `doc/stockpulse-midcap-biotech.json` (decyzja: nowy json — separation of concerns)
2. Seed do `tickers` table z:
   - `sector='midcap_biotech'`
   - `observationOnly=true` (DB only, brak Telegram)
3. SEC EDGAR collector automatycznie zaczyna podążać tickery (na podstawie `tickers.isActive=true`)
4. Form4Pipeline + Form8kPipeline obsłużą events ALE observation gate (S19-FIX-03) blokuje Telegram + correlation Redis (S19-FIX-03b)

### B. Observation period 30 dni

Cel: validate że (a) collector poprawnie podąża tickery, (b) Form 4 events się pojawiają z oczekiwaną frekwencją (≥5/12mies. per ticker baseline), (c) GPT analysis nie produkuje absurdów.

**Monitor**:
- Daily check: ile Form 4 events / ticker w obs window
- Weekly: spot-check alert messages w DB (manual review 5 random alerts)
- Outcome tracking: PriceOutcomeService działa dla obs tickerów (price1h/4h/1d/3d zbierane)

**Decyzja gate (Faza 4 entry)**:
- ≥3 alerty z `priceOutcomeDone=true` per ticker w 30d → wystarczająca data
- Forward validation outcomes: median 7d alpha vs sector ≥ |2%| → edge replikuje się live
- Inaczej: przedłuż obs do 60d

---

## Faza 4: Enable alerts (production live)

### A. Włącz Telegram delivery

Update `tickers.observationOnly=false` per ticker spełniający Faza 3 gate. Per-ticker decyzja, nie batch.

### B. Threshold dostosowanie

Na podstawie Faza 2 d-value:
- d ≥ 0.5 (strong): standard thresholds (Form 4 BUY $100K, C-suite ×1.3, healthcare ×1.2 — ALE dla `sector='midcap_biotech'` ×1.0 lub osobny boost)
- d 0.2-0.5 (moderate): conservative thresholds ($200K, C-suite only, brak healthcare boost)
- d < 0.2: nie powinno tu trafić (gate Faza 2 by zatrzymał)

### C. Continuous monitoring

- Weekly raport: alert count per nowy ticker + outcome distribution
- Quarterly: replikuj V5 hipotezy na 3mies. live data, porównaj z backtest predictions
- Decision deadline: 6mies. live → keep/expand/contract universe na podstawie realized edge

---

## Co świadomie NIE w scope (Plan v3 discipline)

| Item | Reason for skip |
|---|---|
| Pre-revenue gene editing (BEAM/EDIT/NTLA/RCKT) jako primary class | Wyższy risk profile (binary outcomes, FDA decisions), inny edge thesis. Faza 1 zweryfikuje czy w ogóle FDA-approved kryterium spełniają |
| Non-biotech healthcare M&A (medtech, diagnostics) | Out of scope FIX-18 follow-up — różny universe selection process |
| Options flow w mid-cap | Polygon EOD data per nowych tickerów dostępne, ale obecny pipeline jest healthcare-focused (PDUFA boost). Faza 4 osobna sub-decyzja |
| Sentiment pipeline reactivation dla nowych tickerów | Sprint 15 backtest potwierdził zero edge, FinBERT removed 22.04.2026 — nie wracamy |
| 8-K Item 1.01 dla mid-cap (FIX-18-class) | Defer — patrz `PLAN-FIX-18-2026-05-22.md` status DEFERRED |
| Polymarket M&A speculation odds | Brittle source, manual research, hard to operationalize |

---

## Ryzyka

1. **Gene editing class (BEAM/EDIT/NTLA/RCKT) bez FDA-approved drug**
   - Faza 1 odsieje te które nie spełniają kryterium #2
   - Alternative: dodaj jako separate `sector='gene_editing_speculative'` z innym threshold profile (Sprint 20+)

2. **Form 4 filing frequency niska dla pre-IPO-ish mid-caps**
   - Faza 1 check #3 (≥5 filings/12mies.) wyklucza
   - Niska liczność events → niski statistical power w Faza 2 backtest

3. **Beta heterogeneity w mid-cap biotech (1.5-3.0)**
   - Bez `FOLLOWUP-XBI-ADJUSTMENT` baseline outcomes są zaszumione
   - Faza 2 backtest używa "random dni same ticker" baseline (jak V5) — kontroluje per-ticker variance, ale nie sector regime
   - Faza 4 production monitoring potrzebuje sector-adjusted alpha (warunek do FOLLOWUP-XBI shipped)

4. **APLS sample bias** — wybieramy universe na podstawie 1 anegdoty (140% premium)
   - Mitygacja: Faza 1.B (M&A base rate w sektorze 24mies.) podaje sample size 10-20 deals
   - Kalibruje expectation: jeśli base rate 5/rok i capture rate optymistycznie 50% → 2-3 events/rok realistic

5. **Tickery z pending M&A już zdyskontowane**
   - URGN, ARDX itp. mogą mieć price premium speculative już w cenie
   - Mitygacja: Form 4 BUY edge testowany na trailing 24mies. dane przed seed → backtest period przed-M&A
   - Forward: live outcomes pokażą czy edge replikuje się post-seed

---

## Estimate (total ~6-8h)

| Faza | Effort | Deliverable |
|---|---|---|
| Faza 1 | ~75min | Tabela validacji 10-12 tickerów + M&A base rate analysis |
| Faza 2 | 3-4h | Backtest report mid-cap biotech (Welch's t-test + Cohen's d, replikacja V5 H5) |
| Faza 3 | 30min seed + 30d passive | Seed JSON + obs monitoring weekly |
| Faza 4 | 1h enable + ongoing | Production enable + weekly raport |

**Decision deadline first review**: ~Q3 2026 (po 30d obs + first live outcomes).

---

## Powiązane dokumenty

- `doc/PLAN-FIX-18-2026-05-22.md` — status DEFERRED, kontekst dlaczego APLS-class pierwszy
- `doc/FOLLOWUP-XBI-ADJUSTMENT.md` — sector-adjusted alpha pipeline (warunek Faza 4 monitoring)
- `doc/stockpulse-healthcare-universe.json` — obecny universe (28 core + 14 semi obs)
- `scripts/backtest/data/results/backtest_report.md` — V5 metodologia template dla Faza 2
- `doc/STOCKPULSE-CHEATSHEET-2026-04-17.md` — V5 hipotezy + Bonferroni framework
- CLAUDE.md sekcja "System totals" — current state pipeline (gdzie wpisujemy expansion post-deploy)
