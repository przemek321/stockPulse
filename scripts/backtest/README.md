# StockPulse Backtest — Insider Trading Patterns

Backtest hipotez insider trading na 3 latach danych SEC EDGAR Form 4 (kwiecień 2023 – kwiecień 2026).

## Setup

```bash
cd scripts/backtest
python -m venv .venv
source .venv/bin/activate       # Linux/WSL
pip install -r requirements.txt
```

## Użycie

```bash
# Pełny backtest (fetch ~30-45 min, analyze ~2 min, report instant)
python run_backtest.py

# Etapy osobno
python run_backtest.py fetch           # Pobierz dane z SEC EDGAR + yfinance
python run_backtest.py fetch --force   # Wymuś ponowne pobranie (ignoruj cache)
python run_backtest.py analyze         # Uruchom analizę (wymaga danych)
python run_backtest.py report          # Wygeneruj raport (wymaga wyników)
```

## Co testujemy

| Hipoteza | Opis | Odpowiednik w pipeline |
|----------|------|----------------------|
| H1 | Insider Cluster: 2+ discretionary w 7 dni | INSIDER_CLUSTER pattern |
| H2 | Pojedyncza C-suite transakcja (progi $100K/$500K/$1M) | Form 4 Insider Signal |
| H3 | 10b5-1 plan vs discretionary | Filtr is10b51Plan→skip |
| H4 | Role seniority (CEO/CFO vs Director vs Other) | C-suite boost |
| H5 | BUY signals (czy warto alertować?) | Brak w pipeline (tylko obserwacja) |
| H6 | Healthcare vs Control Group | Sector-specific edge? |

## Output

```
data/
├── cik_map.json                    # Cache CIK→ticker
├── form4_transactions.csv          # Wszystkie transakcje (główny dataset)
├── prices/                         # Historyczne ceny per ticker
│   ├── AAPL.csv
│   ├── UNH.csv
│   └── ...
└── results/
    ├── backtest_results.json       # Surowe wyniki (do dalszej analizy)
    └── backtest_report.md          # Czytelny raport z tabelami
```

## Horyzonty cenowe

- **1d** — 1 dzień handlowy po evencie
- **3d** — 3 dni handlowe
- **7d** — 5 dni handlowych (≈ tydzień kalendarzowy)
- **30d** — 21 dni handlowych (≈ miesiąc kalendarzowy)

## Baseline

10 000 losowych dat na tych samych tickerach — symuluje "co jeśli kupiłeś/sprzedałeś w losowym momencie". P-value z Welch's t-test porównuje insider eventy vs ten baseline.

## Tickery

- **42 healthcare** — universe z `doc/stockpulse-healthcare-universe.json`
- **25 control group** — large-cap non-healthcare (AAPL, MSFT, JPM, WMT, XOM, etc.)

## SEC EDGAR Rate Limiting

Skrypt przestrzega limitu 10 req/sec (ustawiony na ~8 req/sec z marginesem). Przy ~70 tickerach i ~20K Form 4 filingów, pełne pobranie trwa ~30-45 minut. Dane są cache'owane — kolejne uruchomienia są natychmiastowe.

## Uwagi

- `is_10b51_plan` wykrywany heurystycznie (szukanie "10b5-1" w XML). Nie jest 100% dokładny, ale wystarczający do backtesta.
- C-suite detection używa tego samego regex co Form4Pipeline w StockPulse.
- Ceny z yfinance (adjusted close) — uwzględniają splity i dywidendy.
