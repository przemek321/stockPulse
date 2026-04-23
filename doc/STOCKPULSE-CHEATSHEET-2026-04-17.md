# StockPulse — Ściąga (cheat sheet)

> Szybka referencja dla obu: Przemek + Claude. Aktualny stan 17.04.2026.
> Zapamiętaj gdzie to jest gdy coś jest niejasne w rozmowie.

---

## 1. HIPOTEZY BACKTESTU — co każda testuje

Wszystkie testy robią Welch's t-test + Cohen's d (ddof=1, pooled,
winsorized 1%) na returns po event_date vs baseline (losowe dni na tych
samych tickerach). N=5000-10000 baseline samples.

| Hipoteza | Nazwa | Co testuje | Direction | V5 verdict (f69cfa8) |
|---|---|---|---|---|
| **H1** | INSIDER_CLUSTER | 2+ insiderów w 7 dniach → czy cluster ma edge | any | **Cluster BUY nie dodaje wartości** ponad solo BUY (N=21 vs 49, p>0.37 wszystkie h.) |
| **H2** | SINGLE_CSUITE | Pojedyncza C-suite discretionary transakcja | any; buy/sell subs | BUY edge ✓✓✓ (V5 d=+1.18 3d Bonf ✓). SELL zero edge — **disable commitnięte (abff1c9)** |
| **H3** | PLAN_VS_DISCRETIONARY | 10b5-1 vs discretionary | sell | **10b5-1 N=0** (Python per-tx parser). Produkcyjny parser: OK (audit 5dc2a36) |
| **H4** | ROLE_SENIORITY | C-suite vs Director vs Other SELL | sell | Wszystkie SELL d≈0 |
| **H5** | BUY_SIGNALS | Discretionary BUY | buy | **Strongest edge** (V5: all BUY 1d d=+1.16 Bonf strict, C-suite 1d d=+1.62) |
| **H6** | HEALTHCARE_VS_CONTROL | Sector-specific edge dla SELL? | sell | **Healthcare d≈0, Control d=+0.10** (N=1393, 30d Bonf ✓). Direct HC-vs-CTRL d=-0.14 30d p=0.016 — healthcare jest SŁABSZY niż control dla SELL |

**Dlaczego direction ma znaczenie:** hit rate liczony jako:
- `buy`: % eventów gdzie cena WZROSŁA po eventie (edge = cena rośnie po BUY)
- `sell`: % eventów gdzie cena SPADŁA po eventie (edge = cena spada po SELL)
- `any`: % eventów gdzie |ruch| > 1% (edge = duży ruch w którąkolwiek stronę)

---

## 2. KLUCZOWE METRYKI — jak czytać liczby

### Cohen's d (effect size)

```
d = (mean_events - mean_baseline) / pooled_std
```

Interpretacja (Cohen 1988):
- **|d| < 0.2** — mały/trywialny efekt (może być noise)
- **|d| 0.2-0.5** — mały efekt ale realny
- **|d| 0.5-0.8** — średni efekt
- **|d| > 0.8** — duży efekt
- **|d| > 1.5** — bardzo duży (rzadkie w finansach, sprawdź N)

W finansach typowa signal quality: d=0.1-0.3 to już coś, d>0.5 to rzadki
prawdziwy edge, d>1.0 wymaga weryfikacji czy nie ma bugu/overfittingu.

### p-value — raw vs Bonferroni

**Raw p-value** = pojedynczy test, próg p<0.05.

**Bonferroni-adjusted:** dla N równoległych testów, właściwy próg:
```
alpha_bonferroni = 0.05 / N_tests
alpha_strict = 0.01 / N_tests
```

W V4 backtest N=112 testów → **próg 0.000446** (nie 0.05).

**Dlaczego to ma znaczenie:**
- 46/112 testów V4 było raw-significant (p<0.05) → ~42% sukces
- 24/112 (21%) przeszło Bonferroni → prawdziwe sygnały
- Różnica 22 = **false positives** przez multiple testing

**Reguła:** jeśli test przechodzi Bonferroni, ufaj. Jeśli tylko raw
p<0.05 w 100+ testach, traktuj jako "może być noise".

### Hit rate

Zawsze patrz **hit rate vs baseline hit rate**, nigdy hit rate sam. Przykład
pułapki: "Insider BUY hit rate 70%" brzmi dobrze, ale baseline może być
65% (bull market). Różnica 5pp to edge, nie absolute 70%.

### N — effective sample size

- **N < 30** — za mało, wnioski ostrożne, Cohen's d niestabilne
- **N 30-100** — użyteczne dla strong signals (d>0.5)
- **N 100-1000** — solidne
- **N > 1000** — wysokiej jakości, nawet mały d znaczący

Pułapka: `buys_above_1000k N=12` ma d=2.56 p=0.008 Bonferroni-true, ale
N=12 oznacza że 1 outlier mógłby zmienić obraz. Trzymaj w głowie że
wyniki są "right for this dataset" ≠ "reliable going forward".

### Direction w stat tests

Kiedy `direction='sell'`, **pozytywne d = edge** (mean SELL events <
mean baseline, czyli cena spadła bardziej niż random). Gdy
`direction='buy'`, pozytywne d = edge (cena wzrosła bardziej). Gdy
`direction='any'`, d mierzy tylko czy coś się dzieje (abs ruch).

---

## 3. BASELINES — czym porównujemy

### Standard baseline (`_compute_baseline`)

Losowe daty na tych samych tickerach. Samples ~10 000. Mierzy "typowy
ruch cenowy w tym universum" bez filingu.

### Dip baseline (`_compute_dip_baseline`)

Losowe dni **po dipie >2%**. Samples ~5 000. Mierzy "co się dzieje po
spadku" — kontroluje mean reversion.

**Kluczowy test:** `vs_random_dip_*` sprawdza czy insider BUY edge
przeżywa kontrolę mean reversion. V4: d=0.61 na 7d → TAK, to nie
jest mean reversion. To jest **najważniejszy** z testów BUY.

### Common vs own baseline (H6)

- `healthcare_vs_common`: healthcare events vs baseline_all (healthcare + control)
- `control_vs_common`: control events vs baseline_all
- `healthcare_vs_own_baseline`: legacy, niewymienne (różne universe)
- `hc_vs_ctrl_direct`: healthcare events vs control events bezpośrednio

**V4 PROBLEM:** control N=0 → H6 nieważne, do naprawy w Sprint 17.

---

## 4. SUB-GROUPS i co znaczą

### H2 (Single C-suite) sub-groups

- `all_sells`: wszystkie C-suite SELL (dowolny value)
- `all_buys`: wszystkie C-suite BUY
- `sells_above_100k/500k/1000k`: progi value thresholds
- `buys_above_100k/500k/1000k`: analogicznie BUY

### H5 (BUY signals) sub-groups

- `csuite_buys`: BUY where `is_csuite=true`
- `director_buys`: BUY where `is_csuite=false`. **UWAGA:** includes 10%
  owners + non-C-suite officers. Mylące nazewnictwo — to nie tylko
  Directors.
- `healthcare_buys`: BUY where `is_healthcare=true`. W V4 = all_buys bo
  control universe jest pusta.
- `buys_above_100k/500k`: progi
- `vs_random_dip_ALL`: wszystkie BUY vs dip baseline (mean reversion control)
- `vs_random_dip_CSUITE`: C-suite BUY vs dip baseline

### H4 (Role seniority) sub-groups

- `csuite`: SELL przez C-suite
- `director`: SELL przez Director (pure, nie 10% owner)
- `other`: reszta (10% owners, junior officers)

### H6 (Healthcare vs Control) sub-groups

- `healthcare_vs_common`: jak wyżej (common baseline)
- `control_vs_common`: **N=0 w V4 — broken**
- `healthcare`/`control_group`: legacy (own baseline, niewymienne)
- `hc_vs_ctrl_direct`: Welch's t-test hc events vs ctrl events bezpośrednio

---

## 5. AKRONIMY I SKRÓTY — glossarium

### Statystyka

| Skrót | Pełna nazwa | Po polsku |
|---|---|---|
| **d** | Cohen's d | Miara wielkości efektu |
| **p** | p-value | Prawdopodobieństwo przypadku |
| **N** | sample size | Liczność próby |
| **ddof** | delta degrees of freedom | Korekcja stopni swobody (1 = sample, 0 = population) |
| **pooled std** | pooled standard deviation | Łączone odchylenie std dwóch grup |
| **winsorize** | winsoryzacja | Obcinanie outliers (np. 1% każdej strony) |
| **FWER** | family-wise error rate | Prawdopodobieństwo ≥1 false positive w N testach |
| **FDR** | false discovery rate | Proporcja false positives wśród significant results |
| **Bonferroni** | — | Konserwatywna korekcja: alpha/N |
| **Welch's t-test** | — | T-test bez założenia równej wariancji (dla nierównych N) |
| **Sig** | significant | Istotny statystycznie |
| **HR** | hit rate | % eventów w oczekiwanym kierunku |

### Finansowe

| Skrót | Znaczenie |
|---|---|
| **Form 4** | SEC filing: insider transactions (CEO, CFO, 10% owners) |
| **Form 8-K** | SEC filing: material events (earnings, M&A, bankruptcy) |
| **10b5-1** | Pre-scheduled trading plan (automat, non-discretionary) |
| **Discretionary** | Transakcja według decyzji insidera (nie automatu) |
| **Rule 10b5-1 Transaction** | Konkretny flag w XML per transakcja |
| **BUY vs SELL (P vs S)** | Kody SEC: P=Purchase, S=Sale |
| **PDUFA** | FDA decision date (FDA Prescription Drug User Fee Act) |
| **C-suite** | Chief-level executives (CEO, CFO, COO, CTO, CIO, CMO, CSO, CLO) |
| **EVP** | Executive Vice President (nie automatycznie C-suite w obecnej whitelist) |
| **XBI** | SPDR S&P Biotech ETF (sector benchmark) |
| **NYSE** | New York Stock Exchange |
| **EOD** | End of day (vs intraday) |
| **CIK** | Central Index Key (SEC identifier per firma/person) |
| **SIC** | Standard Industrial Classification (SEC industry code) |

### StockPulse-specific

| Nazwa | Znaczenie |
|---|---|
| **INSIDER_CLUSTER** | 2+ insiderów w 7d, Redis Sorted Set pattern |
| **INSIDER_PLUS_8K** | Insider + 8-K w 24h |
| **INSIDER_PLUS_OPTIONS** | Insider + options flow w 120h/5d |
| **Form4Pipeline** | NestJS service obsługujący Form 4 alerts |
| **Form8kPipeline** | NestJS service obsługujący 8-K alerts |
| **AlertEvaluator** | Generic rule evaluator (onFiling, onCorrelation) |
| **AlertDeliveryGate** | Shared daily limit (Sprint 16 FLAG #10) |
| **TickerProfile** | 90-day per-ticker profile, calibration rules |
| **CorrelationService** | Redis Sorted Sets, cross-signal detection |
| **PriceOutcomeService** | Post-alert price tracking (4 sloty: 1h/4h/1d/3d) |
| **Observation mode** | Sector=semi, observationOnly=true → DB only, no Telegram |
| **Silent rule** | Rule fires alert to DB ale bez Telegram (nonDeliveryReason='silent_rule') |
| **Spike ratio** | Options volume / avg20d. >3× = spike, >1000× = suspicious (×0.5) |
| **Conviction** | Score [-2, +2] from GPT, boosted by rules (C-suite ×1.3, healthcare ×1.2) |

---

## 6. DECISION REASONS w system_logs — co każdy znaczy

| Reason | Znaczenie | Akcja |
|---|---|---|
| `ALERT_SENT_TELEGRAM` | Alert poszedł do Telegram | — |
| `ALERT_DB_ONLY_OBSERVATION` | Sector observation mode (semi) | DB only |
| `ALERT_DB_ONLY_SILENT_RULE` | Rule marked silent (Sentiment Crash itp.) | DB only |
| `ALERT_DB_ONLY_DAILY_LIMIT` | AlertDeliveryGate daily limit hit | DB only |
| `ALERT_DB_ONLY_SILENT_HOUR` | Nocna godzina | DB only |
| `SKIP_RULE_INACTIVE` | Rule isActive=false w DB | skip |
| `SKIP_LOW_VALUE` | totalValue < threshold (e.g. $100K dla BUY) | skip |
| `SKIP_NOT_ALERTABLE` | Transaction type nie w whitelist (TAX, GRANT) | skip |
| `SKIP_NOT_8K` | onFiling dostał non-8K (Form 4/3) | skip w Form8kPipeline |
| `STORED` | Signal zapisany do Redis Sorted Set | store only |
| `CORRELATION_STORED` | Options flow signal do correlation | store only |
| `NO_PATTERNS` | runPatternDetection nie znalazł wzorca | — |
| `PATTERNS_DETECTED` | Pattern found (INSIDER_CLUSTER itp.) | alert path |
| `TOO_FEW_SIGNALS` | <2 sygnałów w oknie | skip |

---

## 7. V4 BACKTEST — kluczowe liczby jednym rzutem oka

Zakres: 2023-04-01 → 2026-04-05, 40 874 transakcji, 28 healthcare tickers.

### Edge confirmed (Bonferroni ✓, threshold p<0.000446)

| Signal | N | 7d d | Bonferroni |
|---|---|---|---|
| **All discretionary BUY** | 84 | +0.68 | ✓✓✓ strict |
| **C-suite BUY** | 28 | +0.82 | ✓✓✓ |
| **BUY >$100K** | 65 | +0.72 | ✓✓✓ |
| **BUY >$500K** | 41 | +0.83 | ✓✓✓ |
| **BUY >$1M (1d/3d)** | 12 | +2.56 (1d), +1.46 (3d) | ✓✓✓ |
| **Director BUY** | 56 | +0.59 | ✗ (raw ✓✓✓) — N mały |
| **vs dip baseline (crucial)** | 84 | +0.61 | ✓✓✓ strict |

### Edge NOT confirmed (wszystkie SELL + H6)

| Signal | N | d (najlepszy) | Verdict |
|---|---|---|---|
| All C-suite SELL | 973 | ≈0 all horizons | **No edge** |
| SELL >$500K | 492 | +0.09 (7d, p=0.15) | **No edge** |
| SELL >$1M | 359 | +0.01 (7d) | **No edge** |
| H1 sell_clusters | 369 | -0.15 (1d, raw ✓✓ but Bonf ✗) | Noise |
| H1 buy_clusters | 21 | +0.45 (7d, Bonf ✗) | Signal but underpowered |
| H4 csuite SELL | 973 | ≈0 | **No edge** |
| H4 director SELL | 368 | +0.13 (7d) | **No edge** (contrast: V3 had d=0.171) |
| H6 hc vs control | 973 vs **N=0** | — | **BROKEN: control empty** |

### Kluczowe obserwacje V4

1. **Monotonic gradation:** $100K→$500K→$1M: d=+1.20→+1.58→+2.56 (1d). Robust.
2. **100% hit rate BUY>$1M/3d** (N=12). Remarkable ale N low.
3. **vs dip baseline d=+0.61 (7d):** edge nie jest mean reversion.
4. **H3 10b5-1 count = 0:** parser per-transaction znalazł zero 10b5-1 trades
   w 3-letnim datasecie. Oznacza że stary detection (string search całego
   XML) dawał wyłącznie false positives. Filtr `is10b51Plan → skip` w
   produkcji do sprawdzenia.
5. **H6 control N=0:** filter `is_healthcare==True` w `run_analysis`
   wywala control group przed H6 comparison. Do naprawy Sprint 17.
6. **Director BUY d=+0.59:** Director BUY ma edge. Obecnie nie ma boost
   (tylko Director SELL jest hard-skip).
7. **Zero SELL edge:** żaden wariant SELL nie przeszedł Bonferroni.
   V4 ostatecznie potwierdza że "Form 4 Insider SELL" alertowanie w
   produkcji generuje szum. **Decyzja Sprint 16b→17: Form4Pipeline SELL
   route do observation mode (DB only, no Telegram)** — validated przez
   V4, poprzednie "pending V4" rozstrzygnięte.
8. **Cluster przegrywa z single BUY (counterintuitive):**
   - H1 csuite_clusters 7d: d=+0.07 (N=340, Bonf ✗) — clustered C-suite events
   - H5 csuite_buys 7d: d=+0.82 (N=28, Bonf ✓✓✓) — pojedyncze C-suite BUY
   - H1 buy_clusters 7d: d=+0.45 (N=21, Bonf ✗) — clustered BUY events
   - H5 buys_above_500k 7d: d=+0.83 (N=41, Bonf ✓✓✓) — pojedyncze duże BUY

   Czyli **pojedynczy duży BUY (>$500K) ma mocniejszy edge niż cluster
   2+ insiderów**. Cluster pattern może wprowadzać noise (2 small
   transakcje w tygodniu = cluster, ale edge słabszy niż 1 large BUY).
   Hipoteza: insider cluster w V4 dominowany przez SELL (369 sell vs 21
   buy clusters) — sygnał rozcieńczony. **V5 potwierdza** direct test
   cluster_buy_vs_single_buy: p>0.37 wszystkie horyzonty (patrz V5 delta).

### V5 delta (commit f69cfa8, 18.04.2026)

V5 = V4 + H6 control group fix + H1 cluster_buy_vs_single_buy analysis
(kod e07bbc2). 19/128 Bonferroni (14.8%) vs V4 24/112 (21.4%). Threshold
p<0.000391 (V4: 0.000446). Więcej hipotez → surowszy test.

**H6 naprawione (control N=1393, wcześniej N=0):**

```
Horizon  | Healthcare SELL  | Control SELL      | Direct HC-vs-CTRL
1d       | d=-0.06 p=0.07   | d=-0.00 p=0.97    | d=-0.06 p=0.09
3d       | d=-0.07 p=0.17   | d=+0.05 p=0.06    | d=-0.11 p=0.03 raw
7d       | d=+0.00 p=0.84   | d=+0.09 p=0.0004  | d=-0.08 p=0.20
30d      | d=-0.08 p=0.28   | d=+0.10 p=0.0002 ✓| d=-0.14 p=0.02 raw
```

**Kluczowa obserwacja V5 (przeciwna intuicji):** Healthcare insider SELL
ma **zero edge**. Control (non-healthcare: AAPL, MSFT, JPM, XOM...)
insider SELL ma **realny mały edge d=+0.10 na 30d, Bonferroni ✓✓✓**.
Direct d=-0.14 (healthcare słabszy niż control).

**Implikacja:**
- Dla Twojego universe (28 healthcare) SELL disable jest **prawidłowy** — healthcare SELL nadal ma d≈0.
- Dla hipotetycznego universe non-healthcare, insider SELL mógłby być sygnałem. Ale dziś irrelevant.
- **Początkowa hipoteza "healthcare insider edge jest silniejszy niż general market"** jest FAŁSZYWA dla SELL. Dla BUY niewiadomo (w V5 wszystkie BUY były healthcare, brak control BUY do porównania).

**H1 cluster_buy_vs_single_buy (nowa analiza):**

- N_cluster=21, N_single=49, tx_type=BUY
- 1d: p=0.445 | 3d: p=0.700 | 7d: p=0.955 | 30d: p=0.371
- d: JSON ma `None` (bug w `_direct_cluster_vs_single` zapisie, nie liczony poprawnie — do fixu w Sprint 18).

**Wniosek:** czekanie na 2-giego insidera dla BUY alert **nie daje
statystycznej przewagi** nad solo BUY. p>0.37 zawsze. TODO Sprint 18:
rozważ disable `INSIDER_CLUSTER` pattern dla BUY direction (SELL już
observation od Sprint 15).

**BUY edge robustness (V4 → V5):**

| Signal | V4 7d d | V5 7d d | Trend |
|---|---|---|---|
| C-suite BUY (csuite_buys) | +0.82 | +0.92 | +0.10 stronger |
| C-suite BUY (vs_random_dip_CSUITE) | +0.75 | +0.76 | stable |
| All BUY (healthcare_buys) | +0.68 | +0.75 | +0.07 |
| BUY >$500K 1d | +1.58 | +1.77 | +0.19 |

V5 potwierdza V4 BUY edge — nie był artefakt, liczby stabilne.

---

## 8. PRODUCTION PIPELINE — co się dzieje z Form 4 transakcją

```
SEC EDGAR (submissions.json → filing XML)
    ↓
sec-edgar.service.ts → _parse_form4_xml (mergeOwnerRoles FLAG #30)
    ↓
emits NEW_INSIDER_TRADE event
    ↓
Form4Pipeline.onInsiderTrade()
    ↓
  [checks order]
    1. transactionType w {BUY, SELL}? else SKIP_NOT_ALERTABLE
    2. totalValue >= threshold? else SKIP_LOW_VALUE
    3. is10b51Plan? → SKIP (discretionary only filter)
    4. Director + SELL? → SKIP (V4 confirmed no edge)
    5. Ticker observationOnly? → ALERT_DB_ONLY_OBSERVATION
    6. DailyLimit (AlertDeliveryGate) hit? → ALERT_DB_ONLY_DAILY_LIMIT
    7. Silent hour? → ALERT_DB_ONLY_SILENT_HOUR
    8. GPT conviction analysis (TickerProfile injected)
    9. Rule boosts (C-suite ×1.3, healthcare ×1.2)
    10. Final alert → Telegram
    ↓
  emits NEW_INSIDER_SIGNAL event
    ↓
CorrelationService.storeSignal (Redis Sorted Set)
    ↓
CorrelationService.runPatternDetection (3 patterns: CLUSTER, 8K, OPTIONS)
    ↓
if pattern → correlated alert
    ↓
PriceOutcomeService (CRON 1h NYSE) tracks 1h/4h/1d/3d outcomes
```

### Side events

- `AlertEvaluator.onFiling` — obsługuje 8-K (Form 4 już obsłużony w Form4Pipeline)
- `AlertEvaluator.onInsiderTrade` — **USUNIĘTY** w commit 98b3741 (Sprint 16b)

---

## 9. SPRINT HISTORY — co się stało kiedy

| Sprint | Data | Co zrobione |
|---|---|---|
| 10 | — | Options Flow pipeline (Polygon EOD, PDUFA boost) |
| 11 | 03.04 | Wyłączono sentiment (FinBERT, StockTwits). Form4Pipeline przejął insider trades od AlertEvaluator |
| 12 | 04.04 | Migracja z Azure OpenAI na Anthropic Claude Sonnet. Dashboard Status Systemu |
| 13 | 05.04 | Signal Timeline tab |
| 14 | 05.04 | TickerProfile (90d cache 2h TTL) + Glossary tab |
| 15 | 06.04 | Backtest V1 3Y (d=0.43 all BUY). BUY rule added. Director SELL hard skip. INSIDER_CLUSTER SELL → observation |
| 15 P0.5 | 10.04 | Backtest V2 — fix selection bias (42→28 healthcare overlap). BUY >$1M d=0.706 |
| 16 | 06.04 | UTC fix Options CRON 20:30. INSIDER_PLUS_OPTIONS 120h. EDGAR 100/7d |
| 17 | 09.04 | Semi Supply Chain — 14 tickerów observation mode |
| 16 P0 fixes | 16.04 | 6 P0 fixy (commits c2d8ae9..7fe870b): FLAG #30, #25, #21, #8, #26, #10 |
| 16b backtest | 16/17.04 | Python backtest fixes (FLAG #32, #34, #35, #37, #40). V4 results |
| 16b interim | 17.04 | 5 commitów post-logs (commits 98b3741..3277deb): dead handler, Options timeout, C-suite whitelist, CLAUDE.md, test fixes |

---

## 10. PENDING — co jeszcze do zrobienia

### ✅ RESOLVED Sprint 17 (implemented + validated)

1. ✅ **SELL disable (healthcare)** — implementacja: commit `abff1c9`.
   V4+V5 potwierdzają d≈0 dla healthcare SELL. Produkcja: SELL → DB only.
2. ✅ **Director BUY boost ×1.15** — implementacja: commit `e07bbc2`.
   V4/V5 d=+0.59 raw sig. Wąsko do `/\bDirector\b/` (nie wszystkie non-C-suite).
3. ✅ **H6 control group fix** — implementacja: commit `e07bbc2`.
   V5 N_ctrl=1393 (wcześniej 0). **Wynik:** healthcare NIE ma sector-specific edge
   dla SELL — control jest nawet silniejszy (d=+0.10 vs -0.08 na 30d).
4. ✅ **H1 cluster_buy_vs_single_buy** — implementacja: commit `e07bbc2`.
   V5: p>0.37 wszystkie horyzonty, cluster nie dodaje wartości ponad solo BUY.
5. ✅ **Production 10b5-1 parser audit** — verified w commit message `5dc2a36`:
   produkcyjny parser używa per-transaction `Rule10b5-1Transaction` path
   (NIE naive string search). Żaden fix nie potrzebny.

### Sprint 18 candidates (V5-driven)

6. ✅ **INSIDER_CLUSTER disable dla BUY direction** — DONE TASK-09 (23.04.2026).
   V5 cluster_buy_vs_single_buy p>0.37 wszystkie horyzonty. Fix: `detectInsiderCluster`
   w `correlation.service.ts` zwraca `null` dla `dir==='positive'`. SELL zostaje
   (observation mode Sprint 15). 6 nowych testów w `correlation.spec.ts`. Historic
   audit 90d: 0 BUY cluster alertów w DB (retroactive archive niepotrzebny).
   Opcja B hybrid boost (retroactive conviction bump na solo BUY alert)
   odłożona na Sprint 19.
7. **C-suite detection ujednolicenie** (quality fix, pre-existing):
   `form4.pipeline.ts:119` używa starego regexa `/\bChief\b/i.test(role)`,
   podczas gdy linia 240 używa `isCsuiteRole()` (whitelist). Niespójność
   semantyczna — zmień na `isCsuiteRole(role)`. Planowane Etap 5 w
   execution-plan (doc/sprint17-execution-plan.md).
8. **d=None bug w `_direct_cluster_vs_single`** — V5 JSON ma `n_a=None
   n_b=None d=None` dla cluster_buy_vs_single_buy horyzontów (tylko p-value
   wyliczony). Fix w `scripts/backtest/analyzer.py` funkcja `_direct_cluster_vs_single`.
9. **report_generator nie renderuje `hc_vs_ctrl_direct` i `cluster_buy_vs_single_buy`**
   — sekcje są w JSON, brak w markdown. Generator pomija sub_groups z nie-standardowym
   `horizons` schemas (n_a/n_b zamiast n). Fix w `scripts/backtest/report_generator.py`.

### Sprint 18+ research items

10. **Top-quartile options conviction** — czy conviction>0.6 bez PDUFA
    ma edge? (briefing #6)
11. **EVP Sales whitelist** — czy senior operations (EVP Sales) zasługuje
    na C-suite boost? (obecnie wyłączony przez whitelist b503a8e)
12. **Live vs backtest hit rate** — produkcyjne PriceOutcome data vs V5
    predictions. Waluta prawdy.
13. **Non-healthcare universe rozszerzenie** (V5-driven):
    V5 H6 pokazuje że control SELL ma d=+0.10 Bonf ✓✓✓ na 30d. Horyzont
    30d jest poza produkcyjnym PriceOutcome (max 3d), więc actionability
    ograniczona. Ale ciekawe czy mid-cap tech insider SELL jest sygnałem
    dla 1-3d horyzontu. Wymagałoby: fetch non-healthcare insider trades,
    re-run backtest z shorter horizons.

### Unfixed bugs

14. **FLAG #28** — SEC EDGAR collector fetch bez timeout (osobny od
    Options timeout naprawionego w d78a92f).
15. **FLAG #42** — Python backtest baseline sampling uniform per-ticker
    (skipped w HANDOFF #2, sprawdź jeśli V4/V5 ticker concentration wysoka).

---

## 11. ROUTING DECYZJI — gdzie co idzie

Gdy pojawi się coś w ruchu produkcyjnym, najpierw sprawdź tutaj zanim zaczniesz debug:

| Symptom | Najczęstsza przyczyna | Gdzie sprawdzić |
|---|---|---|
| 3 alerty C-suite SELL na Telegram | Stary rule "Form 4 Insider Signal" — ale V4 mówi zero edge | `Form4Pipeline` SELL branch (pending disable) |
| High-conviction options zignorowane | Brak PDUFA context (PDUFA.bio count=0) | `OptionsFlowAlertService` pdufaBoosted filter |
| "Chief X Officer" dostał boost mimo że nie powinien | Sprawdź `C_SUITE_PATTERNS` whitelist (Sprint 16b) | `form4.pipeline.ts:18-48` |
| Telegram alert duplikat 200ms | No deduplication per-ticker w krótkim oknie | `AlertDeliveryGate` (obecnie tylko daily limit) |
| Options Flow 11h zombie | Brak timeout w fetch | naprawione w d78a92f |
| SKIP_RULE_INACTIVE spam | Dead handler | naprawione w 98b3741 |
| "Chief Comm & Corp Aff" alert | Stary /\bChief\b/ regex matched | naprawione w b503a8e |
| `is10b51Plan` skipuje discretionary | Produkcyjny parser per-tx OK — verified 5dc2a36 audit | no action needed |
| Healthcare SELL na Telegram | Stary "Form 4 Insider Signal" rule | naprawione w abff1c9 (V4+V5 driven) |
| Director BUY conviction niedoszacowany | Brak boost przed Sprint 17 | naprawione w e07bbc2 (×1.15) |

---

**Ostatnia aktualizacja:** 18.04.2026 po V5 backtest (commit f69cfa8).
**Next update trigger:** live vs backtest hit rate comparison (Sprint 18
research item #12), albo fix reportu dla cluster_buy_vs_single_buy d values.

**Historia V4 → V5:**
- V4 (e1ab795): 112 testów, 24 Bonf ✓. H6 broken (ctrl N=0). No cluster-vs-single.
- V5 (f69cfa8): 128 testów, 19 Bonf ✓ (threshold p<0.000391). H6 fixed. Cluster-vs-single answered (no edge).
