# StockPulse — CHANGELOG (historia zmian)

> Oś czasu wydzielona z CLAUDE.md 15.06.2026, żeby plik instrukcji został zwięzły
> (ładuje się do kontekstu co sesję). **To jest archiwum „jak doszliśmy" —
> CLAUDE.md opisuje „jak działa teraz".** Pełny pre-cleanup tekst CLAUDE.md jest
> odzyskiwalny przez `git show <commit>:CLAUDE.md`. Wyczerpujące szczegóły każdej
> zmiany: `git log` + pliki `doc/` linkowane niżej.

---

## Lipiec–październik 2026 — walidacja forward, przeglądy, agent-audytor

Faza pomiaru: żaden przegląd nie zmienił reguł sygnałowych. Przeglądy i werdykty w
[KALENDARZ-WALIDACJI-2026.md](KALENDARZ-WALIDACJI-2026.md). Hashe z `git log`:

- **27.06** `c20e7de` autostart czeka na NTP (RTC bez baterii → 1970); `0b0bc8f` watcher discovery na cronie.
- **02.07** `d1c1f73` `isCsuiteRole` role-only wszędzie („Harvard hole"); `19db864` znacznik 🎯 KWALIFIKUJE
  dla delivered Form 4 Insider BUY (reguły gry real [REGULY-GRY-REAL-2026-07-02.md](REGULY-GRY-REAL-2026-07-02.md));
  `5fa7eeb` backtest H7 cluster-BUY INSUFFICIENT_N.
- **05–06.07** `b56b720` escapowanie MarkdownV2 w raporcie 8h; `bbbb597` wyszarzenie stłumionych na timeline.
- **10.07** `97729df` APLS Faza 4 — INSUFFICIENT DATA. **27.07** `46ce4e0` przegląd discovery — bez promocji,
  fix varchar insiderName (DATA GAP).
- **01.08** `2bfd48f`/`2de090f` cotygodniowy backup (cron nd 03:15) + kopia off-site na Telegram (AES-256).
- **10.08** `da4a052` filtr RULE + localStorage na Signal Timeline; `3acb8b7`/`4323fe7` porządki frontendu.
- **01.09 — werdykt #1 (edge nie wykazany)**: `b8e79e6` 8-K Material Event GPT → observation
  (`material_event_obs`); `f988c6c` `getQuote` odrzuca notowania >7d (SEM zamrożone sloty); `f95a3e0` sub-gate
  C-suite BUY (licznik SQL + cron 23:45 + badge „C"); `25e783e` discovery tier-2 C-suite ≥$100K; `f420940` SEM i WBA
  usunięte z `tickers` i JSON uniwersum (delisting). **02.09** `0352b34` jedna strefa czasu (PL) dla usera.
- **23.09** `88f8188` sub-gate C-suite #1 — bez promocji (7/10 in-sample; forward REAL −7%, 0 wchodzalnych);
  gate #2 od 02.09. **27.09** `bfd9f42` csuite-gate catch-up co godzinę.
- **26–27.09 — ESLint strict + TS strict** (`98ded99`..`db87781`): flat config strict-type-checked BE+FE z baseline
  suppressions (blokuje tylko NOWE błędy), `strict: true` w backendzie (159 pól encji `!`, `errMsg()/errCode()`),
  frontend TS 4.9 → 5.9, CI GitHub (required checks backend+frontend), hook lint-changed.
- **29.09 — agent-audytor shadow-mode (etap 1)**: `a623d84` zod manifest, `f9b4f88` encja `agent_findings`,
  `f3b0ba2` 13 checków deterministycznych + fixture z 8 realnych alertów, `a1a2756` orkiestrator + CRON */15,
  `4d8780c` CLI shadow-run; raport [AUDITOR-SHADOW-RUN-2026-09-29.md](AUDITOR-SHADOW-RUN-2026-09-29.md)
  (61 alertów, P2 0/25 FP, werdykt (a)); `AUDITOR_ENABLED=true` na prod od 29.09 (decyzja usera). Etap 2
  (MCP read-only + LLM) po 01.11. Plan: `tasks-2026-09-27/`.
- **03.10** (host, bez commitu): Jetson `nvpmodel -m 2` (15W), usunięty obraz `stockpulse-finbert` (2.93 GB).
  **04.10**: odcięcie zasilania → start kontenerów z zegarem 1970 mimo czekania w autostarcie (`restart:
  unless-stopped` podnosi je przed NTP); dane nienaruszone.
- **11.10** `3ca5cbc` przegląd aktualności dokumentacji + [raport statusu](reports/2026-10-11-status-report.md);
  `9417240` autostart krok 3.5: po NTP restart `app`, jeśli `StartedAt` < 2000 (fix incydentu 04.10), health w pętli do 90 s.
  **18.10** `16c2f42` [podsumowanie tygodnia](reports/2026-10-18-weekly-report.md) (2 alerty, 0 dostarczonych).
- **19.10 — „rdzeń+" large-cap (decyzja usera, pierwsza zmiana reguł od 01.09)**: 6 tickerów discovery o mcap ≥ $10B
  (PFE, BSX, COR, ELAN, COO, SMMT) → rdzeń delivery (UPDATE `tickers`: `sector='healthcare'`, `observationOnly=false`,
  nota `rdzeń+`); discovery rejestruje kandydata z mcap ≥ `DISCOVERY_LARGECAP_DELIVERY_MCAP_MLN` (10 000) od razu jako
  delivery (ping 🎯). Podstawa: alerty discovery Form 4 BUY z 7d — large-cap N=9 hit REAL 78% / med +1,0% vs small-cap
  N=29 28% / −5,3% (in-sample). Pre-rejestracja przeglądu 01.02.2027 lub N=10 w KALENDARZU + `VALIDATION_CALENDAR`.
  Rdzeń = 33 tickery.
- **22.10 — teczka „wejście nocne" zamknięta NEGATYWNIE** ([raport](reports/2026-10-22-after-hours-check.md)): Polygon
  minute aggs (sesja rozszerzona) dla 8 zdarzeń gate'u C-suite #2 — gap powstaje natychmiast po filingu (1. print
  mediana +3,4% = gap na open +3,0%), płynność symboliczna (0–739 szt.), REAL 7d przy wejściu na 1. princie −8,2% vs
  obecne −8,1%. Moment wejścia nie jest problemem; bez zmian w regułach.

## Czerwiec 2026 — Pakiet 1 + Pakiet 2 (edge fixes + discovery)

Kronika: [SESJA-2026-06-09-PAKIET-1.md](SESJA-2026-06-09-PAKIET-1.md),
[SESJA-2026-06-10-PAKIET-2.md](SESJA-2026-06-10-PAKIET-2.md),
[PAKIET-2-DISCOVERY-2026-06-10.md](PAKIET-2-DISCOVERY-2026-06-10.md).
Geneza: [REPORT-2026-06-09-EDGE-ASSESSMENT.md](REPORT-2026-06-09-EDGE-ASSESSMENT.md)
(system netto 0% edge) + [PLAN-EDGE-IMPROVEMENTS-2026-06-09.md](PLAN-EDGE-IMPROVEMENTS-2026-06-09.md).

**Pakiet 1 (09.06, commity `682b13d..09f958e`)** — 7 fixów:
- **P1-00** parser `aff10b5One`: filtr discretionary był no-opem (czytał per-transaction
  tag nieobecny w realnych filingach; prawdziwy znacznik to doc-level `<aff10b5One>`).
  Audyt 1248 filingów: SELL 80% planów ($403M), BUY 0/18. Backfill 752+1246 wierszy
  (10.06). Szczegóły: [AUDIT-10B51-2026-06-09.md](AUDIT-10B51-2026-06-09.md).
- **P1-01** floor priority Director BUY ≥$100K — GPT nie wetuje backtest-backed reguły (PODD Weatherman).
- **P1-02** bullish 8-K gate → observation (delivered bullish 0/4, śr −4.4%); gate na mainItem, R4 beat passthrough.
- **P1-03** PATTERN_THROTTLE INSIDER_PLUS_8K/OPTIONS 2h → 72h.
- **P1-04** FIX-16 shadow mode (asymetryczny cap liczony, NIE wdrożony; review 25.08).
- **P1-05** actionable Telegram (akcja/horyzont/wejście) + snapshot przed dispatch.
- **P1-06** PriceOutcome slot 7d (+xbi7d/ibb7d), hard timeout 7d→11d.

**10.06**: options flow CRON OFF (`03a784e`, odwracalnie — retencja Polygon zweryfikowana);
frontend dogoniony (kolumny 7d/α7d); kalendarz walidacji w raporcie 8h.

**Pakiet 2 (10.06, `1d9b85d`)** — discovery Form 4 sector-wide: kolektor `form4-discovery`
(getcurrent atom co 5 min + daily-index reconciliation 22:40 ET), auto-rejestracja
healthcare/biotech tickerów w observation mode. Weryfikacja adwersarialna 3× block → fix
(dual-row daily-index, transient Finnhub, Harvard hole, stagger cron, cap ET). Pierwsi
odkryci: EYE (10.06), SMMT (12.06, Duggan+Zanganeh $100M).

**15.06**: S20-T06 fix `getEffectiveStartTime` (alerty z okna 00-04 UTC gubiły dzień pomiaru).

## APLS-class expansion (23.05, `687c3d0`; Faza 3 wdrożona 09.06)

6 commercial-stage biotech (URGN/ARDX/MNKD/CRSP strict + AXSM/RCKT stretch) w observation
mode, `sector='biotech_apls'`, BUY-only ≥$500K, boost ×1.2 + strict ×1.1. Backtest 24 mies.:
BUY $500K+ 7d d=+0.75 p=0.041. **Faza 4 review: 09.07.2026** (gate ≥6 BUY, hit ≥60%, alpha ≥+2%).
Szczegóły: [APLS-FAZA-2-RESULTS-2026-05-23.md](APLS-FAZA-2-RESULTS-2026-05-23.md).

## XBI/IBB sector-adjusted alpha (23.05, `7ed4be6/a280dc7/86ead4f`)

6 kolumn xbi/ibb (At/1d/3d, +7d od P1-06) w Alert; `captureAlertSnapshot` helper;
`computeSectorAlpha` (beta=1.0); `/api/alerts/outcomes` zwraca alpha1d/3d/7d. Trigger:
BIIB 14.05 (surowy % miesza alpha z beta sektora). Code review 28.05 (`1a1dccd`):
`directionCorrect` revert na raw + `directionCorrectAlpha` opt-in.
Follow-up: [FOLLOWUP-XBI-ADJUSTMENT.md](FOLLOWUP-XBI-ADJUSTMENT.md).

## Sprint 19 P0 (29.04-11.05, FIX-01..13)

Fixy po HUM/UNH false positives + correlation backdoors + 8-K exhibit. Plan:
[SPRINT-19-BACKLOG.md](SPRINT-19-BACKLOG.md).
- **FIX-01** post-GPT missing-data guard (HUM halucynacja, `1dded97`).
- **FIX-02/02b/02c** pre-LLM Affirms keyword + conviction floor + hardcoded `true`→`false` + limit 8k→50k.
- **FIX-03/03b** observation skip przed GPT (Form4/8k + OptionsFlow correlation).
- **FIX-04** options-flow cycle budget 6h + cap 50 contracts/ticker.
- **FIX-05** direction conflict guard (UNH 3× false positive CRITICAL).
- **FIX-07** Form4 sell_no_edge correlation backdoor (GILD).
- **FIX-10/10b** fetch Exhibit 99.1 dla Item 2.02 + extractItemText boundary bug (MRNA).
- **FIX-12** pre-LLM analyst consensus injection + post-GPT consensus gap guard (PODD).
- **FIX-13 Faza 1** Alpha Vantage period match + anomaly guard WARN-only + cross-source diff log.

## Sprint 18 (23.04, TASK-01..12 + FOLLOW-1..8)

- **TASK-01** AlertDispatcherService (centralny dispatch, ~200 LoC dedup z 5 pipeline'ów).
- **TASK-02** SKIP_NON_ROLE_SELL hard skip (ASX case).
- **TASK-03** multi-transaction Form 4 aggregation.
- **TASK-04** correlation pattern dedup (content-hash, HPE cascade).
- **TASK-05** observation visual distinction (frontend PriorityChip).
- **TASK-06** PDUFA parser observability (PARSER_EMPTY warn).
- **TASK-09** INSIDER_CLUSTER BUY disabled (V5 cluster vs solo p>0.37).
- **TASK-10** C-suite regex unification (role-only whitelist).
- **FOLLOW-8** drop orphan tables `sentiment_scores`/`ai_pipeline_logs`.

## Sprint 16/16b/17 (06-22.04)

- **Sprint 16 P0** (`c2d8ae9..7fe870b`): multi-owner parser, baseline winsorize, NYSE holidays,
  AlertDeliveryGate shared limit. Audyt: [STOCKPULSE-AUDIT-2026-04-16.md](STOCKPULSE-AUDIT-2026-04-16.md).
- **Sprint 16b** (17.04): C-suite whitelist explicit, C-suite SELL → observation (V4 d=-0.002),
  Options Flow timeout 30s.
- **Sprint 17 P1 V5 backtest** (18.04, `f69cfa8`): Director BUY boost ×1.15, H6 control group fix,
  H1 cluster vs solo BUY. Wyniki: healthcare SELL zero edge, control SELL d=+0.10 30d ✓✓✓,
  cluster vs solo BUY p>0.37. Ściąga: [STOCKPULSE-CHEATSHEET-2026-04-17.md](STOCKPULSE-CHEATSHEET-2026-04-17.md).
- **Scheduler consolidation** (22.04): timeZone UTC w @Cron, every:ms → cron pattern,
  5-min stagger (:00 price-outcome, :05/:35 sec-edgar, :15 pdufa).
- **FinBERT cleanup** (22.04, ~2400 LoC): usunięty sidecar + sentiment pipeline + 6 reguł
  sentymentowych. Sprint 15 backtest potwierdził zero edge na sentymencie.

## Sprint 11-15 (03-06.04) — przebudowa na edge

- **Sprint 11**: wyłączenie szumu (StockTwits 0% edge, Finnhub news HFT lag), focus insider pipeline.
- **Sprint 12**: migracja Azure OpenAI gpt-4o-mini → Anthropic Claude Sonnet (bezpośrednio z NestJS).
- **Sprint 15**: backtest 3 lat SEC EDGAR (43 946 tx, 61 tickerów). **insider BUY jedyny silny edge**
  (d=0.43, p<0.001). Reguła Form 4 Insider BUY (C-suite ×1.3, healthcare ×1.2). Director SELL = anty-sygnał.
- **Sprint 16/17**: Semi Supply Chain (14 tickerów observation mode), kolumny `sector`/`observationOnly`/`nonDeliveryReason`.

---

*Faza 0-2 + Sprint 4-10: wcześniejsza historia w `git log` i `doc/reports/`.*
