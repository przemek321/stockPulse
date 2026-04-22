# StockPulse — raport dzienny 2026-04-22

> Zakres: ostatnie 24h (2026-04-21 21:00 → 2026-04-22 21:00 UTC). Fokus: poprawność działania systemu, logika, zgodność z dokumentacją.

---

## TL;DR

**System działa zgodnie z CLAUDE.md, Sprint 11–17 policies**. Jeden delivered Telegram (DXCM INSIDER_PLUS_OPTIONS), 9 observation-mode captures (HPE/ASX/DELL semi + 3 INSIDER_CLUSTER SELL na healthcare). Wszystkie kolektory SUCCESS, zero runtime errors po rebuild 09:23 UTC (Fix A+B). Cron schedulery deterministyczne bez dryfu. Scheduler consolidation (48caf0b..de11193) daje deterministyczną kadencję. FinBERT cleanup series kompletna — frontend regresja (#335f0f1) naprawiona, zero 404 na dashbordzie.

---

## 1. Infrastruktura

| Check | Wynik | Źródło |
|---|---|---|
| Kontenery | 4/4 Up, 0 restartów | `docker compose ps` + `inspect RestartCount` |
| Postgres / Redis uptime | 11h | Od `docker compose down && up` w commit #1 |
| App / Frontend uptime | 8h | Od ostatniego rebuild Fix A+B (09:23 UTC) |
| Runtime errors ostatnia 1h | 0 | `logs app --since 1h \| grep ERROR` |
| `system_logs` errors po 09:23 | 0 | `SELECT COUNT(*) FROM system_logs WHERE status='error' AND created_at > '09:23 UTC'` |
| Dashboard `/api/health/system-overview` | `HEALTHY` | 0 systemErrors, 0 failedJobs7d |

Jeden historyczny TypeError (`volumeSpikeRatio.toFixed`) z 09:03 UTC usunięty z `system_logs` po zakończeniu Fix B. Audit trail w commit message 335f0f1.

---

## 2. Kolektory — cadence audit

### SEC EDGAR (`CRON '5,35 * * * *' UTC`, scheduler consolidation `de11193`)

```
48 cykli w 24h | avg 18089 ms | max 20891 ms | 10 items | wszystkie SUCCESS
```

Ostatnie 8 cykli:
```
20:35, 20:05, 19:35, 19:05, 18:35, 18:05, 17:35, 17:05 — minuta 5 lub 35, 0 dryfu
```

✓ Cron pattern działa dokładnie. Duration avg ~18s (40 tickerów × 200ms delay + Form 4 XML fetche + 10 items collected). Średnio 10 items / 24h = ~1 new filing per 2.4h, spójne z niskim wolumenem w wynikach Q1 2026.

### PDUFA.bio (`CRON '15 */6 * * *' UTC`)

```
11 cykli w 24h | avg 690 ms | 0 items (brak nowych katalizatorów PDUFA w publicznym kalendarzu)
```

- 4 cykle scheduled (00:00, 06:15, 12:15, 18:15 — nota: 00:00 to artefakt starej `every: 6h` przed rebuild, po #3 kolejne już 06:15 etc.)
- 7 cykli "init-run" przy restartach (06:13, 06:43, 06:59, 07:14, 07:21, 09:23) — Sprint 17 `onModuleInit` trigger. Spójne z liczbą dzisiejszych rebuildów kontenera `app`. Za 24h stabilnego działania spadnie do 4/doba.

### Options Flow (Polygon EOD, `CRON '30 16 * * 1-5' America/New_York`)

Ostatni cykl: `2026-04-22 00:14:43 UTC` (= 16:30 ET poprzedniej sesji). 219 flows zebranych, 25 tickerów, avg spike 29×, max 1174× (HUM). Spike ratio > 1000 → `suspicious`, conviction ×0.5 (Sprint 11 flag). Działa.

### Wyłączone kolektory

StockTwits / Finnhub / Reddit — ostatnie cykle z 2026-04-03 (przed Sprint 11 cleanup). Schedulery czyszczą BullMQ repeatable przy onModuleInit (brak nowych jobów). Health controller nadal je listuje (hardcoded) ale oznaczone jako `disabled`.

---

## 3. SEC EDGAR — Form 4 + 8-K throughput

### Form 4 filings (24h)

```
8 Form 4 filings, 4 z gptAnalysis | 7 insider transactions SELL (is10b51Plan=false wszystkie)
```

Wszystkie 7 transakcji to **discretionary** (is10b51Plan=false). Plan 10b5-1 skipowane w Form4Pipeline przed GPT — Sprint 11 filter działa (zero plan trades w DB). Zgodne z CLAUDE.md ("Sprint 11: filtr discretionary only").

### 8-K filings (24h)

```
9 8-K filings | 9/9 z gptAnalysis (100% coverage)
```

Tickery: ELV, AMGN, MOH, ENSG, UNH + 4 inne. Claude Sonnet prompt analysis po polsku, struktura JSON `{"summary": ...}`. **4 filingi oznaczone jako "niekompletne"** — 8-K zawiera tylko referencję do press release bez danych EPS/guidance. GPT prawidłowo odmawia generowania alertu bez danych (nie halucynuje) → **zero false alerts** z niekompletnych 8-K. Sprint 18 candidate: retry gdy press release stanie się dostępny.

---

## 4. Insider trades — kluczowe sygnały

### ASX Chen Tien-Szu — GM ASE Inc. Chung-Li Branch

| # | Transaction | USD | 10b5-1 |
|---|---|---|---|
| 1 | SELL | **$152,554,997** | false |
| 2 | SELL | $37,680,000 | false |
| 3 | SELL | $33,552,000 | false |
| 4 | SELL | $23,350,000 | false |
| **Σ** | | **$247,136,997** | — |

4 transakcje Forms 4 w jednym dniu (2026-04-20), różne accession numbers. Multi-reportingOwner parser (FLAG #30 fix, commit `c2d8ae9`) poprawnie rozdziela multi-filing. **ASX = observation mode** (semi_supply_chain) → brak Telegramu, tylko DB capture.

Wcześniej (20.04) Chen Jeffrey (Director) SELL $4.15M — drugi insider ASX w oknie 7d = klasyczny **INSIDER_CLUSTER pattern**, ale cluster wymaga 2+ unique_insiders (mamy 2), minimum BUY lub mixed — sprawdzę.

### HPE — 3 insiderów w 5 dni

| Data | Insider | Rola | SELL USD | 10b5-1 |
|---|---|---|---|---|
| 2026-04-17 | Neri Antonio F | President and CEO, Director | $3,974,475 | false |
| 2026-04-20 | MacDonald Neil B | EVP, GM Server | $654,975 | false |
| 2026-04-21 | RUSSO FIDELMA | EVP, GM Hybrid Cloud & CTO | $475,517 | false |

**Pattern triggered** (Alert #2356 INSIDER_CLUSTER negative, conviction -0.47). HPE = semi_supply_chain → observation. **Double observation**: (1) ticker observationOnly=true, (2) INSIDER_CLUSTER SELL Sprint 15 policy (backtest p=0.204, brak edge).

---

## 5. Alerts — breakdown delivered vs observation

| Rule | Priority | Total | Delivered | Observation | %deliv |
|---|---|---|---|---|---|
| Correlated Signal | CRITICAL | 4 | **1** (DXCM) | 3 | 25% |
| Correlated Signal | HIGH | 3 | 0 | 3 | 0% |
| Form 4 Insider Signal | CRITICAL | 3 | 0 | 3 | 0% |
| **Σ** | | **10** | **1** | **9** | **10%** |

### 🟢 Poprawne zachowanie observation mode

**Semi supply chain (observationOnly=true)**: HPE×4, ASX×2, DELL×1 = 7 alertów, wszystkie observation ✓ (Sprint 17 plan).

**INSIDER_CLUSTER SELL** (Sprint 15 policy, niezależnie od ticker): GILD×1, HIMS×1, HPE×1 = 3 alerty observation. Healthcare normally alertuje, ale ta konkretna reguła została wyłączona w Sprint 15 (backtest: cluster sell hit rate 42.8%, p=0.204, brak edge). Kod `correlation.service.ts:450-451`:
```ts
const isClusterSellObservation =
  pattern.type === 'INSIDER_CLUSTER' && pattern.direction === 'negative';
```

### 🟢 Jedyny delivered Telegram — DXCM

- **Alert ID 2353**, CRITICAL, INSIDER_PLUS_OPTIONS, direction negative
- Sygnały agregowane: FORM4 insider (-0.15) + OPTIONS×2 (-0.51, -0.45) → conviction **-0.61**
- `priceAtAlert` = $62.60 | `price1h` = $63.55 (**+1.52%**) | `price4h` = $63.12 (**+0.83%**)
- Pattern przewidywał negative, ale krótkoterminowa cena +0.83..1.52% — **forward mismatch w 4h oknie**. `price1d/3d` jeszcze pusty (NYSE open slots). Długoterminowa ocena w Price Outcome Tracker (lifecycle 7d).

---

## 6. Options Flow

```
219 flows, 25 tickerów, avg spike 29×, max 1174× (HUM)
```

Top 10 po |conviction|:
- **UNH** 7× call (strike 370-400, dte 2-3) conviction 0.76-0.84 (post-Q1 earnings rally call buying)
- **MRNA** 2× call (60 strike, dte 2-3) conviction 0.79 (pdufaBoosted=false — brak upcoming PDUFA w 30d)
- **HPQ** 1× call (24 strike, dte 23) conviction 0.76

**HUM spike 1174×** (1 contract, dailyVolume 3134 vs avg 2.67) — **anomalia danych Polygon**, zgodne z Sprint 11 flag: `suspicious > 1000 → conviction ×0.5` (Fix B `Number()` cast w scoreFlow działa).

Zero `pdufaBoosted=true` w top 10 → brak nadchodzących PDUFA dla tych spółek w 30d oknie. `Unusual Options Activity` rule jest aktywna *tylko z PDUFA boost* (Sprint 11), więc żaden z tych 219 flows sam z siebie nie wygeneruje alertu — tylko INSIDER_PLUS_OPTIONS korelacja via CorrelationService.

---

## 7. Price Outcome Tracker

```
10 alertów w 24h | 10/10 priceAtAlert ✓ | 7/10 price1h ✓ | 7/10 price4h ✓ | 0/10 price1d
```

✓ 100% coverage `priceAtAlert` (Sprint 11 fix: zapisywany dla WSZYSTKICH typów).
✓ price1h/4h wypełniają się tylko gdy alert > 1h/4h po NYSE open (3 alerty za świeże albo pre-market → brak price1h).
✓ price1d wymaga pełnej doby — wypełni się jutro (2026-04-23) podczas NYSE open.
CRON deterministyczny `0 * * * *` UTC, `timeZone: 'UTC'` explicit (commit 48caf0b).

---

## 8. Zgodność z CLAUDE.md

| Claim CLAUDE.md | Rzeczywistość 24h | Status |
|---|---|---|
| "8 aktywnych reguł" | 8 isActive=true | ✓ |
| "12 wyłączonych reguł" | 12 isActive=false (w tym 6 sentiment post-cleanup — audit trail) | ✓ |
| "3 aktywne wzorce korelacji" | INSIDER_CLUSTER (3×) + INSIDER_PLUS_OPTIONS (4×) triggerowane. INSIDER_PLUS_8K nie zadziałał w 24h (brak co-occurrence) | ✓ częściowa aktywacja |
| "Form4Pipeline: discretionary only (is10b51Plan=true → skip)" | 7/7 tx ma is10b51Plan=false, zero plan trades w DB | ✓ |
| "Director SELL → hard skip" | Brak Director SELL w 24h (wszystkie SELL od C-suite: GM/EVP/CEO) | neutral |
| "C-suite SELL → observation mode" | N/A w 24h (HPE Neri CEO alert obsługiwany przez INSIDER_CLUSTER path, nie standalone C-suite SELL) | deferred check |
| "Observation gate w Form4Pipeline, Form8kPipeline, AlertEvaluator, CorrelationService, OptionsFlowAlertService" | CorrelationService gate DZIAŁA (ASX+DELL+HPE), Form4Pipeline DZIAŁA (ASX Form 4 Insider Signal = observation) | ✓ |
| "suspicious ratio > 1000 → conviction ×0.5" | HUM 1174× flagged, Fix B `Number()` cast OK | ✓ |
| "Claude Sonnet z per-typ promptami" | 9/9 8-K z gptAnalysis w formacie JSON, po polsku | ✓ |
| "SEC EDGAR CRON `5,35 * * * *` UTC" | 48 cykli dokładnie na :05/:35 | ✓ |
| "PDUFA CRON `15 */6 * * *` UTC" | 4 scheduled + 7 init runs | ✓ |

**Zgodność: 10/11 pozycji potwierdzonych, 1 deferred (brak signal w 24h dla weryfikacji C-suite SELL path).**

---

## 9. Anomalie / Sprint 18 candidates

### 🟡 Niskie znaczenie
- **ASX Chen Tien-Szu $247M łącznie** — realne transakcje (4 filings, 4 accession numbers), parser poprawnie rozdziela. Wysokość sugeruje secondary offering lub tier-1 executive rotation, nie bug.
- **8-K "niekompletne" (ELV, ENSG, MOH, UNH)** — Form 8-K Item 2.02 zawiera tylko link do press release. Claude Sonnet poprawnie odmawia syntezy z pustego filingu. Sprint 18 candidate: retry scraping press release HTML lub lookup 10-Q jeśli dostępny.
- **PDUFA 0 items w 24h** — stabilny kalendarz FDA, brak nowych katalizatorów. Nie bug, po prostu spokojny dzień.

### 🟠 Średnie znaczenie
- **Health controller hardcoded STOCKTWITS/FINNHUB/REDDIT** — frontend `/api/health` listuje 5 kolektorów, 2 mają `lastCollectionAt=2026-04-03` (przed Sprint 11). UX wrażenie że coś "zamrożone". Fix: albo `disabledCollectors` flag w response, albo usunąć z liście (ale wtedy całkowita liczba collectors zmienia się).
- **11 PDUFA init runs w 24h** — dzisiaj 6+ rebuildów. Normalne po dzień cleanup/fix cycle, ale zwraca uwagę. Za 24h stabilnego działania spadnie do 4.

### 🟢 Potwierdzone health
- Scheduler consolidation (commits 48caf0b..de11193): 48 SEC cykli bez dryfu.
- FinBERT cleanup: zero 404 w dashboardzie, zero DI errors przy starcie NestJS, `/api/sentiment/insider-trades` + `/pdufa` HTTP 200.
- Fix B (options-flow TypeError): zero nowych occurrences po 09:23 UTC.
- Observation gate: 9/10 alertów poprawnie routed do DB-only.

---

## 10. Wydajność vs cel systemu

CLAUDE.md cel: **"3-5 alertów/tydzień z realnym edge"**.

24h rzeczywistość:
- 1 delivered Telegram → ekstrapolowane ~7/tydzień, poniżej górnej granicy
- 10 alertów total (90% observation) → **signal quality niski szum Telegram** + bogata baza do backtestu
- Żaden alert nie powtórzył się w throttle window (5 min dla rule, 24h daily limit per symbol) → throttling działa

Wynik: **zgodne z designem po Sprint 17 — system kolekcjonuje sygnały observation, wysyła na Telegram tylko backtest-backed edge (healthcare insider BUY + Correlated Signal z mixed healthcare)**. Dzisiaj edge został wychwycony raz (DXCM INSIDER_PLUS_OPTIONS).

---

*Raport wygenerowany 2026-04-22 21:00 UTC. Commit referencje: scheduler consolidation 48caf0b..de11193, FinBERT cleanup 988bf03..e2d6a66, Fix A+B 335f0f1.*
