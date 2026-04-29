# Sprint 19 — Backlog

> Utworzony 23.04.2026 po zamknięciu Sprint 18 (12 tasków + 5 follow-upów).
> Items zebrane z: cheatsheet "Sprint 18+ research", TASKS-2026-04-22 odrzucone
> opcje, post-Sprint audyt FOLLOW-*, plan-observability-tier1 Tier 2.

---

## ✅ DONE 29.04.2026 — P0 fixes po HUM/UNH false positives + options-flow zombie cycle

Pojedyncza sesja (8 commitów = 6 fixów + 2 docs) po trzech incydentach:
UNH 27.04 21:05 correlated false CRITICAL, HUM 29.04 10:35 GPT halucynacja
earnings miss, options-flow runCollectionCycle 11h 36min (29.04 — drugi raz
po 17.04, mimo Sprint 16b FIX-04).

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

**Cumulative**: 385/385 unit pass, tsc clean, 6 deploy clean w 1 sesji, 0 prod regressions.

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

**Pozostałe Sprint 19 P0/P1 do zrobienia (z planu HANDOFF-2026-04-23):**
- FIX-05 — direction conflict guard w `triggerCorrelatedAlert` (UNH 27.04 mixed signal: 1× negative form4 + 10× positive options → "positive" CRITICAL mimo opisu "Insider SELL + bullish options")
- FIX-06 — pre-LLM EPS/Revenue/MLR numbers extraction (per filing structured input do GPT)
- FIX-07 — Form4 sell_no_edge nie zasila `correlation.storeSignal` (UNH 27.04 backdoor: Form 4 dispatched DB-only ale signal nadal w Redis → INSIDER_PLUS_OPTIONS triggered)
- FIX-08 — subsidiary executive detection (Conway "CEO, Optum" ≠ UNH parent CEO; conviction multiplier ×0.5)
- FIX-09 — managed care vertical (decyzja A obs mode 30d / B per-sector prompty po 7-tickerowym klastrze UNH/HUM/MOH/CNC/ELV/CI/CVS)

Pierwsze 6 fixów (FIX-01..04) zamknęły **HUM-class halucynacje**, **UNH-class
brudne correlation signals dla semi**, **prompt design errors**, oraz
**options-flow zombie cycle** który był otwarty od 17.04. Pozostałe FIX-05..09
zostają do następnych sesji.

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
