# Teczka: sektor czy sygnał — healthcare vs kontrola (08.11.2026)

**Status: PLAN.** Proces: plan → ocena → poprawka → wdrożenie (po zakończeniu teczki
[HORYZONT-30-60-90](TECZKA-HORYZONT-30-60-90-2026-11-08.md)) → commit. Kryteria spisane PRZED jakimkolwiek
przeliczeniem grup kontrolnych (backtest horyzontów jeszcze nie był uruchomiony).

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
