# Sprint 19 — Backlog

> Utworzony 23.04.2026 po zamknięciu Sprint 18 (12 tasków + 5 follow-upów).
> Items zebrane z: cheatsheet "Sprint 18+ research", TASKS-2026-04-22 odrzucone
> opcje, post-Sprint audyt FOLLOW-*, plan-observability-tier1 Tier 2.

---

## ✅ DONE 23.05.2026 — APLS Faza 1+2 (biotech universe expansion) + XBI MVP (sector-adjusted alpha) + FIX-18 deferred

Sesja 23.05.2026: dwa równoległe trackery (APLS biotech universe expansion +
XBI sector-adjusted alpha MVP) + decyzja deferred dla FIX-18 (8-K temporal
awareness) z explicit revisit threshold.

| Commit | Zakres | Test count |
|---|---|---|
| `687c3d0` | **APLS Faza 1+2**: 4-fazowy plan biotech universe expansion. Backtest replikuje V5 (BUY $500K+ 7d **d=+0.75**, p<0.01). Per-ticker driver analysis (ARDX 1d **d=+1.19** ✓✓✓, MNKD 7d d=+0.41, URGN/CRSP statistical noise N<5). C-suite N=3 insufficient dla Bonferroni — exclude z hard rule, accept jako secondary boost ×1.1. 6 viable tickerów: **URGN/ARDX/MNKD/CRSP strict** + **AXSM/RCKT stretch**. Faza 3 seed obs CONSERVATIVE GO decision. | +0 (analysis only) |
| `7ed4be6` | **XBI MVP schema**: dodanie 6 kolumn do `alerts` entity (`xbiAtAlert`, `ibbAtAlert`, `xbiPrice1d/3d`, `ibbPrice1d/3d`). TypeORM `synchronize: true` auto-migracja. | 0 |
| `a280dc7` | **XBI capture helper**: pure function `captureAlertSnapshot(symbol, finnhub)` zwraca `{priceAtAlert, xbiAtAlert, ibbAtAlert}` z 3 parallel `getQuote` calls (graceful nullable fallback). Helper podpięty w 6 sites: Form4Pipeline, Form8kPipeline (2× main + bankruptcy), CorrelationService, AlertEvaluator.sendAlert, OptionsFlowAlertService. | +12 |
| `86ead4f` | **XBI alpha API**: `/api/alerts/outcomes` zwraca 4 nowe pola `xbiAlpha1d/3d, ibbAlpha1d/3d` (post-process pure function `computeAlphaForSlot(rawPct, xbiPct, ibbPct)` — relative outperformance vs sector benchmark). 26 unit testów `computeSectorAlpha` (edge cases: null snapshot, null slot, both benchmarks null, partial null). | +14 |

**Cumulative**: 557/557 unit pass (+52 new), tsc clean, 3 deploy clean.

**APLS wyniki kluczowe** (źródło: `doc/PLAN-APLS-BIOTECH-UNIVERSE-2026-05-23.md`):
- BUY $500K+ 7d window: **d=+0.75, p=0.003** (replikuje V5 healthcare core BUY d=+0.83)
- Per-ticker driver: ARDX dominates (N=4, 1d d=+1.19 ✓✓✓) — single ticker not whole universe edge
- C-suite tier insufficient sample (N=3) — Bonferroni fails, downgrade do secondary boost ×1.1
- Healthcare boost (×1.2) zastosować — sector=biotech to subset healthcare
- Recommendation: 6 tickerów seed obs (4 strict + 2 stretch), Faza 3 PRO GO

**XBI MVP architecture flow**:
```
alert created → captureAlertSnapshot(symbol)
              ↓ (3 parallel Finnhub /quote)
              { priceAtAlert, xbiAtAlert, ibbAtAlert }
              ↓ (persist w alerts row)
PriceOutcomeTracker → fills price1d/3d at horizon
              ↓
/api/alerts/outcomes → post-process computeAlphaForSlot
              ↓ relative outperformance vs sector
              { xbiAlpha1d: +2.1%, ibbAlpha1d: +1.8% }
```

Forward: backfill historic XBI/IBB at sentAt (Finnhub /candle, ~33min run), API timeline endpoint update, frontend toggle Raw/Alpha, weekly raport SQL replacement, Python backtest analyzer dual-track integration.

---

## ✅ DONE 29.04-06.05.2026 — P0 fixes po HUM/UNH false positives + options-flow zombie cycle + missing exhibit + correlation backdoors + extractItemText boundary bug + OptionsFlow obs leak

Sześć sesji (13 commitów = 10 fixów + 3 docs) po siedmiu incydentach:
UNH 27.04 21:05 correlated false CRITICAL, HUM 29.04 10:35 GPT halucynacja
earnings miss, options-flow runCollectionCycle 11h 36min (29.04 — drugi raz
po 17.04, mimo Sprint 16b FIX-04), 4/4 alerty 29-30.04 (ABBV/CI/DXCM/AMGN)
gpt_missing_data bo GPT widział wrapper bez liczb, oraz **3× UNH false positive
CRITICAL w 4 dni** (29.04 00:14 + 22:58, 30.04 23:03 — mixed signal aggregation
maskował Form4 SELL) + GILD-class Form4 SELL "blokowany" w UI ale aktywny w
Redis (29.04 22:05 + 01.05 00:40 → INSIDER_PLUS_OPTIONS Telegram).

| FIX | Commit | Zakres | Test count |
|---|---|---|---|
| FIX-01 | `1dded97` | Post-GPT missing-data guard w Form8kPipeline (cap conviction \|0.3\|, dispatch z `gpt_missing_data`, skip correlation signal) | +16 |
| FIX-02 | `3a3c5ad` | Pre-LLM Affirms keyword extraction + post-GPT conviction floor -0.3 dla affirmation-mode filings | +22 |
| FIX-02b | `9af8567` | Naprawa hardcoded `"requires_immediate_attention": true` w 8-K Item 2.02 prompt → `false` + decision rule | +7 |
| docs | `98db615` | Korekta błędnej diagnozy w komentarzach FIX-02 (root cause = `extractItemText`, nie slice) | 0 |
| FIX-02c | `f36e203` | Bump filing text limit 8 000 → 50 000 chars (4 prompty + parser MAX_TEXT_LENGTH); ~$0.04/filing input cost | 0 (asserts updated) |
| FIX-03 | `b7ca9aa` | Observation ticker skip PRZED GPT call w Form4Pipeline + Form8kPipeline; zamyka brudny correlation signal dla 14 semi tickers | +4 |
| docs | `9c04729` | Aktualizacja CLAUDE.md + SPRINT-19-BACKLOG po pierwszej fali fixów | 0 |
| FIX-04 | `05ade62` | Outer cycle budget 6h w OptionsFlowService (`AbortController` + `setTimeout`), `buildFetchSignal` łączy per-request timeout z cycle abort (Node 18+ `AbortSignal.any`), `delay(ms, signal?)` respektuje abort, cap 50 contracts/ticker — naprawia 11h+ zombie cycle z 17.04 + 29.04 | +10 |
| FIX-10 | `13b56dd` | Fetch Exhibit 99.1 dla Item 2.02 (`fetchExhibit991()` z directory index.json, regex 10 naming variants, konkatenacja PRZED extractItemText/extractGuidanceStatus) — naprawia 4/4 false positive ABBV/CI/DXCM/AMGN gpt_missing_data | +21 |
| FIX-05 + FIX-07 | `3dbc8c4` | **FIX-05**: pure `detectDirectionConflict(signals, threshold=0.05)` w `correlation.service.ts`, integracja w `triggerCorrelatedAlert` po dedup, AlertDispatcher priority order (slot po `gpt_missing_data`), SummaryScheduler PL label "Konflikt kierunków" — naprawia 3× UNH false positive CRITICAL. **FIX-07**: w Form4Pipeline po `dispatcher.dispatch` jeśli `suppressedBy === 'sell_no_edge' \|\| 'csuite_sell_no_edge'` → SKIP `correlation.storeSignal` + `schedulePatternCheck` — naprawia GILD-class backdoor. | +22 |
| FIX-03b | _pending_ | **OptionsFlow observation gate w correlation path**: FIX-03 (29.04, b7ca9aa) commit message i scope obejmował tylko Form4 + Form8k. `OptionsFlowAlertService.processOptionsFlow:79-91` wywoływało `correlation.storeSignal` bezwarunkowo gdy `absConv >= MIN_CONVICTION_CORRELATION (0.25)`, pomijając `observationOnly` flag. Logi 24h 05.05-06.05 ujawniły 5/14 semi tickers (ONTO 9, AMKR 2, DELL 1, KLIC 1, ASX 1) → 14 storeSignal w Redis. ASX conviction 0.72 (CRITICAL range), KLIC 0.57. CLAUDE.md System totals "Semi tickers: zero footprint w Redis" było fałszywe. Materialnie 24h: low (3 wzorce wymagają form4 component, FIX-03 Form4 path blokuje obs). Długoterminowo: high (FIX-09 backtest semi vertical skażony baseline + przyszłe options-only patterns leak). Fix: lookup `tickerRepo.findOne` przed `correlation.storeSignal`, guard `if (!isObservationTicker)`. | +6 |
| FIX-10b | `77770fb` | **extractItemText boundary bug w FIX-10**: `extractItemText(filingText, '2.02')` szuka pierwszego "Item X.XX" jako koniec sekcji — gdy wrapper ma `Item 9.01 Financial Statements and Exhibits` (typowy 2.02), exhibit dołączony do `filingText` na końcu jest **WYCIĘTY** zanim trafi do prompta. MRNA replay 04.05 (filingId=1875) potwierdził: exhibit pobrany +18915 znaków, Sonnet i tak zwracał `conviction=0, direction=neutral, "exhibit niedostępny"`. Fix: pobierz `exhibit99` osobno, `itemText = (extractItemText(filingText, mainItem) + separator + exhibit99).slice(0, MAX_TEXT_LENGTH)`; `extractGuidanceStatus(filingText + exhibit99)` żeby keyword scan widział "Reiterates guidance" z press release. Validation MRNA replay po fix: conviction `0 → 0.7`, direction `neutral → positive`, summary z `$389 mln revenue (+260% YoY) / EPS -$3.40 / guidance utrzymany`. | +4 |

**Cumulative**: 438/438 unit pass, tsc clean, 10 deploy clean, 0 prod regressions.

**Earnings exhibit fetching (FIX-10):**
- 8-K Item 2.02 to wrapper (~40KB) odsyłający do Exhibit 99.1 (200-300KB press release z liczbami)
- Stary `fetchFilingText` szybką ścieżką (.htm endswith) skipowal index.json — exhibit nigdy nie pobierany
- Helper `fetchExhibit991`: directory index.json → naming regex `/ex(hibit)?[-_]?99[-_.]?1\b/` lub `/ex(hibit)?991/` (10 wariantów: `abbv-...exhibit991.htm`, `ex991.htm`, `ex-99-1.htm`, `cmpny_ex991.htm`, etc.)
- Integracja: po `detectItems` jeśli `'2.02' ∈ items` → konkatenacja `wrapper + '=== EXHIBIT 99.1 (PRESS RELEASE) ===' + exhibit` PRZED `extractItemText` i `extractGuidanceStatus` (FIX-02 keyword scan teraz widzi headline guidance z exhibit)
- Failure path graceful: brak exhibit / HTTP error / krótki text → zostaje sam wrapper, missing-data guard FIX-01 nadal łapie
- Filtering precision: regex wymaga prefiksu `ex`/`exhibit` — `abbv-20260429-991.htm` (mylące "991" bez prefix) NIE matchuje

**Defense in depth — 8-K halucynacje (warstwy obrony przeciw HUM/UNH-class):**
1. Prompt template (FIX-02b): zniknął strukturalny wymóg `true`
2. Pre-LLM extraction (FIX-02): deterministyczne keywords podawane GPT jako facts
3. Większy kontekst (FIX-02c): 6× więcej input do LLM → mniej zgadywania
4. Post-GPT floor (FIX-02): cap halucynacji bear pomimo "Confirmed facts"
5. Post-GPT missing-data guard (FIX-01): block self-contradicting alertów
6. Observation gate przed LLM (FIX-03): semi tickers zero footprint w correlation

**Options-flow stability (FIX-04):**
- Outer 6h cycle budget gwarantuje brak nakładania na następny CRON slot (24h gap)
- `buildFetchSignal` łączy per-fetch 30s timeout z cycle abort — pierwszy wygrywa
- `delay()` respektujący signal — bez tego abort musiałby czekać pełne 12.5s × pozostałe iteracje (worst case dziesiątki minut tail po abort)
- Cap 50 contracts/ticker: worst case MRNA z 200 contracts × 12.5s = 41 min/ticker → 50 = max 11 min/ticker, 42 tickers × 11min = 7.7h theoretical upper bound (z fetch timeouts), typowo 4-5h
- Telemetria: `cycle done: N/total tickers, elapsed=Xms` (success) / `cycle aborted: N/total tickers processed, elapsed=Xms` (budget exceeded)

**Correlation hardening (FIX-05 + FIX-07, 02.05.2026):**
- **FIX-05 direction conflict guard**: Pure function `detectDirectionConflict(signals, neutralThreshold=0.05)` — liczy `netByCategory: Map<source_category, sum(|conviction| × signedDirection)>`, kategoria z `|sum| < threshold` neutralna (eliminuje samo-anulujące się wewnątrz kategorii), konflikt = ≥1 positive net + ≥1 negative net w ≥2 categories. Próg 0.05 zgodny z `MIN_CONVICTION` (sygnał poniżej nie trafiłby do Redis). Wywołane w `triggerCorrelatedAlert` po dedup check, przed dispatch — `isDirectionConflict` flaga w `dispatcher.dispatch`. AlertDispatcher: priority slot po `gpt_missing_data`, przed `sell_no_edge` → `suppressedBy='direction_conflict'`. SummaryScheduler PL label "Konflikt kierunków". UNH replay (1× form4 -0.20 + 4× options +0.32..+0.53) → CONFLICT → DB only zamiast CRITICAL Telegram. Trade-off: stracimy "true mixed signal" gdzie obie strony są real (np. CFO podatki SELL + analyst upgrade options) — to feature: brak edge gdy znoszą się, lepiej DB only niż mylący CRITICAL.
- **FIX-07 Form4 sell_no_edge correlation backdoor**: Po `dispatcher.dispatch` w `Form4Pipeline.onInsiderTrade` sprawdzamy `dispatchResult.suppressedBy === 'sell_no_edge' || === 'csuite_sell_no_edge'` → SKIP `correlation.storeSignal` + `schedulePatternCheck`. V5 backtest dowiódł zero edge dla SELL → sygnał nie powinien wpływać na pattern detection. BUY (delivered=true lub `daily_limit` suppression — Telegram throttle, nie semantyka edge'u) zostaje w Redis bez zmian (V5 C-suite BUY 7d d=+0.92 ✓✓✓). Eliminuje GILD-class niewidoczną ścieżkę: Form4 alert "blokowany" w UI, ale signal aktywny → INSIDER_PLUS_OPTIONS klaster → Correlated HIGH negative na Telegram 5-30 min później.

**Pozostałe Sprint 19 P0/P1 do zrobienia (z planu 02.05.2026):**
- FIX-06 — pre-LLM EPS/Revenue/MLR numbers extraction (per filing structured input do GPT). **Status**: po FIX-10b już mniej krytyczne — exhibit dostarcza pełne liczby do Sonneta, post-FIX-10b MRNA validation pokazała 8/8 specific facts w analizie. Ewentualnie jako defense in depth dla edge case'ów gdzie exhibit ma format niestandardowy.
- FIX-08 — subsidiary executive detection (Conway "CEO, Optum" ≠ UNH parent CEO; conviction multiplier ×0.5)
- FIX-09 — managed care vertical (decyzja A obs mode 30d / B per-sector prompty po 7-tickerowym klastrze UNH/HUM/MOH/CNC/ELV/CI/CVS)
- ~~FIX-11 — MRNA-class GPT ignoring delivered Exhibit 99.1~~ **MIS-DIAGNOSED, zamknięte przez FIX-10b**. Diagnostic 04.05 ujawnił że to NIE była halucynacja LLM — `extractItemText` boundary bug obcinał exhibit zanim trafiał do prompta. Sonnet zachowywał się poprawnie ("brak danych" gdy faktycznie ich nie miał). Cross-pipeline check: Form 4 GPT 0/21 halucynacji direction w 30d → eliminuje Anthropic-wide bias. Decyzja: nie ma "MRNA halucynacja bug", jest deterministic input bug naprawiony przez FIX-10b.

Dziewięć fixów (FIX-01..05/07/10/10b) zamknęło **HUM-class halucynacje**,
**UNH-class brudne correlation signals dla semi**, **3× UNH-class direction
conflict mixed signal CRITICAL**, **GILD-class Form4 sell_no_edge backdoor
do correlation**, **prompt design errors**, **8-K wrapper-only bez liczb**,
**MRNA-class extractItemText boundary bug obcinający exhibit**, oraz
**options-flow zombie cycle** który był otwarty od 17.04. Pozostałe
FIX-06/08/09 zostają do następnych sesji (FIX-06 deprioritized po FIX-10b).

---

## 🔜 NEXT SESSION — APLS Faza 3 (~3-4h)

> Źródło: `doc/PLAN-APLS-BIOTECH-UNIVERSE-2026-05-23.md` (4-fazowy plan, sesja 23.05.2026).
> Faza 1+2 DONE (commit 687c3d0). Faza 3 = seed obs production rollout.

### Zakres prac

1. **DB seed 6 tickerów w `src/seed/seed.service.ts`**:
   - Strict tier: **URGN, ARDX, MNKD, CRSP** (sample replikuje V5 BUY $500K+ d=+0.75 7d)
   - Stretch tier: **AXSM, RCKT** (per-ticker driver weaker, treat as hypothesis test)
   - Pola: `sector='biotech_apls'`, `observationOnly=true`, `isActive=true`
   - Audit query: `SELECT symbol, sector, observation_only FROM tickers WHERE sector='biotech_apls'` po seed

2. **Form4Pipeline threshold rule** (`src/sec-filings/pipelines/form4.pipeline.ts`):
   - Stała `MIN_BUY_VALUE_BIOTECH_APLS = 500_000` (vs core healthcare `100_000`)
   - Sector branch: `if (ticker.sector === 'biotech_apls' && totalValue < 500_000) → SKIP_BELOW_THRESHOLD`
   - Logika PRZED isCsuiteRole / isDirectorRole check (efektywność: ~80% biotech BUY $<500K → no GPT call)
   - Healthcare boost ×1.2: stosuje się dla `biotech_apls` (subset healthcare semantycznie)
   - C-suite ×1.3 boost zachowany (kumulatywne dla biotech: ×1.2 × ×1.3 = ×1.56)
   - Strict tier ×1.1 lekka preferencja vs stretch tier (URGN/ARDX/MNKD/CRSP boost vs AXSM/RCKT base)

3. **30-day calendar reminder** (manual): 2026-06-22 → Faza 4 decision review.

4. **Decision gate Faza 4** (akceptowalne kryteria do unlock Telegram):
   - ≥6 BUY events $500K+ w obs window (per-ticker N>=1 minimum)
   - Hit rate 7d ≥60% (priceChange1d > 0 lub priceChange3d > 0)
   - Median alpha 7d ≥+2% raw LUB ≥+1% sector-adjusted (XBI/IBB benchmark — FIX-18 XBI MVP path)
   - **0 MRNA-class halucynacji** (defense in depth: missing_data guard + extractItemText boundary fix wszystkie deployed)

5. **Test integracyjny**: `test/integration/form4-biotech-apls.spec.ts`:
   - Mock Form4 ARDX BUY $600K (Insider role: CEO)
   - Assert: observation alert created z `nonDeliveryReason='observation'`, `correlation.storeSignal` SKIP (FIX-03 path)
   - Assert: `priceAtAlert` + `xbiAtAlert` + `ibbAtAlert` zachowane (captureAlertSnapshot helper podpięty)
   - Assert: alert.priority ≥ HIGH (C-suite ×1.3 × healthcare ×1.2 × strict tier ×1.1 = ×1.72 boost)

**Estimate**: 3-4h (seed + threshold rule + integration test + 30d reminder).

---

## 🔜 XBI Faza 2 follow-up (~5h, parallel z APLS Faza 3)

> Źródło: sesja 23.05.2026 XBI MVP shipped (commits 7ed4be6/a280dc7/86ead4f).
> Faza 1 = schema + capture helper + outcomes API DONE. Faza 2 = backfill +
> frontend toggle + analyzer integration.

### Zakres prac

1. **Backfill historic XBI/IBB at sentAt** (~33 min run):
   - Skrypt `scripts/backfill/backfill-xbi-ibb-snapshots.ts`
   - Iteruje `alerts WHERE xbi_at_alert IS NULL ORDER BY sent_at DESC LIMIT 2000`
   - Finnhub `/candle` endpoint per alert (resolution D, from=sentAt-1d, to=sentAt+1d) → wyciągnij close price w dzień sentAt
   - Rate limit Finnhub: 60 req/min → ~33 min dla 2000 alertów (2 calls per alert: XBI + IBB)
   - Persistence: `alertRepo.update(id, { xbiAtAlert, ibbAtAlert })` (zachować priceAtAlert intact)

2. **API timeline endpoint update** (`/api/alerts/timeline` raw SQL):
   - Dodać `xbi_at_alert, ibb_at_alert, xbi_price1d, xbi_price3d, ibb_price1d, ibb_price3d` w SELECT
   - Post-process pure function `computeAlphaForSlot` per row (analogicznie do `/outcomes`)
   - Response: dodać `xbiAlpha1d, xbiAlpha3d, ibbAlpha1d, ibbAlpha3d`

3. **Frontend toggle Raw/Alpha** (`frontend/src/App.tsx`):
   - State `viewMode: 'raw' | 'alpha'` (default `'alpha'` gdy `xbiAlpha1d !== null`)
   - DataPanel column renderer: if mode='alpha' → render `xbiAlpha1d` + chip "vs XBI"; else raw `priceChange1d`
   - Fallback do Raw gdy `xbiAlpha1d === null` (pre-backfill alerts)

4. **Weekly raport SQL** (`scripts/reports/weekly-report.sql`):
   - Zamienić raw `priceChange1d / 3d` na sector-adjusted alpha w outcome distribution section
   - Median alpha per rule (Form 4 Insider BUY, 8-K Earnings, INSIDER_PLUS_OPTIONS, etc.)
   - Sekcja "Sector context": XBI/IBB performance w okresie raportu

5. **Python backtest analyzer integration** (`scripts/backtest/analyzer.py`):
   - Dual-track: raw d (V5 baseline) + alpha d (new dimension)
   - Yahoo Finance XBI/IBB bulk fetch 3 lata (yfinance lub manual CSV)
   - `compute_alpha(price_at, price_horizon, xbi_at, xbi_horizon)` per event
   - Cohen's d alpha vs raw d — czy hypothesis test edge survives sector normalization

**Estimate**: 5h (backfill 33min run + timeline endpoint 1h + frontend toggle 1.5h + weekly SQL 0.5h + Python integration 2h).

---

## ⏸ FIX-18 DEFERRED — temporal awareness 8-K follow-up (revisit threshold)

> Źródło: `doc/PLAN-FIX-18-2026-05-22.md` (plan zachowany jako audit trail).
> Decyzja sesja 23.05.2026: deferred z explicit revisit threshold.

### Co to było

FIX-18 = post-GPT guard dla 8-K Item 1.01 (Material Definitive Agreement)
gdy emitent miał prior 8-K Item 1.01 lub Item 2.02 z conviction `|c|>0.7` w
ostatnich 90d. Założenie: drugi 8-K w krótkim okresie może być
fundamentalnym follow-up (M&A close po prior LOI) lub niezwiązanym
event'em — GPT bez temporal context może duplikować bull/bear thesis.

### Dlaczego deferred

1. **N=1 sample dotąd** (wymagane ≥5 cases żeby justify scope). Logi
   30d od FIX-13 deploy: 1 case (filing replay nie produkcja).
2. **XBI MVP shipped czesciowe** (schema + capture + outcomes) — backfill
   + frontend toggle + analyzer integration NIE deployed. Bez sector-adjusted
   alpha numbers FIX-18 false positive identification jest noisy.
3. **Median sector-adjusted alpha tych 5+ cases** musi być `<|1.5%| 3d`
   (czyli noise zone, prior conviction nie predicted real outcome) zanim
   guard jest mierzalnie useful.

### Revisit threshold (3 warunki, AND)

- [ ] ≥5 cases 8-K Item 1.01 follow-up po prior conviction `|c|>0.7` w 90d (zebrane z system_logs)
- [ ] XBI pipeline FULL shipped (backfill + frontend toggle + Python analyzer) — czyli XBI Faza 2 follow-up DONE
- [ ] Median sector-adjusted alpha tych 5+ cases `<|1.5%| 3d` (noise zone potwierdzenie)

### Decision deadline

**2027-05-23** (12 mies. cushion) **LUB** Sprint w którym warunki 1-3 spełnione.
Plan v3 framework: incremental over bundle, nie deploy z N=1.

**Estimate (jeśli revisit aktywuje)**: 4-5h (guard logic + 90d window
SQL aggregate + 26 testów + integration replay 5+ cases).

---

## FAZA 3 KALIBRACJA — consensus thresholds (decyzja deadline 25.05.2026)

> Empiryczne case'y z Faza 2 obserwacji (14d od FIX-13 deploy 11.05) ujawniające
> overcap/undercap FIX-12 R1/R2/R3 thresholds. Plan v3 framework:
> incremental over bundle, decyzja architektoniczna na bazie ≥3 case'ów.

### FIX-16 — Asymmetric R1 cap (extreme miss exemption)

**Trigger case (N=1)**: HIMS 11.05.2026 20:35 alert id 2402, 8-K Earnings
Miss CRITICAL, suppressed z `nonDeliveryReason='consensus_miss'`.

GPT analysis (post-cap):
- conviction: **-0.3** (cap z FIX-12 R1: "ANY metric miss + \|conv\|>0.3 → cap 0.3")
- direction: negative, magnitude: **high**, confidence: 0.72
- key_facts: "EPS -0,18 USD vs +0,04 konsensus (**-507,2% chybienie**)",
  "92% bear consistency w historii HIMS"

Price outcome (verified):

| Slot | Cena | Delta vs $29.14 |
|---|---|---|
| priceAtAlert | $29.14 | — (after-hours close +35min) |
| price1h | $25.69 | **-11.84%** |
| price4h | $25.29 | -13.19% |
| **price1d** | **$23.39** | **-19.73%** ← target short już w 1 dzień |
| price3d | $23.97 | -17.74% (stabilny dół) |
| priceOutcomeDone | true | — |

**Diagnoza**: FIX-12 R1 była zaprojektowana dla PODD case (headline BEAT
+33.9% YoY revenue, ale rynek przecenił → cap chroni przed FOMO long).
HIMS to **odwrotna sytuacja semantycznie**: headline MISS extreme (-507% EPS) +
rynek **nie wycenił w pełni** przed earnings → real short opportunity stracony,
bo Telegram nie dostarczył CRITICAL alertu.

**Propozycja R1 asymetrycznego**:
- Headline BEAT (EPS actual > 0) + ANY consensus miss → cap 0.3 (PODD ✓)
- Headline MISS (EPS actual < 0) + STRONG miss (|surprise| > 30%) → **NO cap** (HIMS would qualify, -507% >> 30%)
- Headline MISS + LIGHT miss (|surprise| < 10%) → cap 0.3 (mild bear, accept)
- Headline MISS + MEDIUM miss (10-30%) → cap 0.5 (medium confidence)
- Próg 30% TBD — kalibracja na Q2 sample (lipiec 2026)

**Decision deadline**: 25.05.2026 (Faza 2 framework — obs window 11.05-25.05).

**N=1 sample warning**: HIMS to single case. Konieczne **≥3 HIMS-class**
(headline EPS miss + |surprise|>30% + drop ≥10% 1d) przed cementowaniem
nowego progu. Plan v3: incremental over bundle, nie deploy z N=1.

**Out of scope dla Fazy 3 obecnie**: R2 (in-line ±3%) i R3 (single-metric
beat) — brak triggerów w Faza 2 window dotąd. Kalibracja po Q2 sample (lipiec).

---

## Kategorie

- **DEFERRED** — odłożone z poprzedniego sprintu (decyzja świadoma, Opcja B)
- **POST-PRODUCTION** — wymaga okna danych z produkcji do walidacji
- **RESEARCH** — eksploracja, niedeterministyczny outcome
- **TIER 2** — observability ponad Tier 1 (logging) — metrics + tracing

---

## DEFERRED (Sprint 18 → Sprint 19)

### TASK-09 Opcja B — INSIDER_CLUSTER BUY hybrid boost

**Z**: cheatsheet linia 432, TASKS-2026-04-22 #81, #86

**Decyzja Sprint 18**: Przemek wybrał Opcja A (hard disable na poziomie detekcji).
Opcja B = retroactive conviction bump na solo BUY alert gdy 2-gi insider
zglosi BUY w 7d window — większy task, wymaga alert mutation post-hoc
(modyfikacja istniejącego DB record + ewentualnie re-send Telegram).

**Status open question**: V5 dane (N=21 cluster vs N=49 single) za małe
żeby wnioskować o real edge — p>0.37 może być zarówno true null jak
i statistical underpower. Po 6+ miesiącach produkcji z TASK-09 disabled
+ solo BUY alerty + price outcomes, jeśli okaże się że 2-insider BUY
events systematycznie pokazują wyższy 30d return → Opcja B może mieć
sens. Inaczej zostaje disabled na zawsze.

**Estimate**: 4-6h (alert mutation + retry telegram + edge case'y)

---

## POST-PRODUCTION (wymaga 7d+ okna danych)

### FOLLOW-9 — Decision breakdown w weekly report

**Z**: post-Sprint 18 audyt 23.04.2026

**Problem**: Weekly report (`doc/reports/`) nie pokazuje breakdown'u alert
suppression decisions z system_logs. AlertDispatcherService loguje każdy
dispatch z `decisionReason` (action) — observation / sell_no_edge /
csuite_sell / cluster_sell / daily_limit / telegram_failed / dispatcher_unavailable.
Bez breakdown'u w raporcie nie widać proporcji "co poszło na Telegram vs
co zostało wyciszone i dlaczego".

**Rationale dla odłożenia**: bez 7d okna danych z produkcji (Sprint 18
zamknięty 23.04.2026) sam raport nie ma z czego renderować sensownych
liczb. FOLLOW-9 powinien być odpalony najwcześniej 30.04.2026 po
pierwszym tygodniu działania pełnej Sprint 18 logiki.

**Zakres**: SQL aggregate `system_logs WHERE module='alerts' GROUP BY
decision_reason` + dodać sekcję do weekly-report SQL. Ewentualnie też
breakdown per ticker.

**Estimate**: 1-2h po zebraniu danych.

---

## RESEARCH (V5-driven, niedeterministyczny)

### #10 Top-quartile options conviction bez PDUFA

**Z**: cheatsheet linia 457-458, briefing #6

Czy `conviction > 0.6` na options flow alert (bez PDUFA boost) ma edge?
Obecnie standalone options alerty wychodzą **tylko z PDUFA boost**.
Zbadać retroactively na DB alert outcomes.

### #11 EVP Sales whitelist

**Z**: cheatsheet linia 459-460

Czy senior operations (EVP Sales) zasługuje na C-suite boost? Obecnie
wyłączony przez whitelist Sprint 16b (commit b503a8e). EVP Finance/Operations/
Product/Strategy są w whitelist, EVP Sales nie. Hipoteza: revenue ownership
to insider info comparable do CFO — backtest split EVP Sales vs other EVP.

### #12 Live vs backtest hit rate comparison

**Z**: cheatsheet linia 461-462

Produkcyjne PriceOutcome data (alerts + price1h/4h/1d/3d) vs V5 predictions
(d, p, expected return). Waluta prawdy. Po Sprint 18 mamy enough data points
(form4 BUY rule + cluster SELL observation + healthcare SELL observation) —
porównać retrospektywnie czy edge zaobserwowany w backtest realizuje się live.

**Estimate**: 1 dzień analityki + 0.5 dnia raport.

### #13 Non-healthcare universe rozszerzenie

**Z**: cheatsheet linia 463+

V5 H6 pokazuje że control SELL (non-healthcare) ma d=+0.10 30d Bonferroni
✓✓✓. Hipoteza: insider edge istnieje poza healthcare na dłuższym horyzoncie.
Rozważyć dodanie 5-10 non-healthcare tickerów (pre-zwalidowanych)
w observation mode i zebranie 3-6 mies. danych przed włączeniem alertów.

---

## TIER 2 — Observability beyond Tier 1

### Metrics layer

**Z**: doc/plan-observability-tier1.md:45 (Tier 2: Metrics layer — osobny plan)

Tier 1 (Sprint 17, 22.04 audyt) pokrywa structured logging w `system_logs`
z 5 enriched columns (traceId, level, ticker, decision_reason, parentTraceId).
Tier 2 = metrics export do Prometheus/Grafana (counter/histogram per
decision_reason, latency p95/p99 per pipeline stage).

**Wartość**: dashboard "co system robi w czasie rzeczywistym" — ile alertów
poszło, ile było suppressed, latencje GPT/Telegram/SEC fetch, queue depth
BullMQ. Obecnie wszystko w `system_logs` (SQL queries) — Tier 2 daje
push-based monitoring i alarming.

**Estimate**: 2-3 dni (Prometheus exporter + Grafana dashboards + alerting
rules).

---

## ADMIN / Cleanup (low priority)

### `null as any` w alerts.controller.ts:367-368

**Z**: FOLLOW-2 raport agenta (out of scope tamtego task'a)

Po FOLLOW-2 (typed gptAnalysis column) `null as any` przy resetowaniu
`filing.gptAnalysis = null` / `filing.priceImpactDirection = null`
przestał być semantycznie potrzebny — `null` pasuje do `SecFilingAnalysis | null`.
Cast nadal przechodzi tsc bo `null as any` jest szerszy assignable, ale
jest dead code teraz.

**Estimate**: 5 min (delete `as any` + tsc verify).

### SystemHealthPanel.tsx tsc errors

**Z**: FOLLOW-3 raport agenta (out of scope tamtego task'a)

FinBERT cleanup 22.04.2026 usunął `pipeline` field z `SystemOverview` API
response — `frontend/src/components/SystemHealthPanel.tsx` nadal się do
niego odwołuje. Pre-existing tsc errors nie wprowadzone przez FOLLOW-3,
ale powinny zostać uprzątnięte.

**Estimate**: 15 min (usunąć `.pipeline` references + tsc verify).

### Vite config bind-mount

**Z**: FOLLOW vite Tailscale (commit acffb83)

Obecnie `frontend/vite.config.ts` jest w image (COPY), więc każda zmiana
configa = `docker compose build frontend`. Rozszerzyć compose volumes
o `./frontend/vite.config.ts:/app/vite.config.ts` żeby hot-reload bez
rebuildu.

**Estimate**: 5 min.

### `frontend/package-lock.json` tracking decision

**Z**: FOLLOW-3 raport agenta

Agent musiał `npm install` na Jetsonie — wygenerowany lockfile untracked.
Decyzja: commit dla deterministic builds (rekomendowane) vs gitignore
(obecnie de facto). Backend (`package-lock.json` w root) jest tracked, więc
spójność sugeruje commit także frontend lockfile.

**Estimate**: 5 min decyzja + commit.

---

## Pre-flight przed startem Sprint 19

- [ ] Confirm 7d production data window dla FOLLOW-9 (najwcześniej 30.04.2026)
- [ ] Wybrać 1-2 research items (#10-13) do priorytetowej walidacji
- [ ] Wybrać czy DEFERRED (Opcja B TASK-09) odpalać teraz czy poczekać na live data
- [ ] Tier 2 metrics — yes/no decyzja (3 dni inwestycja, dług observability)
