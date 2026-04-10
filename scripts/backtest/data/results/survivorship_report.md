# Survivorship Bias Check — Sprint 15 Backtest

> Wygenerowane: 2026-04-10 | Pełny scan SEC EDGAR (10107 listed companies)

## Pytanie

Czy nasze 42 hardcoded healthcare tickery w `scripts/backtest/config.py` to lista cherry-picked giants czy reprezentatywna próbka healthcare universe?

## Metodologia

1. Pobrano `company_tickers_exchange.json` z SEC: **10 107 companies** (NYSE/Nasdaq/OTC).
2. Dla każdej firmy: `submissions.json` → SIC code + sprawdzenie czy filowała Form 4 w **Q1 2023** (styczeń–marzec).
3. Filtr: SIC w {2833, 2834, 2835, 2836, 3841, 3842, 3843, 3845, 8000, 8011, 8060, 8062, 8071, 8090, 8731} (healthcare).
4. Porównanie z 42 hardcoded tickerami.
5. Czas: ~40 minut, 8 req/s, cache lokalny.

## Wynik

| Metryka | Wartość |
|---------|---------|
| **Healthcare companies aktywne w Q1 2023** | **743** |
| **Z naszych 42 — pasujące do filtra** | **24** |
| **Pokrycie SEC healthcare universe** | **3.2%** |
| Z naszych 42 — niepasujące | 18 |
| Brakuje z naszej listy | 719 |

## Status każdego z 42 tickerów

### ✓ Przeszło filtr (24)
healthcare SIC + filował Form 4 w Q1 2023:

`HCA, THC, UHS, SEM, HIMS, TDOC, ISRG, DXCM, PODD, IRTC, INSP, ABBV, BMY, GILD, MRNA, REGN, VRTX, BIIB, AMGN, LLY, JNJ, PFE, MRK, RPRX`

### ✗ Niepasujące (18)

| Ticker | Powód | Komentarz |
|--------|-------|-----------|
| UNH | SIC=6324 | Hospital & Medical Service Plans (insurance) |
| ELV | SIC=6324 | Insurance |
| HUM | SIC=6324 | Insurance |
| CNC | SIC=6324 | Insurance |
| MOH | SIC=6324 | Insurance |
| CI | SIC=6324 | Insurance |
| OSCR | SIC=6324 | Insurance |
| MCK | SIC=5122 | Drug wholesalers |
| CAH | SIC=5122 | Drug wholesalers |
| ENSG | SIC=8051 | Skilled nursing |
| DOCS | SIC=7371 | Computer services |
| GDRX | SIC=7374 | Computer services |
| AZN | brak Form 4 Q1 2023 | UK pharma — filing inny system |
| NVO | brak Form 4 Q1 2023 | Duńska pharma |
| SNY | brak Form 4 Q1 2023 | Francuska pharma |
| ABC | brak w SEC list | Cencora (rebrand 2023) |
| ACCD | brak w SEC list | Delisted/przejęte |
| SWAV | brak w SEC list | Delisted/przejęte |

## Sample 30 healthcare tickerów aktywnych w Q1 2023, których NIE MAMY

```
MMM    3M CO                              SIC 3841   medical devices
ABT    ABBOTT LABORATORIES                SIC 2834   pharma
ALGN   ALIGN TECHNOLOGY                   SIC 3842   medical devices
ALNY   ALNYLAM PHARMACEUTICALS            SIC 2834   biotech
EW     EDWARDS LIFESCIENCES               SIC 3842   medical devices
RMD    RESMED                             SIC 3841   medical devices
+ ~480 mniejszych biotech (ABEO, ACAD, ADMA, AGEN, AGIO, ALXO, AMRN...)
+ ~200 mid-cap pharma / med devices
```

## Interpretacja

### To NIE jest pure survivorship bias

Nasz check porównuje listę aktywnych w 2023 z listą aktywnych dziś. Pure survivorship wymaga listy tickerów które były aktywne w 2023 ale **dziś nie istnieją** (delisted, bankrupt, acquired). Tego nie sprawdziliśmy bo SEC nie udostępnia historycznej listy.

### To JEST selection bias (cherry picking)

**Pokrycie 3.2% (24/743)** oznacza że nasza lista 42 tickerów to **starannie wybrane large-cap pharma + zauważone biotech**, nie reprezentatywna próbka healthcare universe.

Co to znaczy dla wniosków Sprint 15:

1. **Insider BUY edge d=0.43** mierzony jest na **large-cap healthcare**, nie na całym sektorze. Większość insider BUY w mniejszych biotechach to **inne sygnały** (founder buying przed catalyst, czasem manipulacja, czasem desperate retail-like move).

2. **C-suite BUY d=0.83** prawdopodobnie zawyżone — w large-caps C-suite BUY jest rzadkie i ma materialne uzasadnienie. W mid/small-cap insider BUY jest częstsze i bardziej szumowe.

3. **Sample 480+ brakujących** to dokładnie ta klasa firm w której insider trading jest najbardziej informacyjny w literaturze (Cohen-Malloy-Pomorski 2012 — efekt jest najsilniejszy w mid-cap).

4. **Healthcare boost ×1.2** może być za niski — jeśli edge faktycznie istnieje w mid-cap biotech, powinien być silniejszy tam niż w large-caps.

### Co to NIE znaczy

- Edge **nie znika**. d=0.43 to wciąż realna metryka dla zdefiniowanego universe.
- Backtest nie jest "fikcją". Jest testem na konkretnej, wąskiej liście firm.
- Insider BUY rule może nadal działać live — ale tylko dla tych 24 tickerów (lub szerszej listy z tej samej klasy).

### Co to znaczy operacyjnie

- **Generalizacja na nowy ticker spoza listy 42 to ekstrapolacja**, nie predykcja.
- Jeśli system wygeneruje alert na np. AGIO (mid-cap biotech) to **nie wiemy** czy d=0.43 się utrzymuje.
- BUY rule warto ograniczyć do **24 zwalidowanych tickerów** w live trading albo zaznaczyć że tickery spoza tej listy mają niższą pewność.

## Co dalej (rekomendacje, kolejność)

### Priorytet 1: Re-run backtestu na rozszerzonym universe

Dodać top 200 healthcare tickerów (mid-cap) i powtórzyć Sprint 15:

```python
# Wybierz 200 z największych 743 healthcare companies (po market cap)
EXTENDED_HEALTHCARE = [...]  # 24 obecnie + 176 nowych
```

Sprawdzić czy d=0.43 utrzymuje się w rozszerzonym universe. Hipotezy:
- **Hipoteza A**: edge utrzymuje się (d=0.30-0.45) → backtest jest robust
- **Hipoteza B**: edge spada do d=0.10-0.20 → był specyficzny dla large-cap
- **Hipoteza C**: edge rośnie do d=0.5+ → mid-cap są bardziej informacyjne (zgodne z literaturą)

### Priorytet 2: Survivorship test na delisted tickerach

Pociągnąć z SEC EDGAR listę CIKs które filowały Form 4 w Q1 2023 ale **nie są** w current `company_tickers_exchange.json`. To są firmy które:
- Zostały delisted (bankructwo, slump)
- Zostały przejęte (M&A)
- Zmieniły ticker

Dla healthcare: zwykle 5-15% per rok. W 3 latach: ~15-30% delisted/acquired.

### Priorytet 3: Acknowledge w dokumentacji

Dodać do `scripts/backtest/data/results/backtest_summary.md` sekcję "Limitations":
- Backtest na 24 tickerach (large-cap healthcare), nie na całym universe.
- d=0.43 mierzony na cherry-picked sample.
- Forward test na nowym tickerze = ekstrapolacja.

## Pliki

- `data/results/survivorship_v2.json` — pełne wyniki (raw)
- `data/survivorship_cache/` — cache 7800+ SEC submissions.json (do reuse)
- `survivorship_v2.py` — skrypt generujący ten raport
