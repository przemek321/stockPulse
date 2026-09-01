# Dziennik transakcji — gra real (REGUŁY §6, obowiązkowy)

> Założony 01.09.2026 przy werdykcie #1 (wcześniej brak — luka). Wpis = każdy alert z 🎯 (delivered Form 4
> Insider BUY z listy core), także pominięty (`SKIPPED_CHASE` / `SKIPPED_SIZE` / `SKIPPED_USER`).
> Kolumna **REAL** = zwrot od pierwszej dostępnej ceny po alercie (`price1h`) do 7d, **NET** = REAL − 1% kosztów.
> Systemowa metryka (raw od `priceAtAlert`) ≠ P&L gracza — patrz WERDYKT-EDGE-2026-09-01.md §0.

| # | Alert | Data (ET) | priceAtAlert | Max wejście (+3%) | Pierwsza cena | Wejście usera | Wyjście (7d) | Wynik brutto | PLN netto | Status | Uwagi |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | ELV #2446 | 17.07 14:05 | 369.99 | 381.09 | 383.99 (pn 20.07, +3.8%) | **?** (user: „na samym dołku dnia" 17.07) | **?** (mechanicznie ~24.07, 7d=378.71) | **?** | **?** | OPEN→? | #2447 to duplikat tego samego filingu (bug, do naprawy). Wejście intraday 17.07 poniżej chase = zgodne z regułami. **Uzupełnić: cena wejścia, liczba akcji, data i cena wyjścia, wynik PLN.** |
| 2 | PODD #2484 | 24.08 07:35 | 148.16 | 152.60 | 147.73 (−0.3%) | — | 148.60 | REAL +0.6% | ≈ −10 PLN (gdyby) | SKIPPED_USER | Potwierdzone 01.09: nie grany. Wchodzalny, wynik po kosztach ≈ 0. |

## Bilans
- Kwalifikujące sygnały 02.07–01.09: **2 zdarzenia** (ELV, PODD); zagrany 1 (ELV, wynik do uzupełnienia).
- Częstotliwość: ~1 sygnał/miesiąc. Otwarte pozycje na 01.09: brak.

## Korekty reguł (z werdyktu 01.09)
- **Sizing przy drogich akcjach**: gdy 1 akcja > 1 500 PLN (np. ELV ~1 350-1 400 PLN), dopuszczalna pozycja
  = 1 akcja (poniżej minimum) — lepiej 1 akcja niż 0 lub 2 (> max 2 400). Pozycja 2 akcji tylko gdy ≤ 2 400 PLN.
- **Chase guard** ocenia cenę w momencie faktycznego wejścia (intraday OK), nie pierwszą cenę następnej sesji.
- Zapisywać także `SKIPPED_*` — bez tego bilans reguł jest nieweryfikowalny (lekcja: 0 wpisów przez 2 miesiące).
