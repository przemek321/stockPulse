"""Teczka 13D — Faza 0: WYKONALNOŚĆ (doc/TECZKA-13D-2026-11-08.md). BEZ zwrotów po wejściu dla zdarzeń.

Liczone wyłącznie:
  N epizodów A (wszystkie / wchodzalne), udział wchodzalnych, MDE (moc 80%, α=0,025 jednostronnie) z NET losowych
  dat tych samych emitentów poza ±63 sesjami od ich filingów 13D, udział zdarzeń, których seria cen kończy się
  przed horyzontem (górna granica „bez ceny wyjścia", łącznie — bez rozbicia na przejęcia), RUN-UP i GAP.
Ceny po wejściu dla ZDARZEŃ nie są odczytywane — sprawdzane jest tylko, czy seria ma notowanie w sesji wyjścia.

Uruchomienie: ./.venv/bin/python -u schedule13d_phase0.py  → data/results/schedule13d_phase0.json
"""
from __future__ import annotations

import csv
import datetime as dt
import json
import math
import sys
from bisect import bisect_left, bisect_right
from dataclasses import dataclass
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np

from schedule13d_classify import RULES_HASH
from schedule13d_fetch import DATA, EXCLUDED_SIC, PRICE_TICKER_TYPES

ET_TZ = ZoneInfo("America/New_York")
RESULTS = Path(__file__).resolve().parent / "data" / "results" / "schedule13d_phase0.json"
HORIZON = 63
EPISODE_GAP = 5
ENTRY_CUTOFF = dt.time(9, 0)
CLOSE_TIME = dt.time(16, 0)
CHASE = 0.03
COST = 0.01
MCAP_MIN = 250e6
ADV_MIN = 1e6
LARGE = 10e9
ADV_WINDOW = 20
RUNUP_SESSIONS = 10
EXCHANGES_OK = {"XNAS", "XNYS", "XASE", "NASDAQ", "NYSE", "NYSE AMERICAN", "NYSE MKT"}
Z_ALPHA, Z_POWER = 1.959964, 0.841621          # α = 0,025 jednostronnie, moc 80%
RANDOM_PER_ISSUER = 20
SEED = 42
GATE = {"n_min": 30, "enterable_min": 0.50, "mde_max_pp": 6.0, "no_exit_max": 0.10}


# ---------------------------------------------------------------- czyste funkcje (testowane)

def parse_acceptance(s: str) -> dt.datetime:
    """EDGAR ACCEPTANCE-DATETIME (YYYYMMDDHHMMSS) jest w czasie ET."""
    return dt.datetime.strptime(s, "%Y%m%d%H%M%S")


def entry_and_last_close(sessions: list[dt.date], acc: dt.datetime) -> tuple[int | None, int | None]:
    """Indeksy (sesja wejścia na otwarciu, sesja ostatniego zamknięcia przed akceptacją)."""
    d, t = acc.date(), acc.time()
    i = bisect_left(sessions, d)
    is_session = i < len(sessions) and sessions[i] == d
    if is_session and t < ENTRY_CUTOFF:
        entry = i
    else:
        entry = i + 1 if is_session else i
    if is_session and t >= CLOSE_TIME:
        last = i
    else:
        last = i - 1
    entry = entry if entry < len(sessions) else None
    last = last if last >= 0 else None
    return entry, last


def build_episodes(filings: list[dict], gap: int = EPISODE_GAP, horizon: int = HORIZON) -> list[dict]:
    """filings: [{issuer, entry_idx, ...}] (posortowane dowolnie). Epizod = pierwszy filing + kolejne ≤ gap sesji
    od poprzedniego; filingi w (gap, horizon] sesji od wejścia epizodu → flaga `later_13d`; po > horizon → nowy epizod."""
    out = []
    by_issuer: dict[str, list[dict]] = {}
    for f in sorted(filings, key=lambda f: (f["issuer"], f["entry_idx"])):
        by_issuer.setdefault(f["issuer"], []).append(f)
    for issuer, fs in by_issuer.items():
        ep = None
        for f in fs:
            if ep is None or f["entry_idx"] - ep["entry_idx"] > horizon:
                ep = {**f, "members": [f["accession"]], "later_13d": False, "_last": f["entry_idx"]}
                out.append(ep)
            elif f["entry_idx"] - ep["_last"] <= gap and not ep["later_13d"]:
                ep["members"].append(f["accession"])
                ep["_last"] = f["entry_idx"]
            else:
                ep["later_13d"] = True
    for ep in out:
        ep.pop("_last", None)
    return out


def mde(sd: float, n: int) -> float:
    return (Z_ALPHA + Z_POWER) * sd / math.sqrt(n) if n > 0 else float("inf")


def split_factor(splits: list[tuple[dt.date, float]], after: dt.date, upto: dt.date) -> float:
    """Iloczyn (split_to/split_from) dla splitów z datą w (after, upto]. Mnożnik dla liczby akcji."""
    f = 1.0
    for d, ratio in splits:
        if after < d <= upto:
            f *= ratio
    return f


# ---------------------------------------------------------------- dane

@dataclass
class Series:
    dates: list[dt.date]
    o: np.ndarray
    c: np.ndarray
    v: np.ndarray

    def idx(self, d: dt.date) -> int | None:
        i = bisect_left(self.dates, d)
        return i if i < len(self.dates) and self.dates[i] == d else None


def load_series(ticker: str, cache: dict) -> Series | None:
    if ticker in cache:
        return cache[ticker]
    p = DATA / "aggs" / f"{ticker.replace('/', '_')}.json"
    s = None
    if p.exists():
        res = json.loads(p.read_text()).get("results") or []
        if res:
            dates = [dt.datetime.fromtimestamp(r["t"] / 1000, ET_TZ).date() for r in res]
            s = Series(dates, np.array([r["o"] for r in res], float), np.array([r["c"] for r in res], float),
                       np.array([r.get("v", 0) for r in res], float))
    cache[ticker] = s
    return s


def load_splits() -> dict[str, list[tuple[dt.date, float]]]:
    out: dict[str, list] = {}
    for r in json.loads((DATA / "splits.json").read_text()):
        if r.get("split_from") and r.get("split_to"):
            out.setdefault(r["ticker"], []).append(
                (dt.date.fromisoformat(r["execution_date"]), r["split_to"] / r["split_from"]))
    return out


def candidates(cik: str) -> list[dict]:
    """[{ticker, exchange, delisted (date|None)}] z Polygon reference (CS/ADRC) + SEC submissions (bieżące)."""
    out = {}
    rp = DATA / "polygon_ref" / f"{cik}.json"
    if rp.exists():
        for r in json.loads(rp.read_text()):
            if r.get("type") in PRICE_TICKER_TYPES and r.get("ticker"):
                dl = r.get("delisted_utc")
                out[r["ticker"]] = {"ticker": r["ticker"], "exchange": (r.get("primary_exchange") or "").upper(),
                                    "delisted": dt.date.fromisoformat(dl[:10]) if dl else None, "src": "polygon"}
    sp = DATA / "submissions" / f"{cik}.json"
    if sp.exists():
        j = json.loads(sp.read_text())
        for t, ex in zip(j.get("tickers", []), j.get("exchanges", []) or [None] * len(j.get("tickers", []))):
            if t and t not in out:
                out[t] = {"ticker": t, "exchange": (ex or "").upper(), "delisted": None, "src": "sec"}
    return list(out.values())


def shares_before(cik: str, before: dt.date) -> tuple[float | None, dt.date | None]:
    p = DATA / "shares" / f"{cik}.json"
    if not p.exists():
        return None, None
    best = None
    for r in json.loads(p.read_text()):
        if r.get("filed") and r.get("val") and dt.date.fromisoformat(r["filed"]) < before:
            best = r
    if not best:
        return None, None
    return float(best["val"]), dt.date.fromisoformat(best["filed"])


# ---------------------------------------------------------------- Faza 0

def resolve(f: dict, sessions: list[dt.date], cache: dict, splits: dict) -> dict:
    """Mapowanie filingu na ticker/giełdę/mcap/ADV/GAP/RUN-UP. Bez cen po wejściu (poza istnieniem notowania)."""
    acc = parse_acceptance(f["acceptance"])
    e_i, l_i = entry_and_last_close(sessions, acc)
    res = {"accession": f["accession"], "issuer": f["subject_cik"], "cls": f["cls"], "acc": acc.isoformat(),
           "entry_idx": e_i, "reason": None}
    if e_i is None or l_i is None:
        res["reason"] = "poza kalendarzem"
        return res
    entry_d, last_d = sessions[e_i], sessions[l_i]
    best = None
    for cand in candidates(f["subject_cik"]):
        if cand["delisted"] and cand["delisted"] <= entry_d:
            continue
        s = load_series(cand["ticker"], cache)
        if s is None:
            continue
        li, ei = s.idx(last_d), s.idx(entry_d)
        if li is None or ei is None or li < ADV_WINDOW - 1:
            continue
        dv = s.c[li - ADV_WINDOW + 1: li + 1] * s.v[li - ADV_WINDOW + 1: li + 1]
        adv = float(np.median(dv))
        if best is None or adv > best["adv"]:
            best = {**cand, "adv": adv, "li": li, "ei": ei, "series": s}
    if best is None:
        res["reason"] = "brak tickera z notowaniem w dniu zdarzenia"
        return res
    s, li, ei, t = best["series"], best["li"], best["ei"], best["ticker"]
    tsplits = splits.get(t, [])
    sh, filed = shares_before(f["subject_cik"], acc.date())
    mcap = None
    if sh:
        mcap = s.c[li] * sh * split_factor(tsplits, filed, last_d)
    gap_ratio = (s.o[ei] * split_factor(tsplits, last_d, entry_d)) / s.c[li]
    # RUN-UP: od sesji (dateOfEvent − 10 sesji) do zamknięcia przed akceptacją (log, opisowo)
    runup = None
    try:
        doe = dt.datetime.strptime(f["date_of_event"], "%m/%d/%Y").date()
        k = bisect_right(s.dates, doe) - 1 - RUNUP_SESSIONS
        if 0 <= k < li:
            runup = math.log(s.c[li] / (s.c[k] / split_factor(tsplits, s.dates[k], last_d)))
    except (ValueError, KeyError):
        pass
    exit_global = e_i + HORIZON
    if exit_global >= len(sessions):
        horizon = "niepełny"
    else:
        horizon = "pełny" if s.idx(sessions[exit_global]) is not None else "seria_kończy_się"
    res.update({"ticker": t, "exchange": best["exchange"], "src": best["src"], "adv": best["adv"], "mcap": mcap,
                "gap": gap_ratio - 1, "enterable": gap_ratio <= 1 + CHASE, "runup_log": runup, "horizon": horizon,
                "filer_is_issuer": f["subject_cik"] in (f.get("filer_ciks") or "").split("|")})
    return res


def population_reason(r: dict) -> str | None:
    if r["reason"]:
        return r["reason"]
    if r["filer_is_issuer"]:
        return "emitent = zgłaszający"
    if r["exchange"] and r["exchange"] not in EXCHANGES_OK:
        return f"giełda {r['exchange']}"
    if r["mcap"] is None:
        return "brak mcap (shares)"
    if r["mcap"] < MCAP_MIN:
        return "mcap < $250M"
    if r["adv"] < ADV_MIN:
        return "ADV < $1M"
    return None


def random_net_sd(episodes: list[dict], all_filings_by_issuer: dict[str, list[int]], sessions: list[dt.date],
                  cache: dict, splits: dict, bench: dict[str, Series]) -> tuple[float | None, int]:
    """SD NET 63 sesji dla losowych dat tych samych emitentów, poza ±63 sesjami od ich filingów 13D."""
    rng = np.random.default_rng(SEED)
    nets = []
    for ep in episodes:
        s = load_series(ep["ticker"], cache)
        b = bench["SPY" if (ep["mcap"] or 0) >= LARGE else "IWM"]
        if s is None:
            continue
        banned = [sessions[i] for i in all_filings_by_issuer.get(ep["issuer"], [])]
        ok = []
        for j in range(len(s.dates) - HORIZON):
            d0 = s.dates[j]
            gi = bisect_left(sessions, d0)
            if gi + HORIZON >= len(sessions) or s.dates[j + HORIZON] != sessions[gi + HORIZON]:
                continue                                 # luka w serii → pomijamy
            if any(abs(gi - bisect_left(sessions, bd)) <= HORIZON for bd in banned):
                continue
            ok.append(j)
        if not ok:
            continue
        tsplits = splits.get(ep["ticker"], [])
        for j in rng.choice(ok, size=min(RANDOM_PER_ISSUER, len(ok)), replace=False):
            d0, d1 = s.dates[j], s.dates[j + HORIZON]
            r_e = s.c[j + HORIZON] * split_factor(tsplits, d0, d1) / s.o[j] - 1
            bi0, bi1 = b.idx(d0), b.idx(d1)
            if bi0 is None or bi1 is None:
                continue
            r_b = b.c[bi1] / b.o[bi0] - 1
            nets.append(r_e - r_b - COST)
    if len(nets) < 2:
        return None, len(nets)
    return float(np.std(nets, ddof=1)), len(nets)


def summarize(xs: list[float]) -> dict:
    a = np.array([x for x in xs if x is not None and not math.isnan(x)])
    if len(a) == 0:
        return {"n": 0}
    return {"n": int(len(a)), "median": float(np.median(a)), "mean": float(a.mean()),
            "p25": float(np.percentile(a, 25)), "p75": float(np.percentile(a, 75))}


def main() -> int:
    cache: dict = {}
    spy = load_series("SPY", cache)
    sessions = spy.dates
    bench = {"SPY": spy, "IWM": load_series("IWM", cache)}
    splits = load_splits()
    filings = list(csv.DictReader(open(DATA / "classified.csv")))
    hdr = {r["accession"]: r for r in csv.DictReader(open(DATA / "filings.csv"))}
    for f in filings:
        f["filer_ciks"] = hdr[f["accession"]]["filer_ciks"]
    filings = [f for f in filings if f["subject_sic"] not in EXCLUDED_SIC]
    resolved = [resolve(f, sessions, cache, splits) for f in filings]
    reasons: dict[str, dict[str, int]] = {}
    pop = []
    for r in resolved:
        why = population_reason(r)
        reasons.setdefault(r["cls"], {}).setdefault(why or "OK", 0)
        reasons[r["cls"]][why or "OK"] += 1
        if why is None:
            pop.append(r)
    all_by_issuer: dict[str, list[int]] = {}
    for r in resolved:
        if r["entry_idx"] is not None:
            all_by_issuer.setdefault(r["issuer"], []).append(r["entry_idx"])

    out = {"rules_hash": RULES_HASH, "sessions": [str(sessions[0]), str(sessions[-1])],
           "filings_after_sic": len(filings), "population_reasons": reasons, "by_class": {}}
    for cls in ("A", "B", "C"):
        eps = build_episodes([r for r in pop if r["cls"] == cls])
        full = [e for e in eps if e["horizon"] != "niepełny"]
        ent = [e for e in full if e["enterable"]]
        ends = sum(1 for e in full if e["horizon"] == "seria_kończy_się")
        d = {"episodes_all": len(eps), "episodes_full_horizon": len(full), "enterable": len(ent),
             "enterable_share": len(ent) / len(full) if full else None,
             "series_ends_before_horizon_share": ends / len(full) if full else None,
             "later_13d_flag": sum(1 for e in full if e["later_13d"]),
             "large_cap": sum(1 for e in full if (e["mcap"] or 0) >= LARGE),
             "acc_in_session_9_16": sum(1 for e in full if dt.time(9) <= dt.datetime.fromisoformat(e["acc"]).time() < dt.time(16)),
             "gap": summarize([e["gap"] for e in full]), "runup_log": summarize([e["runup_log"] for e in full])}
        if cls == "A":
            sd, n_rand = random_net_sd(full, all_by_issuer, sessions, cache, splits, bench)
            d["random_net_sd"], d["random_net_n"] = sd, n_rand
            d["mde_pp_enterable"] = mde(sd, len(ent)) * 100 if sd else None
            d["mde_pp_all"] = mde(sd, len(full)) * 100 if sd else None
            g = {"n": len(ent) >= GATE["n_min"],
                 "enterable_share": (d["enterable_share"] or 0) >= GATE["enterable_min"],
                 "mde": d["mde_pp_enterable"] is not None and d["mde_pp_enterable"] <= GATE["mde_max_pp"],
                 "no_exit_upper_bound": (d["series_ends_before_horizon_share"] or 0) <= GATE["no_exit_max"]}
            d["gate"] = g
            d["episodes"] = [{k: e[k] for k in ("issuer", "ticker", "acc", "mcap", "adv", "gap", "enterable",
                                                "runup_log", "horizon", "later_13d", "members")} for e in full]
        out["by_class"][cls] = d
    RESULTS.parent.mkdir(parents=True, exist_ok=True)
    RESULTS.write_text(json.dumps(out, indent=2, default=str, ensure_ascii=False))
    a = out["by_class"]["A"]
    print(json.dumps({k: v for k, v in a.items() if k != "episodes"}, indent=2, default=str, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
