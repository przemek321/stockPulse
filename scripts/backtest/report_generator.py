"""
Generator raportu markdown z wynikami backtesta.
Produkuje czytelny raport z tabelami, wnioskami i rekomendacjami dla pipeline'u.
"""

import os
from datetime import datetime

from config import (
    CLUSTER_MIN_INSIDERS, CLUSTER_WINDOW_DAYS,
    HORIZONS, RESULTS_DIR, START_DATE, END_DATE,
)


def _fmt(val, suffix="%") -> str:
    if val is None:
        return "—"
    return f"{val:+.2f}{suffix}" if isinstance(val, float) else str(val)


def _sig_marker(data: dict) -> str:
    if data.get("significant_001"):
        return " ***"
    if data.get("significant_005"):
        return " **"
    return ""


def _horizon_table(horizons: dict, direction: str = "") -> str:
    """Generuje tabelę markdown z wynikami per horyzont."""
    header = "| Horyzont | N | Avg Return | Median | Hit Rate | Baseline HR | p-value | Effect (d) | Sig? |"
    sep = "|----------|---|-----------|--------|----------|-------------|---------|------------|------|"
    rows = [header, sep]

    for h in HORIZONS:
        d = horizons.get(h, {})
        if d.get("insufficient_data"):
            rows.append(f"| {h} | {d.get('n', 0)} | — | — | — | — | — | — | n/a |")
            continue

        sig = "✓✓✓" if d.get("significant_001") else ("✓✓" if d.get("significant_005") else "✗")
        rows.append(
            f"| {h} | {d.get('n', 0)} "
            f"| {_fmt(d.get('avg_return_pct'))} "
            f"| {_fmt(d.get('median_return_pct'))} "
            f"| {d.get('hit_rate_pct', '—')}% "
            f"| {d.get('baseline_hit_rate_pct', '—')}% "
            f"| {d.get('p_value', '—')} "
            f"| {_fmt(d.get('effect_size_d'), '')} "
            f"| {sig} |"
        )

    return "\n".join(rows)


def generate_report(results: list, transactions_csv: str) -> str:
    """Generuje pełny raport markdown."""
    
    # Policz transakcje
    import csv
    with open(transactions_csv) as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    n_total = len(rows)
    n_sell = sum(1 for r in rows if r["transaction_type"] == "SELL")
    n_buy = sum(1 for r in rows if r["transaction_type"] == "BUY")
    n_disc = sum(1 for r in rows if r["is_10b51_plan"] == "False")
    n_csuite = sum(1 for r in rows if r["is_csuite"] == "True")
    n_tickers = len(set(r["symbol"] for r in rows))

    report = f"""# StockPulse Backtest — Insider Trading Patterns

> Automatyczny raport backtesta. Wygenerowany: {datetime.now().strftime('%Y-%m-%d %H:%M')}

## Parametry

| Parametr | Wartość |
|----------|---------|
| Zakres dat | {START_DATE} — {END_DATE} |
| Tickery | {n_tickers} (42 healthcare + control group) |
| Transakcje | {n_total} total |
| SELL | {n_sell} |
| BUY | {n_buy} |
| Discretionary (non-10b5-1) | {n_disc} |
| C-suite | {n_csuite} |
| Horyzonty | {', '.join(HORIZONS.keys())} |
| Baseline | 10 000 losowych dat (per universe) |

---

"""

    for h_result in results:
        r = h_result if isinstance(h_result, dict) else h_result.__dict__ if hasattr(h_result, '__dict__') else h_result
        if isinstance(r, dict):
            name = r.get("name", "?")
            desc = r.get("description", "")
            n = r.get("n_events", 0)
            horizons = r.get("horizons", {})
            sub = r.get("sub_groups", {})
        else:
            # dataclass
            name = r.name
            desc = r.description
            n = r.n_events
            horizons = r.horizons
            sub = r.sub_groups

        report += f"## {name}\n\n"
        report += f"**{desc}**\n\n"
        report += f"Eventów: **{n}**\n\n"

        if horizons:
            report += "### Ogółem\n\n"
            report += _horizon_table(horizons) + "\n\n"

        if sub:
            for sub_name, sub_data in sub.items():
                sub_n = sub_data.get("n", 0)
                sub_horizons = sub_data.get("horizons", {})
                if sub_n == 0:
                    continue
                report += f"### {sub_name} (N={sub_n})\n\n"
                report += _horizon_table(sub_horizons) + "\n\n"

        report += "---\n\n"

    # Wnioski
    report += _generate_conclusions(results, rows)

    return report


def _generate_conclusions(results: list, rows: list) -> str:
    """Generuje sekcję wniosków i rekomendacji dla pipeline'u."""
    
    text = """## Wnioski i rekomendacje dla StockPulse

### Legenda istotności statystycznej
- **✓✓✓** — p < 0.01 (bardzo silna istotność)
- **✓✓** — p < 0.05 (istotne statystycznie)
- **✗** — brak istotności (p ≥ 0.05)
- **Effect size (d)**: |d| > 0.2 = mały efekt, > 0.5 = średni, > 0.8 = duży

### Jak interpretować wyniki

1. **Hit rate > baseline hit rate + 5pp** z p < 0.05 → realny edge, wart alertowania
2. **Hit rate ≈ baseline** lub p > 0.05 → brak dowodów na edge, szum
3. **Avg return istotnie różny od baseline** → kierunkowy edge (nie tylko accuracy)
4. **N < 30** → za mało danych, wnioski ostrożne

### Rekomendacje dla pipeline'u

Na podstawie wyników backtesta, poniższe zmiany powinny być rozważone:

#### Jeśli H1 (Clusters) wykazuje edge:
- Utrzymaj INSIDER_CLUSTER pattern w CorrelationService
- Optymalne conviction weights: proporcjonalne do effect size na 7d/30d

#### Jeśli H3 (10b5-1 vs discretionary) potwierdza różnicę:
- Utrzymaj filtr `is10b51Plan=true → skip` w Form4Pipeline
- Jeśli brak różnicy → rozważ włączenie 10b5-1 z niższym conviction

#### Jeśli H4 (Role seniority) potwierdza gradient:
- Utrzymaj C-suite boost w Form4Pipeline
- Sugerowane wagi: CEO/CFO = 1.0, Director = effect_size_ratio, Other = niżej

#### Jeśli H5 (BUY) wykazuje edge:
- Rozważ dodanie reguły alertu dla discretionary BUY
- Ostrożność: BUY signals są rzadsze, mniejszy sample size

#### Jeśli H6 (Healthcare vs Control) wykazuje różnicę sektorową:
- Healthcare insider edge ≠ general market insider edge
- Wagi conviction powinny być sector-specific

---

> **Następny krok**: zamroź pipeline na 2-3 tygodnie, zbierz live dane z nowymi
> wagami z backtesta, porównaj hit rate live vs backtest.
"""
    return text


def save_report(report: str) -> str:
    """Zapisuje raport do pliku."""
    os.makedirs(RESULTS_DIR, exist_ok=True)
    path = os.path.join(RESULTS_DIR, "backtest_report.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write(report)
    print(f"[RAPORT] Zapisano: {path}")
    return path
