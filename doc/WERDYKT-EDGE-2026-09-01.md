# Werdykt „czy system ma edge" — 01.09.2026

> Pre-rejestracja: [KALENDARZ-WALIDACJI-2026.md](KALENDARZ-WALIDACJI-2026.md) (definicje 02.07, wpis 01.09).
> Baseline: [REPORT-2026-06-09-EDGE-ASSESSMENT.md](REPORT-2026-06-09-EDGE-ASSESSMENT.md).
> Weryfikacja: 2 ślepe przeliczenia z surowego CSV (zgodność co do 0.01) + 4 recenzje adwersarialne
> (statystyk, audytor pre-rejestracji, adwokat promocji, praktyk XTB) + krytyk kompletności.
> Szkic przed recenzją zawierał 3 błędy P0 — poprawione tu i opisane w §8.

## 0. Próbka i konwencje

- **57 alertów** post-fixowych (od 09.06) z pełnym 7d, z 61 zmierzonych; 4 poza cutoffem (UNH 25.08,
  THC/IMTX/RGNX 27.08 — żaden delivered). 0/61 alertów bez kierunku (konwencja „pusty=positive" nieużyta).
- **Zdarzenia (E)**: alerty tego samego symbolu i kierunku w łańcuchu ≤7 dni = 1 zdarzenie (średnia).
  57 alertów → 51 zdarzeń. Duplikaty ujawnione przez weryfikację: ELV #2446/#2447 (te same transakcje,
  1.5h odstępu, oba delivered), SMMT #2434/#2435, THC #2455/#2466, PFE #2477 i KURA #2486 re-alertują
  wcześniejsze BUY (bug, §7).
- **Metryki**: hit = kierunek SUROWEJ ceny; alpha XBI (i IBB) OSOBNO; signed = zwrot × kierunek.
  **Nowa kolumna REAL** (wymuszona przez recenzję): zwrot od pierwszej dostępnej ceny (`price1h`,
  pierwszy odczyt po otwarciu NYSE) do 7d — bo **19/23 alertów Form 4 BUY wyszło po sesji**, a
  `priceAtAlert` to close SPRZED reakcji rynku; gap do pierwszej ceny średnio **+4.0%**. NET = REAL − 1%
  kosztów XTB. „Chase-blok" = alerty, gdzie pierwsza cena > +3% (reguła gry §2).
- 95% CI: bootstrap 5000× na zdarzeniach (przy E≤6 anty-konserwatywny — traktować orientacyjnie).
- **Bramka edge** (02.07, przez analogię do gate'u APLS): hit 7d ≥60% **ORAZ** alpha ≥+2pp. Pre-rejestracja
  nie doprecyzowała, czy alpha to średnia czy mediana (oryginalny zapis APLS: **mediana**). Raportujemy obie;
  tam, gdzie się rozjeżdżają, werdykt brzmi „nierozstrzygnięte". Na 01.11 wiążąca = **mediana** (§6).

## 1. TL;DR

| Segment | A/E | signed 7d śr [CI] · med | hit | α XBI śr [CI] · med · α>0 | α IBB | XBI okno | REAL 7d · NET | chase-blok |
|---|---|---|---|---|---|---|---|---|
| **Delivered (produkt)** | 7/6 | +1.67 [−2.9,+7.8] · +0.65 | 67% | +4.36 [−0.7,+11.4] · +2.67 · 83% | +4.78 | +3.00 | −2.03 · −3.03 | 3/7 |
| Delivered bez shorta PODD #2470 | 6/5 | −1.16 · +0.30 | 60% | +1.14 · +2.40 | +1.52 | +2.67 | −1.80 · −2.80 | 2/6 |
| **Delivered grywalne wg REGUŁ** (ELV×2, PODD) | 3/2 | +1.06 · +1.06 | 100% | +3.24 · +3.24 | +2.33 | −2.18 | **−0.70 · −1.70** | 2/3 |
| **Form 4 BUY klasa** (deliv+obs, bez FUND) | 19/16 | +4.00 [+1.0,+7.3] · +2.98 | 81% | +1.60 [−1.8,+5.3] · **+2.21** · 62% | +1.54 | +2.40 | **0.00 · −1.00** | 10/19 |
| ├ **C-suite BUY** (rola z insider_trades) | 10/8 | **+6.63 [+2.6,+11.2]** · +3.91 | **100%** | **+4.87 [+0.4,+10.0]** · +3.24 · 88% | +4.70 | +1.75 | **+1.97 · +0.97** | 6/10 |
| └ Director-only BUY | 9/9 | +1.70 [−1.5,+4.7] · +2.91 | 67% | −1.42 [−5.1,+1.9] · −1.91 · 33% | −1.57 | +3.13 | −1.39 · −2.39 | 4/9 |
| Discovery OSOBOWA | 16/14 | +4.42 [+1.1,+8.0] · +3.15 | 79% | +1.37 [−2.4,+5.5] · +1.24 · 57% | +1.43 | +3.05 | +0.10 · −0.90 | 8/16 |
| ├ bez PRE #2487 | 15/13 | +3.42 · +3.10 | 77% | **+0.01** · +0.51 · 54% | +0.07 | +3.41 | −0.68 · −1.68 | 7/15 |
| ├ bez SMMT (controlling owner) | 14/13 | +4.60 · +3.20 | 77% | +1.97 · +1.96 · 62% | +1.64 | +2.63 | −0.02 · −1.02 | 8/14 |
| ├ biotech kliniczny (właściwy benchmark) | 8/7 | +3.25 · +2.11 | 71% | +0.35 · +1.96 · 57% | +0.48 | +2.90 | −2.41 · −3.41 | 4/8 |
| └ non-biotech (α = dolne ograniczenie) | 8/7 | +5.60 · +3.20 | 86% | +2.39 · +0.51 · 57% | +2.38 | +3.20 | +2.62 · +1.62 | 4/8 |
| Discovery FUNDUSZOWA | 4/4 | +2.09 · +2.47 | 50% | +3.26 · +5.81 · 75% | +1.63 | −1.18 | −3.40 · −4.40 | 2/4 |
| └ bez stale-entry (#2451-53) | 1/1 | REPL +14.21 | 100% | +8.87 | +7.45 | +5.34 | +1.43 · +0.43 | 1/1 |

**Werdykt systemowy (w terminach REGUŁ §5): system NIE jest „bez edge" — ale edge NIE ZOSTAŁ WYKAZANY
(insufficient N / bramka nierozstrzygnięta). Gra real może trwać wyłącznie jako świadomy pomiar z kapitałem,
bo zwrot REALIZOWALNY na tym, co reguły pozwalają grać, wynosi ≈0% brutto, ok. −1% netto.**

1. **Produkt (delivered)**: nominalnie oba progi (hit 67%, α +4.4pp) — ale wyłącznie dzięki jednemu shortowi
   8-K (PODD #2470, +15.8%), którego reguły nie pozwalają grać; bez niego signed −1.2%, α +1.1pp.
   Z 7 delivered **grywalne były 3** (ELV ×2 = 1 zdarzenie, PODD #2484): raw +1.06%, **realizowalnie −0.7%
   (netto −1.7%)**; ELV: pierwsza cena po alercie +3.8-4.0% → chase-blok przy wejściu na otwarciu; PODD
   wchodzalny, +0.6% brutto. Porównanie z baseline (post-fix +3.03%/73% 3d, N=11) **niekonkluzywne** — hit 3d
   57% vs 73%, ale N=7 nie odróżnia tego ani od +3%, ani od all-time 0%/52%.
2. **Form 4 Insider BUY jako klasa (19/16, delivered+obs, FUND osobno wg 27.07)**: hit **81% ✅**; alpha
   średnia +1.60pp ❌ / mediana +2.21pp ✅ → **nierozstrzygnięte** wg definicji 02.07. Surowy zwrot +4.0%
   ma CI powyżej zera, ale jest kruchy (bez PRE dolna granica ≈0; Bonferroni po ~14 porównaniach obejmuje 0;
   d=0.49 vs backtest 0.92) i **nie jest osiągalny**: REAL 0.00%, NET −1.0%, chase-blok 10/19.
3. **Podział ról (nakaz pre-rejestracji — i najważniejszy wynik dnia)**: **C-suite BUY (8 zdarzeń): hit 100%,
   signed +6.6% [+2.6,+11.2], α +4.9pp [+0.4,+10.0] · med +3.2, REAL +2.0% (NET +1.0%)** — jedyna podgrupa
   przechodząca oba progi Z realizowalnym plusem; Director-only (9): hit 67%, α −1.4pp, REAL −1.4%. Kierunkowo
   dokładnie backtest V5 (C-suite ≫ Director). N=8 → **insufficient do deployu**, ale to jest hipoteza
   wiodąca na 01.11 (pre-rejestrowana w §6).
4. **Discovery OSOBOWA (16/14)**: hit 79% ✅, alpha +1.37 śr / +1.24 med ❌ (<+2pp na każdej konwencji:
   bez SMMT +1.97/+1.96, zdarzeń 13 vs 14 — bez zmian). Bez jednego alertu (PRE +17.5%) alpha = 0.0pp; XBI
   rósł w 69% tych samych okien (base-rate). REAL +0.1%, NET −0.9%. **Bez promocji.** Sierpień (α +3.8pp, N=9)
   to podział post-hoc — do teczki jako hipoteza reżimu.
5. **Discovery FUNDUSZOWA (4)**: hit 50%, 3/4 stale-entry, bez nich N=1 (REPL). **Insufficient.** Reguła
   segmentacji do poprawki przed 01.11: FUND = co-filer jest ENCJĄ niezależnie od tagu „10%" (IMTX #2490:
   Perceptive Advisors jako „Director").
6. **APLS**: 0 dyskrecjonalnych BUY od seedu (6 tickerów, trzeci przegląd) → **insufficient N**. Teza szkicu
   o redundancji wobec discovery była **FAŁSZYWA** (`form4-discovery.service.ts:392-396` pomija tickery
   obecne w `tickers`) — kohorta zostaje (koszt 0 przy 0 BUY), osobny gate zdjęty, ocena łączna 01.11.
7. **8-K**: Earnings Miss BEAR (6): signed +8.0%, hit 67%, α +9.0pp — ale gap −8.7% na otwarciu,
   **REAL −0.8%** (spadek jest przed pierwszą ceną); BULL 2.02 (13): +0.8%, α −2.1pp ❌. **Material Event GPT:
   1/7 hit (BEAR 0/3, BULL 1/4)** — GPT na „miękkich" 8-K nie ma edge w żadną stronę (spójne z 09.06: 0/4).
8. **Form 4 SELL jako short (7/6)**: raw −0.3%, hit 58% → brak short-edge; α +5.1pp [+1.8,+9.5] to artefakt
   okna rajdu XBI (+5.4%) na large-capach. Tłumienie `sell_no_edge` zasadne wg kryterium hit.

## 2. Per reguła × kierunek (wszystkie 57)

| Reguła · kierunek | A/E | s3d | s7d śr · med | hit 7d | α XBI śr · med | α IBB | XBI okno | REAL · NET |
|---|---|---|---|---|---|---|---|---|
| Form 4 Insider BUY · BULL (z FUND) | 23/20 | +3.95 | +3.62 · +2.98 | 75% | +1.94 · +2.60 | +1.56 | +1.68 | −0.68 · −1.68 |
| 8-K Earnings Miss · BEAR | 6/6 | +7.33 | +8.02 · +7.93 | 67% | +9.04 · +7.69 | +9.44 | +1.02 | −0.78 · −1.78 |
| 8-K Earnings Miss · BULL | 13/13 | +0.14 | +0.83 · +1.00 | 62% | −2.06 · −4.26 | −1.89 | +2.89 | +0.94 · −0.06 |
| 8-K Material Event GPT · BEAR | 3/3 | −3.01 | −3.37 · −2.93 | 0% | +2.53 · +2.40 | +2.12 | +5.90 | −3.78 · −4.78 |
| 8-K Material Event GPT · BULL | 4/4 | +1.03 | +1.36 · −0.43 | 25% | −3.68 · −4.86 | −1.93 | +5.05 | +0.89 · −0.11 |
| 8-K Leadership Change · BEAR | 1/1 | +3.74 | −0.23 | 0% | +6.26 | +4.56 | +6.49 | −3.04 · −4.04 |
| Form 4 Insider Signal (SELL) · BEAR | 7/6 | −0.77 | −0.26 · +1.57 | 58% | +5.13 · +3.70 | +2.80 | +5.39 | −0.31 · −1.31 |

Uwaga: etykieta „8-K Earnings Miss" obejmuje oba kierunki (13/19 to positive) — nazwa reguły nie opisuje sygnału.

## 3. Bramki tłumiące — walidacja SELEKCJI (nota (1) audytu 02.07), trzy kolumny

| nonDeliveryReason | A/E | s7d śr · med | hit | α XBI śr · med | α IBB | XBI okno | REAL · NET | werdykt |
|---|---|---|---|---|---|---|---|---|
| observation (=discovery) | 20/18 | +3.90 · +3.15 | 72% | +1.79 · +2.21 | +1.47 | +2.11 | −0.67 · −1.67 | patrz §1.4-5 |
| gpt_missing_data | 10/10 | +1.64 · **−0.12** | **40%** | +1.69 · −0.76 | +1.09 | +3.64 | +0.62 · −0.38 | zasadne (hit 40%); koszt = pojedyncze shorty TDOC +26.6, HIMS +10.8; uratowane ISRG −16.9, HUM −6.2 |
| sell_no_edge | 7/6 | −0.26 · +1.57 | 58% | +5.13 · +3.70 | +2.80 | +5.39 | −0.31 · −1.31 | zasadne (hit <60%); alpha = artefakt rajdu |
| consensus_miss | 4/4 | −3.49 · −5.07 | 25% | −6.10 · −6.73 | −4.52 | +0.03 | −4.15 · −5.15 | zasadne |
| bullish_8k_no_edge | 3/3 | +1.82 · −0.87 | 33% | −3.66 · −5.96 | −1.34 | +5.48 | +1.19 · +0.19 | **mieszane** (raw + przez ABBV M&A +16%, alpha −); `ma` N=1 → decyzja odłożona |
| bullish_no_consensus_data | 6/6 | +6.36 · +5.23 | 83% | +4.24 · +1.30 | +3.74 | +2.13 | +2.40 · +1.40 | **klasa wygrywająca, ale THC +27% dominuje** (med α +1.3) |

**Przekaz na 07.09 (pełne pre-zarejestrowane query: 4 powody, `alertDirection='positive'`)**: N=16, hit **50%**,
signed +0.95%, α −2.32pp · med −4.0, REAL +1.0% → **gate zawężenia („hit >55% i średnia dodatnia") NIE odpala**.
`bullish_no_consensus_data` to sub-hipoteza do teczki (N=6, 1 outlier), nie P0. Poprzednia analogia „6/9, +2.1%"
dotyczyła klasy `gpt_missing_data` positive, która teraz ma hit 33%, α −6.2pp — odwrócenie.

Bilans byczych: delivered (4): hit 100%, s7d +1.24, α +1.28 · stłumione (36): hit 64%, s7d +2.55, α −0.30.
Selekcja jest precyzyjna, ale odcina obserwacje discovery — to jest pytanie o promocję, rozstrzygane w §1.4.

## 4. Reżim rynkowy (tylko alerty bycze)

| Miesiąc | A | XBI okno 7d | signed 7d | α XBI | REAL |
|---|---|---|---|---|---|
| VI | 6 | +8.60 | +4.25 | −4.35 | +1.90 |
| VII | 18 | +0.64 | −0.68 | −1.32 | −1.95 |
| VIII | 16 | +2.47 | +5.22 | +2.76 | +1.81 |

Czerwiec = jedno okno rajdu (obserwacje nie-niezależne). Sierpień pierwszy z α>0 — 3 punkty, bez wniosku;
hipoteza „reżim IX-X" do teczki z progiem na 01.11.

## 5. Gra real 02.07–01.09 (REGUŁY §1-6)

| Alert | Wysłany (ET) | priceAtAlert | max wejście (+3%) | pierwsza cena | 7d | raw | REAL · NET | status |
|---|---|---|---|---|---|---|---|---|
| ELV #2446 | 17.07 14:05 | 369.99 | 381.09 | 383.99 (+3.8%) | 378.71 | +2.4% | −1.4 · −2.4 | user WSZEDŁ intraday przy dołku dnia (poniżej chase) — wynik do dziennika |
| ELV #2447 | 17.07 15:35 | 369.24 | 380.32 | 383.99 (+4.0%) | 374.01 | +1.3% | −2.6 · −3.6 | duplikat #2446 (bug §7) |
| PODD #2484 | 24.08 07:35 | 148.16 | 152.60 | 147.73 (−0.3%) | 148.60 | +0.3% | +0.6 · −0.4 | user POMINĄŁ (potwierdzone 01.09) |

Wszystkie 3 technicznie wykonalne na XTB (Załącznik A, ułamki dostępne). Częstotliwość: ~1 kwalifikujący
sygnał/miesiąc. **Dziennik (REGUŁY §6 „obowiązkowy") nie istniał — założony dziś:**
[DZIENNIK-TRANSAKCJI.md](DZIENNIK-TRANSAKCJI.md). Luka w regułach: sizing przy kursie >1500 PLN/akcję
(ELV: 1 akcja = ~1350 PLN < min 1500, 2 akcje > max 2400) — korekta w dzienniku/regułach.

## 6. Decyzja (kontynuować / korygować / zwijać)

### KONTYNUOWAĆ (bez zmian zachowania sygnałowego)
- **Gra real**: werdykt ≠ „bez edge" → §5 REGUŁ nie uruchamia stopu. Kontynuacja jako **świadomy pomiar
  z kapitałem** przy EV realizowalnym ≈0 po kosztach, ~1 sygnał/mies. Reguły bez zmian poza sizingiem (§5).
- **Discovery**: obserwacja przedłużona, bez promocji.
- **APLS**: kohorta zostaje (koszt 0), osobny gate zdjęty.

### PRE-REJESTRACJA na **01.11.2026 — werdykt #2 + przegląd discovery #2** (wiążące od dziś)
1. **Statystyka alpha = MEDIANA** (oryginalny zapis gate'u APLS); średnia raportowana obok.
2. **Trzeci warunek każdej promocji: REAL** — mediana zwrotu `price1h → price7d` po 1% kosztów **> 0**.
   Bez tego surowy hit/alpha nie uzasadnia gry realnej (lekcja dzisiejsza: raw +4%, REAL 0%).
3. **Sub-gate C-suite** (rola z `insider_trades.insiderRole`, whitelist `isCsuiteRole`): przy **N≥10 zdarzeń**
   C-suite BUY w discovery+core, hit ≥60% ∧ mediana α ≥+2pp ∧ REAL>0 → promocja **tylko C-suite BUY**
   z discovery do delivery (🎯). Director-only BUY pozostaje w obserwacji niezależnie od wyniku C-suite.
   Dziś: 8 zdarzeń, wszystkie trzy warunki spełnione — brakuje N.
4. **Segmentacja FUND** = co-filer jest encją w nazwie (CAPITAL/FUND/LP/LLC/PARTNERS/ADVISORS/MANAGEMENT/
   HOLDINGS/TRUST), niezależnie od tagu „10% Owner". Kohorta FUND: N≥10 zdarzeń zanim cokolwiek.
5. **Benchmark**: dopisać capture **XLV** (instrumentacja); reguła przypisania: SIC 283x/2836 → XBI, pozostałe
   healthcare → XLV; alerty sprzed wdrożenia oceniane nadal vs XBI/IBB. Do 01.11 XBI pozostaje wiążący.
6. **Zdarzenia**: symbol + kierunek, łańcuch ≤7 dni (konwencja z tego werdyktu).
7. **Teczka**: stale-filing trap (CAI, latencja filingu 59 dni) — kryterium: jeśli do 01.11 ≥3 alerty z latencją
   >30 dni, policzyć osobno; inaczej zamknąć. Hipoteza reżimu IX-X: α byczych ≥+2pp med przy N≥12.
8. **Werdykt systemowy #2**: te same metryki + REAL; „bez edge" (stop gry wg REGUŁ §5) tylko jeśli klasa
   Form 4 BUY bez FUND ma hit <60% **lub** mediana REAL ≤ −1% przy N≥20 zdarzeń.

### KORYGOWAĆ (bugi i instrumentacja — dozwolone mid-window)
- **Bug: duplikaty alertów** na tych samych transakcjach (ELV ×2 delivered, SMMT ×2, THC SELL re-alert,
  PFE/KURA re-alert wcześniejszych BUY) — agregacja multi-tx (TASK-03) musi dedupować po accession/transakcji.
  Priorytet P1 (zawyża N i spamuje 🎯).
- **Bug: zamrożona cena** SEM #2441 (16.51 przez 7d — stale quote Finnhub) → guard: 5 identycznych slotów = flaga
  `price_frozen`, wykluczenie z metryk.
- **8-K Material Event GPT (1/7)**: propozycja przeniesienia do observation (oba kierunki) do N≥10 — nie jest
  grywalny wg reguł, więc zmiana dotyczy tylko szumu na Telegramie. **Decyzja usera.**
- **XTB Załącznik A**: sprawdzić dostępność tickerów discovery (KURA, PRE, MOBI, ABCL, IONS, REPL, BFLY, ELAN,
  BSX, PFE, CAI, ARTV, CBIO, PBLS) przed 01.11 — bez tego promocja C-suite byłaby pusta.
- **Nazwa reguły** „8-K Earnings Miss" → obejmuje beaty; kosmetyka przy najbliższej zmianie pipeline'u.

### ZWIJAĆ (propozycje — wymagają zgody usera, bo dotyczą prod DB / usunięcia kodu)
- `semi_supply_chain` obs (14 tickerów, zero danych od 04.2026).
- CorrelationService (3 wzorce martwe, audyt 02.07) i PDUFA (kolektor OFF, kalendarz wyschnięty).
- ~~APLS-obs~~ — **wycofane** (teza o redundancji fałszywa).

## 7. Anomalie danych (do naprawy, nie wpływają na decyzje po korekcie)
Duplikaty alertów (§0); SEM frozen quote; VRTX #2431 sell_no_edge z samych planów 10b5-1 (sprzed fixu P1-00
z 09.06 wieczór); CAI #2443 bez wiersza w roles (transakcja 15.05, filing 13.07 — latencja 59d); BFLY #2480
BUY $1.0M przy $21.4M SELL w oknie (sygnał mieszany alertowany jako BUY); KURA #2479/#2486 odstęp 7d 0h48m
(granica sklejania).

## 8. Co recenzja zmieniła w szkicu
- P0: „edge potwierdzony forward" dla klasy BUY → **nierozstrzygnięte** (alpha śr < 2, med > 2; CI raw kruchy).
- P0: sunset APLS jako „redundantne" → **wycofane** (kod pomija istniejące tickery).
- P0: dodana kolumna **REAL/NET** — odpowiedź dla gracza oparta na zwrocie osiągalnym, nie od close sprzed newsa.
- P0: tabela per reguła × kierunek (wymóg wpisu 01.09) — ujawniła C-suite/Director split i bearish 2.02.
- P1: przekaz na 07.09 z pełnego query (gate nie odpala), nie z jednej podklasy; trzy kolumny w każdej bramce;
  delivered rozbite na „selekcja" vs „grywalne"; FUND z/bez stale; 8/16 non-biotech (nie 7/16); dziennik.
