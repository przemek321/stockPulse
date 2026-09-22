# Przegląd sub-gate'u C-suite BUY — 23.09.2026 (wyzwalacz wczesny N=10 z 18.09)

**Werdykt: NIE promujemy. Gate formalnie przeszedł, ale na danych, na których go sformułowano; jedyne
zdarzenia forward mają realizowalny zwrot −7%. Pre-rejestracja gate'u #2 wyłącznie na danych po 01.09.**

Weryfikacja: 3 recenzje adwersarialne (statystyk: DO_NOT_PROMOTE; praktyk XTB i audytor pre-rejestracji:
PROMOTE_WITH_CONDITIONS) + ślepe przeliczenie z bazy (zgodne co do 0.01; PROMOTE_WITH_CONDITIONS).
Rozstrzygające argumenty statystyka poniżej — pozostali nie kwestionowali liczb, tylko literę pre-rejestracji.

## 1. Co się stało
- Licznik dobił do N=10 (T1) **18.09 23:45**; ping „wysłany" wg logu, ale **nie dotarł** (curl `-o /dev/null`,
  brak kontroli `ok:true`) → przegląd 4 dni po terminie z pre-rejestracji („w dniu, w którym N osiągnie 10").
  Naprawione 22.09: log HTTP, state tylko przy `ok:true`, ponowienie następnego dnia.
- **Bug atrybucji** (P1 od audytora i ślepego przeliczenia): rola brana z dowolnego BUY symbolu w oknie 14d,
  nie z transakcji wyzwalającej alert → alerty Director (INBX #2498, ELV #2447) liczone jako C-suite, a INBX
  #2508 (Director Kayyem, 17.09) wszedłby ~24.09 jako **fantomowe 11. zdarzenie**. Naprawione 23.09: wyzwalacz
  z nagłówka wiadomości + `collectedAt` = `sentAt`; tier z grupy wyzwalacza. Skład T1 po fixie: te same 10 zdarzeń.

## 2. Liczby (T1, pozycja 2 200 PLN, REAL = price1h→price7d − 1%)

| Wariant | N | hit | med α | med REAL | **śr REAL** | **suma PLN** | wchodzalne (gap ≤3%) |
|---|---|---|---|---|---|---|---|
| A: gate wg skryptu | 10 | 90% | +3.50 | **+1.48** | **−1.23** | **−271** | 2/10 |
| B: in-sample (≤01.09 — dane, na których gate powstał) | 7 | 100% | +4.54 | +3.08 | +1.26 | +194 | 2/7 |
| **C: out-of-sample (po pre-rejestracji)** | **3** | **67%** | **+1.97** | **−6.68** | **−7.04** | **−465** | **0/3** |
| D: bez PRE (jedyny duży wygrany) | 9 | 89% | +2.45 | +0.68 | −2.40 | −476 | 2 |
| E: KURA sklejona (7d 0h48m) | 9 | 89% | +4.54 | +2.27 | −0.37 | −74 | 2 |
| G: tylko wchodzalne wg chase guardu | 2 | 100% | −2.22 | +1.88 | +1.88 | +83 | 2 |

REAL per zdarzenie: SMMT +0.68, ELV −2.38, BSX +3.25, PFE +3.08, KURA +3.80, KURA −8.95, PRE +9.33,
INBX −16.71, ATEC +2.27, RLMD −6.68. Bootstrap: P(med REAL>0)=0.66, CI mediany [−6.7, +3.4]; Wilcoxon p=0.54.
Gap do pierwszej ceny: mediana **+7.3%** (średnia +6.8% > średni raw +6.5%) — cały „edge" siedzi w luce
overnight, której gracz nie łapie. Chase guard (+3%) blokuje **8/10**; zablokowana ósemka ma med REAL −0.36%.

## 3. Dlaczego NIE promujemy mimo formalnego PASS
1. **In-sample ≠ test.** 01.09 zapisaliśmy: „8 zdarzeń, wszystkie warunki spełnione — brakuje N". Próg N≥10
   wymagał więc 2-3 nowych zdarzeń, a te (INBX, ATEC, RLMD) **przegrały na wszystkich trzech progach** (hit 67%,
   med α +1.97 <2, med REAL −6.68). Gate „przeszedł" wyłącznie dzięki wadze siedmiu zdarzeń in-sample.
2. **Mediana maskuje ujemną wartość oczekiwaną.** Gracz realizuje sumę, nie medianę: −271 PLN na 10 równych
   pozycjach; jeden INBX (−16.7% = −368 PLN) zjada pięć wygranych. Rozkład z ciężkim lewym ogonem.
3. **N=10 stoi na dwóch granicach definicji naraz**: KURA jako 2 zdarzenia (odstęp 7d 0h48m) i PRE ≥$500K
   o $1 998. Każda korekta osobno → N=9 (brak wyzwalacza); obie naraz → N=8.
4. **Sygnał informacyjny jest realny** (hit 9/10, p=0.011; śr α +5.1 z CI>0; XBI dodatni tylko w 4/10 okien —
   to nie rajd), ale **nie jest realizowalny** dla czytelnika Telegrama: rynek wycenia filing na otwarciu.
5. Promocja dałaby 🎯, których reguły gry zabraniają grać w 80% przypadków; grywalna podpróbka ma N=2 (+83 PLN
   za 14 tygodni). Wartość promocji = pomiar, nie dochód — a pomiar mamy już z obserwacji, za darmo.

## 4. Decyzja i pre-rejestracja gate'u #2 (wiążąca od 23.09)
- **Bez promocji.** C-suite BUY z discovery pozostaje obserwacją. Chase guard +3% **bez zmian** (na tej próbce
  chroni: zablokowane zdarzenia med REAL −0.36%). Reguły gry bez zmian.
- **Gate #2 — wyłącznie zdarzenia T1 z `first_at ≥ 2026-09-02`** (czysty forward): N≥10 ∧ hit ≥60% ∧ med α ≥+2pp
  ∧ **med REAL >0 ∧ śr REAL >0** (oba — mediana nie może maskować ogona) ∧ **≥30% zdarzeń wchodzalnych**
  (gap ≤3%). Stan dziś: N=3 (INBX/ATEC/RLMD), FAIL na wszystkim. Przy tempie września N=10 ≈ połowa listopada.
- **Definicje doprecyzowane** (usuwają granice z pkt 3): zdarzenie = ten sam insider LUB symbol w łańcuchu
  ≤7 dni **kalendarzowych** liczonych po `transactionDate` (KURA → 1 zdarzenie); tier z grupy wyzwalacza
  w **jednym filingu** (accession), nie z sumy okna.
- **Instrumentacja** (dozwolona mid-window): licznik pokazuje med i śr REAL, sumę PLN, wchodzalne; atrybucja
  z transakcji wyzwalającej; ping z kontrolą `ok:true`. Werdykt #2 01.11 dostaje tabelę wrażliwości A-G.
- **Teczka**: hipoteza „gap-band" — REAL w paśmie gap1h >7% (dziś 5 zdarzeń, śr −5.25%) vs ≤7% (śr +2.67%);
  ocena przy N≥10 w paśmie >7%. Jeśli się potwierdzi, to argument za guardem, nie przeciw.
- **Otwarte do decyzji usera** (zmiany REGUŁ wymagają datowanego dopisku): stop dyscyplinarny liczony na NET
  z dziennika zamiast alpha (KURA#2/RLMD: alpha dodatnia, REAL −9/−7 — stop by nie zadziałał); tie-break dla
  limitu 2 pozycji (pierwszy alert wg `sentAt`); Załącznik A: PRE.US **niedostępny na XTB**, ATEC/RLMD/INBX/KURA/
  BSX/PFE/SMMT/ENOV dostępne (RLMD bez ułamków) — wg specyfikacji XTB z 18.12.2025, do potwierdzenia w xStation.

## 5. Co ta lekcja mówi o systemie
Insiderzy C-suite kupują dobrze — rynek to wie i wycenia w ciągu godziny od filingu (Form 4 wychodzi po sesji,
otwarcie +7%). Edge, który da się zrealizować, musi być albo szybszy niż otwarcie (nierealne dla XTB kasowego),
albo dotyczyć zdarzeń, których rynek nie wycenia od razu — to jest właściwe pytanie na werdykt #2.
