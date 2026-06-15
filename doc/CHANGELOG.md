# StockPulse — CHANGELOG (historia zmian)

> Oś czasu wydzielona z CLAUDE.md 15.06.2026, żeby plik instrukcji został zwięzły
> (ładuje się do kontekstu co sesję). **To jest archiwum „jak doszliśmy" —
> CLAUDE.md opisuje „jak działa teraz".** Pełny pre-cleanup tekst CLAUDE.md jest
> odzyskiwalny przez `git show <commit>:CLAUDE.md`. Wyczerpujące szczegóły każdej
> zmiany: `git log` + pliki `doc/` linkowane niżej.

---

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
