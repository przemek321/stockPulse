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

## Korekty reguł
Sizing przy drogich akcjach, chase guard intraday, tie-break slotów i stop dyscyplinarny na NETTO —
**przeniesione do REGUŁ jako datowane dopiski 24.09.2026** (§2, §3, §5, Załącznik A). Tu zostaje tylko:
- Zapisywać także `SKIPPED_*` (`SKIPPED_CHASE` / `SKIPPED_SIZE` / `SKIPPED_SLOTS` / `SKIPPED_XTB` /
  `SKIPPED_USER`) — bez tego bilans reguł jest nieweryfikowalny (lekcja: 0 wpisów przez 2 miesiące).
- **Stop dyscyplinarny (od 24.09)**: seria = kolejne WYKONANE transakcje z wynikiem PLN netto < 0; 3 z rzędu
  → pauza do 01.11. Licznik serii na dziś: **0** (ELV wynik niezapisany — nie liczy się; PODD pominięty).
