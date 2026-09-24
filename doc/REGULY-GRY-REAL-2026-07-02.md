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
  *Dopisek 24.09.2026*: guard ocenia cenę w momencie faktycznego wejścia (wejście intraday w dniu alertu
  poniżej progu jest OK — case ELV 17.07). Przegląd sub-gate'u 23.09 potwierdził, że guard chroni:
  zdarzenia C-suite zablokowane przez +3% miały realizowalną medianę −0.4%. **Nie luzować** bez
  pre-zarejestrowanej hipotezy (teczka: „gap-band", KALENDARZ).
- Zlecenie limit (nie market) — spread na mid-capach potrafi zjeść pół edge'a.

## 3. Sizing i koszty (matematyka 8k PLN)

- **1 pozycja = 25–30% kapitału (2 000–2 400 PLN)**, minimum 1 500 PLN
  (poniżej — koszty ~1% round-trip zjadają zbyt dużą część oczekiwanego edge +4–7%).
- **Max 2 pozycje jednocześnie**; max 1 pozycja na ticker.
- Koszty XTB (stan 07.2026): prowizja 0% (do 100k EUR obrotu/mies.), przewalutowanie
  **0.5% w każdą stronę** (~1% round-trip) + spread. Realny próg rentowności ≈ +1.2%.
- Brak akcji ułamkowych dla części tickerów (załącznik A) → pozycja = wielokrotność 1 akcji;
  jeśli 1 akcja > 2 400 PLN i brak ułamków → sygnał odpuszczony (`SKIPPED_SIZE`).
- **Dopisek 24.09.2026** (przeniesione z dziennika, luka ujawniona przy ELV 17.07: 1 akcja ≈ 1 350 PLN):
  gdy 1 akcja kosztuje 1 200–2 400 PLN, dopuszczalna pozycja = **1 akcja** (nawet poniżej minimum 1 500 PLN);
  2 akcje tylko, jeśli łącznie ≤ 2 400 PLN. Lepiej 1 akcja niż 0 lub przekroczenie limitu.
- **Dopisek 24.09.2026 — tie-break przy limicie 2 pozycji**: gdy kwalifikuje się więcej sygnałów niż wolnych
  slotów (case 11.09: INBX otwarty + ATEC + RLMD tego samego dnia), wchodzi **wcześniejszy wg `sentAt`**;
  pozostałe → `SKIPPED_SLOTS` w dzienniku. Bez tej reguły dziennik jest nieodtwarzalny.
- **Zakaz zwiększania stawki** po stracie lub wygranej (sizing stały, nie martyngał).

## 4. Wyjście

- **Mechanicznie w 7. dniu kalendarzowym** od wejścia (najbliższa sesja NYSE, jeśli weekend/święto)
  — tam backtest pokazuje edge; „jeszcze potrzymam" = złamanie systemu.
- Bez stop-lossa śróddziennego (edge mierzony close-to-close na 7d; SL na małym koncie
  = szum + koszty). Ryzyko ograniczane sizingiem, nie stopem.

## 5. Stop dyscyplinarny

- ~~3 kolejne transakcje z alpha 7d < 0 vs XBI → pauza do werdyktu 01.09.~~
  **Zmiana 24.09.2026 (zatwierdzona przez właściciela)**: **3 kolejne transakcje ze stratą NETTO na koncie
  (wynik PLN po kosztach z dziennika < 0) → pauza do najbliższego werdyktu (01.11).** Powód: alpha vs XBI
  mierzy jakość SYGNAŁU, nie wynik GRACZA — KURA 24.08 (alpha +2.5%, konto −9%) i RLMD 11.09 (alpha +2.0%,
  konto −7%) pokazały, że bezpiecznik podpięty do alpha nie odpaliłby przy 3 stratach z rzędu na rachunku
  (przegląd sub-gate'u 23.09). Alpha zostaje metryką analiz systemu; o pauzie decyduje rachunek.
  Reguła jest bardziej konserwatywna (odpala szybciej), nie luźniejsza. Sygnały pominięte (`SKIPPED_*`)
  nie liczą się do serii — liczą się tylko transakcje faktycznie wykonane.
  **Doprecyzowanie 24.09 (żeby dało się to policzyć mechanicznie, nie „na oko")**:
  1. **Kolejność serii = data WYJŚCIA** (nie wejścia). Transakcja liczy się dopiero, gdy jest zamknięta
     i ma wpisany wynik PLN netto. Pozycja otwarta nie wchodzi do serii; jeśli dwie pozycje są otwarte
     naraz, o kolejności decyduje to, która została zamknięta wcześniej.
  2. **Strata = wynik PLN netto < 0** (po przewalutowaniu 0.5%×2 i spreadzie, wg wyciągu XTB — nie wg
     pomiaru systemu). Wynik dokładnie 0 lub dodatni przerywa serię.
  3. **Wpis bez wyniku = brak transakcji** dla licznika. ELV 17.07 (wynik niezapisany) NIE liczy się —
     licznik startuje od zera od pierwszej transakcji zamkniętej po 24.09.
  4. **Reset serii**: jedna transakcja z wynikiem ≥ 0 zeruje licznik; pauza po 3. stracie trwa do
     najbliższego werdyktu (01.11), a po niej licznik zaczyna od zera.
  5. **Data wyjścia** = 7. dzień kalendarzowy od dnia wejścia (§4); gdy wypada w weekend/święto NYSE —
     najbliższa następna sesja. Liczy się dzień w czasie NY (wejście po 22:00 PL to już następny dzień NY).
  Licznik serii prowadzony jawnie w kolumnie **„seria"** dziennika (0/1/2/3 — po każdej zamkniętej transakcji).
- Werdykt 01.09 „system bez edge" → koniec gry realnej, powrót do walidacji.
  *(Werdykt 01.09: edge NIE wykazany, ale system ≠ „bez edge" — gra trwa jako pomiar; następny werdykt 01.11.)*
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
| discovery — kohorta C-suite (dopisek 24.09.2026, spec. XTB z 18.12.2025) | ATEC BSX ENOV INBX KURA PFE RLMD SMMT — dostępne (RLMD bez ułamków, przy $4 bez znaczenia). **PRE.US — BRAK na XTB** (najlepsze zdarzenie kohorty, +9%, było niewykonalne). Pozostałe tickery discovery (ABCL ALMS ARTV BFLY CAI CBIO COO ELAN EYE IMTX IONS MOBI NAMS PBLS REPL RGNX TYRA) — **niesprawdzone**. |

*Dopisek 24.09.2026 — procedura dla otwartego uniwersum (discovery)*: 🎯 na tickerze spoza tej tabeli →
sprawdzić w xStation PRZED wejściem; brak instrumentu = `SKIPPED_XTB` w dzienniku, nie sygnał. Kohorta
discovery na dziś NIE jest promowana (przegląd 23.09) — tabela jest przygotowaniem na wypadek gate'u #2.

**Uwagi krytyczne:**

- ~~SEM jest na XTB (`SEM.US`)~~ — **SEM zdjęty z giełdy (delisting 07.2026)**, usunięty z uniwersum 01.09.2026.
- **Cencora = `COR1.US`** (nie COR.US!). Stary ticker `ABC.US` (AmerisourceBergen) istnieje,
  ale jest **close-only** — nie pomylić.
- **WBA nie istnieje** — Walgreens zdjęty z giełdy (przejęcie Sycamore). Usunięty z uniwersum 01.09.2026.
- **Bez akcji ułamkowych**: CYH, GDRX, ARDX, MNKD, COR1. Praktycznie bez znaczenia —
  wszystkie poza COR1 kosztują <$15; COR1 ≈ $288 ≈ 1 150 PLN = 1–2 akcje mieszczą się
  w pozycji.
- Drogie tickery (LLY ≈ $780 ≈ 3 100 PLN > max pozycji) **mają ułamki** — pozycja 2 000–2 400
  PLN wykonalna na całym uniwersum.
