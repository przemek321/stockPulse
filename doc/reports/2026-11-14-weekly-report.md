# StockPulse — podsumowanie tygodnia 07–14.11.2026

> Liczby z zapytań SELECT do bazy prod, logów kontenerów i `logs/*.log`, 14.11.2026 ~22:40 PL.
> Poprzedni punkt odniesienia: [podsumowanie 11–18.10](2026-10-18-weekly-report.md) (po drodze: werdykt #2 01.11, migracja na Pi 07.11).
> **Żadna pozycja poniżej nie jest sygnałem do gry** — stop gry real obowiązuje od 01.11, tydzień bez dostarczonego alertu.

## 1. Sygnały

| | ten tydzień (07–14.11) | poprzedni (31.10–07.11) | 30 dni |
|---|---|---|---|
| alerty w bazie | **4** | 4 | 16 |
| dostarczone na Telegram | **0** | 1 (MRNA 8-K) | 1 |

Ostatni dostarczony alert: **MRNA 06.11** (8-K wyniki, nie Form 4 — wynik w sekcji 2). Ostatni alert kwalifikujący 🎯
(dostarczony Form 4 Insider BUY): **PODD 24.08** (82 dni). Cztery alerty tygodnia, wszystkie DB-only:

- **#2531 HIMS, pon 09.11 po sesji** — 8-K Item 5.02 (nowy członek rady + umowa doradcza), GPT pozytywnie → stłumiony
  `bullish_8k_no_edge`.
- **#2532 HIMS, pon 09.11 po sesji** — 8-K Item 2.02, wyniki Q3: przychody +49% r/r, ale EPS −0,37 wobec szacunku −0,01,
  marża brutto 74% → 57%, obniżona prognoza. GPT: CRITICAL, negatywnie → stłumiony `consensus_miss`.
  **Kurs: 22,94 → 19,42 na otwarciu we wtorek (−15,3%)**, po 3 dniach 19,48. Kierunek trafiony, ale cały ruch to luka
  na otwarciu — short od pierwszej osiągalnej ceny dałby ok. −0,3%. Szczegóły dla przeglądu 15.11 w sekcji 3.
- **#2533 HUM, czw 12.11 w sesji** — Form 4 SELL, CLO Joseph Ventura, 5 495 akcji za $2,38M, bez planu 10b5-1 (~20% jego
  pakietu) → `sell_no_edge`. Po 1 dniu kurs +1,0% (438,01 → 442,56), czyli przeciw sygnałowi.
- **#2534 MOH, pt 13.11 po sesji** — Form 4 SELL, CLO Jeff Barlow, 8 000 akcji za $1,62M, bez planu; GPT odnotował
  równoległą sprzedaż dwóch dyrektorów → `sell_no_edge`. Brak jeszcze cen po alercie.

**Rdzeń (33 tickery)**: 79 transakcji insiderów zebranych w tygodniu — 29 EXERCISE, 17 TAX, 16 GRANT, 12 SELL
(4 z planu 10b5-1, 8 dyskrecjonalnych), 5 GIFT, **0 BUY**. Licznik werdyktu #3 (`W3`, core+rdzeń+ od 01.11) stoi na
**N=0/10 po dwóch tygodniach**; przy takim tempie 01.02.2027 wypadnie N<5, czyli warunek „sunset gry".

**Discovery (26 tickerów, bez nowych rejestracji)**: 10 transakcji BUY, żadna nie dała alertu:

| ticker | kto | wartość | decyzja systemu |
|---|---|---|---|
| ABCL | Thermopylae Holdings (10% Owner, fundusz) | $699K | GPT → niski priorytet, bez alertu |
| ABCL | Andrew Booth (CFO) | $97K | poniżej progu $100K |
| ATEC | Keith Valentine (Director) | $243K | Director-only wyłączony od 02.11 |
| IONS | Michael Hayden (Director) | $148K | Director-only wyłączony od 02.11 |
| ENOV | 2 osoby z rady (Director), 6 transakcji po ~$25K | $150K łącznie | poniżej progu |

## 2. Domknięte outcome'y (7d) — dane do przeglądów, nie sygnały

Trzy alerty z poprzedniego tygodnia dostały w tym tygodniu cenę 7d:

| alert | wysłany (NY) | kierunek | priceAtAlert | 1h (otwarcie) | 7d | raw 7d | α vs XBI | α vs XLV | REAL od otwarcia |
|---|---|---|---|---|---|---|---|---|---|
| #2527 HCA 8-K (obs) | czw 05.11 16:35, po sesji | negatywny | 507,48 | 494,58 | 503,73 | −0,7% | −1,3 pp | −2,5 pp | **+1,9%** (przeciw shortowi) |
| #2528 HUM 8-K (stłumiony) | pt 06.11 06:36, pre-market | pozytywny | 411,79 | 424,15 | 443,31 | +7,7% | +7,1 pp | +5,9 pp | **+4,5%** |
| #2529 MRNA 8-K (**dostarczony**) | pt 06.11 07:05, pre-market | pozytywny | 241,46 | 260,49 | 230,86 | −4,4% | −5,0 pp | −6,2 pp | **−11,4%** |

- **MRNA** — jedyny dostarczony alert od 24.08 — przegrał: otwarcie +7,9% powyżej ceny alertu (audytor:
  `ENTRY_GAP_UNENTERABLE`), a potem zjazd o 11,4% od otwarcia. Nie był to alert kwalifikujący do gry (reguły: tylko
  Form 4 Insider BUY), więc bez wpływu na dziennik.
- **HUM** — bramka `bullish_no_consensus_data` tym razem wycięła trafny sygnał (+4,5% od otwarcia). To kolejny przypadek
  do sub-hipotezy z przeglądu bullish-8K (próg N≥10).
- **HCA** — po luce −2,5% na otwarciu kurs odbił; short od otwarcia na minusie.
- #2530 HCA (Form 4 SELL, pt 06.11 po sesji, `sell_no_edge`) czeka na cenę 7d; po 3 dniach kurs +1,9% (przeciw sygnałowi).

To te same wnioski co w werdyktach: ruch robi się na otwarciu, od osiągalnej ceny edge znika albo się odwraca.

## 3. Bramki i przegląd 15.11

**Jutro (nd 15.11) wypada przegląd FIX-16 shadow #2 + bullish-8K #2.** Dane, które doszły:

- **FIX-16 shadow**: łącznie 8 zapisów, **2 z `would_uncap=true` — oba HIMS** (10.08 i 09.11). Od przeglądu #1 (25.08)
  doszły dwa zapisy: ABBV 05.10 (false) i HIMS 09.11 (true: conviction przed capem −1,2, po capie −0,3). Próg przeglądu
  to N≥3, więc nadal poniżej. Jak w sierpniu: sam uncap nie dostarczyłby alertu, bo i tak stłumił go `consensus_miss`,
  a ruch −15% był w całości luką.
- W tym samym zapisie HIMS pole `revenue_surprise_pct` = +329%, choć GPT podaje przychody ~22% powyżej szacunku —
  wygląda na niezgodność jednostek w danych konsensusu. Do sprawdzenia przy przeglądzie; niczego nie zmieniałem.
- **Sub-gate C-suite #2** (`logs/csuite-gate.log`, 13.11): **T1 N=6/10** — hit 50%, med α +2,07 pp, med REAL −8,10%,
  wchodzalne 1/6 (N jak 01.11). **T2 N=4/10** — hit 25%, med REAL −5,91%, wchodzalne 3/4. Log na Pi zaczyna się po migracji,
  więc starszych odczytów T2 do porównania tu nie ma.
- **ME8K** (8-K Material Event, od 01.09): N=6/10, hit 67%, med REAL −0,95%.

## 4. Agent-audytor

747 ticków CRON w tygodniu, **0 błędów**. Zaudytowane wszystkie trzy domknięte alerty (#2527–2529): 2× `ENTRY_GAP_UNENTERABLE`
P2 (HUM +3,0%, MRNA +7,9%) i 3× `POST_CLOSE_8K_ENTRY_PRICE` (w tym MRNA jako P2). Wszystkie zgodne z cenami w tabeli wyżej.
W bazie łącznie 78 zaudytowanych alertów.

## 5. Infrastruktura

| element | stan |
|---|---|
| host (Pi 5) | up 4 d 22 h (restart 09.11 wieczorem), 48,8°C, RAM 2,7/8 GB, dysk 28/458 GB (7%) |
| kontenery | postgres/redis/frontend Up 4 d, restarts 0; app przebudowany dziś 22:35 (raport tygodniowy), healthy |
| health | `healthy`; SEC_EDGAR ostatnia kolekcja dziś; REDDIT/PDUFA `isHealthy=false` to stan znany |
| kolektory | 380 cykli SEC core, wszystkie SUCCESS; zebrane 70× Form 4, 21× 8-K, 17× 10-Q, 2× Form 3 |
| discovery | 1042 polle, 11 nieudanych (1,1%): 6× `fetch failed` 10.11 w ciągu 5 minut, 5× `FETCH_TIMEOUT` 13–14.11; każdy następny poll OK |
| GPT (most `claude -p`) | 9 analiz (6× 8-K, 3× Form 4), 11 odpowiedzi OK, 0 błędów; po restarcie 09.11 most wstał po ~5 min (watchdog) |
| system_logs 7d | 2680 info, 5 warn, 6 error — wszystkie z discovery (wyżej) |
| Uptime Kuma | StockPulse API, most i 5 kontenerów ≥99,99%; czujnik pogodynki LB-489 74% (jego „Parse Error" — poza StockPulse) |
| backup | off-site z 08.11 pominięty (limit 45 MB); poprawka z 10.11 czeka na pierwszy prawdziwy przebieg **nd 15.11 03:15** |
| dip research | 5/5 przebiegów pn–pt, raporty wysłane (NIE-sygnały) |
| Telegram | raport 8h wyłączony 14.11 → raport tygodniowy w niedzielę 18:00 PL (pierwszy 15.11) |
| kod | 8 commitów w tygodniu (3 backtesty, 13D, fix CPU%, fix backupu, raport tygodniowy, ten raport); `main` **8 commitów przed `origin/main`** — push czeka |
| gra real (XTB) | stop od 01.11, brak transakcji |

## 6. Co dalej

- **nd 15.11**: przegląd FIX-16 #2 + bullish-8K #2 (sekcja 3); rano sprawdzić `TELEGRAM OK` w `logs/backup-weekly.log`;
  o 18:00 pierwszy raport tygodniowy.
- **Push**: 8 commitów leży tylko na malinie.
- **01.02.2027**: werdykt #3 — licznik W3 na razie 0/10.

## Czego NIE zweryfikowałem

- Prawdziwej wysyłki raportu tygodniowego (pierwszy CRON 15.11 18:00) — sprawdzone testami i tym, że po rebuildzie nie
  wyszła żadna wiadomość.
- Prawdziwej wysyłki backupu off-site po poprawce (tylko test na sucho 10.11).
- Przyczyny `revenue_surprise_pct` = +329% w zapisie HIMS — odnotowane, nie analizowane.
- CI na GitHubie — commity nie są wypchnięte.
