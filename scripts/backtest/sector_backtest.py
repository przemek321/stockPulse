"""
Sektor czy sygnał — czy efekt 90d insider BUY (POZYTYWNY w healthcare, teczka HORYZONT) występuje poza HC (08.11.2026).

Pre-rejestracja: doc/TECZKA-SEKTOR-VS-SYGNAL-2026-11-08.md — sekcja „Poprawka planu (v2)" (wiąże; v1 uchylone).
NIE zmieniać progów po zobaczeniu wyników.

Metoda = horizon_backtest.py (te same funkcje: czyszczenie, epizody, NET, permutacja, bootstrap, werdykt), plus:
  - korekta splitów (cena z Form 4 nominalna vs ceny yfinance skorygowane — SMCI 10:1 10.2024),
  - grupy HC (= G1) / CTRL / SEMI osobno, benchmark = ETF sektora/podsektora dla KAŻDEJ grupy, wariant SPY dla wszystkich,
  - D = różnica w różnicach (grupa X vs HC) ze WSPÓLNYM przesunięciem kalendarza, CI z bootstrapu klastrowego w grupach.

Wyniki HORYZONT (horizon_results.json) są nietknięte — tu osobne pliki sector_*.

Użycie (z katalogu scripts/backtest, venv .venv):
  python sector_backtest.py prices      # tylko BRAKUJĄCE symbole (semi + ETF sektorowe) + splity → data/prices_ohlc/
  python sector_backtest.py validate    # walidacja danych semi + cen
  python sector_backtest.py mde         # N epizodów per grupa/ticker + MDE — BEZ wyników zdarzeń
  python sector_backtest.py run         # → data/results/sector_results.json + sector_tables.md
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date

import numpy as np
import pandas as pd

import horizon_backtest as hb
from config import (CIK_CACHE_FILE_DEFAULT, CIK_CACHE_FILE_SEMI, CONTROL_TICKERS, DATA_DIR, HEALTHCARE_TICKERS,
                    RESULTS_DIR, SEMI_TICKERS, SEMI_TRANSACTIONS_FILE)

HC_TX_FILE = f"{DATA_DIR}/form4_transactions_v6.csv"
SPLITS_FILE = f"{hb.OHLC_DIR}/_splits.json"
RESULTS_FILE = f"{RESULTS_DIR}/sector_results.json"
TABLES_FILE = f"{RESULTS_DIR}/sector_tables.md"
MDE_FILE = f"{RESULTS_DIR}/sector_mde.json"
PRICE_END = "2026-11-07"  # ten sam koniec co ceny HORYZONT (kalendarz SPY do 06.11.2026)

PRIMARY = ("SEMI", "90d")
MIN_N_PRIMARY = 15          # epizodów z pełnym horyzontem 90d — inaczej „insufficient N"
GROUPS = ["HC", "CTRL", "SEMI"]

SECTOR_BENCHMARK_MAP = {
    **{s: b for s, b in hb.BENCHMARK_MAP.items() if s in HEALTHCARE_TICKERS},
    # CTRL — ETF sektorowe (teczka v2)
    **{s: "XLK" for s in ["AAPL", "MSFT", "NVDA"]},
    **{s: "XLC" for s in ["GOOGL", "META"]},
    **{s: "XLY" for s in ["AMZN", "TSLA", "MCD"]},
    **{s: "XLF" for s in ["JPM", "GS", "BAC", "MS", "WFC"]},
    **{s: "XLP" for s in ["WMT", "COST", "PG", "KO", "PEP"]},
    **{s: "XLE" for s in ["XOM", "CVX", "COP"]},
    **{s: "XLI" for s in ["CAT", "DE", "HON", "GE"]},
    # SEMI — półprzewodniki → SOXX, sprzęt IT / OEM / storage → XLK
    **{s: "SOXX" for s in ["MU", "AMKR", "KLIC", "ONTO", "CAMT", "NVMI", "ASX"]},
    **{s: "XLK" for s in ["DELL", "HPE", "HPQ", "NTAP", "SMCI", "STX", "WDC"]},
}
SECTOR_ETFS = sorted(set(SECTOR_BENCHMARK_MAP.values()) | {"SPY"})
ALL_SYMBOLS = HEALTHCARE_TICKERS + CONTROL_TICKERS + SEMI_TICKERS

# WDC: spin-off Sandisk 24.02.2025. Wypełniane PRZED `run` po ręcznej weryfikacji cen (validate): True = Yahoo
# NIE skorygował historii → epizody WDC z oknem obejmującym tę datę są wykluczane.
WDC_SPINOFF_DATE = pd.Timestamp("2025-02-24")
WDC_SPINOFF_UNADJUSTED: bool | None = False  # 08.11 validate: 21.02→24.02.2025 Close 51,68→48,78 (−5,6%), Yahoo split 1,323 = korekta


def group_of(symbol: str) -> str:
    if symbol in HEALTHCARE_TICKERS:
        return "HC"
    if symbol in CONTROL_TICKERS:
        return "CTRL"
    if symbol in SEMI_TICKERS:
        return "SEMI"
    raise KeyError(f"ticker spoza uniwersum: {symbol}")


# ──────────────────────────────────────────────────────────────────────────────
# Dane
# ──────────────────────────────────────────────────────────────────────────────

def load_splits(path: str = SPLITS_FILE) -> dict[str, list[tuple[pd.Timestamp, float]]]:
    if not os.path.exists(path):
        raise FileNotFoundError(f"brak {path} — uruchom `sector_backtest.py prices`")
    with open(path) as f:
        raw = json.load(f)
    return {s: [(pd.Timestamp(d), float(r)) for d, r in v] for s, v in raw.items()}


def load_all_transactions(files: list[str]) -> pd.DataFrame:
    return pd.concat([hb.load_transactions(f) for f in files], ignore_index=True)


def merged_cik_map(paths: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for p in paths:
        for k, v in hb.load_cik_map(p).items():
            if k in out and out[k] != v:
                raise ValueError(f"sprzeczne CIK dla {k}: {out[k]} vs {v}")
            out[k] = v
    return out


def check_coverage(ep: pd.DataFrame, prices: dict, benches: dict, bench_map: dict) -> None:
    """Każdy ticker z epizodu musi mieć ceny i benchmark — inaczej epizody cicho zniknęłyby jako NaN."""
    problems = []
    for s in sorted(ep["symbol"].unique()):
        if s not in prices or prices[s].empty:
            problems.append(f"{s}: brak cen")
        b = bench_map.get(s)
        if b is None:
            problems.append(f"{s}: brak benchmarku w mapie")
        elif b not in benches or benches[b].empty:
            problems.append(f"{s}: brak cen benchmarku {b}")
    if problems:
        raise RuntimeError("niekompletne dane: " + "; ".join(problems))


def wdc_spinoff_mask(ep: pd.DataFrame, calendar: pd.DatetimeIndex, n: int) -> np.ndarray:
    """True dla epizodów WDC, których okno [wejście, wejście+n−1] obejmuje 24.02.2025."""
    k = int(calendar.searchsorted(WDC_SPINOFF_DATE))
    idx = ep["entry_idx"].to_numpy().astype(int)
    return (ep["symbol"].to_numpy() == "WDC") & (idx <= k) & (idx + n - 1 >= k)


def prepare(tx_files: list[str] | None = None, cik_files: list[str] | None = None):
    calendar = hb.load_ohlc(hb.CALENDAR_SYMBOL).index
    prices = {s: hb.load_ohlc(s) for s in ALL_SYMBOLS}
    benches = {b: hb.load_ohlc(b) for b in SECTOR_ETFS}
    tx = load_all_transactions(tx_files or [HC_TX_FILE, SEMI_TRANSACTIONS_FILE])
    cik = merged_cik_map(cik_files or [CIK_CACHE_FILE_DEFAULT, CIK_CACHE_FILE_SEMI])
    clean, log = hb.clean_transactions(tx, cik, prices, splits=load_splits())
    ep = hb.build_episodes(clean, calendar)
    check_coverage(ep, prices, benches, SECTOR_BENCHMARK_MAP)
    ep["group"] = [group_of(s) for s in ep["symbol"]]
    return calendar, prices, benches, tx, clean, log, ep


def nets_for(n: int, calendar, prices, benches, mode: str) -> dict[str, np.ndarray]:
    """mode: 'sector' (ETF sektora/podsektora) albo 'spy'."""
    out = {}
    for s, px in prices.items():
        if px.empty:
            continue
        b = SECTOR_BENCHMARK_MAP[s] if mode == "sector" else "SPY"
        out[s] = hb.net_matrix(px, benches[b], calendar, n)
    return out


def drop_wdc(e: pd.DataFrame, calendar, n: int) -> pd.DataFrame:
    if WDC_SPINOFF_UNADJUSTED:
        return e[~wdc_spinoff_mask(e, calendar, n)]
    return e


# ──────────────────────────────────────────────────────────────────────────────
# Statystyka: różnica w różnicach (testowane w tests/test_sector_backtest.py)
# ──────────────────────────────────────────────────────────────────────────────

def _shifted_means(ep: pd.DataFrame, nets: dict[str, np.ndarray], ks: np.ndarray) -> tuple[float, np.ndarray]:
    vals = hb.episode_nets(ep, nets)
    ok = ~np.isnan(vals)
    syms = ep["symbol"].to_numpy()[ok]
    idx = ep["entry_idx"].to_numpy().astype(int)[ok]
    m = len(nets[syms[0]])
    stack = np.vstack([nets[s] for s in syms])
    rows = np.arange(len(syms))[:, None]
    shifted = (idx[:, None] + ks[None, :]) % m
    with np.errstate(invalid="ignore"):
        perm = np.nanmean(stack[rows, shifted], axis=0)
    return float(vals[ok].mean()), perm


def _cluster_means(ep: pd.DataFrame, vals: np.ndarray, b: int, rng) -> np.ndarray:
    ok = ~np.isnan(vals)
    df = pd.DataFrame({"s": ep["symbol"].to_numpy()[ok], "v": vals[ok]})
    groups = [g["v"].to_numpy() for _, g in df.groupby("s")]
    sums = np.array([g.sum() for g in groups])
    cnts = np.array([len(g) for g in groups])
    pick = rng.integers(0, len(groups), size=(b, len(groups)))
    return sums[pick].sum(axis=1) / cnts[pick].sum(axis=1)


def diff_in_diff(ep_x: pd.DataFrame, nets_x: dict, ep_h: pd.DataFrame, nets_h: dict,
                 b: int = hb.B_PERM, seed: int = hb.SEED, level: float = 0.95) -> dict:
    """D = (śr zdarzeń X − śr dni losowych X) − (śr zdarzeń H − śr dni losowych H).

    Dni losowe = te same wejścia przesunięte o WSPÓLNE k sesji (cyklicznie) w obu grupach — p dwustronne
    z rozkładu D_k; CI z bootstrapu klastrowego po tickerach, losowanego niezależnie w każdej grupie.
    """
    vx, vh = hb.episode_nets(ep_x, nets_x), hb.episode_nets(ep_h, nets_h)
    nx, nh = int((~np.isnan(vx)).sum()), int((~np.isnan(vh)).sum())
    if nx < 2 or nh < 2:
        return {"D": None, "p_two_sided": None, "ci95": [None, None], "n_x": nx, "n_h": nh}
    any_sym = ep_x["symbol"].to_numpy()[~np.isnan(vx)][0]
    m = len(nets_x[any_sym])
    rng = np.random.default_rng(seed)
    ks = rng.integers(1, m, size=b)
    obs_x, perm_x = _shifted_means(ep_x, nets_x, ks)
    obs_h, perm_h = _shifted_means(ep_h, nets_h, ks)
    ok = ~(np.isnan(perm_x) | np.isnan(perm_h))
    perm_x, perm_h = perm_x[ok], perm_h[ok]
    null_x, null_h = float(perm_x.mean()), float(perm_h.mean())
    d_obs = (obs_x - null_x) - (obs_h - null_h)
    d_perm = (perm_x - perm_h) - (null_x - null_h)
    p = (1 + np.sum(np.abs(d_perm) >= abs(d_obs))) / (len(d_perm) + 1)
    rng_b = np.random.default_rng(seed + 1)
    bx = _cluster_means(ep_x, vx, b, rng_b)
    bh = _cluster_means(ep_h, vh, b, rng_b)
    db = (bx - bh) - (null_x - null_h)
    lo, hi = np.percentile(db, [(1 - level) / 2 * 100, (1 + level) / 2 * 100])
    return {"D": float(d_obs), "p_two_sided": float(p), "ci95": [float(lo), float(hi)],
            "null_mean_x": null_x, "null_mean_h": null_h, "n_x": nx, "n_h": nh,
            "d_null_sd": float(np.std(d_perm))}


def primary_verdict(summary: dict) -> dict:
    """Werdykt testu głównego z progiem minimalnego N (teczka v2)."""
    if summary["n"] < MIN_N_PRIMARY:
        return {"verdict": "INSUFFICIENT_N", "n": summary["n"], "min_n": MIN_N_PRIMARY}
    return hb.verdict(summary["mean"], summary["median"], summary["p_perm"], summary["ci95"][1], summary["loto"])


def interpret(primary: dict, d_semi: dict) -> str:
    """Reguły R1–R4 z teczki v2 (spisane przed liczeniem)."""
    v = primary.get("verdict")
    if v == "INSUFFICIENT_N":
        return "R3"
    if v == "POZYTYWNY":
        return "R1"
    hi = (d_semi.get("ci95") or [None, None])[1]
    if v == "NEGATYWNY" and hi is not None and hi < 0:
        return "R2"
    return "R4"


# ──────────────────────────────────────────────────────────────────────────────
# Komendy
# ──────────────────────────────────────────────────────────────────────────────

def cmd_prices() -> int:
    import yfinance as yf
    os.makedirs(hb.OHLC_DIR, exist_ok=True)
    need = [s for s in SEMI_TICKERS + SECTOR_ETFS if not os.path.exists(os.path.join(hb.OHLC_DIR, f"{s}.csv"))]
    print(f"brakujące symbole ({len(need)}): {need} — istniejących plików NIE pobieram ponownie")
    missing = []
    for s in need:
        df = yf.Ticker(s).history(start=hb.PRICE_START, end=PRICE_END, auto_adjust=True)
        if df.empty:
            missing.append(s)
            print(f"{s}: BRAK DANYCH", flush=True)
            continue
        df = df[["Open", "High", "Low", "Close", "Volume"]]
        df.index.name = "Date"
        df.to_csv(os.path.join(hb.OHLC_DIR, f"{s}.csv"))
        print(f"{s}: {len(df)} sesji {df.index[0].date()} → {df.index[-1].date()}", flush=True)
    splits = {}
    for s in ALL_SYMBOLS:
        try:
            sp = yf.Ticker(s).splits
        except Exception as e:  # noqa: BLE001 — SEM (delisting) nie ma notowań
            print(f"{s}: splity niedostępne ({e})")
            sp = None
        if sp is None or len(sp) == 0:
            splits[s] = []
            continue
        sp = sp[sp.index.tz_localize(None) >= pd.Timestamp("2022-01-01")]
        splits[s] = [[str(d.date()), float(r)] for d, r in sp.items()]
    with open(SPLITS_FILE, "w") as f:
        json.dump(splits, f, indent=1)
    print("splity:", {s: v for s, v in splits.items() if v})
    print(f"brak danych: {missing}")
    return 0 if not missing else 1


def cmd_validate() -> int:
    errors = []
    info: dict = {}
    tx = hb.load_transactions(SEMI_TRANSACTIONS_FILE)
    info["semi_rows"] = len(tx)
    info["semi_by_type"] = tx["transaction_type"].value_counts().to_dict()
    info["semi_rows_per_ticker"] = tx["symbol"].value_counts().to_dict()
    st_file = os.path.splitext(SEMI_TRANSACTIONS_FILE)[0] + ".stats.json"
    with open(st_file) as f:
        st = json.load(f)
    info["fetch_stats"] = st
    bad = {s: v for s, v in st.items() if not v.get("cik") or v.get("failed_filings") or v.get("batch_failed")
           or v.get("ticker_error")}
    if bad:
        errors.append(f"problemy pobierania: {sorted(bad)}")
    sell = tx[tx["transaction_type"] == "SELL"]
    info["semi_plan_share_SELL"] = round(float(sell["is_10b51_plan"].mean() * 100), 1) if len(sell) else None
    cik = hb.load_cik_map(CIK_CACHE_FILE_SEMI)
    foreign = tx[tx["issuer_cik"] != tx["symbol"].map(cik)]
    info["semi_foreign_issuer_rows_per_ticker"] = foreign["symbol"].value_counts().to_dict()
    # ceny: istnienie, luki vs kalendarz, skoki
    cal = hb.load_ohlc(hb.CALENDAR_SYMBOL).index
    for s in SEMI_TICKERS + SECTOR_ETFS:
        df = hb.load_ohlc(s)
        if df.empty:
            errors.append(f"{s}: brak cen")
            continue
        miss = cal[(cal >= df.index[0]) & (cal <= df.index[-1])].difference(df.index)
        if len(miss):
            errors.append(f"{s}: brak {len(miss)} sesji vs SPY")
        if df.index[-1] < cal[-1]:
            errors.append(f"{s}: koniec {df.index[-1].date()} < {cal[-1].date()}")
        j = df["Close"].pct_change().abs()
        big = j[j > 0.3]
        if len(big):
            info.setdefault("jumps_gt30pct", {})[s] = [str(d.date()) for d in big.index]
    wdc = hb.load_ohlc("WDC")
    if not wdc.empty:
        w = wdc.loc["2025-02-18":"2025-02-28", "Close"]
        info["WDC_close_around_spinoff"] = {str(d.date()): round(v, 2) for d, v in w.items()}
    info["splits"] = {s: v for s, v in json.load(open(SPLITS_FILE)).items() if v}
    print(json.dumps(info, indent=2, ensure_ascii=False, default=str))
    for e in errors:
        print("BŁĄD:", e)
    print("WALIDACJA:", "OK" if not errors else f"{len(errors)} problemów")
    return 0 if not errors else 1


def _groups(ep: pd.DataFrame) -> dict[str, pd.DataFrame]:
    return {g: ep[ep["group"] == g] for g in GROUPS}


def cmd_mde() -> int:
    """N epizodów per grupa/ticker i MDE (moc 80%, α=0,05 jednostronnie) z rozkładu permutacyjnego — BEZ obserwowanej
    statystyki zdarzeń."""
    calendar, prices, benches, tx, clean, log, ep = prepare()
    out = {"generated": date.today().isoformat(), "cleaning": log, "groups": {}}
    n90 = hb.HORIZONS["90d"]
    nets = nets_for(n90, calendar, prices, benches, "sector")
    gr = _groups(ep)
    for g, e in gr.items():
        e = drop_wdc(e, calendar, n90)
        vals = hb.episode_nets(e, nets)
        ok = ~np.isnan(vals)
        rec = {"episodes": int(len(e)), "with_full_90d": int(ok.sum()),
               "per_ticker_full_90d": pd.Series(e["symbol"].to_numpy()[ok]).value_counts().to_dict()}
        if ok.sum() >= 2:
            _, perm = hb.permutation_pvalue(e, nets, b=2000)
            sd = float(np.std(perm))
            rec.update({"perm_sd_pp": sd, "mde_pp": (1.645 + 0.842) * sd})
        out["groups"][g] = rec
    for g in ["CTRL", "SEMI"]:
        d = diff_in_diff(drop_wdc(gr[g], calendar, n90), nets, gr["HC"], nets, b=2000)
        sd = d.get("d_null_sd")
        out["groups"][g]["D_vs_HC_null_sd_pp"] = sd
        out["groups"][g]["D_vs_HC_mde_pp"] = (1.96 + 0.842) * sd if sd else None  # dwustronnie
    os.makedirs(RESULTS_DIR, exist_ok=True)
    with open(MDE_FILE, "w") as f:
        json.dump(out, f, indent=2, ensure_ascii=False, default=str)
    print(json.dumps(out, indent=2, ensure_ascii=False, default=str))
    return 0


def cmd_run() -> int:
    if WDC_SPINOFF_UNADJUSTED is None:
        print("BŁĄD: WDC_SPINOFF_UNADJUSTED nieustalone — najpierw `validate` i decyzja w kodzie (przed run)")
        return 2
    calendar, prices, benches, tx, clean, log, ep = prepare()
    gr = _groups(ep)
    res = {"generated": date.today().isoformat(),
           "criteria": {"primary": PRIMARY, "min_n_primary": MIN_N_PRIMARY, "alpha": hb.ALPHA,
                        "negative_upper_pp": hb.NEGATIVE_UPPER_PP, "cost_pp": hb.COST_PP, "b_perm": hb.B_PERM,
                        "b_boot": hb.B_BOOT, "benchmark_map": SECTOR_BENCHMARK_MAP,
                        "wdc_spinoff_unadjusted": WDC_SPINOFF_UNADJUSTED},
           "data": {"calendar": [str(calendar[0].date()), str(calendar[-1].date())], "cleaning": log,
                    "episodes": {g: int(len(e)) for g, e in gr.items()}},
           "groups": {}, "diff_in_diff": {}}
    for mode in ["sector", "spy"]:
        res["groups"][mode] = {}
        for g in GROUPS:
            res["groups"][mode][g] = {}
            for h, n in hb.HORIZONS.items():
                nets = nets_for(n, calendar, prices, benches, mode)
                e = drop_wdc(gr[g], calendar, n)
                tested = h == "90d"
                r = hb.summarize_group(e, nets, with_tests=tested and len(e) >= 2)
                res["groups"][mode][g][h] = r
        res["diff_in_diff"][mode] = {}
        n90 = hb.HORIZONS["90d"]
        nets = nets_for(n90, calendar, prices, benches, mode)
        for g in ["CTRL", "SEMI"]:
            res["diff_in_diff"][mode][g] = diff_in_diff(drop_wdc(gr[g], calendar, n90), nets, gr["HC"], nets)
    prim = primary_verdict(res["groups"]["sector"]["SEMI"]["90d"])
    res["primary_verdict"] = prim
    res["ctrl_verdict_partially_unblinded"] = primary_verdict(res["groups"]["sector"]["CTRL"]["90d"])
    res["interpretation_rule"] = interpret(prim, res["diff_in_diff"]["sector"]["SEMI"])
    # opóźnienia filing − transakcja dla SEMI (SMCI)
    c = clean[clean["symbol"].isin(SEMI_TICKERS)]
    lag = (c["filing_date"] - c["transaction_date"]).dt.days
    res["semi_filing_lag_days"] = {s: [int(x) for x in lag[c["symbol"] == s]] for s in sorted(c["symbol"].unique())}
    res["episodes_list"] = {g: [{"symbol": r.symbol, "first_filing": str(pd.Timestamp(r.first_filing).date()),
                                 "value": round(float(r.value)), "n_filings": int(r.n_filings)}
                                for r in gr[g].itertuples()] for g in ["CTRL", "SEMI"]}
    os.makedirs(RESULTS_DIR, exist_ok=True)
    with open(RESULTS_FILE, "w") as f:
        json.dump(res, f, indent=2, ensure_ascii=False, default=str)
    tables = render_tables(res)
    with open(TABLES_FILE, "w") as f:
        f.write(tables)
    print(tables)
    print(f"zapisano: {RESULTS_FILE}, {TABLES_FILE}")
    return 0


def render_tables(res: dict) -> str:
    n = hb._num
    lines = []
    for mode, title in [("sector", "Benchmark: ETF sektora/podsektora"), ("spy", "Benchmark: SPY (odporność)")]:
        lines += [f"### {title}", "", "| Grupa | Horyzont | Epizody | N | Śr NET | Med NET | Hit % | p perm | CI95 |",
                  "|---|---|---|---|---|---|---|---|---|"]
        for g in GROUPS:
            for h in hb.HORIZONS:
                r = res["groups"][mode][g][h]
                ci = r.get("ci95")
                ci_s = f"[{n(ci[0], '+.2f')}; {n(ci[1], '+.2f')}]" if ci else "—"
                lines.append(f"| {g} | {h} | {r['episodes']} | {r['n']} | {n(r['mean'], '+.2f')} | "
                             f"{n(r['median'], '+.2f')} | {n(r['hit'], '.0f')} | {n(r.get('p_perm'), '.4f')} | {ci_s} |")
        lines += ["", "| D vs HC (90d) | D | p (dwustronne) | CI95 | N X / N HC |", "|---|---|---|---|---|"]
        for g, d in res["diff_in_diff"][mode].items():
            ci = d["ci95"]
            lines.append(f"| {g} | {n(d['D'], '+.2f')} | {n(d['p_two_sided'], '.4f')} | "
                         f"[{n(ci[0], '+.2f')}; {n(ci[1], '+.2f')}] | {d['n_x']} / {d['n_h']} |")
        lines.append("")
    pv = res["primary_verdict"]
    lines.append(f"**Test główny SEMI × 90d: {pv['verdict']}** · CTRL (częściowo odślepiony): "
                 f"{res['ctrl_verdict_partially_unblinded']['verdict']} · reguła interpretacji: "
                 f"{res['interpretation_rule']}")
    return "\n".join(lines) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["prices", "validate", "mde", "run"])
    a = ap.parse_args()
    return {"prices": cmd_prices, "validate": cmd_validate, "mde": cmd_mde, "run": cmd_run}[a.cmd]()


if __name__ == "__main__":
    sys.exit(main())
