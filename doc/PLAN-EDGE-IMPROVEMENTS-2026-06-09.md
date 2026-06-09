# Plan zwiększenia skuteczności StockPulse — synteza badania z 09.06.2026

**Metoda**: wielowątkowe badanie (11 agentów, ~1.34M tokenów analizy): 5 równoległych raportów dowodowych (backtest V5/APLS, baza produkcyjna, wykonalność SEC feed, literatura akademicka, quick-wins w kodzie) + 6 **adwersarialnych weryfikacji** kandydujących propozycji (każdy weryfikator miał za zadanie OBALIĆ propozycję danymi z DB/backtestu zanim trafi do tego planu).

**Punkt wyjścia**: [REPORT-2026-06-09-EDGE-ASSESSMENT.md](REPORT-2026-06-09-EDGE-ASSESSMENT.md) — system netto 0.00% (33 dostarczone alerty), jedyny potwierdzony edge to Form 4 Insider BUY (3/3, +5.64% 3d), lejek 1-2 discretionary BUY/mies., cel zrewidowany na 1 alert/tydzień.

---

## TL;DR — co robić, w kolejności

| # | Działanie | Effort | Werdykt weryfikatora | Impact |
|---|---|---|---|---|
| 0 | **Fix parsera 10b5-1 (`aff10b5One`)** — filtr discretionary jest dziś NO-OPEM | XS | odkrycie P0 (3 agentów niezależnie) | poprawność całej premisy systemu |
| 1 | **Deterministyczny floor priority dla BUY** — GPT zjada 25% deliverable BUY | S | potwierdzone w DB (PODD Weatherman) | +25% lejka jedynej działającej reguły |
| 2 | **Bullish 8-K (poza 2.02-R4) → observation** — gate na `mainItem`, nie catalystType | S | supported (z 6 modyfikacjami) | eliminuje kategorię 0/4, śr. −4.4% |
| 3 | **PATTERN_THROTTLE 2h → 72h** (1 linia) zamiast pełnego cross-rule throttle | XS | mixed → wariant 1-liner | tnie 2/3 redundantnych re-broadcastów |
| 4 | **Telegram actionable**: akcja LONG/SHORT + horyzont 3-7d + cena wejścia | S | mixed → po wycięciu zbędnych części | konwersja edge'u na wykonalne decyzje |
| 5 | **FIX-16 w SHADOW MODE** (persist pre-cap conviction, decyzja 25.08 przy N≥3) | S | mixed → nie deployować z N=1 | nie przegapić okna Q2 earnings |
| 6 | **PriceOutcome slot 7d** — walidacja edge'u na horyzoncie, na którym faktycznie istnieje | S | wynika z literatury + backtestu | mierzalność tego, co obiecujemy |
| 7 | **Pivot: event-driven screening Form 4 sector-wide healthcare/biotech** (SIC), obs mode | M (3-5 dni) | mixed → sector-wide TAK, all-market NIE | lejek BUY ≥$500K **×8-20** |
| 8 | **Options flow: odwracalne wyłączenie CRON** (po 1 zapytaniu o retencję Polygon) | S | supported, mocniej niż w propozycji | −6h zombie cycle/dzień, zero utraty winnerów |
| — | **NIE robić**: PDUFA jako sygnał, szybszy polling SEC, reaktywacja starych reguł, all-market screening bez backtestu | — | refuted | patrz sekcja 4 |

---

## 1. Odkrycia krzyżowe — fakty, które zmieniają obraz systemu

To nie były hipotezy do weryfikacji — to bugi/luki znalezione przy okazji, każdy potwierdzony niezależnie przez ≥2 agentów.

### 1.1 Filtr 10b5-1 jest NO-OPEM (P0)

Parser (`form4-parser.ts:148-152`) czyta per-transaction tag `transactionCoding['Rule10b5-1Transaction']`, który **praktycznie nie występuje** w realnych filingach. Prawdziwy wskaźnik to doc-level checkbox `<aff10b5One>` (obowiązkowy od amendmentu kwiecień 2023) — **nieparsowany ani w produkcji, ani w backtestach**.

Dowody: 0/3384 wierszy `insider_trades` ma `is10b51Plan=true`; 0/40874 w V5 CSV; 0/1087 w APLS CSV. **Filing GILD O'Day 29.04** (ten sam, który wywołał S19-FIX-07) ma `<aff10b5One>1</aff10b5One>` + kod S — to **była planowa sprzedaż**, system potraktował ją jako discretionary.

Konsekwencje: (a) "discretionary only" w decision tree to fikcja — zmierzony edge BUY d=+0.75..0.92 to de facto "all BUY" (prawdopodobnie przeżyje fix — plany to głównie SELL — ale wymaga re-runu); (b) fix jest XS (1 pole z XML + fallback na stary tag); (c) to **prerequisite** pivotu z sekcji 3.

### 1.2 Stochastyczna brama GPT zjada 25% deliverable BUY

PODD 03.06: Weatherman Director BUY **$497K** → GPT dał magnitude='low', confidence=0.3 → `scoreToAlertPriority` zwrócił null → `SKIP_LOW_PRIORITY`, **brak alertu**. Bliźniaczy Stonesifer $400K dzień później → magnitude='medium' → delivered, **+4.3% 3d**. Przy 4 deliverable BUY post-rule LLM zjadł 1 (25%). Reguła jest backtest-backed — subiektywna ocena LLM nie powinna jej wetować (analogia do Director SELL hard skip, w drugą stronę). **Fix**: deterministyczny floor `priority=MEDIUM` dla discretionary BUY ≥$100K C-suite/Director; GPT zostaje jako enrichment (conviction, treść), nie jako bramkarz.

### 1.3 `gpt_missing_data` nadal zjada bullish winnerów PO FIX-10b

4 przypadki po deployu FIX-10b (04.05): MRNA +2.1%, **GDRX +14.0%** (Item 2.02 — exhibit fetch mimo fixa zawiódł), MOH +0.5% (Item 5.02 — exhibit **nie jest pobierany** dla 5.02), UNH +2.5% (other — j.w.). Wszystkie 4 dodatnie, śr. +4.8%. All-time suppressed bullish: 6/9 trafień, +2.1% śr. **Paradoks systemu: tłumione bullish wygrywały, dostarczane bullish przegrywały (0/4, −4.4%)** — czyli problem nie leży w kierunku bullish per se, tylko w tym, że dostarczamy narrative bez liczb, a tłumimy te z liczbami (bo exhibit nie dociera). Wniosek dwuczęściowy: gate na bullish-narrative (sekcja 2.P1) + rozszerzenie fetchu Exhibit 99.1 na Item 5.02/other do rozważenia.

### 1.4 Options flow: cykl to DOKŁADNIE 6h codziennie, pokrycie dziurawe

5/5 ostatnich `runCollectionCycle` = 360.00 min (codzienny abort na budżecie). **22/48 aktywnych tickerów ma 0 wierszy options_flow w 30d** — w tym core UNH (ostatnie dane 07.05), LLY (19.03!), AMGN, BIIB, REGN, VRTX. Noga korelacyjna zweryfikowana jako redundantna: wszystkie 3 post-fixowe correlated winnery (HIMS) opierały się o nogę Form4 BUY, która **niezależnie dała standalone alert tego samego dnia**. Scoring ma bias 73% positive. Predykcyjności spike'ów nie da się ocenić z naszych danych (brak tabeli cen, 16% joinów, selection bias).

### 1.5 Latencja SEC: 69h mediany — to prawo, nie polling

Mediana transakcja→kolekcja = 69.0h (N=1846; dominuje ustawowy deadline T+2 dla insidera), 68% Form 4 wpada po zamknięciu NYSE. Skrócenie pollingu 30→5 min kupuje ~12 min na pipeline'ie 69h = **0.3%, zero wpływu na edge 1-7d**. Szybszy polling ma sens wyłącznie jako komponent pivotu discovery (getcurrent cap 100 entries wymusza ≤5 min), nie jako samodzielna inwestycja w "świeżość".

---

## 2. Werdykty adwersarialne propozycji P1-P6

### P1: Bullish 8-K → observation — **SUPPORTED** (effort S)

0/4 delivered bullish, śr. −4.4% 3d; suppressed bullish-z-liczbami miały 6/9 trafień — gate musi więc przepuszczać udokumentowane beaty. Wymagane modyfikacje od weryfikatora:
1. Gate kluczowany na **`mainItem` z `detectItems()`**, NIE na `catalystType` (dowód: MOH Item 7.01 dostał etykietę 'earnings' — catalystType przecieka).
2. Wyjątek dla 2.02: deliver bullish tylko gdy `shouldCapForConsensusGap` zwraca null (R4 — oba beaty ≥+5%); brak danych konsensusu → observation z **osobnym** reason (`bullish_no_consensus_data` vs `bullish_8k_no_edge`) — forward analysis musi odróżniać brak danych od narrative.
3. Rozszerzyć skip `correlation.storeSignal` (form8k.pipeline.ts:499) o nową flagę — inaczej gated bullish zasila INSIDER_PLUS_8K (powtórka backdooru FIX-07).
4. Etykieta PL w REASON_LABELS.
5. **Validation gate**: revisit po 90d lub N≥10 suppressed — jeśli hit >55% i śr. dodatnia, zawęzić gate (np. tylko 1.01/7.01-contract). N=4 to p=0.0625, to zakład o asymetrii kosztów, nie dowód; w pełni odwracalny (observation = dane płyną dalej).
6. Nie ruszać bearish ani bypass Item 1.03 bankruptcy.

Zastrzeżenie uczciwości: 3/4 strat to managed care (MOH/HUM/UHS) w sektorowym dołku — częściowy confound bety sektora, nieweryfikowalny (XBI nie pokrywa managed care).

### P2: Event-driven screening Form 4 — **MIXED → sector-wide TAK, all-market NIE** (effort M)

**Co się broni**: lejek faktycznie zagłodzony u źródła (5 discretionary BUY ≥$100K w 3.3 mies.; zero strat na throttle — problem jest w podaży). Kanały SEC zweryfikowane NA ŻYWO: `getcurrent` atom real-time (wpisy sprzed sekund; cap 100 entries, paginacja nie działa → poll ≤5 min + nightly reconciliation z EFTS/daily-index), EFTS exact counts (~1130 Form 4/dzień rynkowo). Podaż zweryfikowana przez OpenInsider: **healthcare/biotech BUY ≥$500K ≈ 50/30d**, po filtrze ról (C-suite/Director, bez czystych 10% ownerów — to ~60% strumienia) i mcap/ADV realnie **2-5 kandydatów/tydz = 8-20× obecny lejek**. Koszt GPT pomijalny (<$0.05/dzień — deterministyczny pre-filter tnie 99% strumienia przed LLM). Symbol z `<issuerTradingSymbol>` w XML; SIC z submissions JSON (cache).

**Co zostało obalone**: wariant all-market. "731 control BUY na dysku do taniego testu" rozpadł się: 86% to czyści 10% ownerzy (607 z samego BAC!), po filtrze ról+wartości zostaje **13 unikalnych filingów w 36 mies.**, 38/45 z TSLA+XOM — test statystycznie martwy. All-market wymaga świeżego backtestu na mid/small-cap non-healthcare SIC-ach (dni, nie godziny) — **odrzucone do czasu tego backtestu**.

**Warunki brzegowe wdrożenia** (wszystkie z weryfikacji):
- prerequisite: fix `aff10b5One` (sekcja 1.1) PRZED skalowaniem;
- obowiązkowy observation mode 30-60d dla auto-zarejestrowanych tickerów (playbook Sprint 17 / APLS Faza 3); delivery po walidacji przez **top-N ranking** (max 1-2/tydz najwyższy conviction), nie open gate — system już dziś dowozi 2-3.7/tydz szumu, pivot bez selekcji odtwarza problem;
- filtry twarde: C-suite/Director only, mcap ≥$250-300M, ADV ≥$1M, exchange-listed; próg $500K dla nowych (w legacy core zostaje $100K — eventy $100-500K w core mają 3d d=+0.95);
- deterministyczny floor priority (sekcja 1.2) — inaczej GPT odda ~25% nowej podaży;
- alert komunikuje horyzont 3-7d; PriceOutcome dostaje slot 7d (na 30d edge dużych BUY ZNIKA: ≥$500K p=0.126, ≥$1M d=−0.09 — front-loading zwrotu);
- bez nóg korelacji/options dla odkrytych tickerów (standalone Form4-BUY); hardcoded "SECTOR: Healthcare" w prompcie jest OK tylko przy scope sector-wide.

**Spodziewany efekt po walidacji**: ~4-5 delivered/mies. = dokładnie cel 1/tydz, z hit ~75-80% i avg ~+3.5-4.5% 3d (dolny przedział V5 ≥$500K: 80.5% / +4.49%).

### P3: PDUFA jako sygnał — **REFUTED**

- DB: 3 nadchodzące eventy (ACLX 20.06, KURA 01.07, VERA 07.07) — **żaden w uniwersum**; zero monitorowanych tickerów z PDUFA w Q3. Historycznie tylko BMY/LLY/REGN (5 eventów, daty przeszłe, large-capy gdzie decyzja FDA jest efektywnie wyceniana on-day).
- Literatura (Rothenstein JNCI 2011; event study 167 approvals): run-up istnieje **tylko przed wynikami badań klinicznych**, NIE przed decyzjami FDA (zwroty on-day, brak pre-decision driftu) — "run-up signal" obalony u podstaw.
- Realny pre-FDA sygnał wg Bohmann-Patel (2022) to **intraday informed options flow** — nasz EOD Polygon go strukturalnie gubi.
- Jedyny sensowny kernel: nie-kierunkowy flag zmienności "PDUFA za X dni" — ale wymagałby najpierw dodania PDUFA-driven tickerów do uniwersum (osobna decyzja o ekspansji, klasa ryzyka S19-FIX-03). Nie budować teraz.

### P4: Options wind-down + szybszy polling — **MIXED: A tak, B nie**

**Część A (options off) — supported, mocniej niż proponowano** (dowody w 1.4). Wykonanie: **odwracalne wyłączenie CRON** + cleanup repeatable jobs przy starcie (wzorzec StockTwits/Finnhub ze Sprint 11), kod i dane zostają. Przed wyłączeniem: 1 zapytanie do Polygon o głębokość historii options aggregates (czy spike detection jest rekonstruowalny retroaktywnie — warunek przyszłego backtestu opcji). Koszt: INSIDER_PLUS_OPTIONS staje się martwy (akceptowalne — N=3 winnerów to re-broadcasty), korelacje redukują się do INSIDER_PLUS_8K.

**Część B (szybszy polling jako "reinwestycja") — refuted** (dowody w 1.5). "Reinwestycja" to też fałszywa ekonomia: wyłączenie options uwalnia ~0 dev-czasu i $0 (free tier) — nie ma realnego trade-offu między A i B.

### P5: FIX-16 asymetryczny cap — **MIXED → shadow mode teraz, deploy 25.08 przy N≥3**

- HIMS 2402 potwierdzony: jedyny `consensus_miss` all-time, stracony short −19.7% 1d. Ale **deploy z N=1 łamie framework Plan v3** (FIX-12 R1 zaprojektowany pod 1 case PODD właśnie zabił HIMS — nie powtarzać wzorca).
- **Misklasyfikacja w pierwotnym uzasadnieniu**: BIIB to Item 1.01 (M&A), PODD 26.05 to Item 7.01 — narrative, nie hard-numbers; pełny rekord delivered bearish od 16.04 to **2/6, mean +0.96% PRZECIW kierunkowi** — "bearish 8-K trafia" en bloc nie ma potwierdzenia (dopiero post-14.05 wygląda dobrze: 2/3). Nie cytować BIIB/PODD jako dowodu FIX-16.
- Wymagane modyfikacje: (1) **shadow mode** — licz nowe progi, cap zostaje, persystuj `conviction_precap` + `would_uncap` w `sec_filings.gptAnalysis`/alerts (NIE system_logs — retencja 7-30d nie przeżyje do review); (2) **sign-gate**: no-cap tylko gdy conviction<0 (GPT bearish zgodny z missem); (3) definicja extreme odporna na niestabilność mianownika: |surprise|>30% AND (sign-flip LUB |actual−estimate| ≥ $0.10 EPS), wykluczyć filingi z anomaly-guard WARN (one-time charges, klasa GILD); (4) shadow log zbiera też revenue surprise + 30d pre-earnings price action (odróżnienie "miss niewyceniony" od "relief bounce").
- Volume: ~1-3 odblokowane alerty/kwartał, skoncentrowane w earnings season. Per-alert payoff potencjalnie najwyższy w systemie.

### P6: Actionable alert + throttle — **MIXED → wariant okrojony, effort S**

- **Throttle**: dowód "UNH ×5 / HIMS ×4" jest w większości MARTWY — UNH to false positives klasy FIX-05, GILD to backdoor FIX-07; obie klasy wyeliminowane 02.05. Post-fix delivered = **1.98/tydz** (nie 3.3 — tamta liczba uśrednia pre-fixowy kwiecień). Cross-rule throttle 72h (M, 7 plików) tnie tylko 3/11 post-fixowych — wszystkie to HIMS re-broadcasty. **Zamiennik 1-liner: PATTERN_THROTTLE INSIDER_PLUS_OPTIONS/8K 7200s → 259200s** (`correlation.types.ts:53-60`) daje 2/3 efektu; pełny cross-rule dopiero gdy forward pokaże cross-rule repeats. Zero utraconych winnerów w 50d sample (cuts to duplikaty albo losery); first-wins zachowuje 100% Form 4 BUY.
- **Wiadomość**: "rola+kwota" JUŻ JEST w Form 4 (telegram-formatter:218-226) — wyciąć z propozycji; "XBI-alpha w T0" nie istnieje (alpha liczona w slotach 1d/3d). Realna luka: **brak akcji LONG/SHORT, horyzontu i ceny wejścia**. Dodać linię `📌 Akcja: LONG | Horyzont: 3-7d | Wejście: $X.XX` w 3 formatterach; horyzonty jako **statyczna mapa per ruleName+kierunek** (BUY 3-7d, bearish-2.02 1-3d) z komentarzem do backtest_report.md, bez LLM; wymaga przesunięcia `captureAlertSnapshot` PRZED dispatch (dziś cena pobierana po wysyłce). W Correlated formatter dodać nazwisko+kwotę nogi form4.
- Zastrzeżenie z literatury: JMZ 2003 — ~50% abnormal return przychodzi po pierwszym miesiącu; komunikat "wyjdź po 7d" może zostawiać zysk na stole → slot 7d/21d w PriceOutcome rozstrzygnie na naszych danych.

---

## 3. Plan wdrożenia

### Pakiet 1 — "tydzień napraw" (wszystko S/XS, łącznie ~2-3 dni)

1. **aff10b5One parser fix** (XS) + backfill-check: ile historycznych SELL było planami (audyt, bez kasowania danych). Potem decyzja o re-run V5 (sanity: czy BUY edge przeżywa poprawne flagowanie).
2. **Floor priority dla BUY** (S): discretionary BUY ≥$100K C-suite/Director → minimum MEDIUM, GPT nie wetuje. Test: replay PODD Weatherman.
3. **Bullish 8-K gate** (S): wg modyfikacji P1 (mainItem, R4-pass-through, osobne reason, skip storeSignal, REASON_LABELS, revisit-gate 90d/N≥10).
4. **PATTERN_THROTTLE 72h** (XS): 1 stała.
5. **FIX-16 shadow mode** (S): persist pre-cap w trwałym miejscu, sign-gate, definicja extreme z floorem absolutnym; decyzja 25.08.
6. **Telegram actionable** (S): akcja/horyzont/wejście, snapshot przed dispatch.
7. **PriceOutcome slot 7d** (S): bez niego nie zwalidujemy ani pivotu, ani APLS Fazy 4 na horyzoncie, na którym edge istnieje.

### Pakiet 2 — pivot discovery (M, ~3-5 dni, po Pakiecie 1)

Event-driven collector: `getcurrent` atom co 5 min (godziny sesji + 16-19 ET szczyt filingów) → pre-filter deterministyczny (kod P, ≥$500K, aff10b5One=0, SIC healthcare/biotech, C-suite/Director, bez 10% ownerów) → mcap/ADV check (Finnhub profile2) → auto-rejestracja tickera (`observationOnly=true`, sector z mapy SIC) → standardowy Form4Pipeline. Nightly reconciliation EFTS/daily-index (cap 100 getcurrent). Observation 30-60d → delivery przez top-N (1-2/tydz). Szczegółowe warunki brzegowe w sekcji 2.P2.

### Wyłączenia / nie-działania

- **Options flow CRON off** (po potwierdzeniu retencji Polygon) — odwracalne.
- **PDUFA**: nie budować; ewentualnie usunąć martwy wymóg `pdufaBoosted` przy okazji innego sprzątania.
- **Szybszy polling istniejącego kolektora**: nie — chyba że jako część pivotu (tam wymusza go cap 100).
- **Reaktywacja 12 wyłączonych reguł**: ślepa uliczka (7/12 bez producentów danych po FinBERT cleanup, reszta superseded).
- **All-market screening**: dopiero po dedykowanym backteście mid/small-cap non-HC (osobna decyzja, dni pracy).

### Kalendarz walidacji

| Data | Co | Kryterium |
|---|---|---|
| 09.07.2026 | APLS Faza 4 review | ≥6 BUY events, hit ≥60%, median alpha ≥+2% |
| ~25.07.2026 | Pivot discovery: przegląd okna obs | jakość kandydatów, rozkład mcap/ról, zero pump-class |
| 25.08.2026 | FIX-16 decyzja deploy | N≥3 extreme-miss w shadow logu, kierunek zgodny |
| ~01.09.2026 | Werdykt "czy system ma edge" (z raportu 09.06) | ~20-30 niezależnych post-fixowych alertów z 7d outcome |
| +90d od deploy P1 | Revisit bullish-8K gate | hit suppressed >55% → zawęzić gate |

---

## 4. Kontekst z literatury (kalibracja oczekiwań)

- **Insider BUY-only focus jest mocno potwierdzony**: Cohen/Malloy/Pomorski 2012 (opportunistic trades ~82 bps/mies. VW), Lakonishok & Lee 2001 (small-cap BUY ~7.4%/12 mies.; SELL bez wartości predykcyjnej), Jeng/Metrick/Zeckhauser 2003 (BUY >6%/rok abnormal; SELL ~0). Nasze tłumienie 47 SELL to akademicko poprawny default.
- **Horyzont**: JMZ — ~25% abnormal return w pierwszych 5 dniach, ~50% w pierwszym miesiącu; nasz pomiar 3d systematycznie zaniża faktyczny edge → slot 7d (docelowo 21d).
- **Cluster buys**: literatura (Alldredge-Blank +0.9pp/mies.; Kang +1.8pp/21d) mówi, że efekt ISTNIEJE, ale jest mały i widoczny na horyzontach 21-90d przy tysiącach eventów — nasz null (N=21, 3-7d, p>0.37) to underpowered short-horizon null. TASK-09 disable jest OK operacyjnie (solo rule i tak strzela), ale nie cytować jako "klastry nie działają".
- **PEAD**: drift po negatywnych zaskoczeniach jest silniejszy i dłuższy (do 90d, Lerman-Livnat dla 8-K) — wspiera asymetrię FIX-16 i ostrożność wobec bullish narrative.
- **Benchmark komercyjny**: Quiver "Insider Purchases" (top-10 score, weekly rebal, od 2014): CAGR 19.3%, Sharpe 0.55, win rate 61%, MaxDD −50.8% — realistyczna kotwica oczekiwań dla strategii tej klasy (nie "300%/rok").

---

## 5. Czego ten plan świadomie nie rozstrzyga

- **Re-run V5 po fixie aff10b5One** — może lekko przesunąć liczby; decyzja po audycie skali misflagowania.
- **EXERCISE jako sygnał** (603 tx / $390M od marca, exercise-and-hold = proxy conviction; `shares_owned_after` nigdy nieużyte) — kandydat na hipotezę H8 w przyszłym backteście, nie teraz.
- **Control BUY (H7)** — wymaga świeżego fetchu EDGAR dla reprezentatywnych mid/small-cap non-HC (istniejące 731 control BUY to w 86% 10% ownerzy — bezużyteczne).
- **Rozszerzenie fetchu Exhibit 99.1 na Item 5.02/other** — 4 stłumione winnery post-FIX-10b sugerują wartość, ale N małe; obserwować po wdrożeniu P1 (osobne reason ułatwi pomiar).

---

*Źródła: workflow `edge-improvement-research` (run wf_72aa0b1a-c5d, 09.06.2026) — 5 raportów dowodowych + 6 weryfikacji adwersarialnych; pełny output w transcriptach sesji. Liczby DB wg stanu produkcji 09.06.2026 ~20:30 UTC.*
