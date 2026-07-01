#!/usr/bin/env python3
"""
Backtest H7 — CLUSTER-BUY.

Pytanie: czy klaster ≥2 dyskrecjonalnych BUY od ≥2 RÓŻNYCH insiderów w oknie
7 dni kalendarzowych daje wyższy zwrot forward 7d niż pojedynczy dyskrecjonalny BUY?

Reguła decyzyjna i definicje: doc/BACKTEST-H7-CLUSTER-BUY-KRYTERIA-2026-07-02.md
(pre-rejestracja). Reużywa infrastruktury V5 (analyzer.py / price_fetcher.py / config.py):
entry = Close pierwszego dnia handl. >= filing_date, 7d = 5 dni handlowych, Cohen's d
(winsor 1%, pooled ddof=1), Welch's t-test. NIE nadpisuje wyników V5.

Różnica vs V5 `cluster_buy_vs_single_buy`: entry klastra kotwiczony na DRUGIM różnym
insiderze (moment strzału reguły live), a nie na ostatniej dacie klastra.

Uruchomienie (z katalogu scripts/backtest, aktywny .venv):
    .venv/bin/python backtest_h7_cluster_buy.py
"""
from __future__ import annotations

import json
import os
from dataclasses import asdict

import numpy as np
import pandas as pd
from scipy import stats as scipy_stats

from config import (
    CLUSTER_MIN_INSIDERS, CLUSTER_WINDOW_DAYS,
    HEALTHCARE_TICKERS, HORIZONS, RESULTS_DIR, TRANSACTIONS_FILE,
)
from price_fetcher import fetch_all_prices
from analyzer import (
    EventReturn, _cohens_d, _compute_baseline, _compute_returns, _horizon_stats,
)

# Rodzina hipotez k=7 (H1-H6 + H7) → Bonferroni α=0.05/7
BONFERRONI_ALPHA = 0.05 / 7          # ≈ 0.007143
PRIMARY_HORIZON = "7d"
D_THRESHOLD = 0.3
MIN_CLUSTER_EVENTS = 15


# =============================================================================
# Preprocessing transakcji (spójny z analyzer.run_analysis)
# =============================================================================

def _load_and_prepare(csv_path: str) -> pd.DataFrame:
    """Wczytuje CSV, filtruje zepsute daty, deduplikuje per (symbol,insider,isoweek,typ)."""
    df = pd.read_csv(csv_path)
    df = df[df["transaction_date"].str.match(r"^20\d{2}-", na=False)].copy()
    df = df[df["filing_date"].str.match(r"^20\d{2}-", na=False)].copy()

    # Deduplikacja per (symbol, insider, tydzień ISO, typ) — zachowaj największą tx.
    fd = pd.to_datetime(df["filing_date"])
    df["_week"] = fd.dt.isocalendar().week.astype(str) + "-" + \
                  fd.dt.isocalendar().year.astype(str)
    df["_dedup_key"] = df["symbol"] + "|" + df["insider_name"] + "|" + \
                       df["_week"] + "|" + df["transaction_type"]
    n_before = len(df)
    df = df.sort_values("total_value", ascending=False).drop_duplicates(
        subset=["_dedup_key"], keep="first"
    ).sort_values(["symbol", "filing_date"])
    df.attrs["n_removed_dupes"] = n_before - len(df)
    return df


def _disc_buys(df: pd.DataFrame, healthcare_only: bool) -> pd.DataFrame:
    """Dyskrecjonalne BUY (is_10b51_plan==False — de facto wszystkie, flaga zawsze False)."""
    mask = (df["is_10b51_plan"] == False) & (df["transaction_type"] == "BUY")
    if healthcare_only:
        mask &= (df["is_healthcare"] == True)
    out = df[mask].copy()
    out["filing_date"] = pd.to_datetime(out["filing_date"], format="%Y-%m-%d")
    return out.sort_values(["symbol", "filing_date"])


# =============================================================================
# Detekcja klastrów i singli
# =============================================================================

def detect_cluster_buys(buy_df: pd.DataFrame, prices: dict,
                        window_days: int = CLUSTER_WINDOW_DAYS,
                        min_insiders: int = CLUSTER_MIN_INSIDERS):
    """
    Klaster = ≥min_insiders RÓŻNYCH insiderów BUY w oknie [data_i, data_i+window_days].
    Entry = filing_date wiersza, przy którym pojawia się DRUGI różny insider (strzał live).
    Nakładające się klastry = 1 event (greedy jump za okno).
    Zwraca (events, dropped_no_price).
    """
    events: list[EventReturn] = []
    dropped = 0
    for symbol, group in buy_df.groupby("symbol"):
        g = group.sort_values("filing_date").reset_index(drop=True)
        dates = g["filing_date"].values          # datetime64[ns]
        names = g["insider_name"].values
        n = len(g)
        i = 0
        while i < n:
            window_end = dates[i] + np.timedelta64(window_days, "D")
            j = i
            seen: list = []
            second_idx = None
            while j < n and dates[j] <= window_end:
                nm = names[j]
                if nm not in seen:
                    seen.append(nm)
                    if len(seen) == min_insiders and second_idx is None:
                        second_idx = j
                j += 1
            n_distinct = len(seen)
            if n_distinct >= min_insiders:
                entry_date = str(pd.Timestamp(dates[second_idx]).date())
                ret = _compute_returns(prices, symbol, entry_date)
                if ret:
                    events.append(EventReturn(
                        symbol=symbol, event_date=entry_date,
                        price_at_event=ret["price_at_event"], returns=ret["returns"],
                        tx_type="BUY", n_insiders=n_distinct,
                        is_healthcare=symbol in HEALTHCARE_TICKERS,
                        is_csuite=bool(g.iloc[i:j]["is_csuite"].any()),
                        total_value=float(g.iloc[i:j]["total_value"].sum()),
                    ))
                else:
                    dropped += 1
                i = j  # przeskocz całe okno (nakładające klastry = 1 event)
            else:
                i += 1
    return events, dropped


def detect_single_buys(buy_df: pd.DataFrame, prices: dict,
                       window_days: int = CLUSTER_WINDOW_DAYS):
    """
    Single BUY = dyskrecjonalny BUY bez innego BUY INNEGO insidera w ±window_days dni kal.
    Entry = jego filing_date. Zwraca (events, dropped_no_price).
    """
    events: list[EventReturn] = []
    dropped = 0
    win = np.timedelta64(window_days, "D")
    for symbol, group in buy_df.groupby("symbol"):
        g = group.sort_values("filing_date").reset_index(drop=True)
        dates = g["filing_date"].values
        names = g["insider_name"].values
        n = len(g)
        for i in range(n):
            lo, hi = dates[i] - win, dates[i] + win
            has_other = False
            for k in range(n):
                if k == i:
                    continue
                if lo <= dates[k] <= hi and names[k] != names[i]:
                    has_other = True
                    break
            if has_other:
                continue
            entry_date = str(pd.Timestamp(dates[i]).date())
            ret = _compute_returns(prices, symbol, entry_date)
            if ret:
                events.append(EventReturn(
                    symbol=symbol, event_date=entry_date,
                    price_at_event=ret["price_at_event"], returns=ret["returns"],
                    tx_type="BUY", n_insiders=1,
                    is_healthcare=symbol in HEALTHCARE_TICKERS,
                    is_csuite=bool(g.iloc[i]["is_csuite"]),
                    total_value=float(g.iloc[i]["total_value"]),
                ))
            else:
                dropped += 1
    return events, dropped


# =============================================================================
# Direct comparison klaster vs single
# =============================================================================

def direct_comparison(cluster_events: list, single_events: list) -> dict:
    """
    Welch's t-test + Cohen's d klaster vs single per horyzont.
    - p_value: Welch (equal_var=False) na surowych zwrotach.
    - cohens_d_winsor: headline d (V5 _cohens_d, winsor 1%, pooled ddof=1) — METRYKA DECYZYJNA.
    - cohens_d_raw: bez winsoryzacji (V5 _direct_cluster_vs_single form) — transparentność.
    """
    out = {"horizons": {}}
    for horizon in HORIZONS:
        vc = [e.returns.get(horizon) for e in cluster_events
              if e.returns.get(horizon) is not None]
        vs = [e.returns.get(horizon) for e in single_events
              if e.returns.get(horizon) is not None]
        if len(vc) < 3 or len(vs) < 3:
            out["horizons"][horizon] = {
                "n_cluster": len(vc), "n_single": len(vs),
                "note": "insufficient N (<3)",
            }
            continue
        arr_c, arr_s = np.array(vc, dtype=float), np.array(vs, dtype=float)
        t_stat, p_value = scipy_stats.ttest_ind(arr_c, arr_s, equal_var=False)
        # raw d (no winsor)
        var_c, var_s = float(np.var(arr_c, ddof=1)), float(np.var(arr_s, ddof=1))
        pooled_raw = ((var_c + var_s) / 2) ** 0.5 if (var_c + var_s) > 0 else 0.0
        d_raw = ((float(np.mean(arr_c)) - float(np.mean(arr_s))) / pooled_raw
                 if pooled_raw > 0 else 0.0)
        # headline d (winsor 1%, decyzja)
        d_winsor = _cohens_d(arr_c, arr_s, winsorize=True)
        out["horizons"][horizon] = {
            "n_cluster": len(vc), "n_single": len(vs),
            "mean_cluster_pct": round(float(np.mean(arr_c)), 3),
            "mean_single_pct": round(float(np.mean(arr_s)), 3),
            "median_cluster_pct": round(float(np.median(arr_c)), 3),
            "median_single_pct": round(float(np.median(arr_s)), 3),
            "t_stat": round(float(t_stat), 4),
            "p_value": round(float(p_value), 6),
            "cohens_d_winsor": round(d_winsor, 3) if d_winsor is not None else None,
            "cohens_d_raw": round(float(d_raw), 3),
        }
    return out


def _events_summary(events: list, baseline: dict, label: str) -> dict:
    """Statystyki eventów vs baseline (hit-rate, avg, d) — kontekst, nie decyzja."""
    return {
        "n": len(events),
        "n_tickers": len({e.symbol for e in events}),
        "horizons": _horizon_stats(events, baseline, direction="buy"),
    }


# =============================================================================
# Scope runner
# =============================================================================

def run_scope(df: pd.DataFrame, prices: dict, baseline: dict,
              healthcare_only: bool, scope_name: str) -> dict:
    buy_df = _disc_buys(df, healthcare_only=healthcare_only)
    cluster_events, clu_dropped = detect_cluster_buys(buy_df, prices)
    single_events, sin_dropped = detect_single_buys(buy_df, prices)

    comp = direct_comparison(cluster_events, single_events)

    scope = {
        "scope": scope_name,
        "healthcare_only": healthcare_only,
        "n_disc_buy_rows": int(len(buy_df)),
        "n_disc_buy_tickers": int(buy_df["symbol"].nunique()),
        "cluster": _events_summary(cluster_events, baseline, "cluster"),
        "single": _events_summary(single_events, baseline, "single"),
        "cluster_dropped_no_price": clu_dropped,
        "single_dropped_no_price": sin_dropped,
        "direct_comparison": comp,
        "cluster_events_detail": sorted(
            [{"symbol": e.symbol, "date": e.event_date, "n_insiders": e.n_insiders,
              "total_value": round(e.total_value, 0),
              "ret_7d": (round(e.returns.get("7d"), 2)
                         if e.returns.get("7d") is not None else None),
              "is_csuite": e.is_csuite}
             for e in cluster_events],
            key=lambda x: x["date"],
        ),
    }

    # Werdykt (tylko primary scope wchodzi do decyzji, ale liczymy dla obu)
    ph = comp["horizons"].get(PRIMARY_HORIZON, {})
    n_cluster_7d = ph.get("n_cluster", 0)
    d7 = ph.get("cohens_d_winsor")
    p7 = ph.get("p_value")
    if n_cluster_7d < MIN_CLUSTER_EVENTS:
        verdict = "INSUFFICIENT_N"
    elif (p7 is not None and d7 is not None
          and p7 < BONFERRONI_ALPHA and d7 >= D_THRESHOLD):
        verdict = "PASS"
    else:
        verdict = "FAIL"
    scope["verdict"] = verdict
    scope["decision_inputs"] = {
        "horizon": PRIMARY_HORIZON,
        "n_cluster_events": n_cluster_7d,
        "n_single_events": ph.get("n_single", 0),
        "cohens_d_winsor": d7,
        "p_welch": p7,
        "bonferroni_alpha": round(BONFERRONI_ALPHA, 6),
        "d_threshold": D_THRESHOLD,
        "min_cluster_events": MIN_CLUSTER_EVENTS,
    }
    return scope


def main():
    print("=" * 64)
    print("BACKTEST H7 — CLUSTER-BUY (pre-rejestracja 2026-07-02)")
    print("=" * 64)

    df = _load_and_prepare(TRANSACTIONS_FILE)
    print(f"Transakcje po filtrze dat + dedup: {len(df)} "
          f"(usunięto {df.attrs.get('n_removed_dupes')} duplikatów)")
    print(f"Tickery: {df['symbol'].nunique()}")

    prices = fetch_all_prices()
    all_symbols = [s for s in df["symbol"].unique() if s in prices]
    hc_symbols = [s for s in HEALTHCARE_TICKERS if s in prices]

    print("\n[BASELINE] losowe zwroty (kontekst hit-rate)...")
    baseline_all = _compute_baseline(prices, all_symbols, n_samples=10000)
    baseline_hc = _compute_baseline(prices, hc_symbols, n_samples=5000, seed=43)

    print("\n[PRIMARY] healthcare scope...")
    primary = run_scope(df, prices, baseline_hc, healthcare_only=True,
                        scope_name="healthcare")
    print(f"  cluster events (7d): {primary['decision_inputs']['n_cluster_events']}, "
          f"single: {primary['decision_inputs']['n_single_events']}, "
          f"d={primary['decision_inputs']['cohens_d_winsor']}, "
          f"p={primary['decision_inputs']['p_welch']} → {primary['verdict']}")

    print("\n[SECONDARY] full universe (healthcare+control)...")
    secondary = run_scope(df, prices, baseline_all, healthcare_only=False,
                          scope_name="full_universe")
    print(f"  cluster events (7d): {secondary['decision_inputs']['n_cluster_events']}, "
          f"single: {secondary['decision_inputs']['n_single_events']}, "
          f"d={secondary['decision_inputs']['cohens_d_winsor']}, "
          f"p={secondary['decision_inputs']['p_welch']} → {secondary['verdict']}")

    out = {
        "hypothesis": "H7_CLUSTER_BUY",
        "date": "2026-07-02",
        "criteria_file": "doc/BACKTEST-H7-CLUSTER-BUY-KRYTERIA-2026-07-02.md",
        "family_k": 7,
        "bonferroni_alpha": round(BONFERRONI_ALPHA, 6),
        "primary_horizon": PRIMARY_HORIZON,
        "d_threshold": D_THRESHOLD,
        "min_cluster_events": MIN_CLUSTER_EVENTS,
        "dataset": {
            "csv": TRANSACTIONS_FILE,
            "rows_after_prep": int(len(df)),
            "tickers": int(df["symbol"].nunique()),
            "removed_dupes": int(df.attrs.get("n_removed_dupes", 0)),
            "is_10b51_plan_all_false": bool((df["is_10b51_plan"] == False).all()),
            "sector_alpha_available": False,
        },
        "PRIMARY_DECISION_SCOPE": "healthcare",
        "primary_verdict": primary["verdict"],
        "primary": primary,
        "secondary": secondary,
    }

    os.makedirs(RESULTS_DIR, exist_ok=True)
    json_path = os.path.join(RESULTS_DIR, "h7_cluster_buy_results.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False, default=str)
    print(f"\n[WYNIKI] {json_path}")
    return out


if __name__ == "__main__":
    main()
