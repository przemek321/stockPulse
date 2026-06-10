# Kalendarz walidacji 2026 (utworzony 10.06.2026)

> Daty decyzyjne z planu [PLAN-EDGE-IMPROVEMENTS-2026-06-09.md](PLAN-EDGE-IMPROVEMENTS-2026-06-09.md).
> **Mechanizm przypomnienia**: raport 8h na Telegramie pokazuje sekcję
> „📅 Kalendarz walidacji" od 7 dni przed terminem do 3 dni po (flaga ZALEGŁY) —
> źródło: `VALIDATION_CALENDAR` w `src/alerts/summary-scheduler.service.ts`.
> Po wykonaniu przeglądu usuń wpis z tablicy (i odhacz tutaj).

## 2026-07-09 — APLS Faza 4 review

- **Co**: ocena okna obserwacyjnego 6 tickerów `biotech_apls` (URGN/ARDX/MNKD/CRSP/AXSM/RCKT), seed 09.06.
- **Gate**: ≥6 BUY events, hit rate 7d ≥60%, median XBI-alpha ≥+2%.
- **Gdzie**: gotowy SQL w [APLS-FAZA-2-RESULTS-2026-05-23.md](APLS-FAZA-2-RESULTS-2026-05-23.md)
  (sekcja „Faza 4 obs window monitoring"); slot 7d działa od P1-06.
- **Decyzja**: promocja do delivery / przedłużenie obs / wycofanie.

## 2026-07-25 — przegląd okna obs discovery (Pakiet 2)

- **Co**: jakość kandydatów auto-zarejestrowanych przez `form4-discovery` od 10.06.
- **Sprawdź**: `SELECT * FROM tickers WHERE sector='healthcare_discovery'` + ich alerty
  obserwacyjne z price7d/xbiAlpha7d; rozkład mcap/ról; zero pump-class.
- **Decyzja**: włączenie delivery **top-N** (max 1-2/tydz najwyższy conviction) /
  przedłużenie obs / korekta filtrów. Też: przycinanie uniwersum discovery
  (brak auto-expiry — celowo odłożone do tego przeglądu).
- **Kontekst**: [PAKIET-2-DISCOVERY-2026-06-10.md](PAKIET-2-DISCOVERY-2026-06-10.md).

## 2026-08-25 — FIX-16 shadow review

- **Co**: czy asymetryczny cap R1 (extreme miss bez capu) ma poparcie w danych.
- **Query**: `SELECT "gptAnalysis"->'fix16_shadow' FROM sec_filings WHERE "gptAnalysis" ? 'fix16_shadow'`.
- **Gate**: N≥3 `would_uncap=true` z kierunkiem zgodnym (stock spadł po extreme missie —
  sprawdź price outcomes). Q2 earnings (lipiec) powinno dostarczyć próbkę.
- **Decyzja**: deploy drabinki z `src/sec-filings/utils/fix16-shadow.ts` / dalej shadow.
- **Kontekst**: HIMS 11.05 stracony short −19.7% 1d; [SPRINT-19-BACKLOG.md](SPRINT-19-BACKLOG.md) FAZA 3.

## 2026-09-01 — werdykt „czy system ma edge"

- **Co**: powtórka forward-analizy z [REPORT-2026-06-09-EDGE-ASSESSMENT.md](REPORT-2026-06-09-EDGE-ASSESSMENT.md)
  na alertach post-fixowych: signed return 3d **i 7d**, hit rate, XBI-alpha, per reguła.
- **Oczekiwane**: ~20-30 niezależnych alertów z 7d outcome (core + APLS + discovery).
- **Baseline do porównania**: all-time 0.00% signed 3d / hit 52%; post-fix +3.03% / 73% (N=11).
- **Decyzja**: kontynuować / korygować / zwijać.

## 2026-09-07 — bullish-8K gate revisit (90d od P1-02)

- **Query**: alerty `nonDeliveryReason IN ('bullish_8k_no_edge','bullish_no_consensus_data')`
  + price outcomes 1d/3d/7d.
- **Gate**: hit suppressed >55% i średnia dodatnia → **zawęzić** gate (np. tylko
  1.01/7.01-contract zostaje stłumione). Odpala też wcześniej przy N≥10 suppressed.
- **Kontekst**: [PLAN-EDGE-IMPROVEMENTS-2026-06-09.md](PLAN-EDGE-IMPROVEMENTS-2026-06-09.md) §2.P1, commit `44732fc`.

## Wcześniejsze gate'y (dla porządku)

- ~~2026-05-25 — FIX-13 Faza 3 decision deadline~~ (osobny wątek, Plan v3)
- **lipiec 2026** — FIX-10b forward validation (Q2 earnings; kryteria w
  [FIX-10b-VALIDATION-CRITERIA.md](FIX-10b-VALIDATION-CRITERIA.md): 20 alertów Item 2.02,
  ≥85% z 2+ liczbami, 0% regresji MRNA-class) — bez sztywnej daty, naturalnie
  wyjdzie przy przeglądach 09.07/25.07.
