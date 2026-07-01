# Kalendarz walidacji 2026 (utworzony 10.06.2026)

> Daty decyzyjne z planu [PLAN-EDGE-IMPROVEMENTS-2026-06-09.md](PLAN-EDGE-IMPROVEMENTS-2026-06-09.md).
> **Mechanizm przypomnienia**: raport 8h na Telegramie pokazuje sekcję
> „📅 Kalendarz walidacji" od 7 dni przed terminem do 3 dni po (flaga ZALEGŁY) —
> źródło: `VALIDATION_CALENDAR` w `src/alerts/summary-scheduler.service.ts`.
> Po wykonaniu przeglądu usuń wpis z tablicy (i odhacz tutaj).

## Wiążące definicje metryk — pre-rejestracja 02.07.2026 (PRZED przeglądami)

Ustalone po audycie 02.07 (workflow edge-analysis), bo na danych z czerwca sama definicja
„hit" odwraca werdykt o 180° (discovery BUY: raw hit 4/4, alpha hit 0/4 — okno rajdu XBI +20%).

- **hit 7d** = kierunek surowej ceny: `price7d > priceAtAlert` dla alertów positive
  (odwrotnie dla negative). Alpha NIE wchodzi do definicji hitu.
- **alpha 7d** = `xbiAlpha7d` (fallback `ibbAlpha7d`) — OSOBNE kryterium; edge uznajemy
  tylko gdy przechodzą OBA progi gate'u (jak w zapisie gate'u APLS: „hit ≥60% ORAZ alpha ≥+2%").
- **Raportowanie zawsze w trzech kolumnach**: raw 7d, alpha XBI, alpha IBB + zwrot XBI w oknie —
  żeby odróżnić „pick słabszy od sektora" od artefaktu beta=1.0 w rajdzie. Dla tickerów
  spoza biotechu klinicznego (EYE retail, COR dystrybucja SIC 5122) alpha vs XBI traktować
  jako dolne ograniczenie, nie werdykt (benchmark mismatch).
- **Atrybucja C-suite/Director w analizach**: zawsze SQL-em z `insider_trades.insiderRole`,
  nigdy z boostu/priorytetu alertu (do 02.07 ścieżka boostu miała name-match — „Harvard hole",
  usunięty; starsze alerty mogą nosić skażony priorytet).
- **Za mało danych ≠ fail**: przy N poniżej progu gate'u werdykt brzmi „insufficient N"
  i przesuwamy przegląd — nie forsujemy decyzji (anty-wzorzec, który FIX-16 miał wyeliminować).

## 2026-07-09 — APLS Faza 4 review

- **Co**: ocena okna obserwacyjnego 6 tickerów `biotech_apls` (URGN/ARDX/MNKD/CRSP/AXSM/RCKT), seed 09.06.
- **Gate**: ≥6 BUY events, hit rate 7d ≥60%, median XBI-alpha ≥+2%.
- **Gdzie**: gotowy SQL w [APLS-FAZA-2-RESULTS-2026-05-23.md](APLS-FAZA-2-RESULTS-2026-05-23.md)
  (sekcja „Faza 4 obs window monitoring"); slot 7d działa od P1-06.
- **Decyzja**: promocja do delivery / przedłużenie obs / wycofanie.
- **Pre-werdykt 02.07**: gate matematycznie niespełnialny — **0 discretionary BUY** na 6 tickerach
  od seedu (insiderzy w rajdzie XBI +20% nie kupują; same SELL/GRANT/EXERCISE, AXSM plan-SELL $24.4M).
  To brak PODAŻY sygnału, nie brak edge. Rekomendacja na 09.07: **przedłużenie okna** (np. do
  werdyktu 01.09) + liczyć okno od PIERWSZEGO BUY, nie od daty seedu. Wniosek „brak edge"
  na zerowej próbce byłby błędny.

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
- **Stan 02.07**: N=0 (zero capów FIX-12 od wdrożenia 09.06). Jeśli do ~15.08 N<3 —
  przesunąć review z wyprzedzeniem, nie decydować na N=1-2. Uwaga: Alpha Vantage free
  25 req/dzień może być wąskim gardłem danych konsensusu w szczycie Q2.
- **Kontekst**: HIMS 11.05 stracony short −19.7% 1d; [SPRINT-19-BACKLOG.md](SPRINT-19-BACKLOG.md) FAZA 3.

## 2026-09-01 — werdykt „czy system ma edge"

- **Co**: powtórka forward-analizy z [REPORT-2026-06-09-EDGE-ASSESSMENT.md](REPORT-2026-06-09-EDGE-ASSESSMENT.md)
  na alertach post-fixowych: signed return 3d **i 7d**, hit rate, XBI-alpha, per reguła.
- **Oczekiwane**: ~20-30 niezależnych alertów z 7d outcome (core + APLS + discovery).
- **Baseline do porównania**: all-time 0.00% signed 3d / hit 52%; post-fix +3.03% / 73% (N=11).
- **Decyzja**: kontynuować / korygować / zwijać.
- **Noty z audytu 02.07** (uwzględnić w analizie): (1) delivered=0 od 04.06 — werdykt musi
  rozdzielić jakość SYGNAŁÓW (DB-only obs) od jakości SELEKCJI delivery, której forward nie
  przetestował; (2) INSIDER_CLUSTER i INSIDER_PLUS_OPTIONS martwe, INSIDER_PLUS_8K ~martwy
  (okno 24h po czasie ingestii vs mediana latencji Form 4 = 69h) — cisza korelacji to artefakt
  architektury, NIE zasługa throttle; (3) tempo alertów 6/2/2/1 na tydzień — przy tempie
  końca VI werdykt stanie na ~20-23 z 7d (dolny brzeg), sprawdzić licznik ~20.07;
  (4) obserwacje z czerwca dzielą jedno okno rynkowe (rajd XBI) — nie są niezależne.

## 2026-09-07 — bullish-8K gate revisit (90d od P1-02)

- **Query**: alerty `nonDeliveryReason IN ('bullish_8k_no_edge','bullish_no_consensus_data')`
  + price outcomes 1d/3d/7d. **UWAGA (audyt 02.07)**: priorytet suppression maskuje bullish —
  byczy 8-K z missing-data ląduje w `gpt_missing_data` (case: SEM 01.07 positive), z gap
  konsensusu w `consensus_*`. Query MUSI objąć też
  `alertDirection='positive' AND "nonDeliveryReason" IN ('gpt_missing_data','consensus_miss')`,
  inaczej bilans gate'a zaniżony o klasę, która historycznie wygrywała (6/9, +2.1%).
- **Gate**: hit suppressed >55% i średnia dodatnia → **zawęzić** gate (np. tylko
  1.01/7.01-contract zostaje stłumione). Odpala też wcześniej przy N≥10 suppressed.
- **Bilans na 02.07 (N=2, prowadzić na bieżąco)**: MOH 10.06 uratowany (raw −0.9%, α −10.4%)
  vs ABBV 22.06 wycięty katalizator M&A (raw **+16.1%**, α +5.4%) — 1:1. Tagować po
  `catalyst_type`: hipoteza, że gate projektowany pod earnings-hype nie powinien łapać `ma`
  (decyzja przy N≥3 dla tej kategorii).
- **Kontekst**: [PLAN-EDGE-IMPROVEMENTS-2026-06-09.md](PLAN-EDGE-IMPROVEMENTS-2026-06-09.md) §2.P1, commit `44732fc`.

## Wcześniejsze gate'y (dla porządku)

- ~~2026-05-25 — FIX-13 Faza 3 decision deadline~~ (osobny wątek, Plan v3)
- **lipiec 2026** — FIX-10b forward validation (Q2 earnings; kryteria w
  [FIX-10b-VALIDATION-CRITERIA.md](FIX-10b-VALIDATION-CRITERIA.md): 20 alertów Item 2.02,
  ≥85% z 2+ liczbami, 0% regresji MRNA-class) — bez sztywnej daty, naturalnie
  wyjdzie przy przeglądach 09.07/25.07.
