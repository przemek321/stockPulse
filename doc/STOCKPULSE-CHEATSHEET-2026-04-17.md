# StockPulse — Ściąga (cheat sheet)

> Szybka referencja dla obu: Przemek + Claude. Aktualny stan 17.04.2026.
> Zapamiętaj gdzie to jest gdy coś jest niejasne w rozmowie.

---

## 1. HIPOTEZY BACKTESTU — co każda testuje

Wszystkie testy robią Welch's t-test + Cohen's d (ddof=1, pooled,
winsorized 1%) na returns po event_date vs baseline (losowe dni na tych
samych tickerach). N=5000-10000 baseline samples.

| Hipoteza | Nazwa | Co testuje | Direction w kodzie |
|---|---|---|---|
| **H1** | INSIDER_CLUSTER | 2+ insiderów w 7 dniach → czy cluster ma edge | any (abs ruch >1%) |
| **H2** | SINGLE_CSUITE | Pojedyncza C-suite discretionary transakcja | any ogółem; buy/sell w sub-groups |
| **H3** | PLAN_VS_DISCRETIONARY | 10b5-1 (automat) vs discretionary (decyzja) | sell (hit = price down) |
| **H4** | ROLE_SENIORITY | C-suite vs Director vs Other dla SELL | sell |
| **H5** | BUY_SIGNALS | Discretionary BUY — czy predyktywne? | buy (hit = price up) |
| **H6** | HEALTHCARE_VS_CONTROL | Sector-specific edge dla C-suite SELL? | sell |

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

| Signal | N | 7d d | Bonferroni | V4 verdict |
|---|---|---|---|---|
| **All discretionary BUY** | 84 | +0.68 | ✓✓✓ strict | Keep, Form 4 BUY rule |
| **C-suite BUY** | 28 | +0.82 | ✓✓✓ | ×1.3 boost |
| **BUY >$100K** | 65 | +0.72 | ✓✓✓ | threshold confirmed |
| **BUY >$500K** | 41 | +0.83 | ✓✓✓ | tier boost candidate |
| **BUY >$1M (1d/3d)** | 12 | +2.56 (1d), +1.46 (3d) | ✓✓✓ | signal, ale N=12 ostrożnie |
| **Director BUY** | 56 | +0.59 | ✗ (raw ✓✓✓) — N mały | ×1.15 boost (Sprint 17 #1, e07bbc2) |
| **vs dip baseline (crucial)** | 84 | +0.61 | ✓✓✓ strict | nie mean reversion |

### Edge NOT confirmed (wszystkie SELL + H6)

| Signal | N | d (najlepszy) | Verdict | V4 verdict |
|---|---|---|---|---|
| All C-suite SELL | 973 | ≈0 all horizons | **No edge** | observation mode (abff1c9, 5dc2a36) |
| SELL >$500K | 492 | +0.09 (7d, p=0.15) | **No edge** | observation mode |
| SELL >$1M | 359 | +0.01 (7d) | **No edge** | observation mode |
| H1 sell_clusters | 369 | -0.15 (1d, raw ✓✓ but Bonf ✗) | Noise | observation mode |
| H1 buy_clusters | 21 | +0.45 (7d, Bonf ✗) | Signal but underpowered | keep, monitor live |
| H4 csuite SELL | 973 | ≈0 | **No edge** | observation mode |
| H4 director SELL | 368 | +0.13 (7d) | **No edge** (contrast: V3 had d=0.171) | hard skip (pre-V4) |
| H6 hc vs control | 973 vs **N=0** | — | **BROKEN: control empty** | **RESOLVED V5** (see §7.8) |

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
   produkcji generuje szum. **RESOLVED** — Form4Pipeline SELL → observation
   mode (commits abff1c9 feat(form4): SELL → observation mode, 5dc2a36
   C-suite SELL wariant). Alert zapis do DB z `nonDeliveryReason='csuite_sell_no_edge'`,
   brak Telegramu. GPT analysis zachowana dla forward validation.

### 7.8 V5 OBSERVATIONS (Sprint 17, commits e07bbc2 + f69cfa8)

**H6 control fix resolved (Sprint 17 #2):**
- `control_vs_common` teraz N=1393 (było N=0 w V4).
- 7d d=+0.09 p=0.0004 ✓✓✓, 30d d=+0.10 p=0.0002 ✓✓✓ — kontrola (non-healthcare)
  SELL pokazuje edge na dłuższych horyzontach.
- `hc_vs_ctrl_direct` n_hc=973 n_ctrl=1393: d=-0.058 (1d), -0.114 (3d), -0.077 (7d),
  -0.144 (30d). **Healthcare NIE ma sector-specific edge** dla SELL — ujemne d
  znaczy healthcare events wypadają poniżej control events.
- **Wniosek:** healthcare boost ×1.2 dla SELL nie jest uzasadniony (i tak SELL
  jest już w observation mode, więc boost nieaktywny). Boost ×1.2 dalej stosowany
  dla BUY (gdzie V4 potwierdził edge).

**Cluster vs single BUY (Sprint 17 #3):**
- Nowa sub-analiza `cluster_buy_vs_single_buy` w H1: bezpośredni Welch's t-test
  cluster BUY (2+ insiderów w 7d) vs single BUY (<2 insiderów w 7d forward window).
- N_cluster=21, N_single=49, tx_type=BUY.
- Horyzonty: 1d d=+0.22 p=0.44, 3d d=-0.10 p=0.70, 7d d=-0.01 p=0.95, 30d d=-0.23 p=0.37.
- **Wszystkie p>0.37, d w zakresie [-0.23, +0.22].** Cluster nie dodaje
  statystycznie istotnej wartości ponad solo BUY.
- **Counterintuitive V4/V5 observation:** produkcja nadal alertuje na cluster
  (INSIDER_CLUSTER pattern), ale solo BUY (single_buy) daje już cały edge.
  Czekanie na 2-giego insidera nie jest wymagane dla alertu.
- **Decision pending:** czy `Form 4 Insider BUY` rule powinna alertować natychmiast
  bez czekania na cluster (obecnie robi), vs czy INSIDER_CLUSTER BUY pattern
  (osobna ścieżka) jest zbędny. Live validation potrzebna przy N_cluster=21.

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

## 10. DECISIONS RESOLVED (Sprint 17 post-V4/V5)

### 1. SELL → observation mode (RESOLVED)

V4 + V5 oba pokazują zero edge dla insider SELL (wszystkie sub-grupy: all, >$500K,
>$1M, csuite, director, clusters). Form4Pipeline SELL teraz zapisuje do DB z
`delivered=false, nonDeliveryReason='csuite_sell_no_edge'`, bez Telegramu.
GPT analysis + conviction zachowane dla forward validation (sprawdzenie czy
backtest verdict się potwierdza na live data).
- Commits: **abff1c9** (SELL → observation mode), **5dc2a36** (C-suite SELL wariant)
- CLAUDE.md: "alerts.nonDeliveryReason `csuite_sell_no_edge` dodane w Sprint 16b #2"

### 2. H6 control group fix (RESOLVED)

V4 problem: top-level `is_healthcare==True` filter w `run_analysis` zerował control
group przed H6. V5 (commit e07bbc2) usunął ten filter — H1-H5 filtrują per-hypothesis
(tx_df_hc), H6 używa pełnego tx_df. V5 wynik: control_vs_common N=1393,
hc_vs_ctrl_direct n_ctrl=1393. **Sector-specific question odpowiedziany: healthcare
NIE ma edge przewagi nad control dla SELL.**
- Commits: **e07bbc2** (kod), **f69cfa8** (V5 regenerate — naprawia mismatch 3a319d7)

### 3. Director BUY boost ×1.15 (RESOLVED)

V4 d=0.59 raw-significant na 4 horyzontach (1d/3d/7d/30d), mniejszy niż C-suite
d=0.83 ale wyraźny sygnał. Boost ×1.15 dodany w Form4Pipeline, kumulatywny z
healthcare ×1.2 (Director healthcare BUY = ×1.38). C-suite priorytet w co-filing
— albo/albo, nie stack.
- Commit: **e07bbc2** (Sprint 17 P1 — Director BUY boost + H6 control fix + H1 cluster-vs-single)

### 4. Cluster vs single BUY direct test (RESOLVED as observation)

V5 sub-analiza `cluster_buy_vs_single_buy` (§7.8): cluster BUY nie dodaje
statystycznie istotnej wartości ponad solo BUY (wszystkie p>0.37, d [-0.23, +0.22]
przy N_cluster=21, N_single=49). Kod zaimplementowany w `_direct_cluster_vs_single`
+ `_collect_single_buy_events` (analyzer.py:386-389). Żadna zmiana produkcji —
obserwacja zostaje do live validation.
- Commits: **e07bbc2** (analyzer code), **f69cfa8** (V5 results w JSON)

### 5. Production 10b5-1 parser verified (RESOLVED)

`form4-parser.ts:148-152` używa per-transaction XML path
`txn.transactionCoding?.['Rule10b5-1Transaction']` + strict value match ('1' albo 'Y').
NIE jest naive string detection (FLAG #34 z Python V3). 4 testy jednostkowe
pokrywają edge cases.
- CLAUDE.md: "Produkcyjny 10b5-1 parser (status OK, zweryfikowano 17.04)"

---

## 10.1. Remaining research items (Sprint 18+)

- **Top-quartile options conviction** — czy conviction>0.6 bez PDUFA ma edge? (briefing #6)
- **EVP Sales whitelist** — czy senior operations (EVP Sales) zasługuje na C-suite boost?
- **Live vs backtest hit rate** — produkcyjne PriceOutcome data vs V5 predictions.

### Unfixed bugs

- **FLAG #28** — SEC EDGAR collector fetch bez timeout (FLAG #28 osobny od Options timeout
  który jest naprawiony d78a92f)
- **FLAG #32-43** — Python backtest reszta: multi-owner bug (#30 analog), Cohen's d biased,
  brak Bonferroni w niektórych testach, H6 niewymienne baselines. CLAUDE.md: "BLOKUJE
  zaufanie do V3 backtest results" (V4/V5 już używają fix'ów).
- **FLAG #42** — Python backtest baseline sampling uniform per-ticker

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
| `is10b51Plan` skipuje discretionary | Naive string search (FLAG #35 TS analog?) | check `form4-parser.ts` production |

---

**Ostatnia aktualizacja:** 18.04.2026 po V5 backtest (Sprint 17 #1-3 resolved).
**V5 commits:** e07bbc2 (code), 3a319d7 (fictional message, JSON stale),
f69cfa8 (regenerate fix).
**Następna aktualizacja:** po live validation (minimum 2 tygodnie forward data
z `nonDeliveryReason='csuite_sell_no_edge'` alerts + cluster BUY monitoring).
