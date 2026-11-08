# Teczka: sektor czy sygnał — healthcare vs kontrola (08.11.2026)

**Status: WYKONANE 08.11.2026 — test główny SEMI × 90d: INSUFFICIENT_N (8 epizodów) → R3; opisowo CTRL ≈ 0 vs ETF, D(CTRL−HC) −14 pp ([raport](BACKTEST-SEKTOR-VS-SYGNAL-2026-11.md)). B1 odrzucony.** Plan v2 (08.11.2026) — wiąże sekcja „Poprawka planu (v2)" na dole; sekcje v1 niżej
zostają jako historia i są w części UCHYLONE.** Proces: plan → ocena (niezależna recenzja, 08.11) → poprawka →
wdrożenie → commit.

## Pytanie

Werdykt #2: Form 4 BUY w healthcare bez edge przy naszej egzekucji. Nie wiemy, czy to „healthcare nie działa",
czy „insider BUY w ogóle nie działa przy wejściu po filingu + koszt 1%". Brak grupy porównawczej mierzonej
tą samą metodą (H6 z walidacji V5 — healthcare vs kontrola przy równym N — dla BUY nigdy niezrobiona).

## Stan faktyczny (sprawdzony 08.11.2026)

- `form4.pipeline.ts:293`: `semi_supply_chain` (`observationOnly=true`) → `SKIP_OBSERVATION_TICKER` PRZED GPT, bez
  wiersza w `alerts` (S19-FIX-03, po incydencie ASX 22.04 — SELL observation trafił do Redis korelacji).
- W `alerts` jest 24 wierszy semi z 09–28.04.2026 (sprzed fixu), wszystkie `observation`, **0 z `price7d`**.
- `insider_trades` semi (14 tickerów, od 04.2026): SELL 2265, EXERCISE 727, GRANT 370, TAX 204, GIFT 26, OTHER 17,
  **discretionary BUY = 0**. → Z danych produkcyjnych porównanie BUY semi vs healthcare jest niemożliwe (N=0),
  a naprawa ścieżki obserwacji nie dałaby wstecznie żadnych danych.

## Część A — backtest retrospektywny (odpowiedź na pytanie)

Ta sama metodologia i kod co teczka HORYZONT (`horizon_backtest.py`): wejście = otwarcie sesji po dacie filingu,
NET = zwrot − XBI − 1 pp, horyzonty 5/21/42/63 sesje, zdarzenie = ticker + data filingu, te same filtry.

- **Dane:** Form 4 z EDGAR 04.2023–11.2026 dla 14 tickerów semi (AMKR ASX CAMT DELL HPE HPQ KLIC MU NTAP NVMI
  ONTO SMCI STX WDC) — osobny plik `data/form4_transactions_semi.csv` (nie miesza się z plikiem teczki HORYZONT);
  ceny OHLC tych 14 do `data/prices_ohlc/`. ASX/CAMT/NVMI to emitenci zagraniczni (20-F/6-K) — Form 4 mogą
  nie istnieć; zostaną policzone z tym, co jest.
- **Grupy:** HC = healthcare (G1 z teczki HORYZONT) · CTRL = 25 large-capów spoza healthcare (już w danych) ·
  SEMI = 14 semi · NONHC = CTRL ∪ SEMI.
- **Benchmark dla kontroli:** NET liczony vs XBI (identycznie jak HC — to porównanie metody, nie sektorów) ORAZ
  informacyjnie vs SPY (dla kontroli XBI jest obcym benchmarkiem; wynik vs SPY jest uczciwszy dla NONHC).
- **Test (pre-rejestracja), per horyzont 30/60/90d:** Mann–Whitney HC vs NONHC na NET (dwustronny),
  α = 0,05/3. Minimalne N: ≥ 20 zdarzeń w HC i ≥ 20 w NONHC — inaczej „insufficient N" dla tego horyzontu.
- **Reguły interpretacji (ustalone teraz):**
  1. HC ≈ NONHC (brak istotnej różnicy) i obie mediany NET ≤ 0 → **„sygnał nie działa przy naszej egzekucji,
     to nie wina sektora"** — wzmacnia werdykt #2, osłabia argument „zmień sektor".
  2. NONHC istotnie > HC i mediana NONHC NET > 0 → **„problem sektorowy"** — argument za testem sygnału poza
     healthcare (osobna teczka, forward, bez zmiany reguł gry).
  3. HC istotnie > NONHC → healthcare jest lepsze niż reszta; edge (jeśli jest) jest sektorowy.
  4. Brak istotnej różnicy, ale mediany różnego znaku → **nierozstrzygnięte**, raportować jako takie.
- **Znane ograniczenia:** large-capy z kontroli mają mało discretionary BUY (insiderzy dużych spółek kupują
  rzadko) — realne ryzyko „insufficient N"; kontrola ≠ semi ≠ small-cap discovery; survivorship (dzisiejsze listy).

## Część B — naprawa ścieżki obserwacji semi na przyszłość (forward)

Opcje:
- **B1 (rekomendacja):** dopisać `semi_supply_chain` do wyjątku z `form4.pipeline.ts:293` z filtrem
  **BUY-only, discretionary, ≥ $100K** (SELL nadal skip PRZED GPT — zachowuje sens S19-FIX-03, brak ścieżki do
  Redis korelacji). Koszt GPT ≈ 0 (semi: 0 BUY w 7 miesięcy). Daje wiersz w `alerts` z `priceAtAlert` + sloty.
- **B2:** deterministyczny wiersz obserwacji bez LLM — czystsze, ale zmienia kontrakt dispatchera dla wszystkich
  kohort obserwacyjnych; odłożone (osobna decyzja, po werdykcie #3).

**Realna wartość B1 jest mała:** przy 0 BUY przez 7 miesięcy forward semi da N≈0–2/rok — porównanie nie
powstanie w sensownym czasie. Pytanie „sektor czy sygnał" rozstrzyga część A, nie B. B1 robię, bo jest tani
i zamyka dziurę, ale bez oczekiwań co do danych.

**Weryfikacja B1 przed wdrożeniem:** testy jednostkowe Form4Pipeline (semi BUY ≥ $100K → GPT + wiersz observation;
semi BUY < $100K → skip; semi SELL → skip PRZED GPT, bez wiersza; apls/discovery bez zmian); przegląd miejsc
czytających `alerts` po sektorze/obserwacji (raport 8h „🔭 Nowe obserwacje", `csuite-gate`, SQL werdyktów —
semi nie może wejść do liczników healthcare); `npx jest test/unit`, `npx tsc --noEmit`, `npm run lint`;
`make rebuild-app` na prod + health.

## Lista zadań

| # | Zadanie | Testy / weryfikacja |
|---|---|---|
| A1 | Pobranie Form 4 semi z EDGAR (osobny plik) | liczności per ticker, udział 10b5-1, duplikaty; które tickery bez Form 4 (ADR) |
| A2 | Ceny OHLC 14 semi | walidacja jak w HORYZONT (kalendarz, luki, skoki) |
| A3 | Rozszerzenie `horizon_backtest.py`: grupy SEMI/NONHC, NET vs SPY, test Mann–Whitney HC vs NONHC | nowe testy jednostkowe (przynależność do grup, kierunek testu, „insufficient N") + regresja starych |
| A4 | Raport `doc/BACKTEST-SEKTOR-VS-SYGNAL-2026-11.md` | liczby generowane z JSON; interpretacja wg reguł 1–4 |
| B1 | Wyjątek semi BUY ≥ $100K w Form4Pipeline | testy jednostkowe + jest/tsc/lint + przegląd konsumentów `alerts` + rebuild prod |
| C | Commit (lokalnie; push po ogarnięciu gita) | — |

---

## Poprawka planu (v2, 08.11.2026 — po niezależnej recenzji; spisana PRZED liczeniem czegokolwiek dla SEMI)

Recenzja: 6 × P0, 8 × P1. Kluczowe zarzuty zweryfikowane w kodzie/danych przed przyjęciem (CTRL znany z
`horizon_results.json`; guard korelacji `form4.pipeline.ts:644` kluczowany `suppressedBy`, nie sektorem; prompt
`form4.prompt.ts:37,42` na sztywno „Healthcare"; w danych v6 reguła ceny: 0 excluded, 1 fixed (WFC) → splity NIE
dotknęły wyników HORYZONT, ale SMCI 10:1 (10.2024) w semi by dotknął).

### Co już widzieliśmy (odślepienie — uczciwie)

- **HC (G1)** — znany z HORYZONT: 90d POZYTYWNY (śr +12,85, med +4,87 pp vs ETF podsektora). Tu tylko opisowo.
- **CTRL** — znany KIERUNEK z HORYZONT (tabela `CTRL_info` vs SPY: 90d śr +2,49, med +2,51, N=25, hit 64%;
  testu nie liczono). Wynik CTRL = **częściowo odślepiony** → raportowany, ale NIE konfirmacyjny.
- **SEMI** — nic nie widziane. **Jedyna część konfirmacyjna.** Przed liczeniem zwrotów zapisuję N epizodów SEMI
  per ticker i MDE (sama liczba zdarzeń nie odślepia).

### Pytanie (zmienione)

Plan v1 zakładał „HC bez edge" — HORYZONT dał POZYTYWNY, więc reguła 1 (mediana HC ≤ 0) jest nieosiągalna.
Nowe pytanie: **czy efekt 90d insider BUY (POZYTYWNY w HC) występuje poza healthcare** (efekt ogólny sygnału),
czy jest specyficzny dla healthcare / tej listy tickerów?

### Grupy i benchmarki (ta sama metoda dla każdej grupy)

- HC = G1 (benchmark: ETF podsektora jak w HORYZONT). CTRL = 25 large-capów. SEMI = 14 semi. **Osobno** —
  NONHC = CTRL ∪ SEMI tylko opisowo (różna wielkość, beta, częstość BUY).
- Benchmark główny = **ETF sektora/podsektora dla każdej grupy** (v1 „kontrola vs XBI" uchylone — mierzyło spread
  SPY−XBI; „SPY uczciwszy dla semi" uchylone — przy becie semi ~1,5–2 w hossie AI to głównie beta):
  - SEMI: MU AMKR KLIC ONTO CAMT NVMI ASX → **SOXX**; DELL HPE HPQ NTAP SMCI STX WDC → **XLK**.
  - CTRL: AAPL MSFT NVDA → XLK · GOOGL META → XLC · AMZN TSLA MCD → XLY · JPM GS BAC MS WFC → XLF ·
    WMT COST PG KO PEP → XLP · XOM CVX COP → XLE · CAT DE HON GE → XLI.
- Odporność: **SPY dla wszystkich grup** (łącznie z HC). XBI wypada.
- Wyniki HORYZONT (`horizon_results.json`, CTRL_info vs SPY) zostają nietknięte — nowe liczenie idzie osobną
  komendą do `sector_results.json`.

### Test (zastępuje Mann–Whitney)

MW uchylony: zakłada niezależność (klastry tickerów — CAT 24% CTRL; nakładające się okna 63 sesji), testuje inną
statystykę niż HORYZONT i miesza sygnał z dryfem tickera względem benchmarku.

- **Test główny (konfirmacyjny): SEMI × 90d** — identyczny jak test główny HORYZONT: epizody (≤5 sesji), średni
  NET, p z permutacji przesunięcia kalendarza (B=10 000), CI z bootstrapu klastrowego po tickerach, LOTO.
  POZYTYWNY = p<0,05 ∧ śr>0 ∧ med>0 ∧ LOTO tego samego znaku; NEGATYWNY = CI95 hi < 3 pp; inaczej NIEROZSTRZYGNIĘTY.
  **Minimalne N: 15 epizodów z pełnym horyzontem 90d — inaczej „insufficient N", test nie jest liczony.**
- **CTRL × 90d** — ten sam test, raportowany jako częściowo odślepiony.
- **D = różnica w różnicach względem HC** (dla CTRL i SEMI): D = (śr NET zdarzeń X − śr NET dni losowych X) −
  (to samo dla HC). p dwustronne ze **wspólnego** przesunięcia kalendarza obu grup; CI z bootstrapu klastrowego
  losowanego osobno w każdej grupie. Opisowe (MDE różnicy duże).
- 30/60d i 7d — opisowo.

### Reguły interpretacji (zastępują 1–4 z v1)

- **R1:** SEMI POZYTYWNY → „efekt ogólny insider BUY" — wzmacnia HORYZONT, osłabia hipotezę „to lista HC".
- **R2:** SEMI NEGATYWNY (CI95 hi efektu < +3 pp) **i** CI95 hi D(SEMI − HC) < 0 →
  „efekt specyficzny dla HC/listy" — forward-test HC zostaje, bez rozszerzania na inne sektory.
- **R3:** SEMI N < 15 → insufficient N (wtedy wniosek opiera się na CTRL, oznaczonym jako odślepiony — opisowo).
- **R4:** wszystko inne → **NIEROZSTRZYGNIĘTY — wynik oczekiwany, zapisany z góry** (MDE różnicy grup ≫
  obserwowane różnice median).
- Żaden wynik nie zmienia reguł gry ani produkcji (dyscyplina hipotez; werdykt #3 bez zmian).

### Dane — wymagania (z recenzji)

- Kontrola emitenta obowiązkowa (ASX: wiersze pod CIK ASX to ASE jako owner cudzych akcji — incydent 22.04);
  licznik odrzuceń per ticker w raporcie. ASX/CAMT/NVMI (FPI, zwolnieni z Section 16) → spodziewane N≈0, raport jawnie.
- **Korekta splitów:** cena/ilość z Form 4 przeliczana współczynnikiem splitów (yfinance) PRZED regułą ceny
  (wartość transakcji bez zmian); test jednostkowy. Regresja: wyniki HORYZONT bez zmian.
- **WDC — spin-off Sandisk 24.02.2025:** ręczna weryfikacja korekty cen Yahoo; jeśli brak korekty → wykluczyć
  epizody WDC, których okno obejmuje 24.02.2025.
- SMCI: rozkład opóźnień filing − transakcja w raporcie.
- Pobieranie: `BT_UNIVERSE=semi` → osobny plik `form4_transactions_semi.csv` i `cik_map_semi.json`
  (v6 i `cik_map.json` nietknięte — sprawdzane sha256). Ceny: tylko brakujące symbole (istniejące pliki
  `prices_ohlc/` NIE są pobierane ponownie — inaczej zmieniłyby wyniki HORYZONT).

### Część B — B1 ODRZUCONY (zmiana w stosunku do v1)

Recenzja wykazała, że B1 („jedna linia" przy `form4.pipeline.ts:293`) to w praktyce 5 zmian w produkcji:
(1) prompt na sztywno „Healthcare" (dokładnie powód S19-FIX-03); (2) guard korelacji po `suppressedBy` →
przy niedostępnym dispatcherze BUY semi wchodzi do Redis (klasa incydentu ASX); (3) `discovery-watch.sh` pinguje
każdy observation bez filtra sektora (podwójny ping z błędną etykietą); (4) wiersz nie jest gwarantowany
(`SKIP_LOW_PRIORITY`, GPT null) → próbka selekcjonowana przez GPT; (5) sloty kończą się na 7d i benchmarki
XBI/IBB/XLV — B1 nie dałby ani 90d, ani benchmarku semi. Zysk: N≈0–2/rok.
**Zamiast B1: forward-pomiar offline tą samą metodą** — ponowne uruchomienie części A z późniejszym `BT_END_DATE`
(fetcher semi + `sector-run`), bez żadnej zmiany w produkcji. Termin: razem z werdyktem #3 (01.02.2027);
informacyjnie, nie bramka. Wariant B2 (deterministyczny wiersz obserwacji bez LLM) — osobna decyzja usera.

### Lista zadań (v2)

| # | Zadanie | Testy / weryfikacja |
|---|---|---|
| A1 | Form 4 semi z EDGAR (`BT_UNIVERSE=semi`) | liczności per ticker, FPI, odrzucenia emitenta, duplikaty; sha256 v6/`cik_map.json` bez zmian |
| A2 | Ceny brakujących symboli (14 semi + SOXX XLK XLC XLY XLF XLP XLE XLI) + splity | walidacja jak HORYZONT; WDC 24.02.2025; istniejące pliki nietknięte |
| A3 | `horizon_backtest.py`: korekta splitów, wiele plików transakcji, grupy CTRL/SEMI, mapa benchmarków sektorowych, D-permutacja, komendy `sector-mde` / `sector-run` | pytest: splity, przynależność, brak cen → błąd, D (znak, wspólne przesunięcie), insufficient N; regresja HORYZONT bajt w bajt; mutacje |
| A3.5 | `sector-mde`: N epizodów SEMI per ticker + MDE → wpis do teczki PRZED `sector-run` | — |
| A4 | `sector-run` + raport `doc/BACKTEST-SEKTOR-VS-SYGNAL-2026-11.md` (liczby z JSON) | ręczne przeliczenie 2–3 epizodów CTRL/SEMI; reguły R1–R4 |
| C | Commit (lokalnie) | — |

### A3.5 — N i MDE PRZED `sector-run` (08.11.2026, `data/results/sector_mde.json`; bez wyników zdarzeń)

- Pobranie semi: 3 401 Form 4, 14 965 wierszy, 0 nieudanych; **BUY = 22 wiersze w 3,5 roku** (SELL 6 580). FPI: CAMT 11,
  NVMI 22, ASX 34 filingów — 0 BUY. Cudzy emitent: WDC 4, DELL 1 wiersz. Splity skorygowane: 5 wierszy (SMCI sprzed 10:1).
  WDC: Yahoo koryguje spin-off (24.02.2025 −5,6%, współczynnik 1,323) → `WDC_SPINOFF_UNADJUSTED=False`.
- Epizody z pełnym 90d (ETF sektorowe): **HC 47** (= HORYZONT), **CTRL 25**, **SEMI 8** (SMCI 3, AMKR 2, KLIC 1, MU 1, NTAP 1).
- MDE (80%, α=0,05): HC 11,5 pp · CTRL 6,9 pp · SEMI 41,4 pp · D(CTRL−HC) 14,0 pp · D(SEMI−HC) 52,2 pp.
- **Konsekwencja zapisana z góry:** SEMI 8 < 15 → test główny = **INSUFFICIENT_N → reguła R3**. Wniosek może opierać
  się tylko na CTRL (częściowo odślepiony, opisowo); D przy MDE 14 pp nie wykryje różnic rzędu obserwowanych median.
