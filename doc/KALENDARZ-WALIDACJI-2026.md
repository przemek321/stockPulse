# Kalendarz walidacji 2026 (utworzony 10.06.2026)

> Daty decyzyjne z planu [PLAN-EDGE-IMPROVEMENTS-2026-06-09.md](PLAN-EDGE-IMPROVEMENTS-2026-06-09.md).
> **Mechanizm przypomnienia**: raport 8h na Telegramie pokazuje sekcję
> „📅 Kalendarz walidacji" od 7 dni przed terminem do 3 dni po (flaga ZALEGŁY) —
> źródło: `VALIDATION_CALENDAR` w `src/alerts/summary-scheduler.service.ts`.
> Po wykonaniu przeglądu usuń wpis z tablicy (i odhacz tutaj).

## Wiążące definicje metryk — pre-rejestracja 02.07.2026 (PRZED przeglądami)

Ustalone po audycie 02.07 (workflow edge-analysis), bo na danych z czerwca sama definicja
„hit" odwraca werdykt o 180° (discovery BUY: raw hit 4/4, alpha hit 0/4 — okno rajdu XBI +20%).

- **hit 7d** = kierunek surowej ceny: `price7d > priceAtAlert` dla alertów positive
  (odwrotnie dla negative). Alpha NIE wchodzi do definicji hitu.
- **alpha 7d** = `xbiAlpha7d` (fallback `ibbAlpha7d`) — OSOBNE kryterium; edge uznajemy
  tylko gdy przechodzą OBA progi gate'u (jak w zapisie gate'u APLS: „hit ≥60% ORAZ alpha ≥+2%").
- **Raportowanie zawsze w trzech kolumnach**: raw 7d, alpha XBI, alpha IBB + zwrot XBI w oknie —
  żeby odróżnić „pick słabszy od sektora" od artefaktu beta=1.0 w rajdzie. Dla tickerów
  spoza biotechu klinicznego (EYE retail, COR dystrybucja SIC 5122) alpha vs XBI traktować
  jako dolne ograniczenie, nie werdykt (benchmark mismatch).
- **Atrybucja C-suite/Director w analizach**: zawsze SQL-em z `insider_trades.insiderRole`,
  nigdy z boostu/priorytetu alertu (do 02.07 ścieżka boostu miała name-match — „Harvard hole",
  usunięty; starsze alerty mogą nosić skażony priorytet).
- **Za mało danych ≠ fail**: przy N poniżej progu gate'u werdykt brzmi „insufficient N"
  i przesuwamy przegląd — nie forsujemy decyzji (anty-wzorzec, który FIX-16 miał wyeliminować).

## ~~2026-07-09 — APLS Faza 4 review~~ ✅ WYKONANY 10.07 — INSUFFICIENT DATA

**Werdykt** ([APLS-FAZA-4-REVIEW-2026-07-10.md](APLS-FAZA-4-REVIEW-2026-07-10.md)): 0 BUY od
seedu (brak podaży sygnału w rajdzie XBI, nie brak edge) → okno przedłużone do werdyktu 01.09,
licznik gate'u od pierwszego BUY. Wpis zdjęty z VALIDATION_CALENDAR.

<details><summary>Oryginalny zapis gate'u</summary>

- **Co**: ocena okna obserwacyjnego 6 tickerów `biotech_apls` (URGN/ARDX/MNKD/CRSP/AXSM/RCKT), seed 09.06.
- **Gate**: ≥6 BUY events, hit rate 7d ≥60%, median XBI-alpha ≥+2%.
- **Gdzie**: gotowy SQL w [APLS-FAZA-2-RESULTS-2026-05-23.md](APLS-FAZA-2-RESULTS-2026-05-23.md)
  (sekcja „Faza 4 obs window monitoring"); slot 7d działa od P1-06.
- **Decyzja**: promocja do delivery / przedłużenie obs / wycofanie.
- **Pre-werdykt 02.07**: gate matematycznie niespełnialny — **0 discretionary BUY** na 6 tickerach
  od seedu (insiderzy w rajdzie XBI +20% nie kupują; same SELL/GRANT/EXERCISE, AXSM plan-SELL $24.4M).
  To brak PODAŻY sygnału, nie brak edge. Rekomendacja na 09.07: **przedłużenie okna** (np. do
  werdyktu 01.09) + liczyć okno od PIERWSZEGO BUY, nie od daty seedu. Wniosek „brak edge"
  na zerowej próbce byłby błędny.

</details>

## ~~2026-07-25 — przegląd okna obs discovery~~ ✅ WYKONANY 27.07 — BEZ PROMOCJI

**Werdykt** ([DISCOVERY-OBS-REVIEW-2026-07-27.md](DISCOVERY-OBS-REVIEW-2026-07-27.md)): alpha XBI
0/5 (śr. −4.6pp), jedyny alert w reżimie spadkowym (CAI) przegrał też na raw → delivery top-N NIE
włączone, obs do werdyktu 01.09. Kohorta 7 tickerów — segmentować: osobowa (EYE/COR/CAI/SMMT) vs
funduszowa (CBIO/ARTV/PBLS — 10% Owner co-filing, klasa nietestowana w V5). Bug varchar(100)
naprawiony (DATA GAP CBIO/ARTV/PBLS). Wpis zdjęty z VALIDATION_CALENDAR.

<details><summary>Oryginalny zapis gate'u</summary>

## 2026-07-25 — przegląd okna obs discovery (Pakiet 2)

- **Co**: jakość kandydatów auto-zarejestrowanych przez `form4-discovery` od 10.06.
- **Sprawdź**: `SELECT * FROM tickers WHERE sector='healthcare_discovery'` + ich alerty
  obserwacyjne z price7d/xbiAlpha7d; rozkład mcap/ról; zero pump-class.
- **Decyzja**: włączenie delivery **top-N** (max 1-2/tydz najwyższy conviction) /
  przedłużenie obs / korekta filtrów. Też: przycinanie uniwersum discovery
  (brak auto-expiry — celowo odłożone do tego przeglądu).
- **Kontekst**: [PAKIET-2-DISCOVERY-2026-06-10.md](PAKIET-2-DISCOVERY-2026-06-10.md).

</details>

## ~~2026-08-25 — FIX-16 shadow review~~ ✅ WYKONANY 25.08 — INSUFFICIENT N (1/6)

**Werdykt** ([FIX-16-SHADOW-REVIEW-2026-08-25.md](FIX-16-SHADOW-REVIEW-2026-08-25.md)):
N=1 `would_uncap` (HIMS 10.08, kierunek potwierdzony −10.8% 7d) < gate 3 → cap zostaje,
shadow przedłużony, **review #2: 2026-11-15** (po Q3 earnings; wcześniej przy N≥3).
Niuans: HIMS i tak stłumiony przez `gpt_missing_data` — uncap sam nie dostarczyłby shorta.

- **Co**: czy asymetryczny cap R1 (extreme miss bez capu) ma poparcie w danych.
- **Query**: `SELECT "gptAnalysis"->'fix16_shadow' FROM sec_filings WHERE "gptAnalysis" ? 'fix16_shadow'`.
- **Gate**: N≥3 `would_uncap=true` z kierunkiem zgodnym (stock spadł po extreme missie —
  sprawdź price outcomes). Q2 earnings (lipiec) powinno dostarczyć próbkę.
- **Decyzja**: deploy drabinki z `src/sec-filings/utils/fix16-shadow.ts` / dalej shadow.
- **Stan 02.07**: N=0 (zero capów FIX-12 od wdrożenia 09.06). Jeśli do ~15.08 N<3 —
  przesunąć review z wyprzedzeniem, nie decydować na N=1-2. Uwaga: Alpha Vantage free
  25 req/dzień może być wąskim gardłem danych konsensusu w szczycie Q2.
- **Kontekst**: HIMS 11.05 stracony short −19.7% 1d; [SPRINT-19-BACKLOG.md](SPRINT-19-BACKLOG.md) FAZA 3.

## ~~2026-09-01 — werdykt „czy system ma edge"~~ ✅ WYKONANY 01.09 — EDGE NIE WYKAZANY (insufficient N)

**Werdykt** ([WERDYKT-EDGE-2026-09-01.md](WERDYKT-EDGE-2026-09-01.md), 57 alertów / 51 zdarzeń, zweryfikowany
2 ślepymi przeliczeniami + 4 recenzjami): system ≠ „bez edge" (REGUŁY §5 nie stopuje gry), ale edge NIE
wykazany. Klasa Form 4 BUY bez FUND (16 zdarzeń): hit 81% ✅, alpha śr +1.6 ❌ / med +2.2 ✅ → nierozstrzygnięte;
**zwrot REALIZOWALNY** (price1h→7d, 19/23 alertów po sesji, gap +4%) = 0.0% brutto / −1.0% netto.
**C-suite BUY (8 zdarzeń): hit 100%, α +4.9pp [CI>0], REAL +1.0% netto** — hipoteza wiodąca, N za małe.
Discovery osobowa: hit 79%, α +1.4/med +1.2 → bez promocji. FUND N=4, APLS 0 BUY → insufficient (teza
„APLS redundantne" FAŁSZYWA — kod pomija istniejące tickery; kohorta zostaje). Delivered grywalne: 3 alerty,
REAL −0.7%. 8-K Material Event GPT 1/7. Wpis zdjęty z VALIDATION_CALENDAR; następny: **01.11 werdykt #2**.

<details><summary>Oryginalny zapis gate'u</summary>

- **Co**: powtórka forward-analizy z [REPORT-2026-06-09-EDGE-ASSESSMENT.md](REPORT-2026-06-09-EDGE-ASSESSMENT.md)
  na alertach post-fixowych: signed return 3d **i 7d**, hit rate, XBI-alpha, per reguła.
- **Oczekiwane**: ~20-30 niezależnych alertów z 7d outcome (core + APLS + discovery).
- **Baseline do porównania**: all-time 0.00% signed 3d / hit 52%; post-fix +3.03% / 73% (N=11).
- **Decyzja**: kontynuować / korygować / zwijać.
- **Noty z audytu 02.07** (uwzględnić w analizie): (1) delivered=0 od 04.06 — werdykt musi
  rozdzielić jakość SYGNAŁÓW (DB-only obs) od jakości SELEKCJI delivery, której forward nie
  przetestował; (2) INSIDER_CLUSTER i INSIDER_PLUS_OPTIONS martwe, INSIDER_PLUS_8K ~martwy
  (okno 24h po czasie ingestii vs mediana latencji Form 4 = 69h) — cisza korelacji to artefakt
  architektury, NIE zasługa throttle; (3) tempo alertów 6/2/2/1 na tydzień — przy tempie
  końca VI werdykt stanie na ~20-23 z 7d (dolny brzeg), sprawdzić licznik ~20.07;
  (4) obserwacje z czerwca dzielą jedno okno rynkowe (rajd XBI) — nie są niezależne.

</details>

## 2026-11-01 — werdykt #2 + przegląd discovery #2 (pre-rejestracja 01.09, WIĄŻĄCA)

- **Statystyka alpha = MEDIANA** (oryginalny zapis APLS); średnia obok. Bramka: hit 7d ≥60% ∧ med α ≥+2pp.
- **Trzeci warunek każdej promocji: REAL** — mediana `price1h → price7d` po 1% kosztów > 0.
- **Sub-gate C-suite** (rola z `insider_trades.insiderRole`, `isCsuiteRole`): N≥10 zdarzeń C-suite BUY
  (discovery+core), hit ≥60% ∧ med α ≥+2pp ∧ REAL>0 → promocja TYLKO C-suite BUY z discovery do delivery (🎯).
  Director-only zostaje w obs niezależnie. Stan 01.09: 8 zdarzeń, wszystkie warunki spełnione, brakuje N.
  **✅ Wyzwalacz odpalił 18.09 (N=10), przegląd 23.09 → BEZ PROMOCJI**
  ([CSUITE-SUBGATE-REVIEW-2026-09-23.md](CSUITE-SUBGATE-REVIEW-2026-09-23.md)): gate przeszedł na medianie
  in-sample (7/10 zdarzeń sprzed pre-rejestracji), out-of-sample (INBX/ATEC/RLMD) hit 67%, med REAL **−6.68%**,
  śr REAL T1 −1.23% (−271 PLN), gap do pierwszej ceny med +7.3%, chase guard blokuje 8/10. **Gate #2 (wiążący
  od 23.09)**: tylko zdarzenia T1 z `first_at ≥ 02.09`; N≥10 ∧ hit ≥60% ∧ med α ≥+2 ∧ **med REAL >0 ∧ śr REAL >0
  ∧ ≥30% wchodzalnych (gap ≤3%)**; zdarzenie = ten sam insider/symbol w ≤7 dniach kalendarzowych po
  `transactionDate`; tier z grupy wyzwalacza w jednym filingu. Stan 23.09: N=3, FAIL. Chase guard bez zmian.
  Bugi naprawione: ping bez kontroli `ok:true` (18.09 nie dotarł), atrybucja roli z okna 14d zamiast z
  transakcji wyzwalającej (fantomowe INBX #2508).
  Wyzwalacz wczesny (bez zmian): przegląd sub-gate'u odpala w dniu, w którym N osiągnie 10 (nie czekamy na 01.11) —
  licznik `scripts/csuite-gate.sh` (cron pn-pt 23:45, log `logs/csuite-gate.log`, jednorazowy ping Telegram
  przy N≥10; `--print` = tabela zdarzeń). SQL = wierna kopia whitelisty `isCsuiteRole` (`scripts/sql/csuite-gate.cte.sql`).
- **Tier-2 C-suite (pre-rejestracja 01.09 wieczór, wdrożone tego dnia)**: próg discovery dla ról C-suite
  obniżony **$500K → $100K** (Director zostaje na $500K; APLS bez zmian). Uzasadnienie: backtest V5 H2 —
  C-suite BUY 7d ≥$100K N=25 d=+0.94 hit 80% vs ≥$500K N=17 d=+1.08 hit 82% (efekt płaski, próg kosztuje
  ~1/3 podaży); forward Director-only α −1.4pp → tylko C-suite. Kohorta **T2 ($100-500K) liczona OSOBNO**
  od T1 (≥$500K, sub-gate #1 bez zmian); T2 ma własny identyczny gate (N≥10 ∧ hit ≥60% ∧ med α ≥+2 ∧ REAL>0)
  → promocja C-suite BUY T2. Ryzyko do obserwacji: mniejsze zakupy = mniejszy sygnał? (backtest mówi nie).
- **FUND** = co-filer jest ENCJĄ w nazwie (CAPITAL/FUND/LP/LLC/PARTNERS/ADVISORS/MANAGEMENT/HOLDINGS/TRUST),
  niezależnie od tagu „10%" (case IMTX #2490). Decyzje o FUND dopiero przy N≥10 zdarzeń.
- **Benchmark**: capture XLV (instrumentacja); SIC 283x/2836 → XBI, inne healthcare → XLV; alerty sprzed
  wdrożenia nadal vs XBI/IBB. Do 01.11 XBI wiążący.
- **Zdarzenia**: symbol + kierunek, łańcuch ≤7 dni. Joint filers (SMMT-class: 2 Form 4 na jedną wspólną
  transakcję) = 1 zdarzenie. Alerty z zamrożonym notowaniem (5 identycznych slotów — SEM #2441, delisting)
  **wykluczone** z metryk (`price_frozen`).
- **APLS**: liczone łącznie z discovery (ta sama metryka BUY ≥$500K 7d); osobnego gate'u brak.
- **Teczka**: stale-filing trap (≥3 alerty z latencją >30d → osobno, inaczej zamknąć); reżim IX-X (α byczych
  med ≥+2pp przy N≥12); 8-K Material Event GPT (1/7) — N≥10 → decyzja obs/sunset.
- **Werdykt systemowy #2**: „bez edge" (stop gry, REGUŁY §5) tylko gdy klasa Form 4 BUY bez FUND: hit <60%
  LUB mediana REAL ≤ −1% przy N≥20 zdarzeń. Inaczej: kontynuacja / promocja wg sub-gate'ów.

## ~~2026-09-07 — bullish-8K gate revisit (90d od P1-02)~~ ✅ WYKONANY 07.09 — BEZ ZAWĘŻENIA

**Werdykt** ([BULLISH-8K-GATE-REVIEW-2026-09-07.md](BULLISH-8K-GATE-REVIEW-2026-09-07.md)): pełne query
N=16, hit **50%** (≤55%), signed +0.95%, α med −4.0, REAL med −0.1% → gate zawężenia NIE odpala, bramka
zostaje. Teczka: sub-hipoteza `bullish_no_consensus_data` (6: hit 83%, +6.4%, ale THC-outlier; kryterium
N≥10 ∧ hit ≥60% ∧ med α ≥+2 ∧ REAL>0) i wyjątek `ma` (N=2 <3, odłożone). **Przegląd #2: 15.11** (z FIX-16 #2).

- **Wynik pełnego query na 01.09** (4 powody, positive, 7d): N=16, hit **50%**, signed +0.95%, α −2.32pp ·
  med −4.0, REAL +1.0% → gate zawężenia NIE odpala. Sub-hipoteza `bullish_no_consensus_data` (6: hit 83%,
  +6.4%, α śr +4.2 / med +1.3, THC +27% dominuje). `gpt_missing_data` positive: hit 33%, α −6.2 (odwrócenie
  wobec „6/9, +2.1%"). `bullish_8k_no_edge` `ma`: N=1 → odłożone.

- **Query**: alerty `nonDeliveryReason IN ('bullish_8k_no_edge','bullish_no_consensus_data')`
  + price outcomes 1d/3d/7d. **UWAGA (audyt 02.07)**: priorytet suppression maskuje bullish —
  byczy 8-K z missing-data ląduje w `gpt_missing_data` (case: SEM 01.07 positive), z gap
  konsensusu w `consensus_*`. Query MUSI objąć też
  `alertDirection='positive' AND "nonDeliveryReason" IN ('gpt_missing_data','consensus_miss')`,
  inaczej bilans gate'a zaniżony o klasę, która historycznie wygrywała (6/9, +2.1%).
- **Gate**: hit suppressed >55% i średnia dodatnia → **zawęzić** gate (np. tylko
  1.01/7.01-contract zostaje stłumione). Odpala też wcześniej przy N≥10 suppressed.
- **Bilans na 02.07 (N=2, prowadzić na bieżąco)**: MOH 10.06 uratowany (raw −0.9%, α −10.4%)
  vs ABBV 22.06 wycięty katalizator M&A (raw **+16.1%**, α +5.4%) — 1:1. Tagować po
  `catalyst_type`: hipoteza, że gate projektowany pod earnings-hype nie powinien łapać `ma`
  (decyzja przy N≥3 dla tej kategorii).
- **Update 10.07**: SEM #2441 (byczy 8-K przez `gpt_missing_data` — klasa maskowana!) 7d:
  raw 0.00%, α **−3.8%** → tłumienie zasadne. VRTX #2442 (07.07, `bullish_8k_no_edge`) —
  trzeci przypadek wprost, 7d ~14.07. Bilans gate'ów tłumiących bullish: 2 zasadne
  (MOH, SEM) / 1 kosztowny (ABBV M&A) / 1 w toku (VRTX).
- **Update 10.08**: VRTX #2442 domknięty: 7d raw **−9.8%**, α **−6.0%** → tłumienie zasadne.
  OSCR #2473 (06.08, byczy 2.02 przez `gpt_missing_data` — klasa maskowana): GPT LONG
  conv 0.30 na EPS beat „+179.5%" ($1.10 vs $0.39) przy braku MLR/przychodów/guidance
  w tekście; rynek **−12.1% 1d / −5.9% 3d** (7d w pomiarze). Beat najpewniej artefaktem
  GAAP vs adjusted-konsensus; guard missing-data uratował najgorszy byczy call w historii
  pomiaru. Bilans: **4 zasadne (MOH, SEM, VRTX, OSCR) / 1 kosztowny (ABBV M&A)**.
  Hipoteza do przeglądu 07.09: ekstremalne beaty (>+100%) traktować jak FIX-16 misses —
  podejrzenie niezgodności definicji EPS, nie euforii.
- **Kontekst**: [PLAN-EDGE-IMPROVEMENTS-2026-06-09.md](PLAN-EDGE-IMPROVEMENTS-2026-06-09.md) §2.P1, commit `44732fc`.

## Wcześniejsze gate'y (dla porządku)

- ~~2026-05-25 — FIX-13 Faza 3 decision deadline~~ (osobny wątek, Plan v3)
- **lipiec 2026** — FIX-10b forward validation (Q2 earnings; kryteria w
  [FIX-10b-VALIDATION-CRITERIA.md](FIX-10b-VALIDATION-CRITERIA.md): 20 alertów Item 2.02,
  ≥85% z 2+ liczbami, 0% regresji MRNA-class) — bez sztywnej daty, naturalnie
  wyjdzie przy przeglądach 09.07/25.07.
