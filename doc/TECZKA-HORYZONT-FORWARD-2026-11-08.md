# Teczka: HORYZONT — pomiar w przód (forward) Form 4 BUY healthcare × 90 dni (08.11.2026)

**Status: AKTYWNA — pomiar trwa (ślepo).** Kryteria spisane 08.11.2026, **zanim powstał pierwszy epizod forward**
(dane backtestu kończą się 07.11.2026). Droga 1 (decyzja usera 08.11): **okresowe ponowne uruchomienie backtestu
offline, zero zmian w pomiarze produkcji** (jedyna zmiana w aplikacji: przypomnienia o przebiegach w raporcie 8h). To NIE sygnał i NIE zmiana reguł gry — stop gry real (REGUŁY §5) obowiązuje
niezależnie od tej teczki.

## Skąd hipoteza

[Backtest HORYZONT](BACKTEST-HORYZONT-30-60-90-2026-11.md) (08.11.2026): Form 4 BUY w 28 tickerach healthcare
(G1), epizody, wejście na otwarciu sesji po filingu, wyjście po 63 sesjach (≈ 90 dni), NET vs ETF podsektora − 1 pp →
**POZYTYWNY**: 47 epizodów, śr NET +12,85 pp, mediana +4,87 pp, p 0,0001. Ale to ten sam okres, na którym pomysł
powstał (in-sample), a zadanie 2 ([sektor czy sygnał](BACKTEST-SEKTOR-VS-SYGNAL-2026-11.md)) pokazało, że na
large-capach spoza HC efektu nie ma, a bez HIMS/OSCR różnica traci istotność. **Forward rozstrzyga, czy to efekt,
czy artefakt okresu 2023–2026.**

## Kryteria (pre-rejestracja — nie zmieniać po pierwszym epizodzie forward)

**Metoda = HORYZONT 1:1** (ten sam kod `horizon_backtest.py`, zamrożony), z dwiema zmianami ustalonymi teraz:

- **Uniwersum:** te same 28 tickerów G1 (`HEALTHCARE_TICKERS` w `config.py`; SEM zdelistowany → zero epizodów).
  Rdzeń+ (PFE BSX COR ELAN COO SMMT) i discovery **poza testem** — inna populacja niż ta, z której wyszła hipoteza.
- **Epizod forward:** epizod G1, którego **pierwszy** filing ma datę ≥ **08.11.2026**. Epizod zaczęty wcześniej
  i ciągnięty przez filingi po 08.11 należy do in-sample (nie liczy się).
- **Korekta splitów włączona** (`clean_transactions(..., splits)` z zadania 2) — w HORYZONT bez znaczenia
  (0 korekt w HC), w forward chroni regułę ceny przed splitem w trakcie pomiaru.
- Bez zmian: wejście = otwarcie 1. sesji po dacie filingu; wyjście = zamknięcie 63. sesji; NET = zwrot − zwrot ETF
  (IHF/IHI/IBB/XLV wg mapy HORYZONT) − 1 pp; scalanie filingów ≤ 5 sesji; czyszczenie (emitent = ticker, 10b5-1,
  same fundusze, duplikaty, reguła ceny). Liczy się **tylko epizod z pełnym horyzontem 63 sesji**.

**Spojrzenia (dwa, α = 0,05 rozdzielone po 0,025):**

| Spojrzenie | Kiedy | Uwagi |
|---|---|---|
| 1 | pierwszy kwartalny przebieg, w którym **N ≥ 20** epizodów forward z pełnym 63 | |
| 2 (ostatnie) | **N ≥ 40** albo **01.05.2030** — co pierwsze | tylko gdy spojrzenie 1 dało „czekamy" |

Gdy do 01.05.2030 nie będzie nawet 20 epizodów → jedyne spojrzenie z tym, co jest → **NIEROZSTRZYGALNE_N**, teczka
zamknięta.

**Werdykt spojrzenia (statystyka = średni NET 63 sesji epizodów forward), w tej kolejności:**

1. **POTWIERDZONA**, gdy naraz: p (permutacja z przesunięciem kalendarza, B = 10 000, jednostronnie) **< 0,025** ·
   średnia > 0 · mediana > 0 · średnia > 0 po usunięciu każdego tickera z osobna (leave-one-ticker-out; przy
   epizodach z jednego tickera — niespełnione).
2. **OBALONA**, gdy: górna granica CI95 średniej (bootstrap klastrowy po tickerach) **< +3 pp**, **albo**
   średnia ≤ 0 **i** mediana ≤ 0.
3. W pozostałych przypadkach: po spojrzeniu 1 → **czekamy na spojrzenie 2**; po spojrzeniu 2 →
   **NIEROZSTRZYGNIĘTA**, teczka zamknięta (trzeciego spojrzenia nie ma).

**Co oznacza werdykt:**
- POTWIERDZONA → podstawa do **osobnej teczki reguł gry** (trzymanie ~90 dni, wchodzalność na XTB, koszt, sizing).
  Sama nie zdejmuje stopu gry i nie zmienia produkcji.
- OBALONA / NIEROZSTRZYGNIĘTA / NIEROZSTRZYGALNE_N → hipoteza 90d zamknięta; nie wracamy do niej z tymi samymi
  danymi (wariacje progów, grup, horyzontów = nowa hipoteza z nowym okresem).

**Ślepota między spojrzeniami:** przebieg kwartalny uruchamia wyłącznie `status` — **same liczności** (ile epizodów,
ile z pełnym horyzontem, per ticker), **zero zwrotów**. `look` odmawia, dopóki warunek spojrzenia nie jest spełniony,
i zapisuje stan (`data/results/horizon_forward_state.json`), więc spojrzenia nie da się powtórzyć. Grupy G2/G3
i horyzonty 30/60d są wypisywane tylko przy spojrzeniu, opisowo.

## Moc testu — zapisana z góry (szacunek)

Z HORYZONT: G1 90d — MDE 11,5 pp przy 47 epizodach (α 0,05). Przeskalowane (σ ~ 1/√N, α 0,025 jednostronnie):
**N = 20 → MDE ≈ 20 pp · N = 40 → MDE ≈ 14 pp.** Efekt z in-sample (+12,9 pp) jest **poniżej** MDE przy N = 20.
**Najbardziej prawdopodobny uczciwy wynik spojrzenia 1 to „czekamy"**, a na końcu — o ile efekt jest realny, ale
mniejszy niż w in-sample — NIEROZSTRZYGNIĘTA. POTWIERDZONA wymaga, by forward był co najmniej tak dobry jak
backtest. OBALONA jest osiągalna (średnia i mediana ≤ 0 albo CI < +3 pp), jeśli efekt był artefaktem okresu.

**Tempo:** in-sample 2024: 13, 2025: 17, 2026 (do 07.11): 10 epizodów G1. Przy ~13–14/rok i +63 sesjach na
domknięcie: spojrzenie 1 realnie **~połowa 2028**, spojrzenie 2 **~początek 2030**. Na werdykcie #3 (01.02.2027)
będzie 0–2 pełnych epizodów — **forward HORYZONT nie wpływa na werdykt #3.**

## Przebieg kwartalny (01.02 / 01.05 / 01.08 / 01.11; pierwszy 01.02.2027)

```bash
cd scripts/backtest
# 1. Form 4 (okno od 01.09.2026 — łańcuchy z in-sample odpadają same; 2 req/s, IP produkcji)
BT_START_DATE=2026-09-01 BT_END_DATE=$(date +%F) BT_SEC_RATE_LIMIT=0.5 BT_TX_FILE=data/form4_transactions_fwd.csv \
  .venv/bin/python -c "from edgar_fetcher import fetch_all_form4; fetch_all_form4(True)"
# 2. ceny + splity (osobny katalog — ceny HORYZONT zostają zamrożone)
.venv/bin/python horizon_forward.py prices
# 3. ŚLEPY status (tylko liczności) → wpis w tabeli niżej
.venv/bin/python horizon_forward.py status
# 4. TYLKO gdy status pokazuje pending_look: spojrzenie → raport doc/BACKTEST-HORYZONT-FORWARD-<data>.md
.venv/bin/python horizon_forward.py look
```

Przed `look`: sha256 plików z `FROZEN_FILES` (zapisywane w JSON wyniku) muszą być równe hashom niżej. Inny hash =
najpierw opis zmiany i dowód, że nie dotyka logiki (np. regresja HORYZONT 0 różnic), dopiero potem spojrzenie.

## Zamrożenie kodu

Kod: `scripts/backtest/horizon_forward.py` (+ testy `tests/test_horizon_forward.py`), korzysta z
`horizon_backtest.py`, `config.py` (dodane tylko nadpisania `BT_START_DATE`, `BT_SEC_RATE_LIMIT` — domyślne bez
zmian), `edgar_fetcher.py`. Hashe sha256 (08.11.2026):

- `horizon_forward.py`: `148e1a0fb7adc0964f801d560806ace1e76b0c1cde550133ac2b4e2af967df42`
- `horizon_backtest.py`: `2f07810bb33750cff701b61d84df17061990bc166bd8413283943fbec577a33a`
- `config.py`: `a738b962053ff8953117e00e12ebc49ec227cfc4ea37af2d0019283646429e5d`
- `edgar_fetcher.py`: `8b576cb3bc83983eaaab0670f6f17390d1f6cf4698fa00fe22f5c7ed7b9dc76a`

## Dziennik przebiegów (tylko liczności)

| Data | Koniec danych | Epizody forward | Z pełnym 63 | Spojrzenie | Uwagi |
|---|---|---|---|---|---|
| 08–09.11.2026 | 06.11.2026 | 0 | 0 | — | przebieg zerowy (kontrola instalacji): okno 01.09–07.11 zgodne z plikiem HORYZONT v6 1:1 (1 421 wierszy, ten sam rozkład typów i tickerów); `look` odmawia |

## Ograniczenia

- Lista 28 tickerów z 2026 (survivorship zostaje); healthcare rdzeń bez rdzenia+.
- Jeden reżim rynku na raz; 2 spojrzenia przy małym N — moc niska (patrz wyżej).
- Ceny yfinance skorygowane wstecz (dywidendy) — przy każdym przebiegu pobierane od nowa; NET in-sample może się
  minimalnie różnić od HORYZONT, ale epizody in-sample i tak nie wchodzą do testu.
- Pobieranie Form 4 z maliny = IP produkcji → `BT_SEC_RATE_LIMIT=0.5` (2 req/s), żeby nie zjeść limitu 10 req/s
  kolektorów.
