# Streszczenie badania skuteczności — 09.06.2026

> Skrót wykonawczy. Pełna synteza z werdyktami adwersarialnymi i planem wdrożenia:
> [PLAN-EDGE-IMPROVEMENTS-2026-06-09.md](PLAN-EDGE-IMPROVEMENTS-2026-06-09.md).
> Punkt wyjścia (forward-ocena 98 alertów): [REPORT-2026-06-09-EDGE-ASSESSMENT.md](REPORT-2026-06-09-EDGE-ASSESSMENT.md).
> Metoda: 11 agentów (5 raportów dowodowych + 6 weryfikacji adwersarialnych), dane produkcyjne + backtest V5/APLS + literatura.

## Odkrycie P0, którego nikt się nie spodziewał: filtr 10b5-1 nie działa

Parser czyta per-transaction tag, którego realne filingi nie mają — prawdziwy znacznik
to doc-level `<aff10b5One>`, nieparsowany. Efekt: **0 z 3384** transakcji w bazie ma
flagę planu, a SELL GILD O'Day z 29.04 (ten od FIX-07) *był planową sprzedażą*
potraktowaną jako discretionary. Cała premisa "discretionary only" to dziś fikcja.
Fix jest malutki (XS) i jest warunkiem wszystkiego dalej.

## Druga nieszczelność: GPT wetuje najlepszą regułę

PODD Weatherman, Director BUY $497K (03.06) — GPT dał magnitude='low' i alert
**nie wyszedł**; bliźniaczy Stonesifer $400K dzień później wyszedł i zrobił +4.3% 3d.
LLM zjadł 25% deliverable BUY. Fix: deterministyczny floor priorytetu dla
backtest-backed BUY — GPT wzbogaca treść, ale nie blokuje.

## Najmocniejsza dźwignia (zweryfikowana na żywo): screening całego sektora

Zamiast listy 28 tickerów — event-driven screening wszystkich Form 4. Kanał
`getcurrent` SEC działa real-time, a podaż healthcare/biotech BUY ≥$500K to
~50/miesiąc rynkowo → po ostrych filtrach (C-suite/Director, mcap ≥$250M, bez 10%
ownerów) **2-5 kandydatów/tydzień = 8-20× obecny lejek**. Wariant all-market
weryfikator **obalił** — dane kontrolne do walidacji okazały się śmieciowe
(86% to 10% ownerzy, 607 wpisów z samego BAC).

## Obalone — nie tracić na to czasu

- **PDUFA jako sygnał**: literatura (Rothenstein JNCI 2011, event study 167 approvals)
  pokazuje run-up przed wynikami badań klinicznych, *nie* przed decyzjami FDA;
  do tego zero nadchodzących eventów PDUFA w naszym uniwersum (ACLX/KURA/VERA — wszystkie poza).
- **Szybszy polling SEC**: mediana opóźnienia transakcja→kolekcja to 69h — to ustawowe
  T+2 insidera, nie polling; skrócenie 30→5 min zmienia 0.3%. 68% filingów wpada
  po zamknięciu sesji.

## Plan (szczegóły w PLAN-EDGE-IMPROVEMENTS)

- **Pakiet 1** (~2-3 dni, 7 zmian S/XS): fix parsera `aff10b5One`, floor priority dla BUY,
  gate bullish-8K (0/4 trafień, śr. −4.4%), PATTERN_THROTTLE 2h→72h, FIX-16 shadow mode,
  actionable Telegram (akcja/horyzont/cena wejścia), slot 7d w PriceOutcome.
- **Pakiet 2** (3-5 dni): pivot discovery sector-wide healthcare/biotech (getcurrent
  co 5 min + EFTS reconciliation + SIC + mcap/ADV), observation 30-60d, delivery top-N.
- **Wyłączenie options flow** (odwracalne, CRON off): cykl pali równe 6h dziennie
  (abort na budżecie), 22/48 tickerów bez danych od 30 dni, a wszystkie correlated
  winnery były re-broadcastami standalone Form 4 BUY z tego samego dnia.

## Kalendarz walidacji

| Data | Co |
|---|---|
| 09.07.2026 | APLS Faza 4 review (≥6 BUY, hit ≥60%, alpha ≥+2%) |
| 25.08.2026 | FIX-16 decyzja deploy (N≥3 w shadow logu) |
| ~01.09.2026 | Werdykt "czy system ma edge" (~20-30 niezależnych alertów z 7d outcome) |

Stan na 09.06 wieczór: nic z planu jeszcze nie wdrożone; naturalny start = Pakiet 1
od fixu parsera.
