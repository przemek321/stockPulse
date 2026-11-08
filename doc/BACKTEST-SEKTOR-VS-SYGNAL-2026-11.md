# Backtest: sektor czy sygnał — insider BUY poza healthcare (08.11.2026)

**To jest backtest, NIE sygnał i NIE zmiana reguł gry.** Pre-rejestracja:
[TECZKA-SEKTOR-VS-SYGNAL](TECZKA-SEKTOR-VS-SYGNAL-2026-11-08.md) — sekcja „Poprawka planu (v2)" (po niezależnej recenzji)
+ „A3.5" (N i MDE zapisane PRZED liczeniem). Liczby z `scripts/backtest/data/results/sector_results.json`
(tabele: `sector_tables.md`, MDE: `sector_mde.json`).

## Pytanie

Backtest [HORYZONT](BACKTEST-HORYZONT-30-60-90-2026-11.md) dał dla healthcare na 90d wynik POZYTYWNY. Czy to efekt
ogólny insider BUY (działa też w innych sektorach), czy specyficzny dla healthcare / naszej listy tickerów?

## Werdykt wg reguł spisanych z góry

**Test główny SEMI × 90d: INSUFFICIENT_N → reguła R3.** W 14 tickerach semi przez 3,5 roku jest tylko **22 wierszy BUY**
(przy 6 580 SELL) → **8 epizodów** (próg: 15). Insiderzy spółek semi prawie nie kupują akcji na rynku — pytanie
„sektor czy sygnał" dla semi jest **nierozstrzygalne z danych**, a nie „nierozstrzygnięte przez pech". MDE dla SEMI
wynosiło 41 pp — przy takim N nie da się wykryć niczego realistycznego.

Pozostaje opis na grupie kontrolnej (25 large-capów spoza healthcare) — **częściowo odślepionej** (kierunek był
widoczny w tabeli HORYZONT vs SPY), więc wyłącznie opisowo.

## Wyniki — benchmark główny: ETF sektora/podsektora

| Grupa | Epizody 90d | Śr NET 90d | Med NET 90d | Hit | p perm | CI95 (bootstrap klastrowy) |
|---|---|---|---|---|---|---|
| HC (healthcare, = HORYZONT G1) | 47 | **+12,85** | **+4,87** | 62% | 0,0001 | [+3,45; +25,60] |
| CTRL (25 large-capów) | 25 | +0,81 | +0,40 | 56% | 0,59 | [−3,44; +3,81] |
| SEMI (14 semi) | 8 | +14,95 | +3,24 | 50% | 0,27 | [−4,88; +28,15] |

NET = zwrot od otwarcia sesji po filingu do zamknięcia 63. sesji − zwrot ETF (te same daty) − 1 pp kosztu.
ETF: HC jak w HORYZONT (IHF/IHI/IBB/XLV); CTRL — XLK/XLC/XLY/XLF/XLP/XLE/XLI wg sektora; SEMI — SOXX (półprzewodniki)
lub XLK (sprzęt IT/OEM).

**Różnica w różnicach D vs HC (90d)** — efekt zdarzeń ponad losowe dni tej samej grupy, minus to samo dla HC; p ze
wspólnego przesunięcia kalendarza:

| | D | p (dwustronne) | CI95 |
|---|---|---|---|
| CTRL − HC | **−14,31 pp** | 0,0001 | [−27,58; −4,32] |
| SEMI − HC | −4,53 pp | 0,83 | [−28,62; +12,31] |

Krótsze horyzonty (opisowo, ETF): CTRL med 7d +0,08 / 30d +1,45 / 60d +1,20 · SEMI med 7d −0,23 / 30d +4,09 / 60d +15,79.

### Odporność

- **vs SPY** (wszystkie grupy): HC 90d śr +11,03 / med +3,24 (p 0,0001) · CTRL +2,49 / +2,51 (p 0,37) · SEMI +21,07 /
  +13,40 (p 0,26, N=8 — beta semi w hossie AI). D(CTRL−HC) = −13,35 pp, p 0,011.
- **Post-hoc (NIE pre-rejestrowane):** D(CTRL − HC bez HIMS i OSCR) = **−10,01 pp, p 0,11**, CI95 [−18,72; −3,03];
  mediana HC bez nich +3,79 vs CTRL +0,40. Bez dwóch największych zwycięzców różnica traci istotność permutacyjną —
  kierunek zostaje.

## Co z tego wynika

1. **Na pytanie dla semi nie ma odpowiedzi i jej nie będzie** — 8 epizodów w 3,5 roku; forward dałby ~2/rok.
2. **Opisowo: efekt nie przenosi się na large-capy spoza healthcare.** Kontrola vs swoje ETF-y ≈ 0 (med +0,4 pp,
   CI do +3,8 pp), istotnie poniżej HC (D −14 pp). To kierunek „efekt specyficzny" — ALE:
   - kontrola to mega-capy (AAPL, MSFT, CAT…), HC to w dużej części small/mid-capy (HIMS, OSCR, TDOC, GDRX) —
     **nie da się oddzielić „healthcare" od „wielkość spółki"**;
   - CTRL był częściowo odślepiony; po wyjęciu HIMS i OSCR p różnicy = 0,11.
3. **Praktycznie bez zmian:** forward-test HC 90d (hipoteza z HORYZONT) zostaje; brak podstaw do rozszerzania
   sygnału na inne sektory; reguły gry i produkcja bez zmian.

## Dane i kontrole

- Form 4 semi z EDGAR 04.2023 → 07.11.2026: 3 401 filingów, 14 965 wierszy, 0 nieudanych. FPI (CAMT, NVMI, ASX)
  — 11/22/34 filingów, 0 BUY. Healthcare + kontrola — plik v6 z HORYZONT (nietknięty, sha256 sprawdzone).
- Czyszczenie (łącznie 60 195 wierszy): cudzy emitent 1 982 · BUY 223 · plan 10b5-1 5 · same fundusze 15 ·
  duplikaty treści 14 · **korekta splitów 5** (SMCI sprzed 10:1) · cena skorygowana 1 · wykluczone 0 → 189 wierszy.
- Epizody SEMI: AMKR 26.02.2025 ($19,0 mln) i 05.08.2025 ($9,6 mln) — rodzina założyciela (Kim), stała cena 21,85
  (wygląda na transakcję strukturalną, nie zakup z rynku); KLIC 05.2024 ($48 tys.); MU 01.2026 ($7,8 mln, Director);
  NTAP 03.2025 ($0,5 mln); SMCI 05.2023, 08.2023, 02.2024 (Director, $0,5–1,1 mln). Opóźnienia filing − transakcja
  0–4 dni (także SMCI).
- WDC: spin-off Sandisk 24.02.2025 skorygowany przez Yahoo (−5,6% w dniu, współczynnik 1,323) — epizodów nie wykluczano.
- Weryfikacja: regresja — nowy kod na danych HORYZONT odtwarza `horizon_results.json` bajt w bajt (0 różnic);
  ręczne przeliczenie 4 epizodów (AMKR ×2, KLIC, CAT) zgodne co do 0,0001 pp; 28 nowych testów
  (`tests/test_sector_backtest.py`), mutacje 10/10 wykryte; cały pakiet 159 passed.

## Część B (naprawa obserwacji semi w produkcji) — odrzucona

Uzasadnienie w teczce (v2): „jedna linia" przy `form4.pipeline.ts:293` wymagałaby zmian promptu (na sztywno
„Healthcare"), guardu korelacji (po `suppressedBy`, nie sektorze), watchera discovery; dałaby wiersze selekcjonowane
przez GPT, tylko do 7d i bez benchmarku semi — przy ~2 BUY/rok. **Forward = ponowne uruchomienie tego backtestu**
z późniejszym `BT_END_DATE` (informacyjnie, przy werdykcie #3 01.02.2027). Produkcja bez zmian.

## Ograniczenia

Survivorship i look-ahead (listy tickerów z 2026, semi wybrane po hossie AI); jeden reżim rynku (2023–2026);
CTRL częściowo odślepiony; zdarzenia w grupach skupione (CAT 6/25 w CTRL); różnica wielkości spółek HC vs CTRL.

## Odtworzenie

```bash
cd scripts/backtest
BT_UNIVERSE=semi BT_END_DATE=2026-11-07 .venv/bin/python -c "from edgar_fetcher import fetch_all_form4; fetch_all_form4(True)"
.venv/bin/python sector_backtest.py prices && .venv/bin/python sector_backtest.py validate
.venv/bin/python sector_backtest.py mde && .venv/bin/python sector_backtest.py run
```
