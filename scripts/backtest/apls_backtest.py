#!/usr/bin/env python3
"""
APLS-class universe expansion — Faza 2 backtest standalone runner.

Reuse:
  - edgar_fetcher: parsowanie Form 4 XML (parse_form4_xml, fetch_form4_xml)
  - price_fetcher: yfinance OHLC (fetch_prices_for_ticker)
  - analyzer:      _compute_returns, _compute_baseline, _horizon_stats, _cohens_d

Output:
  data/apls/form4_transactions.csv
  data/apls/prices/{TICKER}.csv
  data/apls/results/apls_results.json
  data/apls/results/apls_report.md

Użycie:
  python apls_backtest.py              # all stages
  python apls_backtest.py fetch        # tylko Form 4 + ceny
  python apls_backtest.py analyze      # tylko analiza
  python apls_backtest.py report       # tylko raport
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta
from typing import Optional

import numpy as np
import pandas as pd
import requests
from scipy import stats as scipy_stats

import apls_config as cfg

# ============================================================================
# SEC EDGAR fetcher (reuse low-level helpers from edgar_fetcher via monkey-patch)
# ============================================================================

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": cfg.SEC_USER_AGENT,
    "Accept-Encoding": "gzip, deflate",
})


def _rate_limit():
    time.sleep(cfg.SEC_RATE_LIMIT)


def fetch_cik_map() -> dict[str, str]:
    """Pobiera ticker → CIK z SEC."""
    if os.path.exists(cfg.CIK_CACHE_FILE):
        with open(cfg.CIK_CACHE_FILE) as f:
            cached = json.load(f)
            if all(t in cached for t in cfg.ALL_TICKERS):
                return cached

    print("[CIK] Pobieram company_tickers.json z SEC...")
    resp = SESSION.get("https://www.sec.gov/files/company_tickers.json")
    resp.raise_for_status()
    data = resp.json()
    _rate_limit()

    ticker_to_cik = {}
    for entry in data.values():
        ticker = entry["ticker"].upper()
        if ticker in cfg.ALL_TICKERS:
            ticker_to_cik[ticker] = str(entry["cik_str"])

    missing = set(cfg.ALL_TICKERS) - set(ticker_to_cik.keys())
    if missing:
        print(f"[CIK] BRAK CIK dla: {sorted(missing)}")

    os.makedirs(cfg.DATA_DIR, exist_ok=True)
    with open(cfg.CIK_CACHE_FILE, "w") as f:
        json.dump(ticker_to_cik, f, indent=2)
    print(f"[CIK] {len(ticker_to_cik)}/{len(cfg.ALL_TICKERS)} CIK-ów")
    return ticker_to_cik


def _fetch_submissions(cik: str) -> list[dict]:
    cik_padded = cik.zfill(10)
    url = f"{cfg.SEC_BASE_URL}/submissions/CIK{cik_padded}.json"
    resp = SESSION.get(url)
    resp.raise_for_status()
    _rate_limit()
    data = resp.json()

    filings = []
    recent = data.get("filings", {}).get("recent", {})
    if recent:
        forms = recent.get("form", [])
        dates = recent.get("filingDate", [])
        accessions = recent.get("accessionNumber", [])
        doc_urls = recent.get("primaryDocument", [])
        for i in range(len(forms)):
            filings.append({
                "form": forms[i], "date": dates[i],
                "accession": accessions[i],
                "primary_doc": doc_urls[i] if i < len(doc_urls) else "",
            })
    older_files = data.get("filings", {}).get("files", [])
    for file_ref in older_files:
        file_url = f"{cfg.SEC_BASE_URL}/submissions/{file_ref['name']}"
        try:
            resp2 = SESSION.get(file_url)
            resp2.raise_for_status()
            _rate_limit()
            batch = resp2.json()
            forms = batch.get("form", [])
            dates = batch.get("filingDate", [])
            accessions = batch.get("accessionNumber", [])
            doc_urls = batch.get("primaryDocument", [])
            for i in range(len(forms)):
                filings.append({
                    "form": forms[i], "date": dates[i],
                    "accession": accessions[i],
                    "primary_doc": doc_urls[i] if i < len(doc_urls) else "",
                })
        except Exception as e:
            print(f"  [WARN] {file_ref['name']}: {e}")
    return filings


def _filter_form4_in_range(filings: list[dict]) -> list[dict]:
    out = []
    for f in filings:
        if f["form"] not in ("4", "4/A"):
            continue
        try:
            fdate = date.fromisoformat(f["date"])
        except ValueError:
            continue
        if cfg.START_DATE <= fdate <= cfg.END_DATE:
            out.append(f)
    return out


def fetch_all_form4(force: bool = False) -> str:
    """Pobiera Form 4 dla 6 APLS tickerów."""
    if os.path.exists(cfg.TRANSACTIONS_FILE) and not force:
        with open(cfg.TRANSACTIONS_FILE) as f:
            n = sum(1 for _ in csv.reader(f)) - 1
        print(f"[EDGAR] Cache: {cfg.TRANSACTIONS_FILE} ({n} transakcji)")
        return cfg.TRANSACTIONS_FILE

    # Reuse XML parser + fetcher z edgar_fetcher (one shot import)
    # ALE: musimy nadpisać HEALTHCARE_TICKERS żeby is_healthcare był True dla APLS
    # (wszystkie 6 to biotech/pharma — funkcjonalnie healthcare).
    import edgar_fetcher as ef
    ef.HEALTHCARE_TICKERS = list(cfg.ALL_TICKERS)  # patch — wszystkie APLS = healthcare=True

    cik_map = fetch_cik_map()
    os.makedirs(cfg.DATA_DIR, exist_ok=True)

    all_tx = []
    total_filings = 0
    errors = 0
    for i, symbol in enumerate(cfg.ALL_TICKERS):
        cik = cik_map.get(symbol)
        if not cik:
            print(f"[{i+1}/{len(cfg.ALL_TICKERS)}] {symbol}: brak CIK — skip")
            continue
        print(f"[{i+1}/{len(cfg.ALL_TICKERS)}] {symbol} (CIK {cik})...",
              end=" ", flush=True)
        try:
            filings = _fetch_submissions(cik)
            form4s = _filter_form4_in_range(filings)
            print(f"{len(form4s)} Form 4", end="", flush=True)
            ticker_tx = 0
            for j, filing in enumerate(form4s):
                xml = ef._fetch_form4_xml(
                    filing["accession"], filing["primary_doc"], cik
                )
                if xml:
                    txs = ef._parse_form4_xml(
                        xml, symbol, filing["date"], filing["accession"]
                    )
                    # Annotacja tier
                    tier = "strict" if symbol in cfg.TIER_STRICT else "stretch"
                    for tx in txs:
                        tx["tier"] = tier
                    all_tx.extend(txs)
                    ticker_tx += len(txs)
                else:
                    errors += 1
                if (j + 1) % 50 == 0:
                    print(f" [{j+1}]", end="", flush=True)
            total_filings += len(form4s)
            print(f" → {ticker_tx} tx")
        except Exception as e:
            print(f" BŁĄD: {e}")
            errors += 1

    with open(cfg.TRANSACTIONS_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=cfg.TX_COLUMNS)
        writer.writeheader()
        writer.writerows(all_tx)
    print(f"\n[EDGAR] DONE: {len(all_tx)} transakcji z {total_filings} "
          f"filingów ({errors} błędów)")
    print(f"        Zapisano: {cfg.TRANSACTIONS_FILE}")
    return cfg.TRANSACTIONS_FILE


# ============================================================================
# Prices (reuse price_fetcher)
# ============================================================================

def fetch_all_prices(force: bool = False) -> dict[str, pd.DataFrame]:
    """Pobiera dzienne OHLC z yfinance dla 6 APLS tickerów."""
    import yfinance as yf
    os.makedirs(cfg.PRICES_DIR, exist_ok=True)

    prices = {}
    for i, symbol in enumerate(cfg.ALL_TICKERS):
        path = os.path.join(cfg.PRICES_DIR, f"{symbol}.csv")
        if os.path.exists(path) and not force:
            df = pd.read_csv(path, index_col=0)
            df.index = pd.to_datetime(df.index, utc=True).tz_localize(None)
            prices[symbol] = df
            continue
        print(f"[PRICES] [{i+1}/{len(cfg.ALL_TICKERS)}] {symbol}...",
              end=" ", flush=True)
        start = cfg.START_DATE - timedelta(days=10)
        end = cfg.END_DATE + timedelta(days=60)
        try:
            t = yf.Ticker(symbol)
            df = t.history(start=start.isoformat(), end=end.isoformat(),
                           auto_adjust=True)
            if df.empty:
                print("brak danych")
                continue
            df = df[["Close"]].copy()
            df.index.name = "Date"
            df.to_csv(path)
            df.index = pd.to_datetime(df.index, utc=True).tz_localize(None) \
                if df.index.tz is not None else pd.to_datetime(df.index)
            prices[symbol] = df
            print(f"{len(df)} dni")
        except Exception as e:
            print(f"BŁĄD: {e}")
    print(f"[PRICES] DONE: {len(prices)}/{len(cfg.ALL_TICKERS)}")
    return prices


# ============================================================================
# Analyzer (minimal V5-style replication)
# ============================================================================

def _winsorize(arr: np.ndarray, pct: float = 1.0) -> np.ndarray:
    if len(arr) < 10:
        return arr
    lower = np.percentile(arr, pct)
    upper = np.percentile(arr, 100 - pct)
    return np.clip(arr, lower, upper)


def _cohens_d(arr_a: np.ndarray, arr_b: np.ndarray,
              winsorize: bool = True) -> Optional[float]:
    if len(arr_a) < 4 or len(arr_b) < 10:
        return None
    if winsorize:
        arr_a = _winsorize(arr_a, pct=1.0)
        arr_b = _winsorize(arr_b, pct=1.0)
    n1, n2 = len(arr_a), len(arr_b)
    s1, s2 = np.var(arr_a, ddof=1), np.var(arr_b, ddof=1)
    pooled_var = ((n1 - 1) * s1 + (n2 - 1) * s2) / (n1 + n2 - 2)
    pooled_std = np.sqrt(pooled_var)
    if pooled_std <= 0:
        return None
    return float((np.mean(arr_a) - np.mean(arr_b)) / pooled_std)


def get_price_at(df: pd.DataFrame, target: pd.Timestamp,
                 offset_days: int = 0) -> Optional[float]:
    if df is None or df.empty:
        return None
    mask = df.index >= target
    if not mask.any():
        return None
    start_idx = mask.argmax()
    target_idx = start_idx + offset_days
    if target_idx >= len(df):
        return None
    return float(df.iloc[target_idx]["Close"])


def compute_returns(prices: dict[str, pd.DataFrame], symbol: str,
                    event_date: str) -> Optional[dict]:
    df = prices.get(symbol)
    if df is None or df.empty:
        return None
    try:
        ts = pd.Timestamp(event_date)
    except ValueError:
        return None
    price_at = get_price_at(df, ts, 0)
    if price_at is None or price_at <= 0:
        return None
    returns = {}
    for label, offset in cfg.HORIZONS.items():
        fp = get_price_at(df, ts, offset)
        if fp is not None and fp > 0:
            returns[label] = (fp - price_at) / price_at * 100
        else:
            returns[label] = None
    if not any(v is not None for v in returns.values()):
        return None
    return {"price_at_event": price_at, "returns": returns}


def compute_baseline(prices: dict[str, pd.DataFrame], symbols: list[str],
                     n_samples: int = 5000, seed: int = 42) -> dict[str, list[float]]:
    rng = np.random.RandomState(seed)
    baseline = {h: [] for h in cfg.HORIZONS}
    all_dates = {}
    for sym in symbols:
        df = prices.get(sym)
        if df is not None and len(df) > 30:
            all_dates[sym] = df.index.tolist()
    if not all_dates:
        return baseline
    per_sample = max(1, n_samples // len(all_dates))
    for sym, dates in all_dates.items():
        max_idx = len(dates) - max(cfg.HORIZONS.values()) - 1
        if max_idx < 1:
            continue
        indices = rng.randint(0, max_idx, size=min(per_sample, max_idx))
        df = prices[sym]
        for idx in indices:
            base = df.iloc[idx]["Close"]
            if base <= 0:
                continue
            for label, offset in cfg.HORIZONS.items():
                future_idx = idx + offset
                if future_idx < len(df):
                    fp = df.iloc[future_idx]["Close"]
                    baseline[label].append((fp - base) / base * 100)
    return baseline


def horizon_stats(returns_list: list[dict], baseline: dict[str, list[float]],
                  direction: str = "buy") -> dict:
    """direction: 'buy' → hit = price up, 'sell' → down, 'any' → abs>1%."""
    result = {}
    for horizon in cfg.HORIZONS:
        values = [ev["returns"].get(horizon) for ev in returns_list
                  if ev["returns"].get(horizon) is not None]
        if len(values) < 3:
            result[horizon] = {"n": len(values), "insufficient_data": True}
            continue
        arr = np.array(values)
        bl = np.array(baseline.get(horizon, []))
        if direction == "sell":
            hits = np.sum(arr < 0)
        elif direction == "buy":
            hits = np.sum(arr > 0)
        else:
            hits = np.sum(np.abs(arr) > 1.0)
        hit_rate = float(hits / len(arr) * 100)
        if len(bl) > 0:
            if direction == "sell":
                bl_hits = np.sum(bl < 0)
            elif direction == "buy":
                bl_hits = np.sum(bl > 0)
            else:
                bl_hits = np.sum(np.abs(bl) > 1.0)
            bl_hit = float(bl_hits / len(bl) * 100)
        else:
            bl_hit = 50.0
        p_value = None
        if len(bl) > 10:
            try:
                _, p_value = scipy_stats.ttest_ind(arr, bl, equal_var=False)
                p_value = float(p_value)
            except Exception:
                pass
        d = _cohens_d(arr, bl, winsorize=True)
        result[horizon] = {
            "n": len(arr),
            "avg_return_pct": round(float(np.mean(arr)), 3),
            "median_return_pct": round(float(np.median(arr)), 3),
            "std_pct": round(float(np.std(arr)), 3),
            "hit_rate_pct": round(hit_rate, 1),
            "baseline_avg_pct": round(float(np.mean(bl)), 3) if len(bl) > 0 else None,
            "baseline_hit_rate_pct": round(bl_hit, 1),
            "p_value": round(p_value, 4) if p_value is not None else None,
            "effect_size_d": round(d, 3) if d is not None else None,
            "significant_005": p_value is not None and p_value < 0.05,
            "significant_001": p_value is not None and p_value < 0.01,
        }
    return result


def direct_tier_comparison(strict_events: list[dict],
                            stretch_events: list[dict]) -> dict:
    """Welch's t-test strict vs stretch (replikuje H6 direct comparison)."""
    out = {"n_strict": len(strict_events), "n_stretch": len(stretch_events),
           "horizons": {}}
    for horizon in cfg.HORIZONS:
        vs = [e["returns"].get(horizon) for e in strict_events
              if e["returns"].get(horizon) is not None]
        vt = [e["returns"].get(horizon) for e in stretch_events
              if e["returns"].get(horizon) is not None]
        if len(vs) < 4 or len(vt) < 4:
            out["horizons"][horizon] = {"insufficient_data": True,
                                        "n_strict": len(vs), "n_stretch": len(vt)}
            continue
        arr_s, arr_t = np.array(vs), np.array(vt)
        _, p = scipy_stats.ttest_ind(arr_s, arr_t, equal_var=False)
        d = _cohens_d(arr_s, arr_t, winsorize=True)
        out["horizons"][horizon] = {
            "n_strict": len(arr_s), "n_stretch": len(arr_t),
            "avg_strict_pct": round(float(np.mean(arr_s)), 3),
            "avg_stretch_pct": round(float(np.mean(arr_t)), 3),
            "p_value": round(float(p), 4),
            "effect_size_d": round(d, 3) if d is not None else None,
            "significant_005": float(p) < 0.05,
        }
    return out


def is_csuite_role(officer_title: str, is_officer) -> bool:
    if not is_officer or pd.isna(officer_title) or not officer_title:
        return False
    title_upper = str(officer_title).upper()
    return any(t.upper() in title_upper for t in cfg.CSUITE_TITLES)


def run_analysis(tx_file: str, prices: dict[str, pd.DataFrame]) -> dict:
    print("\n" + "=" * 60)
    print("APLS-CLASS BACKTEST — Faza 2")
    print("=" * 60)

    tx_df = pd.read_csv(tx_file)
    tx_df = tx_df[tx_df["transaction_date"].str.match(r"^20\d{2}-", na=False)].copy()
    tx_df = tx_df[tx_df["filing_date"].str.match(r"^20\d{2}-", na=False)].copy()

    # Dedup per insider×tydzień×typ (jak V5)
    tx_df["_week"] = (
        pd.to_datetime(tx_df["filing_date"]).dt.isocalendar().week.astype(str) +
        "-" + pd.to_datetime(tx_df["filing_date"]).dt.isocalendar().year.astype(str)
    )
    tx_df["_key"] = (tx_df["symbol"] + "|" + tx_df["insider_name"] + "|" +
                     tx_df["_week"] + "|" + tx_df["transaction_type"])
    n_before = len(tx_df)
    tx_df = tx_df.sort_values("total_value", ascending=False).drop_duplicates(
        subset=["_key"], keep="first"
    ).sort_values(["symbol", "filing_date"])
    print(f"Transakcje: {n_before} → {len(tx_df)} po dedup")

    # Standardize bool columns (CSV → string)
    for col in ("is_10b51_plan", "is_csuite", "is_officer", "is_director"):
        tx_df[col] = tx_df[col].astype(str).str.lower().isin(["true", "1"])

    print(f"  BUY:  {(tx_df['transaction_type'] == 'BUY').sum()}")
    print(f"  SELL: {(tx_df['transaction_type'] == 'SELL').sum()}")
    print(f"  10b5-1: {tx_df['is_10b51_plan'].sum()}")
    print(f"  C-suite: {tx_df['is_csuite'].sum()}")
    print(f"  Strict tier: {(tx_df['tier'] == 'strict').sum()}")
    print(f"  Stretch tier: {(tx_df['tier'] == 'stretch').sum()}")
    print(f"  Tickery: {sorted(tx_df['symbol'].unique().tolist())}")

    # Baseline (wszystkie 6 tickerów łącznie)
    symbols_with_data = [s for s in cfg.ALL_TICKERS if s in prices]
    print(f"\n[BASELINE] {len(symbols_with_data)} tickerów z cenami...")
    baseline_all = compute_baseline(prices, symbols_with_data, n_samples=10000)
    print(f"  baseline samples: {len(baseline_all.get('1d', []))}")

    # H_APLS_ALL: discretionary BUY all
    print("\n[H_APLS_ALL] Discretionary BUY (all)...")
    buys_all = tx_df[(tx_df["transaction_type"] == "BUY") &
                     (~tx_df["is_10b51_plan"])].copy()
    events_all = []
    for _, row in buys_all.iterrows():
        ret = compute_returns(prices, row["symbol"], row["filing_date"])
        if ret:
            events_all.append({
                **ret, "symbol": row["symbol"],
                "is_csuite": row["is_csuite"],
                "tier": row["tier"],
                "total_value": row["total_value"],
            })
    print(f"  {len(events_all)} events")
    h_all = horizon_stats(events_all, baseline_all, "buy")

    # H_APLS_CSUITE: discretionary BUY C-suite
    print("\n[H_APLS_CSUITE] C-suite discretionary BUY...")
    events_csuite = [e for e in events_all if e["is_csuite"]]
    print(f"  {len(events_csuite)} events")
    h_csuite = horizon_stats(events_csuite, baseline_all, "buy")

    # H_APLS_TIER: strict vs stretch direct
    print("\n[H_APLS_TIER] Strict tier vs stretch tier (BUY)...")
    events_strict = [e for e in events_all if e["tier"] == "strict"]
    events_stretch = [e for e in events_all if e["tier"] == "stretch"]
    print(f"  strict: {len(events_strict)}, stretch: {len(events_stretch)}")
    h_tier = direct_tier_comparison(events_strict, events_stretch)

    # Per-tier breakdown vs baseline
    h_strict_vs_baseline = horizon_stats(events_strict, baseline_all, "buy")
    h_stretch_vs_baseline = horizon_stats(events_stretch, baseline_all, "buy")

    # Value threshold breakdowns (BUY $100K / $500K / $1M)
    h_value_breakdowns = {}
    for thr in cfg.VALUE_THRESHOLDS:
        label = f"buys_above_{thr // 1000}k"
        filtered = [e for e in events_all if e["total_value"] >= thr]
        h_value_breakdowns[label] = {
            "n": len(filtered),
            "horizons": horizon_stats(filtered, baseline_all, "buy"),
        }

    # Per-ticker breakdown (which ticker drives signal?)
    h_per_ticker = {}
    for sym in cfg.ALL_TICKERS:
        sym_events = [e for e in events_all if e["symbol"] == sym]
        if len(sym_events) >= 3:
            h_per_ticker[sym] = {
                "n": len(sym_events),
                "horizons": horizon_stats(sym_events, baseline_all, "buy"),
            }

    # Bonferroni
    all_tests = []
    def _collect(obj):
        if isinstance(obj, dict):
            if "p_value" in obj and obj.get("p_value") is not None:
                all_tests.append(obj)
            for v in obj.values():
                _collect(v)
        elif isinstance(obj, list):
            for item in obj:
                _collect(item)

    bundle = {
        "h_apls_all": h_all,
        "h_apls_csuite": h_csuite,
        "h_apls_tier": h_tier,
        "h_strict_vs_baseline": h_strict_vs_baseline,
        "h_stretch_vs_baseline": h_stretch_vs_baseline,
        "h_value_breakdowns": h_value_breakdowns,
        "h_per_ticker": h_per_ticker,
    }
    _collect(bundle)

    n_tests = len(all_tests)
    if n_tests > 0:
        alpha_b = 0.05 / n_tests
        alpha_b_strict = 0.01 / n_tests
        for t in all_tests:
            p = t.get("p_value")
            if p is None:
                continue
            t["bonferroni_n_tests"] = n_tests
            t["bonferroni_threshold_005"] = round(alpha_b, 6)
            t["significant_bonferroni"] = p < alpha_b
            t["significant_bonferroni_strict"] = p < alpha_b_strict
        n_sig = sum(1 for t in all_tests if t.get("significant_bonferroni"))
        print(f"\n[BONFERRONI] {n_tests} testów, threshold={alpha_b:.6f}, "
              f"istotne: {n_sig}/{n_tests}")

    results = {
        "meta": {
            "date_generated": str(date.today()),
            "tickers_strict": cfg.TIER_STRICT,
            "tickers_stretch": cfg.TIER_STRETCH,
            "start_date": str(cfg.START_DATE),
            "end_date": str(cfg.END_DATE),
            "n_transactions": int(len(tx_df)),
            "n_buy_events": int(len(events_all)),
            "n_csuite_events": int(len(events_csuite)),
            "n_strict_events": int(len(events_strict)),
            "n_stretch_events": int(len(events_stretch)),
            "n_bonferroni_tests": n_tests,
        },
        **bundle,
    }
    os.makedirs(cfg.RESULTS_DIR, exist_ok=True)
    results_path = os.path.join(cfg.RESULTS_DIR, "apls_results.json")
    with open(results_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False, default=str)
    print(f"\n[WYNIKI] Zapisano: {results_path}")
    return results


# ============================================================================
# Report generator
# ============================================================================

def _fmt_p(p):
    if p is None:
        return "—"
    return f"{p:.4f}"


def _fmt_d(d):
    if d is None:
        return "—"
    return f"{d:+.3f}"


def _sig(h):
    if h.get("significant_bonferroni_strict"):
        return "✓✓✓"
    if h.get("significant_bonferroni"):
        return "✓✓"
    if h.get("significant_005"):
        return "✓"
    return "✗"


def _h_table(name: str, h: dict) -> str:
    lines = [
        f"### {name}", "",
        "| Horizon | N | Avg % | Hit % | Baseline % | d | p | Sig |",
        "|---|---:|---:|---:|---:|---:|---:|:--:|",
    ]
    for horizon in cfg.HORIZONS:
        row = h.get(horizon, {})
        if row.get("insufficient_data"):
            lines.append(f"| {horizon} | {row.get('n', 0)} | "
                         f"insufficient data | | | | | |")
            continue
        lines.append(
            f"| {horizon} | {row.get('n', 0)} | "
            f"{row.get('avg_return_pct', 0):+.2f} | "
            f"{row.get('hit_rate_pct', 0):.1f} | "
            f"{row.get('baseline_avg_pct', 0):+.2f} | "
            f"{_fmt_d(row.get('effect_size_d'))} | "
            f"{_fmt_p(row.get('p_value'))} | "
            f"{_sig(row)} |"
        )
    return "\n".join(lines)


def _tier_table(h: dict) -> str:
    lines = [
        "### H_APLS_TIER: strict vs stretch (BUY, direct Welch's t-test)", "",
        f"N_strict={h.get('n_strict', 0)}, N_stretch={h.get('n_stretch', 0)}",
        "",
        "| Horizon | N str | N str | Avg str | Avg stretch | d | p | Sig |",
        "|---|---:|---:|---:|---:|---:|---:|:--:|",
    ]
    for horizon in cfg.HORIZONS:
        row = h.get("horizons", {}).get(horizon, {})
        if row.get("insufficient_data"):
            lines.append(f"| {horizon} | {row.get('n_strict', 0)} | "
                         f"{row.get('n_stretch', 0)} | insufficient | | | | |")
            continue
        lines.append(
            f"| {horizon} | {row.get('n_strict', 0)} | "
            f"{row.get('n_stretch', 0)} | "
            f"{row.get('avg_strict_pct', 0):+.2f} | "
            f"{row.get('avg_stretch_pct', 0):+.2f} | "
            f"{_fmt_d(row.get('effect_size_d'))} | "
            f"{_fmt_p(row.get('p_value'))} | "
            f"{_sig(row)} |"
        )
    return "\n".join(lines)


def _decision_block(h_all: dict, h_csuite: dict) -> str:
    """Decision gate Faza 3 entry."""
    d_all_7d = h_all.get("7d", {}).get("effect_size_d")
    p_all_7d = h_all.get("7d", {}).get("p_value")
    d_cs_7d = h_csuite.get("7d", {}).get("effect_size_d")
    p_cs_7d = h_csuite.get("7d", {}).get("p_value")

    def _gate(d, p):
        if d is None or p is None:
            return "INDETERMINATE (insufficient data)"
        if d >= 0.5 and p < 0.01:
            return "**GO seed observation 30d** (d≥0.5 + p<0.01)"
        if d >= 0.2:
            return ("**GO seed obs CONSERVATIVE** (d 0.2-0.5; "
                    "threshold $200K + C-suite only)")
        return "**DROP** (d<0.2, brak edge)"

    return (
        "## Decyzja gate Faza 3 entry\n\n"
        f"### H_APLS_ALL (7d horizon)\n"
        f"- d={_fmt_d(d_all_7d)}, p={_fmt_p(p_all_7d)}\n"
        f"- Decision: {_gate(d_all_7d, p_all_7d)}\n\n"
        f"### H_APLS_CSUITE (7d horizon)\n"
        f"- d={_fmt_d(d_cs_7d)}, p={_fmt_p(p_cs_7d)}\n"
        f"- Decision: {_gate(d_cs_7d, p_cs_7d)}\n\n"
        f"### V5 healthcare core baseline (porównanie)\n"
        f"- V5 H5 all_buys 7d: d=+0.75 ✓✓✓ Bonferroni\n"
        f"- V5 H5 csuite_buys 7d: d=+0.92 ✓✓✓ Bonferroni\n"
        f"- APLS extrapolation hypothesis: jeśli d ≥ 0.5 raw → edge zachowany\n"
    )


def generate_report(results: dict) -> str:
    meta = results["meta"]
    lines = [
        f"# APLS-class backtest Faza 2 — wyniki",
        "",
        f"**Data:** {meta['date_generated']}",
        f"**Zakres:** {meta['start_date']} → {meta['end_date']}",
        f"**Tickery strict:** {', '.join(meta['tickers_strict'])}",
        f"**Tickery stretch:** {', '.join(meta['tickers_stretch'])}",
        f"**Transakcje (po dedup):** {meta['n_transactions']}",
        f"**BUY events:** {meta['n_buy_events']} (C-suite: {meta['n_csuite_events']})",
        f"**Strict events:** {meta['n_strict_events']}, "
        f"**Stretch events:** {meta['n_stretch_events']}",
        f"**Bonferroni tests:** {meta['n_bonferroni_tests']}",
        "",
        "## Hipotezy primary",
        "",
        _h_table("H_APLS_ALL — Discretionary BUY (all, all 6 tickers)",
                 results["h_apls_all"]),
        "",
        _h_table("H_APLS_CSUITE — C-suite discretionary BUY",
                 results["h_apls_csuite"]),
        "",
        _tier_table(results["h_apls_tier"]),
        "",
        "## Per-tier breakdown vs baseline",
        "",
        _h_table("Strict tier (URGN/ARDX/MNKD/CRSP) BUY vs baseline",
                 results["h_strict_vs_baseline"]),
        "",
        _h_table("Stretch tier (AXSM/RCKT) BUY vs baseline",
                 results["h_stretch_vs_baseline"]),
        "",
        "## Value threshold breakdowns",
        "",
    ]
    for label, group in results.get("h_value_breakdowns", {}).items():
        lines.append(_h_table(f"{label} (N={group['n']})", group["horizons"]))
        lines.append("")

    lines.append("## Per-ticker breakdown")
    lines.append("")
    for sym, group in results.get("h_per_ticker", {}).items():
        lines.append(_h_table(f"{sym} (N={group['n']})", group["horizons"]))
        lines.append("")

    lines.append("")
    lines.append(_decision_block(results["h_apls_all"], results["h_apls_csuite"]))
    lines.append("")
    lines.append("## Limitacje + caveats")
    lines.append("")
    lines.append(
        "- **N=6 tickerów** (vs V5 healthcare 28 tickerów) → mniejsze N events, "
        "wide CI, większy wpływ outlierów per ticker.\n"
        "- **Trailing 24 mies.** (vs V5 36 mies.) — wybrane bo APLS Faza 1.A "
        "research showed znaczne zmiany kompozycji universe (RCKT KRESLADI "
        "marzec 2026, świeże FDA approvals).\n"
        "- **Raw priceChange**, nie sector-adjusted (`FOLLOWUP-XBI-ADJUSTMENT.md` "
        "ship → Faza 4 monitoring quality, nie wymagane dla baseline edge test).\n"
        "- **No control group** w tym backtest — porównanie do V5 healthcare "
        "core ma być po-deploy w forward observation.\n"
        "- **Stretch tier N=2 tickers** → wide variance, treat tier comparison "
        "jako exploratory, nie definitive.\n"
    )
    return "\n".join(lines)


def save_report(report: str) -> str:
    os.makedirs(cfg.RESULTS_DIR, exist_ok=True)
    path = os.path.join(cfg.RESULTS_DIR, "apls_report.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write(report)
    return path


# ============================================================================
# CLI
# ============================================================================

def main():
    parser = argparse.ArgumentParser(description="APLS-class backtest Faza 2")
    parser.add_argument(
        "stage", nargs="?", default="all",
        choices=["all", "fetch", "analyze", "report"],
    )
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    print("\n" + "=" * 60)
    print("APLS-class universe expansion — Faza 2 backtest")
    print("=" * 60 + "\n")

    tx_file = cfg.TRANSACTIONS_FILE
    prices = None

    if args.stage in ("all", "fetch"):
        t0 = time.time()
        tx_file = fetch_all_form4(force=args.force)
        prices = fetch_all_prices(force=args.force)
        print(f"\n[FETCH] Done in {(time.time()-t0)/60:.1f} min")

    if args.stage in ("all", "analyze"):
        if prices is None:
            prices = fetch_all_prices(force=False)
        if not os.path.exists(tx_file):
            print(f"[BŁĄD] Brak {tx_file} — uruchom fetch")
            sys.exit(1)
        t0 = time.time()
        results = run_analysis(tx_file, prices)
        print(f"\n[ANALYZE] Done in {time.time()-t0:.1f}s")

    if args.stage in ("all", "report"):
        results_path = os.path.join(cfg.RESULTS_DIR, "apls_results.json")
        if not os.path.exists(results_path):
            print(f"[BŁĄD] Brak {results_path} — uruchom analyze")
            sys.exit(1)
        with open(results_path) as f:
            results = json.load(f)
        report = generate_report(results)
        path = save_report(report)
        print(f"\nRAPORT GOTOWY: {path}")


if __name__ == "__main__":
    main()
