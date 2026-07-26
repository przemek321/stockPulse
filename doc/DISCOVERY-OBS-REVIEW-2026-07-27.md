# Przegląd okna obs discovery — werdykt (wykonany 27.07.2026, termin 25.07)

> Gate z [KALENDARZA](KALENDARZ-WALIDACJI-2026.md): decyzja delivery **top-N** /
> przedłużenie obs / korekta filtrów + przycinanie uniwersum. Kohorta
> `healthcare_discovery` (Pakiet 2, start 10.06). Metryki wg pre-rejestracji 02.07
> (hit = raw, alpha = osobne kryterium; EYE/COR/CAI non-biotech → alpha XBI = dolne ograniczenie).

## Werdykt: **BEZ promocji do delivery** — obserwacja przedłużona do werdyktu 01.09

### Dane (N=5 alertów z kompletem 7d; wszystkie DB-only observation)

| id | Ticker | Data | Trigger | raw 7d | α XBI 7d | α IBB 7d | XBI w oknie |
|---|---|---|---|---|---|---|---|
| 2432 | EYE | 10.06 | Nicholson Dir $776K | +2.86% | −3.03pp | −0.00pp | +5.9% |
| 2434 | SMMT | 12.06 | Duggan Co-CEO $50M | +3.44% | −5.11pp | +0.00pp | +8.6% |
| 2435 | SMMT | 12.06 | Zanganeh Co-CEO $50M | +0.79% | −7.86pp | −2.66pp | +8.7% |
| 2440 | COR | 22.06 | Durcan Dir $1.10M | +3.20% | −5.10pp | −3.97pp | +8.3% |
| 2443 | CAI | 13.07 | Halbert Dir $990K | **−4.83%** | −1.91pp | −3.62pp | **−2.9%** |

**Zbiorczo**: hit raw 7d **4/5 (80%)**, śr. +1.09% / med. +2.86%; alpha XBI **0/5** (śr. −4.60pp);
alpha IBB **0/5 realnie** (jedyny „plus" to +0.002pp SMMT = zero). Pop-and-fade w 4/5 (ret3d > ret7d;
EYE fade −10.9pp).

### Uzasadnienie odmowy promocji

1. **Zero dowodu alpha w żadnym segmencie**: SMMT (biotech klin.) śr. −6.5pp, EYE+COR (non-biotech,
   dolne ograniczenie) śr. −4.1pp, ale i vs IBB wszystko ≤0 — benchmark mismatch nie tłumaczy całości.
2. **Test zmiany reżimu wypadł źle**: pierwsze 4 okna to rajd XBI (+6–9%) — raw hity mogły być betą.
   Jedyny alert zmierzony w reżimie spadkowym (CAI, XBI −2.9%) przegrał **i na raw (−4.83%), i na alpha**.
   Teza „raw hit = beta rajdu, nie edge" się wzmocniła.
3. Promocja teraz = dostarczanie sygnałów przegrywających z ETF-em sektora — wprost przeciw celowi
   „1 alert/tydzień z realnym edge".

Decyzja spójna z APLS (10.07): kohorta mierzy dalej do werdyktu 01.09, delivery nie włączamy.
Nie jest to „fail hipotezy discovery" — N=5, jeden reżim rajdu + jeden punkt spadkowy.

### Zmiana profilu kohorty — segmentacja obowiązkowa od tego przeglądu

Kohorta urosła do **7 tickerów**, ale nowe rejestracje zmieniły charakter:

- **Sub-kohorta OSOBOWA** (trigger: osoba C-suite/Director): EYE, COR, CAI (+SMMT z zastrzeżeniem
  controlling-owner >73%). To klasa zwalidowana backtestem V5.
- **Sub-kohorta FUNDUSZOWA** (trigger: fundusz 10% Owner co-filing): **CBIO** (Fairmount $20.0M),
  **ARTV** (RA Capital $1.43M), **PBLS** (RA Capital $6.92M) — 3/4 nowych rejestracji w lipcu.
  Wzorzec „osoba+fundusz" = dokładnie fikcyjny klaster OSCR z weryfikacji H7. **Backtest V5 NIGDY
  nie testował BUY funduszy** — to inna hipoteza. W analizach (w tym werdykt 01.09) te sub-kohorty
  liczyć OSOBNO; pre-filtra nie zmieniamy (obserwacja jest tania, dane o nowej klasie cenne).

### Bug znaleziony przy przeglądzie (naprawiony w tym samym commicie)

**DATA GAP CBIO/ARTV/PBLS**: INSERT do `insider_trades` padał na `value too long for varchar(100)` —
sklejone nazwy co-filerów funduszy przekraczały limit kolumny `insiderName`. Efekt: 3/7 tickerów
kohorty bez trade'ów i bez alertów obs (5 accessionów; dedup w `sec_filings` blokuje samonaprawę).
Fix: kolumna 255 + defensywne przycięcie w parserze. **Odzysk danych wymaga ręcznego DELETE
5 wierszy z `sec_filings`** (re-processing przez kolektor) — decyzja usera (zasada: pytać przy
DELETE na prod). UWAGA: odzyskane alerty będą miały `priceAtAlert` z dnia re-processingu
(nie 20–22.07) — odnotować przy analizie.

### Hipotezy do teczki (bez zmian w kodzie)

- **Stale-filing trap (CAI)**: transakcja 15.05, filing 13.07 (latencja ~2 mies.), cena alertu
  +16.7% nad ceną insidera — sygnał przeterminowany w chwili alertu. Kandydat na guard
  „max latencja filingu / max premia nad ceną insidera" — do rozważenia przy werdykcie 01.09.
- **Strefa mcap $100–250M przestała być pusta**: VANI ($122M, Dir+10%Own $1M) — pierwszy odrzut
  w strefie (w czerwcu tylko mikrocapy $10–19M). Hipoteza small-cap zaczyna być mierzalna.
- Klaster COR (2 BUY w 4 dni) nie był kontynuowany — od 29.06 same GRANTy.

### Kondycja operacyjna funnela (02–27.07)

7 kandydatów po pre-filtrze (~3.3/tydz., górny zakres projektu), 3 odrzuty — wszystkie na mcap
(VANI 122M, CRDF 61M, ZSTK 11M), 0 na ADV; 4 rejestracje. Warn-rate polli **1.3–1.7%** (spadek
z ~3.7% w czerwcu); reconciliation 22:40 ET regularne; Redis samoczyszczący (TTL). Okres
02–10.07 nierekonstruowalny (restart kontenera uciął logi) — znana luka observability,
odrzuty nadal tylko w logach kontenera.

## Stan szerszej walidacji (przy okazji przeglądu)

- **DELIVERED ≠ 0**: 2× ELV Form 4 Insider BUY delivered 17.07 (CRITICAL, ze znacznikiem 🎯).
  Pierwszy (#2446) z kompletem 7d: raw +2.4%, **alpha XBI +4.6pp** — pierwszy delivered
  z dodatnią alphą. Drugi (#2447) w pomiarze.
- Bilans maskowanych bullish (5 zmierzonych): śr. **−6.1pp** alpha — gate'y per saldo bronią
  kapitału. ISRG (beat EPS +9.8%, kusił 16.07): **−16.9% raw / −15.9pp alpha w 7d** — tłumienie
  i dyscyplina uratowały duży minus. Kosztowny nadal tylko ABBV (M&A). MOH 22.07 i THC 23.07 w pomiarze.
- Tempo: ~2.9 alertu/tydz.; projekcja ~26–29 z kompletem 7d na cutoff 22–24.08 — werdykt 01.09
  będzie miał dane w celu 20–30.
- FIX-16 shadow: 2 wpisy (HCA, ENSG), **0× would_uncap** — gate przeglądu 25.08 (N≥3) nie zbliża
  się do spełnienia mimo sezonu Q2 → ~15.08 zaplanować przesunięcie review.
- APLS: nadal 0 BUY — licznik Fazy 4 nie wystartował.
