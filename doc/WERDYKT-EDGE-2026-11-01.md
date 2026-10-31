# Werdykt #2 „czy system ma edge" + przegląd discovery #2 — 01.11.2026

> Pre-rejestracja: [KALENDARZ-WALIDACJI-2026.md](KALENDARZ-WALIDACJI-2026.md) (definicje 02.07, wpis 01.11 z 01.09,
> gate C-suite #2 z 23.09). Poprzednik: [WERDYKT-EDGE-2026-09-01.md](WERDYKT-EDGE-2026-09-01.md).
> Dane: eksport `alerts`/`insider_trades`/`tickers` z prod 31.10 22:40 CET; przeliczenie Pythonem
> (`scripts/analysis/werdykt-2026-11-01.py`, pełny wydruk w [WERDYKT-EDGE-2026-11-01-dane.md](WERDYKT-EDGE-2026-11-01-dane.md))
> + **ślepe przeliczenie kryterium systemowego czystym SQL — zgodne co do 0.01** (29 zdarzeń, hit 62.1%, med REAL −1.37).
> Wykonane 31.10 wieczorem (sesja piątkowa zamknięta; ostatni alert z pełnym 7d: 22.10).

## 0. Próbka i konwencje

- **96 alertów** post-fixowych (od 09.06), **93 z pełnym 7d**; 3 bez 7d (ELV #2524 SELL 23.10, CNC/HCA 8-K 27.10 — żaden
  delivered); SEM #2441 wykluczony (`price_frozen`, delisting) → **92 w metrykach**. Od werdyktu #1 doszło **35 alertów**
  (IX: 22, X: 13), **0 delivered** — ostatni 🎯 to PODD 24.08.
- Metryki wg pre-rejestracji: hit = kierunek surowej ceny 7d; **alpha = MEDIANA** (średnia obok) vs XBI; **REAL** = `price1h → price7d`
  × kierunek, NET = REAL − 1%; zdarzenie = symbol + kierunek w łańcuchu ≤7 dni (średnia); FUND = co-filer z encją w nazwie;
  rola **z transakcji wyzwalającej** (`insider_trades.insiderRole`, whitelist `isCsuiteRole`); tier z grupy wyzwalacza.
- Dwa widoki: **cała próbka post-fix** (to na niej stoi kryterium systemowe N≥20) i **forward po 01.09** (czysty out-of-sample).

## 1. TL;DR

| Segment | A/E | signed 7d śr [CI] · med | hit | α XBI śr · **med** · α>0 | REAL śr · **med** [CI] · NET med | chase>3% |
|---|---|---|---|---|---|---|
| **Form 4 BUY klasa (bez FUND)** — cała | 37/29 | +2.00 [−0.9,+5.1] · +1.97 | **62%** | +0.90 · **+1.96** · 59% | −2.01 · **−1.37** [−5.7,+1.7] · −2.37 | 18/37 |
| **Form 4 BUY klasa (bez FUND)** — forward ≥01.09 | 17/12 | −0.26 · −3.04 | **42%** | +0.03 · +0.89 · 50% | −4.51 · **−5.67** [−9.1,+2.0] · −6.67 | 8/17 |
| ├ C-suite BUY — cała | 19/18 | +3.58 · +2.04 | 67% | +3.10 · **+2.31** · 67% | −1.32 · −0.39 [−8.2,+4.2] · −1.39 | 11/19 |
| ├ C-suite BUY — forward | 10/10 | +1.09 · −3.11 | 40% | +1.52 · +0.89 | −4.02 · **−7.06** · −8.06 | 6/10 |
| ├ C-suite T1 ≥$500K — cała / forward | 14/13 · 6/6 | +5.38 · +2.78 | 77% · 50% | med +2.45 · +2.07 | med **+1.68** · **−7.10** | 10/14 · 5/6 |
| ├ C-suite T2 $100–500K — cała / forward | 5/5 · 4/4 | −1.10 · −1.45 | 40% · 25% | med −0.19 · −1.28 | med −1.37 · −4.91 | 1/5 |
| └ Director-only BUY — cała / forward | 18/16 · 7/5 | −1.30 · −6.86 | 50% · 20% | med −1.90 · −3.79 | med **−3.50** [−6.4,−0.7] · −7.82 | 7/18 |
| Discovery+APLS osobowa — cała / forward | 25/21 · 15/11 | +1.64 · −0.59 | 52% · 36% | med **+0.03** · −0.19 | med **−5.33** · −5.68 | 14/25 |
| Discovery FUNDUSZOWA | 7/7 | −0.67 | 43% | med +2.75 | med −4.67 | 5/7 |
| Rdzeń+ tickery (PFE BSX COR ELAN COO SMMT) | 9/6 | +3.54 · +3.31 | 83% | −0.18 · +1.48 | +1.36 · **+1.24** · +0.24 | 2/9 |
| Core zwalidowany + rdzeń+ (bez discovery) | 8/8 | — | **88%** | — | med **+0.69** (śr +0.84) | — |
| Delivered (produkt, wszystkie od 09.06) | 7/6 | +1.67 · +0.65 | 67% | +4.36 · +2.67 | −2.03 · −1.10 · −2.10 | 3/7 |
| Form 4 SELL jako short | 12/10 | +0.92 · +2.26 | 70% | +3.63 · +2.85 | +0.83 · +2.33 · +1.33 | 0/12 |
| 8-K wszystkie | 36/35 | +0.87 · −0.23 | 49% | +0.13 · −0.62 | −0.75 · −1.07 · −2.07 | 10/36 |

Pełne tabele (per reguła × kierunek, bramki tłumiące, reżim miesięczny, lista 29 zdarzeń) w pliku `-dane.md`.

## 2. Werdykt systemowy #2 — kryterium pre-zarejestrowane 01.09 SPEŁNIONE → „BEZ EDGE"

Zapis z 01.09: *„bez edge" (stop gry wg REGUŁ §5) tylko gdy klasa Form 4 BUY bez FUND: hit <60% **LUB** mediana REAL ≤ −1%
przy N≥20 zdarzeń.* Stan: **N=29 ≥ 20, hit 62% (próg OK), mediana REAL −1.37% ≤ −1% → kryterium odpala.**

Wrażliwość (żaden wariant z N≥20 nie ratuje klasy; warianty z N<20 pokazują, GDZIE siedzi strata):

| Wariant | E | hit | med REAL (śr) | kryterium |
|---|---|---|---|---|
| A: bazowy | 29 | 62% | −1.37 (−2.01) | **BEZ EDGE** |
| B: bez sklejania (alert = zdarzenie) | 37 | 62% | −1.37 (−2.46) | BEZ EDGE |
| C: z FUND | 36 | 58% | −2.48 (−2.69) | BEZ EDGE |
| D: bez PRE (brak na XTB) | 28 | 61% | −1.68 (−2.45) | BEZ EDGE |
| I: tylko T1 ≥$500K | 24 | 67% | −1.23 (−1.97) | BEZ EDGE |
| E: tylko wchodzalne (gap ≤3%) | 15 | 40% | −1.37 (−2.95) | N<20 |
| F: tylko forward ≥01.09 | 12 | **42%** | **−5.67** (−4.51) | N<20 |
| G: tylko in-sample <01.09 | 17 | 76% | −0.73 (−0.24) | N<20 |
| H: core + rdzeń+ (bez discovery) | 8 | 88% | **+0.69** (+0.84) | N<20 |

- Mediana REAL ma CI [−5.7, +1.7] (bootstrap P(med>0) = 17%) — statystycznie „nierozróżnialne od zera", ale pre-rejestracja
  nie zostawiła furtki na CI: próg to punktowa mediana przy N≥20 i został przekroczony. **Nie relitygujemy** (lekcja 23.09).
- Rozkład REAL (29 zdarzeń): 11 wygranych / 18 przegranych; suma NET @2200 PLN na zdarzenie = **−1 918 PLN**. Lewy ogon:
  ALMS −19.7, INBX −15.7, RAPP −9.6, MOBI −9.3, XENE −8.5, ENOV −8.4, KURA −7.9 — **wszystko discovery**.
- **Kierunek próbki forward jest jednoznaczny**: po 01.09 klasa ma hit 42% i med REAL −5.7%; każdy podsegment forward
  (C-suite, Director, discovery, FUND) jest ujemny na REAL. In-sample (≤01.09) wyglądał na +; forward go odwrócił — to ten sam
  wzorzec co sub-gate C-suite 23.09. Reżim: XBI w oknach IX −1.1%, X +0.6% — to nie jest artefakt rajdu.
- Jedyny segment na plusie to **core zwalidowany + rdzeń+ (H: 8 zdarzeń, hit 88%, med REAL +0.69%)** — N za małe, w większości
  in-sample, i dokładnie to mierzy przegląd rdzeń+ 01.02.2027 (N=10). Nie zmienia werdyktu, ale definiuje, co warto dalej mierzyć.

**Konsekwencja wg REGUŁ §5: stop gry real** — od 01.11.2026 brak nowych pozycji z alertów StockPulse. W praktyce od 24.08 i tak
nie było 🎯 (0 delivered w IX–X), więc stop nic nie zamyka; zmienia status z „świadomy pomiar z kapitałem" na „pomiar bez kapitału".
Zdjęcie stopu wymaga pozytywnego werdyktu #3 (zapis w §8) albo datowanego dopisku właściciela w REGUŁACH.

## 3. Sub-gate C-suite BUY #2 (gate wiążący od 23.09: tylko T1 z `first_at ≥ 02.09`)

Stan licznika (`logs/csuite-gate.log`, 30.10): **T1 N=6/10, hit 50%, med α +2.07, med REAL −8.10%, śr REAL −5.17%, suma −682 PLN,
wchodzalne 1/6** → progi: hit ✗, α ✓ (na granicy), med REAL ✗, śr REAL ✗, wchodzalne ✗. Zdarzenia: INBX ×3 (CEO Lappe: −16.7 / −9.9 /
**+9.5**), ATEC +2.3, RLMD −6.7, XENE −9.5. Gate trwa do N=10 (tempo ~3/mies. → grudzień); dziś wynik byłby **FAIL 4/5**.
Hipoteza „gap-band" (23.09): gap >7% → śr REAL −4.25 (N=5) vs ≤7% → −0.20 (N=13) — kierunek zgodny, N<10, trwa.

**Bug licznika (instrumentacja, naprawiony dziś)**: nazwisko wyzwalacza wyciągane z wiadomości Telegram zawiera escapy
MarkdownV2 (`Davidson Michael H\.`), więc insiderzy z kropką w nazwisku nie łączyli się z `insider_trades` i wypadali z kohorty.
Dotyczy T2: **NAMS #2503 (CEO Davidson, +6.0 REAL) i RAPP #2522-23 (CFO Ignelzi, −9.6)** → T2 forward = **4/10** (nie 2): ENOV −8.5,
NAMS +6.0, DMRA −1.4, RAPP −9.6 → hit 25%, med REAL −4.9. T1 bez zmian (6). Fix: `scripts/sql/csuite-gate.cte.sql` usuwa `\` z nazwiska.

## 4. Przegląd discovery #2 → BEZ PROMOCJI, kohorta do decyzji

- Osobowa (25/21): hit 52%, **med α +0.03** (próg +2), **med REAL −5.33%** → wszystkie trzy warunki ✗. Forward (15/11): 36% / −0.19 / −5.68.
- Discovery **Director-only forward: 5 alertów, hit 0%, med REAL −11.8%** (ALMS −19.7 jedyny raz, ale i reszta ujemna). Cała próbka
  Director-only: hit 50%, med α −1.90, med REAL −3.50 [CI −6.4, −0.7 — **cały CI poniżej zera**]. To jedyny segment, gdzie dane
  mówią coś pewnego: Director BUY ≥$500K w small-capach **nie ma edge w żadnej konwencji**, spójnie z backtestem (Director ≪ C-suite)
  i z werdyktem #1 (α −1.4).
- FUND (7/7): hit 43%, med REAL −4.67 — N<10, bez decyzji; nic nie wskazuje na wartość.
- APLS: nadal **0 dyskrecjonalnych BUY** od seedu 09.06 (5 miesięcy) — insufficient, koszt 0.
- Lejek: 26 tickerów discovery (IX +9, X +3); large-capy od 19.10 idą do rdzenia (jeszcze żaden alert z tej ścieżki).
- Stale-filing trap: 0 alertów z latencją >30d od 01.09 → **teczka zamknięta**.

## 5. Rdzeń+ (decyzja 19.10, przegląd 01.02.2027 / N=10)

Historycznie 9 alertów / 6 zdarzeń na tych tickerach (in-sample): hit 83%, med REAL +1.24, 2/9 chase-blok. **Od promocji 19.10:
0 alertów** (ELV #2524 23.10 to SELL core, stłumiony). Licznik N=0/10 forward. Bez zmian.

## 6. 8-K, bramki, teczki

- **Bullish-8K pełne query** (4 powody, positive): A/E 24/23, hit **48%**, signed −0.43, α med −4.26 → gate zawężenia (hit >55%) nie odpala;
  `bullish_no_consensus_data` (6/6, hit 83%, REAL med +2.59) nadal jedyna dodatnia podklasa, 0 nowych od 01.09. Formalny przegląd #2 = 15.11.
- **8-K Material Event GPT**: od 01.09 **0 wierszy `material_event_obs`** — bo priorytet tłumienia `bullish_8k > material_event_obs`
  maskuje je jako `bullish_8k_no_edge` (6 forward, hit 2/5). Licznik N≥10 z 01.09 jest więc martwy w tej postaci; cała reguła: 12 alertów,
  BULL 3/7, BEAR 1/4 — bez edge, jak 01.09. Decyzja: obs zostaje, licznik liczyć po `ruleName`, nie po powodzie.
- Earnings Miss BEAR (6/6): raw +8.0%, **REAL −0.78** — spadek jest przed pierwszą ceną (bez zmian od #1). BULL (17/17): hit 53%, α −4.3.
- Form 4 SELL jako short (12/10): hit 70%, α med +2.85, REAL med +2.33 — jedyna reguła z dodatnim REAL, ale α to large-capy
  w oknie XBI +2.7 i reguły gry nie przewidują shortów; **teczka**: N≥20 zdarzeń → osobna ocena (nie promocja — short na XTB kasowym
  = CFD, poza REGUŁAMI).
- Reżim IX–X: α byczych med −1.12 (N=28) → hipoteza „reżim" **zamknięta negatywnie**.
- Instrumentacja XLV z pre-rejestracji 01.09 **NIE została wdrożona** (brak w kodzie) — bez konsekwencji dla werdyktu (XBI wiążący), odnotowane.

## 7. Gra real 01.09–01.11

0 sygnałów 🎯 → 0 transakcji, dziennik bez nowych wpisów, seria 0. Stop §5 wchodzi z werdyktu, nie z serii strat.

## 8. Decyzje

**Automatyczne (z pre-rejestracji, bez uznaniowości):**
1. Werdykt systemowy #2 = **BEZ EDGE** → **stop gry real (REGUŁY §5)**. Wpis w [DZIENNIK-TRANSAKCJI.md](DZIENNIK-TRANSAKCJI.md).
2. Discovery: bez promocji (3/3 progi ✗). Sub-gate C-suite #2: trwa do N=10 (dziś FAIL 4/5).
3. Rdzeń+: bez zmian, przegląd 01.02.2027 / N=10.
4. Teczki zamknięte: stale-filing (0), reżim IX–X (α −1.1). Otwarte: gap-band (N=5/10), Form 4 SELL short (N=10/20), FUND (7/10).

**Do decyzji właściciela (rekomendacja agenta kursywą):**
5. **System dalej jako pomiar bez kapitału vs sunset.** *Rekomendacja: pomiar do 01.02.2027 — jedyne pytanie, na które forward może
   jeszcze odpowiedzieć, to rdzeń+/core (segment H, med REAL +0.69 przy N=8) i sub-gate C-suite przy N=10. Koszt: serwer + API.*
   Werdykt #3 = **01.02.2027** (razem z rdzeń+): klasa „core + rdzeń+ Form 4 BUY" N≥10 zdarzeń, hit ≥60% ∧ med REAL >0 ∧ śr REAL >0
   → zdjęcie stopu gry wyłącznie dla 🎯 z rdzenia; inaczej sunset gry (system może zostać jako research).
6. **Discovery Director-only ($500K, role-only)**: generuje tylko stratne obserwacje i zużywa GPT. *Rekomendacja: wyłączyć ścieżkę
   Director w discovery (C-suite T1/T2 zostają do końca gate'u #2). Zmiana reguły → osobny commit po decyzji, nie dziś.*
7. **Etap 2 agentów (MCP read-only + LLM)**: *odłożyć — przy braku edge do ochrony to koszt bez zwrotu; audytor etap 1 zostaje
   (0 false positives, 0 kosztu).*
8. **Migracja na Raspberry Pi 5**: decyzja techniczna niezależna od edge; *ma sens tylko przy wyborze „pomiar" w pkt 5 (po 01.11
   zgodnie z planem, warunek: SSD na dane).*
9. **Anthropic API bez kredytów od 27.10** ([project] „credit balance too low"): od 27.10 11:35 UTC **20 8-K bez analizy GPT** i 2 kandydaci
   Form 4 (SRRK Director $1.9–4.1M ×4, RAPP Director Healy $20M) **bez wiersza w alerts** (obserwacja utracona). Wybór A (doładować
   $5–10) vs B (most `claude -p` poza aplikacją) z 31.10 nadal otwarty. *Rekomendacja bez zmian: A — jeśli pomiar trwa, pipeline musi
   zostać identyczny z mierzonym.*

## 9. Co ta runda mówi o systemie

Werdykt #1 brzmiał „edge informacyjny, nierealizowalny" (gap +4–7% na otwarciu). Dwa miesiące forward dopisały drugą połowę:
w small-capach discovery **nie ma nawet edge informacyjnego** po 01.09 (hit 42%), a gap nadal zjada to, co zostaje. Sygnał insiderski
działa tam, gdzie rynek jest głęboki i reakcja na filing mała — core/large-cap (gap med +1–2%, REAL +) — czyli dokładnie tam, gdzie
podaż to ~1 zdarzenie/miesiąc. To jest hipoteza rdzeń+, i ona ma swój termin.
