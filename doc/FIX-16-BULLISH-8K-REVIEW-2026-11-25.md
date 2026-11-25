# FIX-16 shadow #2 + bullish-8K gate #2 — przegląd 25.11.2026 (termin 15.11)

**Werdykt: bez zmian reguł. Cap R1 zostaje (FIX-16: insufficient N, 2/9), bramka bullish-8K zostaje bez
zawężenia (hit 43% ≤ 55%). Sub-hipoteza `bullish_no_consensus_data` ZAMKNIĘTA. Przegląd #3: 15.03.2027 (po Q4).**

Przegląd wykonany 10 dni po terminie; dane = stan bazy 25.11.2026. To NIE jest sygnał.

## 1. FIX-16 shadow #2

### Gate (pre-zarejestrowany 09.06, doprecyzowany 02.07)

Deploy asymetrycznej drabinki (extreme miss → bez capa) przy **N≥3 `would_uncap=true` z kierunkiem zgodnym**.
Poniżej progu → „insufficient N", przegląd przesunięty.

### Dane (`sec_filings.gptAnalysis.fix16_shadow`, 9 zapisów)

| Symbol | Filing | would_uncap | precap | EPS surprise | Uwagi |
|---|---|---|---|---|---|
| HCA | 14.07 | false | −1,10 | −0,8% | |
| ENSG | 22.07 | false | −0,70 | −0,2% | |
| UHS | 28.07 | false | −0,70 | −0,6% | rev surprise +304% (artefakt, §3A) |
| TDOC | 29.07 | false | −0,70 | −12,6% | |
| CI | 30.07 | false | +0,70 | −0,6% | sign-gate ✗ |
| **HIMS** | **10.08** | **true** | **−1,10** | **−529,9%** | alert #2475 |
| ABBV | 05.10 | false | −0,40 | −0,7% | nowy |
| **HIMS** | **09.11** | **true** | **−1,20** | **−2487%** | nowy, alert #2532; rev surprise +329% (artefakt, §3A) |
| GDRX | 24.11 | false | +0,90 | −1,0% | nowy, sign-gate ✗; konsensus z poprzedniego kwartału (§3B) |

**N = 2/9 — gate niespełniony (potrzeba 3).** Oba kwalifikujące zapisy to ten sam emitent (HIMS).

### Kierunek obu `would_uncap`

| Alert | Powód tłumienia | Luka 1h | raw 7d | Short od price1h (REAL brutto) | α XBI |
|---|---|---|---|---|---|
| #2475 HIMS 10.08 | `gpt_missing_data` | −0,6% | −10,8% | **+10,2%** | −12,1 pp |
| #2532 HIMS 09.11 | `consensus_miss` | −15,3% | −21,5% | **+7,3%** | −14,4 pp |

Kierunek potwierdzony 2/2, także od ceny osiągalnej (po luce kurs zjeżdżał dalej). Poprawka do notatki z raportu
tygodnia 14.11 („ruch −15% był w całości luką"): po domknięciu 7d widać jeszcze −7,3% od otwarcia.

### Interakcja uncap × tłumienie (punkt zaległy z przeglądu #1)

`AlertDispatcherService.dispatch` (`src/alerts/alert-dispatcher.service.ts:125-130`) tłumi każdy alert z
`isConsensusGap=true` — niezależnie od conviction. Cap zmienia więc tylko liczbę zapisaną w alercie DB-only.
**Sama drabinka FIX-16 nie dostarczyłaby żadnego z dwóch shortów HIMS**: #2475 stłumił wyższy priorytetem
`gpt_missing_data`, #2532 — sam `consensus_miss`. Żeby FIX-16 cokolwiek zmienił na Telegramie, potrzebny byłby
dodatkowo wyjątek w dispatcherze (extreme miss negative → deliver) — to nowy element, nieobjęty pre-rejestracją.

### Decyzja

- Cap R1 (0,3) bez zmian; shadow zbiera dalej (koszt zerowy).
- Tempo: 9 zapisów w 24 tygodnie, 2 extreme (oba HIMS). Kolejna próbka = wyniki Q4 (koniec stycznia–luty 2027).
- **Review #3: 15.03.2027** (wcześniej przy N≥3). Przy N=3 decyzja o deployu i tak wymaga osobnej pre-rejestracji
  wyjątku w dispatcherze (wyżej) — bez niego deploy jest kosmetyczny.

## 2. Bullish-8K gate #2

### Gate (pre-rejestracja 09.06, doprecyzowanie 02.07)

Pełne query: `alertDirection='positive'` z powodami `bullish_8k_no_edge`, `bullish_no_consensus_data`,
`gpt_missing_data`, `consensus_miss`. **Zawęzić bramkę tylko gdy hit 7d >55% ORAZ średnia dodatnia.**
Kontrola metody: to samo query obcięte do 01.09 odtwarza przegląd #1 (N=16, hit 50%, signed +0,95%, α med −4,0, NET −0,1%).

### Dane (alerty od 09.06 z pełnym 7d; stan 25.11)

| Klasa | N | hit 7d | signed 7d | α XBI med · śr | REAL med (po 1%) |
|---|---|---|---|---|---|
| **RAZEM (pre-zarejestrowane query)** | **30** | **43%** | **−0,88%** | −4,0 · −2,8 | −1,0% |
| bullish_8k_no_edge | 11 | 27% | −2,78% | −6,0 · −3,2 | −3,8% |
| bullish_no_consensus_data | 9 | 78% | +4,82% | −0,6 · +2,5 | +2,6% |
| gpt_missing_data (positive) | 9 | 33% | −3,38% | −5,7 · −6,2 | −1,0% |
| consensus_miss (positive) | 1 | 0% | −8,92% | −14,2 | −7,2% |
| *w tym nowe od 01.09* | *14* | *36%* | *−2,98%* | *−4,6* | *−4,1%* |

Hit 43% ≤ 55% i średnia ujemna → **gate zawężenia NIE odpala**. W pomiarze 7d są jeszcze 4 alerty (BSX #2542,
UHS #2545, GDRX #2546, AMGN #2547); nawet 4/4 trafione dałyby 17/34 = 50%, więc wynik jest przesądzony.

### Wnioski

1. **Tłumienie byczych 8-K jest zasadne i od września wyraźniej niż wcześniej**: 14 nowych alertów, hit 36%,
   mediana od ceny osiągalnej −4,1% netto.
2. **Sub-hipoteza `bullish_no_consensus_data` — ZAMKNIĘTA** (kryterium z 07.09: N≥10 ∧ hit ≥60% ∧ med α ≥+2 ∧ REAL>0;
   „poniżej progu → zamknąć"). Stan: N=9, hit 78% ✅, REAL +2,6% netto ✅, **med α −0,6 pp ✗**. Dziesiąta obserwacja
   tego nie zmieni: przy dowolnie wysokim wyniku mediana α dla N=10 wyniosłaby najwyżej +1,3 pp (<+2). Zastrzeżenie
   bez wpływu na werdykt: 7 z 9 to spółki spoza biotechu klinicznego (MOH, THC, HUM, CNC, HCA, GILD, LLY), dla których
   α vs XBI jest dolnym ograniczeniem; XLV jest dopiero od 01.11 (1 alert: HUM #2528, α XLV +5,9 pp). Ewentualny powrót
   = nowa teczka z własnym kryterium na XLV, nie reinterpretacja tej.
3. **Wyjątek `ma`** (kryterium: N≥3, hit ≥2/3): ABBV #2439 +16,1% ✅, ABBV #2494 −3,3% ✗, **UHS #2545 (24.11) w pomiarze,
   7d ~03.12**. N=2 → odłożone; rozstrzygnie UHS: trafiony → 2/3 → do rozważenia na przeglądzie #3, pudło → zamknąć.
4. **`gpt_missing_data` positive**: N=9, hit 33%, α śr −6,2 pp — guard zostaje.
5. **2.02 po fixie Exhibit 99.1 (≥06.11)**: w query 1 alert z 7d (HUM #2528, +7,7%) + GDRX w pomiarze — za mało
   na osobną ocenę.
6. **Hipoteza symetryczna z 10.08 (ekstremalne BEATY >+100% jako artefakt definicji EPS)** — 2 przypadki, oba przeciw
   byczemu callowi: OSCR 06.08 (+179,5%; −12,1% 1d, stłumiony) i **MRNA 06.11 (+129,8%; jedyny alert dostarczony
   między 24.08 a 20.11; otwarcie +7,9%, potem REAL −11,4%)**. N=2 — obserwacja, nie decyzja. Propozycja kryterium
   na przegląd #3: przy N≥3 i ≥2/3 z REAL 7d <0 → rozważyć kierowanie beatów >+100% do DB-only. Uwaga: zaskoczenie
   EPS jest zapisywane tylko przy capie (`fix16_shadow`), więc dla byczych alertów trzeba je odczytywać z treści wiadomości.

### Decyzja

Bramka bez zmian. Sub-hipoteza `bullish_no_consensus_data` zamknięta. `ma` i „ekstremalne beaty" → przegląd #3 (15.03.2027).

## 3. Błędy danych konsensusu znalezione przy przeglądzie (stan z chwili przeglądu; naprawione tego samego dnia — §4)

**A. Zawyżone zaskoczenie przychodów (podejrzenie mocne, nieodtworzone na tekście filingu).** `extractRevenue`
(`src/sec-filings/utils/extract-reported-numbers.ts:47`) bierze NAJWIĘKSZĄ kwotę „revenue" z tekstu. HIMS 09.11: w shadow
`revenue_surprise_pct` = +329%, a GPT z tego samego raportu podaje $890,4M vs szacunek $730,1M (+22%) — wyciągnięta wartość
to ok. $3,1 mld. UHS 28.07: +304% przy przychodach kwartału $4,638 mld. Oba wyniki to ~4× kwartał, czyli wzorzec prognozy
całorocznej albo sumy narastającej. Skutek: liczba wchodzi do guardu luki konsensusu (`consensus-gap-guard.ts:50,114`)
i do bloku konsensusu w prompcie GPT, więc może zmieniać klasyfikację miss / in-line / mixed.

**B. Konsensus z poprzedniego kwartału (potwierdzone).** `fetchFinnhubEarnings`
(`src/sec-filings/services/consensus-comparison.service.ts:168-176`) bierze najnowszy okres z Finnhub bez sprawdzenia, czy
to raportowany kwartał. GDRX 24.11 opublikował opóźnione wyniki Q3, a Finnhub (odczyt 25.11) kończy się na Q2
(`2026-06-30`: actual 0,08 / estimate 0,0808). „EPS miss −1,0%" i szacunek przychodów $193,2M pochodzą więc z Q2 —
`consensus_miss` i cap nałożono na podstawie innego kwartału. Tym razem zadziałało ochronnie (byczy call GPT, kurs −16,7%
do 1h), ale to przypadek, nie mechanizm.

Oba błędy dotykają ścieżki decyzyjnej 8-K Item 2.02; poprawka = decyzja usera (zmienia warunki pomiaru bramek 8-K) — podjęta 25.11, patrz errata i §4.

### Errata 25.11 (wieczór) — skala błędu B i naprawa obu błędów (decyzja usera)

Po decyzji usera oba błędy zostały naprawione (§4). Przy naprawie sprawdziłem w Finnhub, z którego kwartału pochodził EPS
w każdym z 9 zapisów shadow (dopasowanie zapisanej pary actual/estimate do okresu). **W 6 z 9 był to POPRZEDNI kwartał**,
w siódmym (ABBV) wstępne dane Q3 porównano z Q2; na właściwym kwartale liczyły się tylko UHS i CI.

| Symbol | Filing | EPS użyty (kwartał) | Zapisany surprise | Właściwy kwartał: actual / estimate | Właściwy surprise |
|---|---|---|---|---|---|
| HCA | 14.07 | Q1 | −0,8% | 7,62 / 7,5425 | **+1,0% (beat)** |
| ENSG | 22.07 | Q1 | −0,2% | 1,92 / 1,8794 | **+2,2% (beat)** |
| UHS | 28.07 | Q2 ✓ | −0,6% | — | bez zmian |
| TDOC | 29.07 | Q1 | −12,6% | −0,21 / −0,2549 | **+17,6% (beat)** |
| CI | 30.07 | Q2 ✓ | −0,6% | — | bez zmian |
| HIMS | 10.08 | Q1 | −529,9% | −0,37 / −0,0143 | −2487% (nadal extreme miss) |
| ABBV | 05.10 | Q2 | −0,7% | 3,82 / 3,823 (Q3, stan dzisiejszy) | −0,1% |
| HIMS | 09.11 | Q2 | −2487% | −0,10 / +0,0649 | −254% (zmiana znaku, nadal extreme miss) |
| GDRX | 24.11 | Q2 | −1,0% | Finnhub nie ma jeszcze Q3 | brak danych |

Co to zmienia w tym przeglądzie:

- **FIX-16: wynik 2/9 utrzymuje się jakościowo** — oba HIMS są extreme missem także na właściwym kwartale. Ale liczby
  w tabeli §1 (surprise, precap) powstały na danych poprzedniego kwartału, a 3 z 7 zapisów „false" (HCA, ENSG, TDOC)
  to cap `consensus_miss` nałożony na raport, który w rzeczywistości był beatem EPS.
- **GPT dostawał w prompcie blok konsensusu z poprzedniego kwartału** — analizy 8-K Item 2.02 od 09.06 (wdrożenie FIX-12),
  w których Finnhub nie miał jeszcze bieżącego kwartału, są tym skażone. Ilu ich było poza 9 zapisami shadow, nie da się
  odtworzyć (okres nie był zapisywany).
- **Bullish-8K: wynik zbiorczy (N=30, hit 43%) nie zależy od tego błędu** — pre-zarejestrowane query łączy wszystkie cztery
  powody. Skażony jest podział na klasy (`consensus_miss` vs `bullish_no_consensus_data` vs `bullish_8k_no_edge` dla 2.02),
  więc zamknięta sub-hipoteza `bullish_no_consensus_data` była mierzona na etykietach, które częściowo wynikały z błędu.
  Nie otwieram jej ponownie: od naprawy ta etykieta znaczy co innego (patrz §4), więc ewentualny pomiar to nowa teczka.

## 4. Naprawa błędów danych konsensusu (25.11, decyzja usera) — ZMIANA WARUNKÓW POMIARU

- **A. `extractRevenue`** — odtworzone na realnym tekście: HIMS łapał „For the full year 2026, we expect Revenue of $3.13 billion
  to $3.15 billion" (zwracał $3,13 mld, teraz $890,4M), UHS tabelę prognozy rocznej (zwracał $18,5 mld, teraz $4,638 mld).
  Funkcja pomija teraz kwoty w kontekście prognozy, okresu innego niż kwartał, zakresów i porównań rok do roku; gdy nic
  pewnego nie zostaje, zwraca `null`. Kontrolnie bez zmiany wyniku: GDRX, CI, TDOC.
- **B. Okres Finnhub** — `assessReportedPeriod`: Finnhub uznany za nieaktualny, gdy jego okres jest starszy niż 100 dni względem
  daty filingu albo Alpha Vantage ma już wiersz późniejszego, zakończonego kwartału. Wtedy EPS z Finnhub jest pomijany (`null`),
  a szacunek przychodów pochodzi z kwartału faktycznie raportowanego. GDRX 24.11 po poprawce: EPS brak, przychody +8,1% vs Q3
  (było +13,1% vs Q2), okres 2026-09-30.
- **Bezpiecznik**: zaskoczenie przychodów powyżej +150% jest odrzucane jako niezgodność okresu/jednostek (tylko w górę).

**Skutek dla ścieżki decyzyjnej (od wdrożenia 25.11):** gdy Finnhub nie ma jeszcze bieżącego kwartału — a to częsty przypadek
(wyżej 6–7 z 9) — EPS jest nieznany, więc bycze 2.02 trafiają do `bullish_no_consensus_data` (DB-only) zamiast dostawać cap
na cudzym kwartale, a **niedźwiedzie 2.02 nie dostają już capa `consensus_miss` z poprzedniego kwartału i mogą zostać
dostarczone na Telegram**. Analizy 8-K Item 2.02 dziel na przed / od 26.11.2026; w logach kontenera licz WARN
„Finnhub period nieaktualny" (częstość zjawiska). Zapisy `fix16_shadow` sprzed naprawy zostają w bazie bez korekty.

## 5. Zmiany wykonane przy przeglądzie

- `VALIDATION_CALENDAR`: wpis 15.11 zdjęty, dodany 15.03.2027 (FIX-16 #3 + bullish-8K #3).
- Ping Telegram „FIX-16 shadow" nie powołuje się już na „review 25.08" (data nieaktualna od sierpnia).
- Żadnych zmian w regułach, progach ani w dispatcherze.
