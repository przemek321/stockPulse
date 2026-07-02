# Reguły gry na realnym kapitale — pre-rejestracja 02.07.2026

> **Status**: spisane i zaakceptowane PRZED pierwszym kwalifikującym sygnałem (dyscyplina
> pre-rejestracji — jak kryteria backtestów). Zmiana reguł wymaga dopisku z datą i powodem;
> zmiana w trakcie otwartej pozycji = złamanie systemu.
> Kapitał: **8 000 PLN**. Broker: **XTB** (akcje rynku kasowego, NIE CFD).
> Dokument operacyjny właściciela systemu — nie stanowi porady inwestycyjnej.

## 1. Sygnał kwalifikujący (wszystkie warunki naraz)

1. Alert **delivered** na Telegram (`nonDeliveryReason IS NULL`) — obserwacje, pingi
   discovery i alerty stłumione **NIE są** sygnałami (lekcja: ping testowy COR 02.07).
2. Klasa **Form 4 Insider BUY** — jedyny sygnał z potwierdzonym backtestem
   (V5 C-suite d=+0.92, Director d=+0.59). 8-K, korelacje, cluster (H7 = INSUFFICIENT_N,
   d=+0.25 po korekcie OSCR) — nie kwalifikują do czasu werdyktu 01.09.
3. Ticker dostępny na XTB jako akcja kasowa (załącznik A) — sprawdzone z wyprzedzeniem.
4. Discovery/APLS kwalifikują się dopiero PO promocji do delivery (decyzje 25.07 / 01.09).

## 2. Wejście

- Kupno w dniu alertu albo na otwarciu następnej sesji NYSE.
- **Chase guard**: jeśli cena > `priceAtAlert` +3% → NIE wchodzić (lekcja SMMT #2435:
  „nie goń sygnału"). Odpuszczony sygnał odnotować w dzienniku jako `SKIPPED_CHASE`.
- Zlecenie limit (nie market) — spread na mid-capach potrafi zjeść pół edge'a.

## 3. Sizing i koszty (matematyka 8k PLN)

- **1 pozycja = 25–30% kapitału (2 000–2 400 PLN)**, minimum 1 500 PLN
  (poniżej — koszty ~1% round-trip zjadają zbyt dużą część oczekiwanego edge +4–7%).
- **Max 2 pozycje jednocześnie**; max 1 pozycja na ticker.
- Koszty XTB (stan 07.2026): prowizja 0% (do 100k EUR obrotu/mies.), przewalutowanie
  **0.5% w każdą stronę** (~1% round-trip) + spread. Realny próg rentowności ≈ +1.2%.
- Brak akcji ułamkowych dla części tickerów (załącznik A) → pozycja = wielokrotność 1 akcji;
  jeśli 1 akcja > 2 400 PLN i brak ułamków → sygnał odpuszczony (`SKIPPED_SIZE`).
- **Zakaz zwiększania stawki** po stracie lub wygranej (sizing stały, nie martyngał).

## 4. Wyjście

- **Mechanicznie w 7. dniu kalendarzowym** od wejścia (najbliższa sesja NYSE, jeśli weekend/święto)
  — tam backtest pokazuje edge; „jeszcze potrzymam" = złamanie systemu.
- Bez stop-lossa śróddziennego (edge mierzony close-to-close na 7d; SL na małym koncie
  = szum + koszty). Ryzyko ograniczane sizingiem, nie stopem.

## 5. Stop dyscyplinarny

- **3 kolejne transakcje z alpha 7d < 0 vs XBI → pauza do werdyktu 01.09.**
- Werdykt 01.09 „system bez edge" → koniec gry realnej, powrót do walidacji.
- Każda transakcja niezgodna z regułami (wejście z emocji, brak wpisu w dzienniku,
  przetrzymanie po 7d) → tygodniowa pauza, niezależnie od wyniku.

## 6. Dziennik transakcji (obowiązkowy, `doc/DZIENNIK-TRANSAKCJI.md`)

Wpis PRZED wejściem: data, ticker, id alertu, `priceAtAlert`, cena wejścia, liczba akcji,
wartość PLN, kurs USD/PLN. Po wyjściu: cena, wynik %, wynik PLN po kosztach, **XBI w tym
samym oknie**, alpha, zgodność z regułami (tak/nie). Raz w miesiącu: porównanie z pomiarami
systemu (sloty 7d w `alerts`) — rozjazd wynik realny vs systemowy = dane o egzekucji.

---

## Załącznik A — dostępność uniwersum na XTB (rynek kasowy, spec. OMI od 29.06.2026)

Źródło: oficjalna tabela specyfikacji XTB (`Specification_Table_Organised_Market_Instruments_OMI.pdf`,
pobrana 02.07.2026). Oferta brokera zmienia się — **przed transakcją potwierdź w xStation**.

**Dostępne (45/46), żaden nie jest w trybie close-only:**

| Grupa | Tickery |
|---|---|
| core healthcare (36) | ABBV ALHC AMGN BIIB BMY CERT CI CNC CVS CYH DOCS DVA DXCM ELV ENSG GDRX GILD GSK HCA HCAT HIMS HUM ISRG LLY MOH MRNA OSCR PODD REGN SEM TDOC THC UHS UNH VEEV VRTX |
| discovery (3) | EYE SMMT **COR1** |
| biotech_apls (6) | ARDX AXSM CRSP MNKD RCKT URGN |

**Uwagi krytyczne:**

- **SEM jest na XTB** (`SEM.US`) — w wyszukiwarce xStation szukaj „SEM.US" albo „Select
  Medical" (samo „SEM" może nie podpowiedzieć).
- **Cencora = `COR1.US`** (nie COR.US!). Stary ticker `ABC.US` (AmerisourceBergen) istnieje,
  ale jest **close-only** — nie pomylić.
- **WBA nie istnieje** — Walgreens zdjęty z giełdy (przejęcie Sycamore). Martwy ticker
  w naszym uniwersum; do usunięcia przy najbliższym przeglądzie.
- **Bez akcji ułamkowych**: CYH, GDRX, ARDX, MNKD, COR1. Praktycznie bez znaczenia —
  wszystkie poza COR1 kosztują <$15; COR1 ≈ $288 ≈ 1 150 PLN = 1–2 akcje mieszczą się
  w pozycji.
- Drogie tickery (LLY ≈ $780 ≈ 3 100 PLN > max pozycji) **mają ułamki** — pozycja 2 000–2 400
  PLN wykonalna na całym uniwersum.
