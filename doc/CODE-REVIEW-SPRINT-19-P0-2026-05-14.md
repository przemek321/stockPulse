# Code Review — Sprint 19 P0 (FIX-01 do FIX-13 Faza 1)

**Data**: 2026-05-14
**Zakres**: 21 commitów (29.04 — 12.05.2026), Sprint 19 P0 stack
**Reviewer**: Claude Opus 4.7 (autor większości kodu — full disclosure bias)
**Metoda**: line-by-line read + cross-reference z testami + live DB sanity check

---

## TL;DR

**Wynik**: stack działa zgodnie z designem, ZERO crashes w 48h produkcji (od deploy FIX-13). Znalezione **36 issues**: 4× 🔴 (real bug ryzyko), 6× 🟠 (medium), 22× 🟡 (cosmetic/edge), 4× ✅ (verified OK), 2 dead flags.

**Najpoważniejsze 4 problemy do action**:
1. **#20 R2 consensus guard wymaga `bothKnown`** — gdy rev=null + eps in-line + GPT bullish, brak cap'u. Real risk dopóki FIX-14 (extractRevenue GILD) nie ready.
2. **#28 Pozostałe 3 prompt builders ignorują guidance + consensus args** — `buildForm8k101Prompt/5-02/other` mają 5-arg signature, parser wysyła 7 args. TypeScript silently ignores → FIX-02 guidance facts (np. dla acquisition + reaffirm guidance w jednym 8-K Item 1.01) NIE są wstrzykiwane do prompta dla 3/4 typów Item.
3. **#2 Finnhub `latest` period race** — dla świeżego 8-K Item 2.02 w pierwszych 0-1h post-publication, Finnhub może jeszcze nie mieć update'u. Wtedy `latest.period` = poprzedni Q, AV matched dla poprzedniego Q, surprise % policzony cross-period.
4. **#31 Form4Pipeline `isSellNoEdge: !isBuy` bez rozróżnienia C-suite** — `isCsuiteSellObservation` flag w DispatchParams jest DEAD CODE. CLAUDE.md twierdzi że c-suite path działa (`ALERT_DB_ONLY_CSUITE_SELL_NO_EDGE`), DB pokazuje 0 takich alertów w 22 dni.

---

## 🔴 CRITICAL bugs

### #20 — R2 in-line guard wymaga `bothKnown`, leak gdy rev=null

**Plik**: `src/sec-filings/utils/consensus-gap-guard.ts:72-79`

```typescript
const bothKnown = eps !== null && rev !== null;
if (bothKnown && epsInLine && revInLine && absConv > 0.5) {
  return { cap: 0.5, reason: 'consensus_in_line', ... };
}
```

**Problem**: R2 aktywuje TYLKO gdy oba metryki znane. Realny case (występuje DZIŚ przy current extractRevenue regex limitations):
- 8-K Item 2.02 dla GILD-class ticker (table format "Total revenues 6,960 (in millions)")
- `extractRevenue` zwraca `null` (FIX-14 jeszcze nie ready)
- Finnhub zwraca EPS surprise = +2% (in-line)
- GPT chwali "+30% YoY revenue!" z conviction +1.4
- R2 NIE aktywuje (bo `rev === null`)
- R1 NIE aktywuje (bo nie ma miss <0)
- R3 NIE aktywuje (bo wymaga bothKnown)
- **No cap → CRITICAL Telegram delivered z conviction +1.4 na headline YoY**

**Fix**:
```typescript
const onlyEpsInLine = eps !== null && rev === null && Math.abs(eps) < 3;
const onlyRevInLine = rev !== null && eps === null && Math.abs(rev) < 3;
if (((bothKnown && epsInLine && revInLine) || onlyEpsInLine || onlyRevInLine) && absConv > 0.5) {
  // cap 0.5
}
```

Albo konserwatywniej: gdy tylko jedna metryka znana, cap niżej (0.4) — brak drugiej metryki = niewiedza zwiększa risk.

**Status**: NIE EXPOSED w 48h produkcji (zero Item 2.02 alertów, post-Q1 earnings season). Wystąpi w Q2 (lipiec) gdy znowu pojawią się Item 2.02 alerty.

---

### #28 — Pozostałe 3 prompt builders ignorują `extractedFacts` + `consensusBlock`

**Pliki**:
- `src/sec-filings/prompts/form8k-1-01.prompt.ts:1` — signature 5 args
- `src/sec-filings/prompts/form8k-5-02.prompt.ts:1` — signature 5 args
- `src/sec-filings/prompts/form8k-other.prompt.ts:1-7` — signature 5 args
- `src/sec-filings/prompts/form8k-2-02.prompt.ts:7-12` — signature 7 args ✅

**Problem**: `selectPromptBuilder` w `form8k.parser.ts:83-93` typuje return jako `(...args: 7) => string` (z `extractedFacts` i `consensusBlock`). Caller `form8k.pipeline.ts:248-256` wysyła 7 args. ALE buildery 1.01/5.02/other mają 5-arg signature — TypeScript dopuszcza variance (`(args5) => string` is assignable to `(args7) => string`), **ostatnie 2 args są silently ignored przy wywołaniu**.

**Skutki**:
- **FIX-02 guidance facts** (`extractedFacts`) są skanowane dla WSZYSTKICH 8-K (linia 214 `extractGuidanceStatus`) ALE wstrzykiwane do prompta TYLKO dla 2.02.
- Item 1.01 (acquisition) z "Affirms Full Year guidance" headline → FIX-02 detected, ale builder ignores → GPT nie widzi.
- Item 7.01/8.01 (Reg FD/Other) — typowo używane dla mid-quarter guidance updates → FIX-02 ignored.
- **FIX-12 consensus** jest pobierane tylko dla 2.02 (linia 233 `if (mainItem === '2.02')`), więc dla innych args=null — bezpieczne, ale **niezgodne signature jest code smell**.

**Fix**:
- Opcja A (rekomendowana): rozszerzyć signature 3 builderów do 7 args (z `_` prefix dla unused):
  ```typescript
  export function buildForm8k101Prompt(
    ticker: string,
    companyName: string,
    text: string,
    _itemNumber?: string,
    tickerProfile?: string | null,
    extractedFacts?: string | null,    // ADD
    _consensusBlock?: string | null,   // ADD, unused (consensus only for 2.02)
  ): string {
    // Inject extractedFacts dla Item 1.01 też (jeśli affirms guidance w acquisition)
  }
  ```
- Opcja B: explicit `if (mainItem === '2.02')` gating PRZED `extractGuidanceStatus` (tylko jeśli decyzja produktowa: guidance facts tylko dla earnings).

**Recommendation**: Opcja A — guidance affirmation może wystąpić w 8-K Item 1.01 (acquisition + reaffirm) lub Item 7.01 (mid-quarter Reg FD). Tracimy real signal.

---

### #2 — Finnhub `latest` period race w pierwszych 0-24h post-8-K

**Plik**: `src/sec-filings/services/consensus-comparison.service.ts:139-171`

```typescript
const sorted = [...json].sort((a, b) => (b.period || '').localeCompare(a.period || ''));
const latest = sorted[0];
return {
  epsActual: typeof latest.actual === 'number' ? latest.actual : null,
  epsEstimate: typeof latest.estimate === 'number' ? latest.estimate : null,
  period: latest.period ?? null,
};
```

**Problem**: Komentarz na linii 18 mówi "po raporcie 8-K Item 2.02 dane są aktualizowane w 0-24h". Tymczasem 8-K może być prześle published 5-10 min przed naszym fetch'em (CRON `5,35 * * * *`). Jeśli Finnhub nie zdążył update'ować, `latest` = POPRZEDNI Q. Wtedy:
- `latest.period = '2025-12-31'` (Q4 2025, z poprzedniego raportu)
- `latest.actual = 1.50` (Q4 actual, stary)
- `latest.estimate = 1.45` (Q4 estimate, stary)
- Pipeline: `revenueActual = extractRevenue(itemText)` daje **Q1 2026** revenue (z fresh 8-K)
- `selectAlphaEstimate(rows, '2025-12-31', ...)` → matched Q4 2025 estimate
- Surprise % policzony: **Q1 2026 actual vs Q4 2025 estimate** = WRONG PERIOD

**Real impact**: nie zaobserwowane w 48h (zero Item 2.02). Baseline 12.05 (6 dni post-Q1 earnings) pokazał wszystkie 15 tickers mają `period='2026-03-31'` (Finnhub już updated) — czyli race typowo trwa <24h. Dla świeżych 8-K w 1h post-publication: realny risk.

**Fix**: użyć `filingDate` z `payload.filing` jako alternative period source. Match `filingDate` do Q (Jan-Mar → Q1, etc.) i preferuj quarter z fresh 8-K nad Finnhub `latest`:

```typescript
async fetchAndCompare(symbol: string, reportText: string, filingDate?: Date): Promise<ConsensusComparison> {
  // ...
  const expectedPeriod = filingDate ? inferQuarterEndDate(filingDate) : null;
  // Jeśli Finnhub.period !== expectedPeriod, fallback do null (no surprise calc)
  // — lepsze niż cross-period
}
```

Lub: zwracać surprise % TYLKO gdy `latest.period === expectedPeriod` (sanity gate).

---

### #6 — AV matched estimate może być POST-REPORT REVISED (architectural)

**Plik**: `src/sec-filings/services/consensus-comparison.service.ts:179-182`

```typescript
* Empirical finding (research 2026-05-11): Alpha Vantage zachowuje per-quarter
* estimates w pełnej historii (≥2017), W TYM dla just-reported Q (estimate przed
* raportem nie jest zastąpiony przez actual).
```

**Problem**: hipoteza unverified. Plan v3 critique (Blef #1):
- AV może odzwierciedlać "current consensus revised post-report" zamiast "pre-report consensus"
- Baseline 12.05 pokazał liczby dla wszystkich 15 tickerów, ale nie sprawdziliśmy czy te liczby były takie same 05.05 (dzień przed PODD report)
- Bez snapshot pre-report nie wiemy czy AV preserve'uje czy update'uje

**Real impact**: jeśli AV update'uje post-report, **mierzymy WRONG SIGNAL** — to "current revised expectations" zamiast "pre-report consensus". Surprise % traci znaczenie.

**Verification**: śledzić AV response dla single ticker przez 7+ dni po Q earnings → czy `revenue_estimate_average` dla tego Q zmienia się?

**Fix**: brak natychmiastowego — wymaga external verification. Można dodać **snapshot persist do DB** (`consensus_snapshots` table per FIX-16 z planu) żeby zbierać empirical data. Pierwsza weryfikacja: następny Q earnings season (lipiec 2026).

**Note**: ten issue był flagowany w Plan v3 Critique jako Blef #1. Świadomie odłożony do Faza 3 (post-observation 14d).

---

## 🟠 MEDIUM issues

### #10 — `consensus source diff` log na debug level → 2d retention

**Plik**: `src/sec-filings/services/consensus-comparison.service.ts:100-105`

```typescript
this.logger.debug(`consensus source diff ${symbol} period=${period}: ...`);
```

**Problem**: system_logs cleanup tier — `debug=2d, info=7d, warn+error=30d` (CLAUDE.md). Faza 2 obserwacji jest 14d (do 25.05.2026). Każdy diff log znika po 2 dniach — **nie mamy 14d retention dla decision-making data**.

**Real impact**: po 14d obserwacji (zaplanowane decision Finnhub vs AV primary), dostępne będą tylko **ostatnie 2 dni** diff logs. Niewystarczające dla statystyki.

**Fix**: zmień `logger.debug` → `logger.log` (info level, 7d retention). Lub `logger.warn` jeśli chcemy 30d (ale to overkill).

**Severity**: medium — degraduje value Faza 2 obserwacji o ~80% (2d z 14d).

---

### #21 — Comment logical lie w form8k.pipeline.ts:315-320

**Plik**: `src/sec-filings/pipelines/form8k.pipeline.ts:315-320`

```typescript
// S19-FIX-12: post-GPT consensus gap guard. Działa PRZED missing-data guard
// bo missing-data ma wyższy priority w AlertDispatcher (key_facts "niedostępne"
// means brak liczb → guard cap'uje i tak).
```

**Problem**: komentarz mówi że consensus gap CODE runs first **bo** missing-data ma wyższy priority w dispatcher. To **logically backwards** — fakt że missing-data ma wyższy priority w dispatcher nie wynika z tego że consensus code powinno run first.

**Real impact**: maintenance confusion. Następny dev pomyśli że order ma znaczenie semantyczne; faktycznie oba są idempotent caps.

**Fix**: poprawić komentarz:
```typescript
// S19-FIX-12: post-GPT consensus gap guard. Działa przed missing-data guard
// chronologicznie ALE oba caps są idempotent. Final reason w dispatch path
// determinated przez AlertDispatcher priority order (missing-data > consensus_gap).
// Czyli jeśli oba aktywują się, alert i tak idzie z reason='gpt_missing_data'.
```

---

### #24 — Throttle check PO consensus fetch → marnujemy AV rate limit

**Plik**: `src/sec-filings/pipelines/form8k.pipeline.ts:233-246` (consensus fetch) → `:431-434` (throttle check)

**Problem**: pipeline order:
1. fetchAndCompare consensus (`AV API call`)
2. GPT call
3. Zod parse
4. Consensus gap guard
5. Missing-data guard
6. Throttle check ← TUTAJ wykluczamy duplikat

Jeśli alert jest duplicate (throttle hits), zużyliśmy:
- 1× Finnhub call (60/min — OK)
- 1× AV call (25/dzień — **scarce**)
- 1× GPT call (cost ~$0.04 — accumulated)

**Real impact**: AV rate limit 25/dzień. Healthcare ma typowo 5-15 Item 2.02/dzień w sezonie. Throttle catch ~30% duplikatów (heuristically) → ~3-5 AV calls/dzień zmarnowanych.

**Fix**: przenieść throttle check PRZED fetch (wymaga refactoringu). Lub: cache consensus per `(symbol, period)` z TTL 1h żeby duplicate'y reused.

**Severity**: medium (operational), bez funkcjonalnego bugu.

---

### #26 — priority='MEDIUM' hardcoded w missing-data path, dynamic w main path

**Plik**: `src/sec-filings/pipelines/form8k.pipeline.ts:362, 393` (missing-data) vs `:418-422` (main path)

**Problem**:
- Missing-data path (GPT zadeklarował brak danych): `priority: 'MEDIUM'` hardcoded.
- Main path (consensus gap cap): `priority = scoreToAlertPriority(analysis, '8-K')` — dynamic from capped conviction.

Po consensus_miss cap (conv → ±0.3), `scoreToAlertPriority` może dać LOW lub MEDIUM. W missing-data path zawsze MEDIUM.

**Real impact**: HIMS 2010 alert (consensus_miss + key_facts "Dane przychodowe niezawarte") miał OBIE guards aktywne. Pierwsze hit: consensus gap cap (-1.6 → -0.3). Drugie hit: missing-data (idempotent cap -0.3 → -0.3 + return z hardcoded MEDIUM + dispatch z `isGptMissingData=true`). Final: alert z priority='MEDIUM', reason='gpt_missing_data' (z dispatcher priority order: gpt_missing_data > consensus_gap).

Czyli consensus_miss info LOST (subsumed by missing-data). Plus asymetria priority calculation.

**Fix**: w missing-data path też używać `scoreToAlertPriority` z capped conviction (po cap'ie 0.3 dynamic priority typowo LOW/MEDIUM zgodne z intent).

**Severity**: cosmetic asymmetry, ale spójność lepsza.

---

### #31 — Form4Pipeline `isSellNoEdge: !isBuy` bez C-suite rozróżnienia

**Plik**: `src/sec-filings/pipelines/form4.pipeline.ts:428`

```typescript
isSellNoEdge: !isBuy,
```

**Problem**: wszystkie SELL → `sell_no_edge` reason. Nie używa `isCsuiteSellObservation` flag z DispatchParams (interface ma flagę, caller jej nigdy nie set'uje).

**Verification** (DB 22 dni od 22.04):
| nonDeliveryReason | count |
|---|---|
| sell_no_edge | 6 |
| cluster_sell_no_edge | 3 |
| **csuite_sell_no_edge** | **0** |

CLAUDE.md w System totals twierdzi: "C-suite SELL → `ALERT_DB_ONLY_CSUITE_SELL_NO_EDGE` (Sprint 16b)". DB pokazuje że TEN PATH NIE JEST UŻYWANY.

**Skutki**:
1. **Dead flag** `isCsuiteSellObservation` w `DispatchParams` (interface) — never set w produkcji.
2. **Reason 'csuite_sell_no_edge'** zarezerwowany w `REASON_LABELS` (summary-scheduler) — nigdy nie renderowany w raporcie 8h.
3. **CLAUDE.md outdated** vs reality.

**Decision needed**: 
- (A) Implementuj rozróżnienie w Form4Pipeline → `isCsuiteSellObservation: !isBuy && isCsuiteRole, isSellNoEdge: !isBuy && !isCsuiteRole`.
- (B) Usuń `isCsuiteSellObservation` flag (Sprint 16b decyzja overridden przez Sprint 17 TASK-02 unified gate). Update CLAUDE.md.

**Recommendation**: (B). Sprint 17 TASK-02 SKIP_NON_ROLE_SELL już wykluczył non-role SELL. Pozostałe C-suite + Director → wszystkie zero edge per V5 backtest. Differentiation bez value-add. Cleanup.

**Severity**: medium (dead code + docs mismatch).

---

### #32 — `tickerRepo.findOne` 2× per OptionsFlow event

**Plik**: `src/options-flow/options-flow-alert.service.ts:90` + `:200`

Świadomie odłożone w FIX-03b commit message ("refactor zoptymalizowanie do single lookup to scope creep"). OK w tym kontekście.

**Real impact**: ~1ms DB query per event × ~50 events/dzień = 50ms wasted. Ignorable.

**Status**: accepted technical debt. Można zostawić.

---

## 🟡 MINOR / cosmetic issues

### Łączny breakdown

| # | Plik | Issue | Severity |
|---|---|---|---|
| #3 | consensus-comparison.service.ts:275 | `selectAlphaEstimate` używa `new Date()` (non-deterministic w testach) | 🟡 |
| #5 | consensus-comparison.service.ts:298 | `!== null && isFinite` — `isFinite(null)===false`, `!== null` redundant | 🟡 |
| #7 | consensus-comparison.service.ts:221 | `parseInt('20.00')` fragile gdy AV zmieni format do `'20.5'` | 🟡 |
| #8 | consensus-comparison.service.ts:119 | `revenueSource='matched'` gdy `revenueEstimate=null` — niespójna semantyka | 🟡 |
| #9 | types/consensus-comparison.ts:40 | `fetchedAt: Date` — JSON serialization → ISO string (works ale Type warning) | 🟡 |
| #11 | consensus-comparison.service.spec.ts:410 | Test "anomaly guard \|eps\|>50 GILD" jest NEGATIVE case z mylącym nazewnictwem | 🟡 |
| #12 | consensus-comparison.service.spec.ts | Tests używają `Date.now()+30d` — non-deterministic w czasie | 🟡 |
| #13 | consensus-comparison.service.ts:368 | `formatConsensusBlock` no trailing newline (caller dodaje) | 🟡 |
| #15 | consensus-comparison.service.ts:56 | `Promise.allSettled` połyka rejected reason silent — brak audit | 🟡 |
| #17 | consensus-gap-guard.ts:95 | R3 details `epsStrongBeat ? eps : rev` powtórzone 2× — stylistic | 🟡 |
| #18 | consensus-gap-guard.ts:88 | "Double weak beat" (3-5% both) wpada w no-cap zone | 🟡 |
| #19 | consensus-gap-guard.ts:70 | `Math.abs(eps) < 3` strict — `3.0` exactly nie jest in-line | 🟡 |
| #22 | form8k.pipeline.ts:400 | `direction=neutral + conv=0` → alertDirection='positive' (off-by-one) | 🟡 |
| #23 | form8k.pipeline.ts:466 | `getQuote` po dispatch — Telegram delivered jeśli `getQuote` later fails | 🟡 |
| #29 | alert-dispatcher.service.ts:25 | `parentTraceId` w DispatchParams ale nie w DispatchResult | 🟡 |
| #33 | options-flow-alert.service.ts:100 | `direction='mixed' && conv=0` → 'negative' (edge case) | 🟡 |
| #35 | sec-filings.module.ts:35 | `ConsensusComparisonService` provider not exported (future-proofing) | 🟡 |

### ✅ Verified OK (nie issue, sprawdzone)

| # | Co | Verification |
|---|---|---|
| #1 | `Promise.allSettled` w `fetchAndCompare` | Nie race — `await` czeka na oba przed `selectAlphaEstimate` |
| #4 | Debug log gating optional chain | TS narrowing OK (deployed kompiluje się 24h+) |
| #16 | R1 cap'uje też bearish-on-miss | Świadoma decyzja (test linia 1 confirms intent) |
| #25 | `consensusGapDecision` → skip correlation | Linia 505 `!consensusGapDecision` blokuje storeSignal |
| #27 | Consensus block tylko dla 2.02 | `if (mainItem === '2.02')` gate na fetch + null w pozostałych |
| #34 | OptionsFlow FIX-03b coverage | `sendAlert` ma własny `isObservationTicker` w dispatch args |
| #36 | `@Optional()` dispatcher DI design | Testability + defense, intent OK |

### Dead code

| # | Co | Status |
|---|---|---|
| Dead | `DispatchParams.isCsuiteSellObservation` | Never set production (zero `csuite_sell_no_edge` w DB 22d) |
| Reserved | `DispatchParams.isSilent` | Świadomie reserved per komentarz (SILENT_RULES post-cleanup) |
| Silently ignored | `extractedFacts` w `buildForm8k101Prompt/5-02/other` | Issue #28 — 3 buildery z 5-arg signature przyjmują 7 args |

---

## Test coverage analysis

| Spec file | Test count | Coverage notes |
|---|---|---|
| consensus-comparison.service.spec.ts | 34 | ✅ FIX-13 nowe: 13 cases (matched/forward/anomaly/diff). Brak: cross-period race (#2), AV revision drift (#6) |
| consensus-gap-guard.spec.ts | 21 | ✅ R1/R2/R3 covered. Brak: rev=null + eps in-line + GPT bullish (#20 leak), 3-5% double weak beat (#18 zone) |
| alert-dispatcher.spec.ts | 27 | ✅ Priority chain covered. Brak: `parentTraceId` propagation test |
| form8k-missing-data.spec.ts | 2 | ⚠ Słaba: tylko detector unit + replay HUM integration. Brak: interaction missing-data + consensus_gap (#26 priority calc asymmetry) |
| form8k-prompts-template.spec.ts | (?) | ⚠ Tylko 2-02 prompt regression guards. Brak: 1.01/5.02/other prompt builders czy ignore extra args (#28) |
| Total unit suites | 27 | 524/524 pass |

**Gap krytyczny**: brak testu integration dla całego stack'u `fetch consensus → guard → missing-data → dispatch` w jednym pipeline. `form8k.pipeline.ts:onFiling` jest 500+ linii orchestration bez integration test (tylko unit tests poszczególnych guard'ów).

---

## Cross-cutting observations

### 1. CLAUDE.md vs reality drift

**CLAUDE.md System totals** (06.05 + 11.05 entry):
- "C-suite SELL → `ALERT_DB_ONLY_CSUITE_SELL_NO_EDGE`" — **DB pokazuje 0 takich alertów w 22d** (#31)
- "Semi tickers: zero footprint w correlation Redis Sorted Set" (FIX-03b komentarz) — **historycznie było false aż do FIX-03b commit 11.05** (samo CLAUDE.md przyznaje)
- "AlertDispatcher priority order: observation > gpt_missing_data > consensus_gap > direction_conflict > ..." — ✅ verified w kodzie

**Recommendation**: synchronizacja CLAUDE.md po każdej zmianie produkcji. Action items są juz w niej wpisane jako historyczne fixy, ale aktualne state-of-affairs (np. dead `csuite_sell_no_edge`) drift'uje.

### 2. Defense-in-depth coverage

Guards interaction matrix (cap conviction post-GPT dla 8-K Item 2.02):

| Guard | Trigger | Cap | Priority | Coverage |
|---|---|---|---|---|
| FIX-02 floor | Affirms guidance + bear conviction | -0.3 floor | (line 289) | ✅ |
| FIX-12 consensus gap | Miss/in-line/mixed surprise | 0.3/0.5/0.7 | (line 322) | ✅ |
| FIX-01 missing-data | `key_facts` includes "niedostępne" | ±0.3 | (line 343) | ✅ |

**Order**: FIX-02 → FIX-12 → FIX-01 → dispatch.
**Idempotent**: każdy guard cap'uje conviction (Math.max/min), kolejność nie zmienia final value.
**Dispatcher priority**: missing-data > consensus_gap > direction_conflict > sell_no_edge — wybór `nonDeliveryReason` jeśli kilka aktywuje się.

Nieoczywista interakcja: gdy missing-data hit, własny dispatch + return (linia 409) — pomija main path consensus gap zostaje w analysis.conviction ale `isConsensusGap` flag NIE jest propagowany do dispatcher w missing-data branch (audit info loss, #26).

### 3. Telemetry retention vs Faza 2 cel

Faza 2 obserwacji to 14d (do 25.05.2026). Decisions:
- `revenueSource` ratio matched vs forward
- Finnhub vs AV diff distribution
- consensus_* activation rate

System_logs cleanup:
- debug 2d
- info 7d
- warn 30d

`consensus source diff` log = debug (#10) — **niewystarczające retention**.

**Action**: bump #10 do `logger.log` przed real Q2 earnings season (lipiec).

---

## Recommended action priority

### P0 (do następnego deploy)
1. **#28 prompt signature mismatch** — dodać `extractedFacts` arg do 3 builderów (1-01, 5-02, other). 30 min effort. Niski risk regresji.
2. **#10 diff log info level** — `debug` → `log`. 5 min. Krytyczne dla Faza 2.

### P1 (przed Q2 earnings season — lipiec)
3. **#20 R2 guard rev=null leak** — extend logic dla single-metric in-line case. 30 min + 3 testy.
4. **#2 Finnhub period race** — sanity gate `latest.period === expectedQuarter`. 1h.
5. **#31 cleanup dead flag** — usunąć `isCsuiteSellObservation` lub implementować rozróżnienie. Decision + update CLAUDE.md. 15 min + DB query.

### P2 (Faza 3 decision 25.05)
6. **#6 AV revision drift** — verify hipoteza przez 7d snapshot ticker. Wymaga FIX-16 (persist consensus). 2h.
7. **#26 priority asymmetry** missing-data vs main path. 15 min.
8. **#21 comment poprawka** logical lie. 5 min.

### P3 (chronic technical debt)
- #24 throttle przed fetch refactor
- #32 single tickerRepo lookup
- cosmetic 🟡 issues

---

## Conclusion

Stack FIX-01 do FIX-13 jest **funkcjonalnie zdrowy** — 48h production zero crashes, defense-in-depth działa (HIMS 2010 dispatched DB-only z 2 guards aktywnymi, MOH sell_no_edge zadziałał). Faza 2 obserwacji nie ma triggers (Q1 earnings season skończony) — zaplanowana decision 25.05 prawdopodobnie nie da meaningful sample, recommend przesunąć do Q2 (lipiec).

**Najpoważniejsze 3 do natychmiastowego action** (P0 + krytyczne P1):
1. **#28** — extractedFacts ignored przez 3 buildery (FIX-02 efektywnie tylko dla Item 2.02).
2. **#20** — R2 in-line guard wymaga bothKnown → rev=null leak.
3. **#10** — diff log retention 2d niewystarczające dla 14d Faza 2.

**Dead code**: 1 flag (isCsuiteSellObservation), 1 ignored arg w 3 builderach. Minor cleanup, nie risk.

**Test coverage** OK (524 testów, 27 suites) ALE brak integration test dla pipeline orchestration (form8k.pipeline.onFiling 500+ linii).

**Najlepsze elementy**:
- AlertDispatcher centralna decyzja z 8-stop priority chain (TASK-01 22.04)
- Defense-in-depth idempotent caps (FIX-01/02/12)
- FIX-13 selectAlphaEstimate pure function testability
- correlation backdoor closure (FIX-07) — sygnał z zero-edge gate'em nie zasila Redis

---

*Code review wygenerowany 2026-05-14 ~16:XX UTC przez Claude Opus 4.7. Author bias disclosed: ~80% reviewed code napisane przez tego samego autora (Sprint 19 sesje). Critical lens applied — pozostałe issue'y które autor nie wyłapał wymagają second-reviewer human read.*

*Powiązane dokumenty*:
- `doc/PLAN-FIX-13-15-CRITIQUE-2026-05-11.md` — self-review Plan v2 (analogiczna metoda)
- `doc/BASELINE-FAZA-2-2026-05-12.md` — baseline measurement
- `doc/REPORT-2026-05-11-weekend-analysis.md` — weekend analysis trigger
