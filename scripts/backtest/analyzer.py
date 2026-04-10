"""
Analiza hipotez insider trading patterns.
H1: Insider Clusters, H2: Single C-suite, H3: 10b5-1 vs discretionary,
H4: Role seniority, H5: BUY vs SELL signals.
Baseline: losowe daty na tych samych tickerach.
"""
from __future__ import annotations

import os
import json
from collections import defaultdict
from dataclasses import dataclass, field, asdict
from datetime import date, timedelta
from typing import Optional

import numpy as np
import pandas as pd
from scipy import stats as scipy_stats

from config import (
    CLUSTER_MIN_INSIDERS, CLUSTER_WINDOW_DAYS,
    HEALTHCARE_TICKERS, HORIZONS, RESULTS_DIR,
    VALUE_THRESHOLDS,
)
from price_fetcher import get_price_at_date


# =============================================================================
# Typy danych
# =============================================================================

@dataclass
class EventReturn:
    """Zwrot cenowy po jednym evencie insiderskim."""
    symbol: str
    event_date: str
    price_at_event: float
    returns: dict[str, float] = field(default_factory=dict)  # horizon → % return
    tx_type: str = ""       # BUY / SELL
    role: str = ""          # Officer/Director/10% Owner
    is_csuite: bool = False
    is_10b51: bool = False
    is_healthcare: bool = False
    total_value: float = 0.0
    n_insiders: int = 1     # dla clusterów


@dataclass
class HypothesisResult:
    """Wynik jednej hipotezy."""
    name: str
    description: str
    n_events: int = 0
    horizons: dict = field(default_factory=dict)
    # per horizon: avg_return, median_return, hit_rate, std, baseline_avg,
    # baseline_hit_rate, p_value, effect_size
    sub_groups: dict = field(default_factory=dict)  # sub-breakdowns


# =============================================================================
# Pomocnicze: obliczanie zwrotów
# =============================================================================

def _compute_returns(prices: dict[str, pd.DataFrame], symbol: str,
                     event_date_str: str) -> Optional[dict]:
    """Oblicza zwroty cenowe po evencie dla wszystkich horyzontów."""
    df = prices.get(symbol)
    if df is None or df.empty:
        return None

    try:
        event_date = pd.Timestamp(event_date_str)
    except ValueError:
        return None

    price_at = get_price_at_date(df, event_date, offset_days=0)
    if price_at is None or price_at <= 0:
        return None

    returns = {}
    for label, offset in HORIZONS.items():
        future_price = get_price_at_date(df, event_date, offset_days=offset)
        if future_price is not None and future_price > 0:
            returns[label] = (future_price - price_at) / price_at * 100
        else:
            returns[label] = None

    if not any(v is not None for v in returns.values()):
        return None

    return {"price_at_event": price_at, "returns": returns}


def _compute_baseline(prices: dict[str, pd.DataFrame],
                      symbols: list[str], n_samples: int = 5000,
                      seed: int = 42) -> dict[str, list[float]]:
    """
    Losowe daty na tych samych tickerach jako baseline.
    Zwraca {horizon: [returns...]}.
    """
    rng = np.random.RandomState(seed)
    baseline = {h: [] for h in HORIZONS}

    # Zbierz dostępne daty per ticker
    all_dates = {}
    for sym in symbols:
        df = prices.get(sym)
        if df is not None and len(df) > 30:
            all_dates[sym] = df.index.tolist()

    if not all_dates:
        return baseline

    symbols_with_data = list(all_dates.keys())
    per_sample = max(1, n_samples // len(symbols_with_data))

    for sym in symbols_with_data:
        dates = all_dates[sym]
        # Losuj daty (z marginesem na horyzonty)
        max_idx = len(dates) - max(HORIZONS.values()) - 1
        if max_idx < 1:
            continue
        indices = rng.randint(0, max_idx, size=min(per_sample, max_idx))

        df = prices[sym]
        for idx in indices:
            base_price = df.iloc[idx]["Close"]
            if base_price <= 0:
                continue
            for label, offset in HORIZONS.items():
                future_idx = idx + offset
                if future_idx < len(df):
                    future_price = df.iloc[future_idx]["Close"]
                    ret = (future_price - base_price) / base_price * 100
                    baseline[label].append(ret)

    return baseline


def _compute_dip_baseline(prices: dict[str, pd.DataFrame],
                          symbols: list[str], dip_threshold: float = -2.0,
                          seed: int = 45) -> dict[str, list[float]]:
    """
    Baseline: losowe dni PO DIPIE (spadek > dip_threshold %).
    Kontroluje mean reversion — jeśli insider BUY po dipie daje te same zwroty
    co losowy dip, to nie ma edge insiderskiego.
    """
    rng = np.random.RandomState(seed)
    baseline = {h: [] for h in HORIZONS}

    for sym in symbols:
        df = prices.get(sym)
        if df is None or len(df) < 30:
            continue

        closes = df["Close"].values
        # Znajdź dni z dziennym spadkiem > threshold
        daily_returns = np.diff(closes) / closes[:-1] * 100
        dip_indices = np.where(daily_returns <= dip_threshold)[0] + 1  # +1 = dzień po spadku

        max_offset = max(HORIZONS.values())
        valid_dips = [i for i in dip_indices if i + max_offset < len(closes)]

        if not valid_dips:
            continue

        # Losuj max 50 dipów per ticker (żeby nie zdominować dużymi tickerami)
        if len(valid_dips) > 50:
            valid_dips = rng.choice(valid_dips, size=50, replace=False).tolist()

        for idx in valid_dips:
            base_price = closes[idx]
            if base_price <= 0:
                continue
            for label, offset in HORIZONS.items():
                future_idx = idx + offset
                if future_idx < len(closes):
                    future_price = closes[future_idx]
                    ret = (future_price - base_price) / base_price * 100
                    baseline[label].append(ret)

    return baseline


# =============================================================================
# Hipotezy
# =============================================================================

def _horizon_stats(returns_list: list[EventReturn],
                   baseline: dict[str, list[float]],
                   direction: str = "any") -> dict:
    """
    Oblicza statystyki per horyzont.
    direction: "sell" → hit = price went down, "buy" → up, "any" → abs move
    """
    result = {}
    for horizon in HORIZONS:
        values = []
        for ev in returns_list:
            r = ev.returns.get(horizon)
            if r is not None:
                values.append(r)

        if len(values) < 3:
            result[horizon] = {"n": len(values), "insufficient_data": True}
            continue

        arr = np.array(values)
        bl = np.array(baseline.get(horizon, []))

        # Hit rate: kierunek zgodny z oczekiwanym
        # direction="any" → liczy abs(return) > 1% jako "ruch" (nie 100%)
        if direction == "sell":
            hits = np.sum(arr < 0)  # SELL → cena spadła = trafiony
        elif direction == "buy":
            hits = np.sum(arr > 0)  # BUY → cena wzrosła = trafiony
        else:
            hits = np.sum(np.abs(arr) > 1.0)  # >1% abs ruch = istotny event

        hit_rate = float(hits / len(arr) * 100) if len(arr) > 0 else 0

        # Baseline hit rate
        if len(bl) > 0:
            if direction == "sell":
                bl_hits = np.sum(bl < 0)
            elif direction == "buy":
                bl_hits = np.sum(bl > 0)
            else:
                bl_hits = np.sum(np.abs(bl) > 1.0)
            bl_hit_rate = float(bl_hits / len(bl) * 100)
        else:
            bl_hit_rate = 50.0

        # P-value (t-test vs baseline)
        p_value = None
        if len(bl) > 10 and len(arr) > 3:
            try:
                _, p_value = scipy_stats.ttest_ind(arr, bl, equal_var=False)
                p_value = float(p_value)
            except Exception:
                pass

        # Effect size (Cohen's d)
        effect_size = None
        if len(bl) > 10 and len(arr) > 3:
            pooled_std = np.sqrt((np.std(arr)**2 + np.std(bl)**2) / 2)
            if pooled_std > 0:
                effect_size = float((np.mean(arr) - np.mean(bl)) / pooled_std)

        result[horizon] = {
            "n": len(arr),
            "avg_return_pct": round(float(np.mean(arr)), 3),
            "median_return_pct": round(float(np.median(arr)), 3),
            "std_pct": round(float(np.std(arr)), 3),
            "hit_rate_pct": round(hit_rate, 1),
            "baseline_avg_pct": round(float(np.mean(bl)), 3) if len(bl) > 0 else None,
            "baseline_hit_rate_pct": round(bl_hit_rate, 1),
            "p_value": round(p_value, 4) if p_value is not None else None,
            "effect_size_d": round(effect_size, 3) if effect_size is not None else None,
            "significant_005": p_value is not None and p_value < 0.05,
            "significant_001": p_value is not None and p_value < 0.01,
        }

    return result


def analyze_h1_clusters(tx_df: pd.DataFrame,
                        prices: dict[str, pd.DataFrame],
                        baseline: dict[str, list[float]]) -> HypothesisResult:
    """
    H1: Insider Cluster — 2+ discretionary insiderów w 7 dni.
    Odpowiada wzorcowi INSIDER_CLUSTER w CorrelationService.
    """
    h = HypothesisResult(
        name="H1_INSIDER_CLUSTER",
        description=(f"{CLUSTER_MIN_INSIDERS}+ discretionary insiderów "
                     f"(non-10b5-1) w {CLUSTER_WINDOW_DAYS} dni")
    )

    # Filtr: discretionary only (non-10b5-1), SELL lub BUY
    disc = tx_df[
        (tx_df["is_10b51_plan"] == False) &
        (tx_df["transaction_type"].isin(["BUY", "SELL"]))
    ].copy()
    disc["filing_date"] = pd.to_datetime(disc["filing_date"], format="%Y-%m-%d")
    disc = disc.sort_values(["symbol", "filing_date"])

    events = []
    for symbol, group in disc.groupby("symbol"):
        dates = group["filing_date"].values

        i = 0
        while i < len(dates):
            window_end = dates[i] + np.timedelta64(CLUSTER_WINDOW_DAYS, "D")
            cluster_mask = (dates >= dates[i]) & (dates <= window_end)
            cluster = group[cluster_mask]

            unique_insiders = cluster["insider_name"].nunique()
            if unique_insiders >= CLUSTER_MIN_INSIDERS:
                # Użyj OSTATNIEJ filing_date klastra (rynek widzi pełny klaster)
                cluster_date = str(pd.Timestamp(dates[cluster_mask][-1]).date())
                dominant_type = cluster["transaction_type"].mode().iloc[0]

                ret_data = _compute_returns(prices, symbol, cluster_date)
                if ret_data:
                    ev = EventReturn(
                        symbol=symbol,
                        event_date=cluster_date,
                        price_at_event=ret_data["price_at_event"],
                        returns=ret_data["returns"],
                        tx_type=dominant_type,
                        n_insiders=unique_insiders,
                        is_healthcare=symbol in HEALTHCARE_TICKERS,
                        is_csuite=bool(cluster["is_csuite"].any()),
                    )
                    events.append(ev)

                # Przeskocz klaster
                i += int(cluster_mask.sum())
                continue
            i += 1

    h.n_events = len(events)
    if events:
        # Split po typie
        sell_events = [e for e in events if e.tx_type == "SELL"]
        buy_events = [e for e in events if e.tx_type == "BUY"]

        h.horizons = _horizon_stats(events, baseline, direction="any")
        h.sub_groups = {
            "sell_clusters": {
                "n": len(sell_events),
                "horizons": _horizon_stats(sell_events, baseline, "sell"),
            },
            "buy_clusters": {
                "n": len(buy_events),
                "horizons": _horizon_stats(buy_events, baseline, "buy"),
            },
            "csuite_clusters": {
                "n": len([e for e in events if e.is_csuite]),
                "horizons": _horizon_stats(
                    [e for e in events if e.is_csuite], baseline, "any"
                ),
            },
            "healthcare_only": {
                "n": len([e for e in events if e.is_healthcare]),
                "horizons": _horizon_stats(
                    [e for e in events if e.is_healthcare], baseline, "any"
                ),
            },
        }

    return h


def analyze_h2_single_csuite(tx_df: pd.DataFrame,
                              prices: dict[str, pd.DataFrame],
                              baseline: dict[str, list[float]]) -> HypothesisResult:
    """
    H2: Pojedyncza transakcja C-suite (non-10b5-1).
    Podział na progi wartości: $100K, $500K, $1M+.
    """
    h = HypothesisResult(
        name="H2_SINGLE_CSUITE",
        description="Pojedyncza C-suite discretionary transakcja (SELL + BUY)",
    )

    csuite = tx_df[
        (tx_df["is_csuite"] == True) &
        (tx_df["is_10b51_plan"] == False) &
        (tx_df["transaction_type"].isin(["BUY", "SELL"]))
    ].copy()

    events = []
    for _, row in csuite.iterrows():
        ret_data = _compute_returns(prices, row["symbol"], row["filing_date"])
        if ret_data:
            events.append(EventReturn(
                symbol=row["symbol"],
                event_date=row["filing_date"],
                price_at_event=ret_data["price_at_event"],
                returns=ret_data["returns"],
                tx_type=row["transaction_type"],
                role=row["insider_role"],
                is_csuite=True,
                is_10b51=False,
                total_value=row["total_value"],
                is_healthcare=row["is_healthcare"],
            ))

    h.n_events = len(events)
    if events:
        sells = [e for e in events if e.tx_type == "SELL"]
        buys = [e for e in events if e.tx_type == "BUY"]
        
        h.horizons = _horizon_stats(events, baseline, "any")
        h.sub_groups = {
            "all_sells": {
                "n": len(sells),
                "horizons": _horizon_stats(sells, baseline, "sell"),
            },
            "all_buys": {
                "n": len(buys),
                "horizons": _horizon_stats(buys, baseline, "buy"),
            },
        }

        # Podział po wartości transakcji
        for threshold in VALUE_THRESHOLDS:
            label = f"sells_above_{threshold//1000}k"
            filtered = [e for e in sells if e.total_value >= threshold]
            h.sub_groups[label] = {
                "n": len(filtered),
                "horizons": _horizon_stats(filtered, baseline, "sell"),
            }

            label_buy = f"buys_above_{threshold//1000}k"
            filtered_buy = [e for e in buys if e.total_value >= threshold]
            h.sub_groups[label_buy] = {
                "n": len(filtered_buy),
                "horizons": _horizon_stats(filtered_buy, baseline, "buy"),
            }

    return h


def analyze_h3_plan_vs_discretionary(tx_df: pd.DataFrame,
                                      prices: dict[str, pd.DataFrame],
                                      baseline: dict[str, list[float]]) -> HypothesisResult:
    """
    H3: 10b5-1 plan vs discretionary.
    Weryfikacja: czy filtr is10b51Plan→skip jest uzasadniony.
    """
    h = HypothesisResult(
        name="H3_PLAN_VS_DISCRETIONARY",
        description="10b5-1 (automat) vs discretionary (decyzja) — porównanie predyktywności",
    )

    sells = tx_df[tx_df["transaction_type"] == "SELL"].copy()

    plan_events = []
    disc_events = []

    for _, row in sells.iterrows():
        ret_data = _compute_returns(prices, row["symbol"], row["filing_date"])
        if not ret_data:
            continue
        ev = EventReturn(
            symbol=row["symbol"],
            event_date=row["filing_date"],
            price_at_event=ret_data["price_at_event"],
            returns=ret_data["returns"],
            tx_type="SELL",
            is_10b51=row["is_10b51_plan"],
            is_healthcare=row["is_healthcare"],
        )
        if row["is_10b51_plan"]:
            plan_events.append(ev)
        else:
            disc_events.append(ev)

    h.n_events = len(plan_events) + len(disc_events)
    h.sub_groups = {
        "10b51_plan": {
            "n": len(plan_events),
            "horizons": _horizon_stats(plan_events, baseline, "sell"),
        },
        "discretionary": {
            "n": len(disc_events),
            "horizons": _horizon_stats(disc_events, baseline, "sell"),
        },
    }

    return h


def analyze_h4_role_seniority(tx_df: pd.DataFrame,
                               prices: dict[str, pd.DataFrame],
                               baseline: dict[str, list[float]]) -> HypothesisResult:
    """
    H4: Role seniority — CEO/CFO vs Director vs Other.
    Weryfikacja: czy C-suite boost w pipeline jest uzasadniony.
    """
    h = HypothesisResult(
        name="H4_ROLE_SENIORITY",
        description="C-suite vs Director vs Other — predyktywność per rola",
    )

    disc = tx_df[
        (tx_df["is_10b51_plan"] == False) &
        (tx_df["transaction_type"] == "SELL")
    ].copy()

    role_groups = {"csuite": [], "director": [], "other": []}

    for _, row in disc.iterrows():
        ret_data = _compute_returns(prices, row["symbol"], row["filing_date"])
        if not ret_data:
            continue
        ev = EventReturn(
            symbol=row["symbol"],
            event_date=row["filing_date"],
            price_at_event=ret_data["price_at_event"],
            returns=ret_data["returns"],
            tx_type="SELL",
            role=row["insider_role"],
            is_csuite=row["is_csuite"],
            is_healthcare=row["is_healthcare"],
        )

        if row["is_csuite"]:
            role_groups["csuite"].append(ev)
        elif row["is_director"]:
            role_groups["director"].append(ev)
        else:
            role_groups["other"].append(ev)

    total = sum(len(v) for v in role_groups.values())
    h.n_events = total
    for role, events in role_groups.items():
        h.sub_groups[role] = {
            "n": len(events),
            "horizons": _horizon_stats(events, baseline, "sell"),
        }

    return h


def analyze_h5_buy_signals(tx_df: pd.DataFrame,
                            prices: dict[str, pd.DataFrame],
                            baseline: dict[str, list[float]],
                            dip_baseline: dict[str, list[float]] = None) -> HypothesisResult:
    """
    H5: Discretionary BUY — czy warto alertować?
    Porównanie z dwoma baseline: losowy dzień (standard) i losowy dip >2% (mean reversion control).
    """
    h = HypothesisResult(
        name="H5_BUY_SIGNALS",
        description="Discretionary BUY (non-10b5-1) — czy predyktywne?",
    )

    buys = tx_df[
        (tx_df["is_10b51_plan"] == False) &
        (tx_df["transaction_type"] == "BUY")
    ].copy()

    events = []
    for _, row in buys.iterrows():
        ret_data = _compute_returns(prices, row["symbol"], row["filing_date"])
        if not ret_data:
            continue
        events.append(EventReturn(
            symbol=row["symbol"],
            event_date=row["filing_date"],
            price_at_event=ret_data["price_at_event"],
            returns=ret_data["returns"],
            tx_type="BUY",
            is_csuite=row["is_csuite"],
            total_value=row["total_value"],
            is_healthcare=row["is_healthcare"],
        ))

    h.n_events = len(events)
    if events:
        h.horizons = _horizon_stats(events, baseline, "buy")
        h.sub_groups = {
            "csuite_buys": {
                "n": len([e for e in events if e.is_csuite]),
                "horizons": _horizon_stats(
                    [e for e in events if e.is_csuite], baseline, "buy"
                ),
            },
            "director_buys": {
                "n": len([e for e in events if not e.is_csuite]),
                "horizons": _horizon_stats(
                    [e for e in events if not e.is_csuite], baseline, "buy"
                ),
            },
            "healthcare_buys": {
                "n": len([e for e in events if e.is_healthcare]),
                "horizons": _horizon_stats(
                    [e for e in events if e.is_healthcare], baseline, "buy"
                ),
            },
            "buys_above_100k": {
                "n": len([e for e in events if e.total_value >= 100_000]),
                "horizons": _horizon_stats(
                    [e for e in events if e.total_value >= 100_000], baseline, "buy"
                ),
            },
            "buys_above_500k": {
                "n": len([e for e in events if e.total_value >= 500_000]),
                "horizons": _horizon_stats(
                    [e for e in events if e.total_value >= 500_000], baseline, "buy"
                ),
            },
        }

        # Porównanie z dip baseline (kontrola mean reversion)
        if dip_baseline:
            h.sub_groups["vs_random_dip_ALL"] = {
                "n": len(events),
                "horizons": _horizon_stats(events, dip_baseline, "buy"),
                "_note": "Baseline = losowe dni po spadku >2%. Jeśli brak istotności → mean reversion, nie edge.",
            }
            csuite_b = [e for e in events if e.is_csuite]
            if csuite_b:
                h.sub_groups["vs_random_dip_CSUITE"] = {
                    "n": len(csuite_b),
                    "horizons": _horizon_stats(csuite_b, dip_baseline, "buy"),
                }

    return h


def analyze_healthcare_vs_control(tx_df: pd.DataFrame,
                                   prices: dict[str, pd.DataFrame],
                                   baseline_hc: dict[str, list[float]],
                                   baseline_ctrl: dict[str, list[float]]) -> HypothesisResult:
    """
    H6 (bonus): Healthcare vs Control Group — czy insider edge jest sector-specific?
    """
    h = HypothesisResult(
        name="H6_HEALTHCARE_VS_CONTROL",
        description="Insider SELL predyktywność: healthcare vs non-healthcare control group",
    )

    disc_sells = tx_df[
        (tx_df["is_10b51_plan"] == False) &
        (tx_df["transaction_type"] == "SELL") &
        (tx_df["is_csuite"] == True)
    ].copy()

    hc_events = []
    ctrl_events = []

    for _, row in disc_sells.iterrows():
        ret_data = _compute_returns(prices, row["symbol"], row["filing_date"])
        if not ret_data:
            continue
        ev = EventReturn(
            symbol=row["symbol"],
            event_date=row["filing_date"],
            price_at_event=ret_data["price_at_event"],
            returns=ret_data["returns"],
            tx_type="SELL",
            is_healthcare=row["is_healthcare"],
        )
        if row["is_healthcare"]:
            hc_events.append(ev)
        else:
            ctrl_events.append(ev)

    h.n_events = len(hc_events) + len(ctrl_events)
    h.sub_groups = {
        "healthcare": {
            "n": len(hc_events),
            "horizons": _horizon_stats(hc_events, baseline_hc, "sell"),
        },
        "control_group": {
            "n": len(ctrl_events),
            "horizons": _horizon_stats(ctrl_events, baseline_ctrl, "sell"),
        },
    }

    return h


# =============================================================================
# Główna funkcja analizy
# =============================================================================

def run_analysis(transactions_csv: str,
                 prices: dict[str, pd.DataFrame]) -> list[HypothesisResult]:
    """Uruchamia wszystkie hipotezy. Zwraca listę wyników."""

    print("\n" + "=" * 60)
    print("ANALIZA HIPOTEZ INSIDER TRADING PATTERNS")
    print("=" * 60)

    # Wczytaj transakcje
    tx_df = pd.read_csv(transactions_csv)
    # Filtruj błędne daty (np. rok 0025 zamiast 2025 z SEC XML)
    tx_df = tx_df[tx_df["transaction_date"].str.match(r"^20\d{2}-", na=False)].copy()
    tx_df = tx_df[tx_df["filing_date"].str.match(r"^20\d{2}-", na=False)].copy()
    # V2 (P0.5 fix): zawężamy tx_df tylko do healthcare tickers
    # H5 i H1 nie filtrowały po tickerach — używały wszystkich 61. Fix:
    tx_df = tx_df[tx_df["is_healthcare"] == True].copy()
    print(f"\nTransakcje (raw, po filtrze healthcare {len(HEALTHCARE_TICKERS)} tickerów): {len(tx_df)}")

    # Deduplikacja: kolapsuj wiele transakcji per (symbol, insider, tydzień, typ)
    # do jednego eventu — zapobiega pompowaniu N przez wewnątrz-tickerowe korelacje
    tx_df["_week"] = pd.to_datetime(tx_df["filing_date"]).dt.isocalendar().week.astype(str) + \
                     "-" + pd.to_datetime(tx_df["filing_date"]).dt.isocalendar().year.astype(str)
    tx_df["_dedup_key"] = tx_df["symbol"] + "|" + tx_df["insider_name"] + "|" + \
                          tx_df["_week"] + "|" + tx_df["transaction_type"]
    n_before = len(tx_df)
    # Zachowaj największą transakcję per klucz deduplikacji
    tx_df = tx_df.sort_values("total_value", ascending=False).drop_duplicates(
        subset=["_dedup_key"], keep="first"
    ).sort_values(["symbol", "filing_date"])
    print(f"Transakcje (po deduplikacji per insider×tydzień): {len(tx_df)} "
          f"(usunięto {n_before - len(tx_df)} duplikatów)")

    # Statystyki danych
    print(f"  SELL: {len(tx_df[tx_df['transaction_type'] == 'SELL'])}")
    print(f"  BUY:  {len(tx_df[tx_df['transaction_type'] == 'BUY'])}")
    print(f"  10b5-1: {tx_df['is_10b51_plan'].sum()}")
    print(f"  C-suite: {tx_df['is_csuite'].sum()}")
    print(f"  Healthcare: {tx_df['is_healthcare'].sum()}")
    print(f"  Control: {(~tx_df['is_healthcare']).sum()}")
    print(f"  Tickery: {tx_df['symbol'].nunique()}")

    # Baseline
    print("\n[BASELINE] Obliczam losowe zwroty...")
    hc_symbols = [s for s in HEALTHCARE_TICKERS if s in prices]
    ctrl_symbols = [s for s in tx_df[~tx_df["is_healthcare"]]["symbol"].unique()
                    if s in prices]
    all_symbols = [s for s in tx_df["symbol"].unique() if s in prices]

    baseline_all = _compute_baseline(prices, all_symbols, n_samples=10000)
    baseline_hc = _compute_baseline(prices, hc_symbols, n_samples=5000, seed=43)
    baseline_ctrl = _compute_baseline(prices, ctrl_symbols, n_samples=5000, seed=44)

    # Dip baseline — kontrola mean reversion (losowe dni po spadku >2%)
    print("[BASELINE DIP] Obliczam zwroty po losowych dipach >2%...")
    dip_baseline_all = _compute_dip_baseline(prices, all_symbols)
    n_dip = len(dip_baseline_all.get("1d", []))
    print(f"  dip baseline: {n_dip} samples")

    for h, bl in [("all", baseline_all), ("healthcare", baseline_hc),
                  ("control", baseline_ctrl)]:
        n = len(bl.get("1d", []))
        print(f"  {h}: {n} samples")

    # Hipotezy
    results = []

    print("\n[H1] Insider Clusters...")
    h1 = analyze_h1_clusters(tx_df, prices, baseline_all)
    results.append(h1)
    print(f"     {h1.n_events} clusterów znalezionych")

    print("[H2] Single C-suite transakcje...")
    h2 = analyze_h2_single_csuite(tx_df, prices, baseline_all)
    results.append(h2)
    print(f"     {h2.n_events} transakcji")

    print("[H3] 10b5-1 vs Discretionary...")
    h3 = analyze_h3_plan_vs_discretionary(tx_df, prices, baseline_all)
    results.append(h3)
    print(f"     {h3.n_events} transakcji")

    print("[H4] Role Seniority...")
    h4 = analyze_h4_role_seniority(tx_df, prices, baseline_all)
    results.append(h4)
    print(f"     {h4.n_events} transakcji")

    print("[H5] BUY Signals (+ dip baseline kontrola)...")
    h5 = analyze_h5_buy_signals(tx_df, prices, baseline_all, dip_baseline_all)
    results.append(h5)
    print(f"     {h5.n_events} transakcji")

    print("[H6] Healthcare vs Control...")
    h6 = analyze_healthcare_vs_control(tx_df, prices, baseline_hc, baseline_ctrl)
    results.append(h6)
    print(f"     {h6.n_events} transakcji")

    # Zapis JSON
    os.makedirs(RESULTS_DIR, exist_ok=True)
    results_path = os.path.join(RESULTS_DIR, "backtest_results.json")
    with open(results_path, "w", encoding="utf-8") as f:
        json.dump([asdict(r) for r in results], f, indent=2, ensure_ascii=False,
                  default=str)
    print(f"\n[WYNIKI] Zapisano: {results_path}")

    return results
