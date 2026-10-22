# Sprawdzenie „wejścia nocnego" (after-hours / pre-market) — 22.10.2026

**Pytanie usera (19.10)**: czy wejście po godzinach (broker z handlem nocnym) pozwoliłoby ominąć gap na otwarciu,
który uniemożliwia realizację edge'u C-suite BUY (sub-gate #1 23.09: edge informacyjny, nie realizowalny)?

**Dane**: Polygon `/v2/aggs/.../range/1/minute` (sesja rozszerzona 4:00–20:00 ET; sesja nocna 20:00–04:00
Blue Ocean NIE jest w SIP), 9 alertów = 8 zdarzeń gate'u C-suite #2 (od 02.09; `scripts/csuite-gate.sh --print`).
Skrypt jednorazowy (scratchpad), odczyt 22.10. Cena alertu (`priceAtAlert`, Finnhub) = zamknięcie sesji regularnej
(zweryfikowane na barze 16:00). REAL = `price7d` vs cena wejścia − 1% kosztów.

| alert | czas ET | cena alertu | 1. print po alercie | gap 1. printu | gap open | wolumen do open | REAL 7d @1. print | REAL 7d @1h (obecne) |
|---|---|---|---|---|---|---|---|---|
| ENOV #2496 | 04.09 21:02 | 18,56 | 08.09 04:00 @18,80 | +1,3% | +3,2% | 29,9k | −8,2% | −9,5% |
| INBX #2497 | 08.09 16:07 | 114,34 | 16:17 @118,00 | +3,2% | +2,7% | 9,2k | −11,7% | −16,7% |
| ATEC #2500 | 10.09 21:02 | 8,84 | 11.09 04:00 @9,09 | +2,8% | +8,0% | 52k | +13,5% | +2,3% |
| RLMD #2501 | 11.09 07:32 | 4,07 | 07:37 @4,41 | +8,4% | +13,0% | 35k | −6,9% | −6,7% |
| INBX #2510 | 23.09 17:05 | 100,33 | **brak transakcji** | — | +2,0% | 0 | — | −1,2% |
| DMRA #2511 | 28.09 07:02 | 20,66 | 09:28 @21,90 | +6,0% | +2,9% | 500 szt. | −8,9% | −2,4% |
| INBX #2512 | 28.09 18:05 | 101,71 | 18:32 @104,00 | +2,3% | +3,5% | 739 szt. | −10,1% | −9,9% |
| XENE #2514 | 01.10 09:22 | 37,19 | 09:23 @38,50 | +3,5% | +3,0% | 17k | −8,2% | −9,5% |
| INBX #2518 | 14.10 19:05 | 85,26 | 15.10 04:02 @89,85 | +5,4% | +2,7% | 1,9k | +8,8% | +9,5% |

## Wnioski

1. **Gap powstaje natychmiast po filingu, nie przez noc.** Pierwszy print po alercie (nawet 10 min po filingu,
   w after-hours — INBX 16:17) jest już +1,3…+8,4% nad zamknięciem; mediana **+3,4%** = gap na otwarciu (+3,0%).
   Nie istnieje okno, w którym odbiorca alertu kupuje po cenie sprzed Form 4.
2. **Płynność symboliczna**: 0 transakcji (INBX 23.09), 739 szt./2 h (INBX 28.09), pojedynczy print 500 szt.
   (DMRA — wejście @21,90 gorsze niż open @21,26). Cena printu jest losowa.
3. **Wynik 7d bez zmian**: mediana REAL @1. print **−8,2%** vs @1h **−8,1%**; hit 2/8 w obu wariantach.
   Moment wejścia nie jest problemem gate'u C-suite — problemem jest brak edge'u post-filing na tych small-capach.
4. Sesja nocna 20:00–04:00 niezmierzona (brak w danych), ale ENOV/ATEC (filing 21:02) miały pierwszy print
   o 4:00 już +1,3%/+2,8% — noc nie dałaby lepiej.

**Decyzja**: teczka „wejście nocne" zamknięta z wynikiem NEGATYWNYM (dyscyplina hipotez: negatywny wynik czyści
teczkę). Nie szukać brokera z handlem nocnym pod ten system. Bez zmian w regułach i kodzie.

Czego nie zweryfikowałem: spreadów bid/ask w sesji rozszerzonej (Polygon aggs nie zawiera), realnej wykonalności
zlecenia 1 akcji na XTB poza sesją (XTB: brak handlu nocnego dla US — nieaktualne do sprawdzenia, bo wynik i tak negatywny).
