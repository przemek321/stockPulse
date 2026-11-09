"""
Pomiar w przód (forward) hipotezy HORYZONT: Form 4 BUY healthcare (G1) × 63 sesje.

Teczka: doc/TECZKA-HORYZONT-FORWARD-2026-11-08.md — kryteria spisane 08.11.2026, ZANIM istniał jakikolwiek
epizod forward (dane in-sample kończą się 07.11.2026). Kod zamrożony (hashe w teczce i w każdym JSON wyniku).

To backtest offline powtarzany co kwartał — NIE sygnał i NIE zmiana reguł gry; produkcja bez zmian.

Komendy (z katalogu scripts/backtest):
  BT_START_DATE=2026-09-01 BT_END_DATE=<dziś> BT_SEC_RATE_LIMIT=0.5 BT_TX_FILE=data/form4_transactions_fwd.csv \\
      .venv/bin/python -c "from edgar_fetcher import fetch_all_form4; fetch_all_form4(True)"
  .venv/bin/python horizon_forward.py prices     # ceny + splity do data/prices_ohlc_fwd/
  .venv/bin/python horizon_forward.py status     # ŚLEPY: tylko liczby epizodów, zero zwrotów
  .venv/bin/python horizon_forward.py look       # spojrzenie — odmawia, dopóki nie spełniony warunek N/daty
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import date

import numpy as np
import pandas as pd

import horizon_backtest as hb
from config import DATA_DIR, HEALTHCARE_TICKERS, RESULTS_DIR

# ── Pre-rejestracja (08.11.2026) — NIE zmieniać po pierwszym epizodzie forward ─────────────────────────────
FORWARD_START = pd.Timestamp("2026-11-08")   # epizod forward = PIERWSZY filing epizodu ≥ tej daty
FETCH_START = "2026-09-01"                   # okno pobierania (łańcuchy epizodów z in-sample odpadają same)
HORIZON_PRIMARY = 63
HORIZONS_INFO = {"30d": 21, "60d": 42}
LOOK1_N = 20                                 # spojrzenie 1: ≥ 20 epizodów z pełnym horyzontem 63 sesji
LOOK2_N = 40                                 # spojrzenie 2 (ostatnie): ≥ 40 epizodów
FINAL_DATE = date(2030, 5, 1)                # ostatnie spojrzenie najpóźniej tego dnia (z tym N, które jest)
ALPHA_PER_LOOK = 0.025                       # α = 0,05 rozdzielone na 2 spojrzenia (Bonferroni)
NEGATIVE_UPPER_PP = 3.0                      # jak w HORYZONT
UNIVERSE = sorted(HEALTHCARE_TICKERS)        # 28 tickerów G1 z HORYZONT (lista zamrożona)
KNOWN_DELISTED = {"SEM"}                     # brak cen już w HORYZONT (zdelistowany) — nie blokuje

TX_FILE = os.environ.get("BT_TX_FILE", f"{DATA_DIR}/form4_transactions_fwd.csv")
OHLC_FWD_DIR = f"{DATA_DIR}/prices_ohlc_fwd"
SPLITS_FWD_FILE = f"{OHLC_FWD_DIR}/_splits.json"
STATE_FILE = f"{RESULTS_DIR}/horizon_forward_state.json"
FROZEN_FILES = ["horizon_forward.py", "horizon_backtest.py", "config.py", "edgar_fetcher.py"]


def benchmarks() -> list[str]:
    return sorted({hb.BENCHMARK_MAP[s] for s in UNIVERSE} | {hb.CALENDAR_SYMBOL})


def code_hashes() -> dict[str, str]:
    here = os.path.dirname(os.path.abspath(__file__))
    out = {}
    for f in FROZEN_FILES:
        with open(os.path.join(here, f), "rb") as fh:
            out[f] = hashlib.sha256(fh.read()).hexdigest()
    return out


def forward_episodes(ep: pd.DataFrame) -> pd.DataFrame:
    """Epizody G1, których PIERWSZY filing jest ≥ FORWARD_START (łańcuch zaczęty wcześniej = in-sample)."""
    if ep.empty:
        return ep
    m = ep["symbol"].isin(UNIVERSE) & (pd.to_datetime(ep["first_filing"]) >= FORWARD_START)
    return ep[m].reset_index(drop=True)


def pending_look(state: dict, n_full: int, today: date) -> int | None:
    """Które spojrzenie jest dozwolone teraz (1 / 2) albo None. Spojrzenie 2 jest ostatnie."""
    done = state.get("looks_done", [])
    if 2 in done or state.get("closed"):
        return None
    final = today >= FINAL_DATE
    if 1 not in done:
        if n_full >= LOOK1_N:
            return 1
        return 2 if final else None      # do FINAL_DATE nie doszło do spojrzenia 1 → jedyne, ostatnie
    if n_full >= LOOK2_N or final:
        return 2
    return None


def forward_verdict(n: int, mean, median, p, ci_hi, loto: dict, look: int) -> str:
    """Werdykt spojrzenia (reguły z teczki, w tej kolejności)."""
    if n < LOOK1_N:
        return "NIEROZSTRZYGALNE_N"                    # tylko na ostatnim spojrzeniu z FINAL_DATE
    loto_ok = bool(loto) and all(v > 0 for v in loto.values())
    if p is not None and p < ALPHA_PER_LOOK and mean > 0 and median > 0 and loto_ok:
        return "POTWIERDZONA"
    if (ci_hi is not None and ci_hi < NEGATIVE_UPPER_PP) or (mean <= 0 and median <= 0):
        return "OBALONA"
    return "NIEROZSTRZYGNIETA_KONIEC" if look == 2 else "CZEKAMY_NA_SPOJRZENIE_2"


def load_state() -> dict:
    if not os.path.exists(STATE_FILE):
        return {"looks_done": []}
    with open(STATE_FILE) as f:
        return json.load(f)


def prepare():
    calendar = hb.load_ohlc(hb.CALENDAR_SYMBOL, OHLC_FWD_DIR).index
    prices = {s: hb.load_ohlc(s, OHLC_FWD_DIR) for s in UNIVERSE}
    benches = {b: hb.load_ohlc(b, OHLC_FWD_DIR) for b in benchmarks()}
    with open(SPLITS_FWD_FILE) as f:
        splits = {s: [(pd.Timestamp(d), float(r)) for d, r in v] for s, v in json.load(f).items()}
    tx = hb.load_transactions(TX_FILE)
    tx = tx[tx["symbol"].isin(UNIVERSE)]
    clean, log = hb.clean_transactions(tx, hb.load_cik_map(), prices, splits)
    ep = hb.build_episodes(clean, calendar)
    return calendar, prices, benches, clean, log, forward_episodes(ep)


def nets(n: int, calendar, prices, benches) -> dict[str, np.ndarray]:
    return {s: hb.net_matrix(px, benches[hb.BENCHMARK_MAP[s]], calendar, n)
            for s, px in prices.items() if not px.empty}


def counts(fwd: pd.DataFrame, calendar, prices, benches) -> dict:
    """Wyłącznie liczności (ślepe): ile epizodów forward, ile z pełnym horyzontem 63 sesji."""
    full = ~np.isnan(hb.episode_nets(fwd, nets(HORIZON_PRIMARY, calendar, prices, benches)))
    return {"episodes_forward": int(len(fwd)), "with_full_63": int(full.sum()),
            "calendar_end": str(calendar[-1].date()),
            "per_ticker": fwd["symbol"].value_counts().sort_index().to_dict() if len(fwd) else {}}


def cmd_prices() -> int:
    import yfinance as yf
    os.makedirs(OHLC_FWD_DIR, exist_ok=True)
    end = (date.today() + pd.Timedelta(days=1)).isoformat()
    missing, splits = [], {}
    for s in UNIVERSE + benchmarks():
        t = yf.Ticker(s)
        df = t.history(start=hb.PRICE_START, end=end, auto_adjust=True)
        if df.empty:
            missing.append(s)
            continue
        df = df[["Open", "High", "Low", "Close", "Volume"]]
        df.index = df.index.tz_localize(None) if df.index.tz is not None else df.index
        df.index.name = "Date"
        df.to_csv(os.path.join(OHLC_FWD_DIR, f"{s}.csv"))
        try:
            sp = t.splits
        except Exception:  # noqa: BLE001 — zdelistowany ticker
            sp = None
        splits[s] = [] if sp is None or len(sp) == 0 else [[str(d.date()), float(r)] for d, r in sp.items()]
    with open(SPLITS_FWD_FILE, "w") as f:
        json.dump(splits, f, indent=1)
    print(f"ceny: {len(UNIVERSE) + len(benchmarks()) - len(missing)} symboli, brak: {missing}")
    return 1 if set(missing) - KNOWN_DELISTED else 0


def cmd_status() -> int:
    calendar, prices, benches, clean, log, fwd = prepare()
    c = counts(fwd, calendar, prices, benches)
    state = load_state()
    c["looks_done"] = state.get("looks_done", [])
    c["pending_look"] = pending_look(state, c["with_full_63"], date.today())
    print(json.dumps(c, indent=2, ensure_ascii=False))
    print("(status jest ślepy — bez zwrotów; spojrzenie: `horizon_forward.py look`)")
    return 0


def cmd_look() -> int:
    calendar, prices, benches, clean, log, fwd = prepare()
    c = counts(fwd, calendar, prices, benches)
    state = load_state()
    look = pending_look(state, c["with_full_63"], date.today())
    if look is None:
        print(json.dumps(c, indent=2, ensure_ascii=False))
        print(f"ODMOWA: spojrzenie niedozwolone (N z pełnym horyzontem {c['with_full_63']}, "
              f"progi {LOOK1_N}/{LOOK2_N}, data końcowa {FINAL_DATE}). Status bez zwrotów powyżej.")
        return 2

    n63 = nets(HORIZON_PRIMARY, calendar, prices, benches)
    vals = hb.episode_nets(fwd, n63)
    ok = ~np.isnan(vals)
    e, v = fwd[ok].reset_index(drop=True), vals[ok]
    # Najpierw MDE (z przesuniętych dat — bez obserwowanej statystyki), potem wynik
    p, perm = hb.permutation_pvalue(e, n63) if len(e) >= 2 else (None, np.array([]))
    sd = float(np.std(perm)) if len(perm) else None
    mde = (1.960 + 0.842) * sd if sd else None          # α = 0,025 jednostronnie, moc 80%
    mean = float(v.mean()) if len(v) else None
    median = float(np.median(v)) if len(v) else None
    lo, hi = hb.cluster_bootstrap_ci(e, v)
    loto = hb.leave_one_ticker_out(e, v) if len(v) else {}
    verdict = forward_verdict(int(len(v)), mean, median, p, hi, loto, look)

    info = {}
    for h, n in HORIZONS_INFO.items():
        vv = hb.episode_nets(fwd, nets(n, calendar, prices, benches))
        vv = vv[~np.isnan(vv)]
        info[h] = {"n": int(len(vv)), "mean": float(vv.mean()) if len(vv) else None,
                   "median": float(np.median(vv)) if len(vv) else None}

    out = {"generated": date.today().isoformat(), "look": look, "verdict": verdict,
           "code_sha256": code_hashes(), "tx_file": TX_FILE, "counts": c, "cleaning": log,
           "mde_pp": mde, "primary_63": {"n": int(len(v)), "mean": mean, "median": median,
                                         "hit": float((v > 0).mean()) if len(v) else None,
                                         "p_perm": p, "ci95": [lo, hi], "loto": loto},
           "info": info,
           "episodes": [{"symbol": r.symbol, "first_filing": str(r.first_filing), "value": float(r.value),
                         "net_63": float(x)} for r, x in zip(e.itertuples(), v)]}
    os.makedirs(RESULTS_DIR, exist_ok=True)
    path = f"{RESULTS_DIR}/horizon_forward_look{look}_{date.today().isoformat()}.json"
    with open(path, "w") as f:
        json.dump(out, f, indent=2, ensure_ascii=False, default=str)
    state.setdefault("looks_done", []).append(look)
    state["closed"] = verdict != "CZEKAMY_NA_SPOJRZENIE_2"
    state[f"look{look}"] = {"date": out["generated"], "verdict": verdict, "file": path}
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)
    print(f"MDE (moc 80%, α {ALPHA_PER_LOOK}): {mde}")
    print(json.dumps({k: out[k] for k in ("look", "verdict", "primary_63", "info")}, indent=2,
                     ensure_ascii=False, default=str))
    print(f"zapisano: {path}")
    return 0


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    return {"prices": cmd_prices, "status": cmd_status, "look": cmd_look}[cmd]()


if __name__ == "__main__":
    sys.exit(main())
