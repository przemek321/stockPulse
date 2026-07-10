# APLS Faza 4 review — werdykt (wykonany 10.07.2026, termin 09.07)

> Gate z [KALENDARZA](KALENDARZ-WALIDACJI-2026.md): ≥6 BUY events, hit 7d ≥60%,
> median XBI-alpha ≥+2%. Kohorta: 6 tickerów `biotech_apls`
> (URGN/ARDX/MNKD/CRSP/AXSM/RCKT), seed 09.06.2026, BUY-only ≥$500K.
> Metryki wg wiążących definicji pre-zarejestrowanych 02.07 (hit=raw, alpha osobno).

## Werdykt: **INSUFFICIENT DATA** → okno przedłużone do 01.09

Stan danych za pełne okno 09.06–10.07 (SQL na prod, 10.07):

| Metryka | Wynik | Gate |
|---|---|---|
| BUY events (alerty) | **0** | ≥6 — NIESPEŁNIALNY |
| Discretionary BUY w insider_trades (jakiejkolwiek wielkości) | **0** | — |
| Hit 7d / alpha | brak danych (N=0) | nie dotyczy |

Insiderzy 6 spółek przez cały miesiąc nie kupili ani jednej akcji: wyłącznie
GRANT (55), EXERCISE (20), plan-SELL (ARDX $727K, AXSM $36.3M, URGN $350K)
i 1 discretionary SELL (URGN $142.5K). Kontekst reżimu: rajd XBI (+20% w
czerwcu) — insiderzy kupują dołki, nie szczyty; **brak PODAŻY sygnału jest
skorelowany z reżimem rynkowym i nie jest dowodem przeciw hipotezie APLS**
(backtest Faza 2: BUY $500K+ 7d d=+0.75 p=0.041 pozostaje w mocy).

## Decyzja (zgodna z pre-werdyktem z 02.07)

1. **Okno obserwacyjne przedłużone do werdyktu 01.09** — kohorta zostaje
   w observation mode bez zmian konfiguracji (zero kosztu: BUY-only gate
   nie generuje GPT calls przy braku BUY).
2. **Licznik gate'u od pierwszego BUY**: jeśli pierwszy discretionary BUY
   pojawi się przed 01.09, okno oceny liczy się od jego daty (a nie od
   seedu) — gate ≥6 BUY oceniany najwcześniej 6 tygodni po pierwszym BUY.
3. Wpis 09.07 zdjęty z `VALIDATION_CALENDAR` (raport 8h przestaje przypominać);
   ocena APLS wraca jako część werdyktu 01.09.
4. Wniosku „brak edge" NIE wyciągamy — na N=0 byłby błędem (patrz ryzyko
   konstrukcyjne gate'u odnotowane w audycie 02.07: kryterium ≥6 BUY zależy
   od zachowania insiderów, nie od jakości systemu).

## Przy okazji przeglądu (stan pomiarów 10.07)

- **SEM #2441** (byczy 8-K stłumiony `gpt_missing_data`, 01.07): komplet 7d —
  raw **0.00%** (16.51→16.51, płaski cały tydzień), XBI +3.8% w oknie →
  **alpha −3.8%**. Tłumienie zasadne (LONG przegrałby z sektorem). Dopisany
  do bilansu bullish w kalendarzu (rewizja 07.09).
- **VRTX #2442** (07.07, `bullish_8k_no_edge`): trzeci przypadek do bilansu
  bullish-gate; 7d wypadnie ~14.07.
- Discovery: bez nowych tickerów (EYE/SMMT/COR); delivered nadal 0 od 04.06.
