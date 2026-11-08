"""
Backtest horyzontów 30/60/90 dni dla discretionary Form 4 BUY (08.11.2026).

Pre-rejestracja kryteriów: doc/TECZKA-HORYZONT-30-60-90-2026-11-08.md — sekcja „Poprawka planu po recenzji"
(zastępuje pierwotne kryteria). NIE zmieniać progów po zobaczeniu wyników.

Metoda (skrót):
  - czyszczenie: emitent z XML = ticker, tylko tabela non-derivative, BUY, nie plan 10b5-1, bez samych 10% Owner,
    deduplikacja po treści transakcji (4/A, co-filingi), reguła wiarygodności ceny vs Close,
  - C-suite = wzorce 1:1 z produkcji (C_SUITE_PATTERNS w form4.pipeline.ts),
  - epizod = ticker + kolejne filingi BUY z wejściami w odstępie ≤ 5 sesji; wejście = otwarcie sesji po
    PIERWSZYM filingu epizodu; wyjście = zamknięcie sesji wejście + n − 1,
  - NET = zwrot − zwrot benchmarku podsektora (te same daty) − 1 pp,
  - test główny: G1 × 63 sesje, średni NET epizodów, permutacja z przesunięciem kalendarza (B = 10 000),
  - CI: bootstrap klastrowy po tickerach; werdykt POZYTYWNY / NEGATYWNY / NIEROZSTRZYGNIĘTY.

Użycie (z katalogu scripts/backtest, venv .venv; BT_TX_FILE wskazuje plik v6):
  python horizon_backtest.py prices     # OHLC (yfinance) → data/prices_ohlc/
  python horizon_backtest.py validate   # walidacja danych (Form 4 + ceny)
  python horizon_backtest.py mde        # N epizodów + minimalny wykrywalny efekt — BEZ wyników zdarzeń
  python horizon_backtest.py run        # wyniki → data/results/horizon_results.json + horizon_tables.md
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date

import numpy as np
import pandas as pd

from config import CIK_CACHE_FILE, CONTROL_TICKERS, DATA_DIR, HEALTHCARE_TICKERS, RESULTS_DIR, TRANSACTIONS_FILE

OHLC_DIR = f"{DATA_DIR}/prices_ohlc"
RESULTS_FILE = f"{RESULTS_DIR}/horizon_results.json"
REPORT_TABLE_FILE = f"{RESULTS_DIR}/horizon_tables.md"
MDE_FILE = f"{RESULTS_DIR}/horizon_mde.json"
CALENDAR_SYMBOL = "SPY"
PRICE_START = "2023-03-15"

# ── Pre-rejestracja (teczka, sekcja „Poprawka planu po recenzji") ─────────────────────────────────────
HORIZONS = {"7d": 5, "30d": 21, "60d": 42, "90d": 63}
PRIMARY = ("G1_hc_all", "90d")
SECONDARY = [(g, h) for g in ["G1_hc_all", "G2_hc_csuite", "G3_hc_100k"] for h in ["30d", "60d", "90d"]
             if (g, h) != PRIMARY]
COST_PP = 1.0
MIN_VALUE_G3 = 100_000
EPISODE_GAP_SESSIONS = 5
ALPHA = 0.05
NEGATIVE_UPPER_PP = 3.0
B_PERM = 10_000
B_BOOT = 10_000
SEED = 42
PRICE_OK = (0.7, 1.3)
PRICE_FIX = (0.2, 5.0)
WINSOR = (1, 99)
MAX_TICKER_SHARE = 0.25

BENCHMARK_MAP = {
    **{s: "IHF" for s in ["UNH", "ELV", "HUM", "CNC", "MOH", "CI", "OSCR", "HCA", "THC", "UHS", "ENSG", "SEM"]},
    **{s: "IHI" for s in ["ISRG", "DXCM", "PODD"]},
    **{s: "IBB" for s in ["GILD", "AMGN", "REGN", "VRTX", "BIIB", "MRNA"]},
    **{s: "XLV" for s in ["LLY", "ABBV", "BMY", "HIMS", "TDOC", "DOCS", "GDRX"]},
    **{s: "SPY" for s in CONTROL_TICKERS},
}
INFO_BENCHMARK = "XBI"  # wariant informacyjny (porównywalność z produkcją)
ALL_BENCHMARKS = sorted(set(BENCHMARK_MAP.values()) | {INFO_BENCHMARK, "IBB", "XLV", "SPY", "IHF", "IHI"})

# Wzorce C-suite przeniesione 1:1 z src/sec-filings/pipelines/form4.pipeline.ts (C_SUITE_PATTERNS)
C_SUITE_PATTERNS = [
    re.compile(r"\bChief\s+(Executive|Financial|Operating|Technology|Information|Medical|Scientific|Legal|Accounting)\s+Officer\b", re.I),
    re.compile(r"\b(CEO|CFO|COO|CTO|CIO|CMO|CSO|CLO)\b", re.I),
    re.compile(r"(?<!Vice\s)(?<!Senior\s)\bPresident\b", re.I),
    re.compile(r"\bChair(man|woman|person)\b", re.I),
    re.compile(r"\bVice\s+Chair(man|woman|person)\b", re.I),
    re.compile(r"\b(?:EVP|Executive\s+Vice\s+President)[\s,]+.*?(Finance|Operations?|Product|Strategy)\b", re.I),
    re.compile(r"\bPrincipal\s+(Financial|Accounting)\s+Officer\b", re.I),
]

# Skoki >50%/dzień sprawdzone ręcznie 08.11.2026 (wolumen ×20–60, brak splitu; MRNA potwierdzona priceAtAlert
# z produkcji: 57,92 USD 31.07 → 154,27 USD 01.09) — realne ruchy, nie błąd danych.
VERIFIED_JUMPS = {("OSCR", "2023-03-28"), ("MRNA", "2026-08-19")}

# Strefa pola acceptanceDateTime z submissions.json EDGAR — ZWERYFIKOWANE 08.11.2026 na 3 filingach UNH:
# API „2026-10-05T20:26:16.000Z" = nagłówek .hdr.sgml ACCEPTANCE-DATETIME 20261005162616 (ET, EDT = UTC−4)
# → sufiks „Z" jest prawdziwy, pole jest w UTC.
ACCEPTANCE_TZ = "UTC"


def is_csuite_title(title) -> bool:
    if not isinstance(title, str) or not title.strip():
        return False
    return any(p.search(title) for p in C_SUITE_PATTERNS)


# ──────────────────────────────────────────────────────────────────────────────
# Dane
# ──────────────────────────────────────────────────────────────────────────────

def _to_bool(s: pd.Series) -> pd.Series:
    return s.astype(str).str.strip().str.lower().isin(["true", "1", "yes"])


def load_transactions(path: str = TRANSACTIONS_FILE) -> pd.DataFrame:
    df = pd.read_csv(path, dtype={"issuer_cik": str, "accession_number": str})
    for col in ["is_officer", "is_director", "is_ten_pct_owner", "is_10b51_plan", "is_csuite", "is_healthcare"]:
        df[col] = _to_bool(df[col])
    df["filing_date"] = pd.to_datetime(df["filing_date"]).dt.normalize()
    df["transaction_date"] = pd.to_datetime(df["transaction_date"], errors="coerce").dt.normalize()
    for c in ["total_value", "shares", "price_per_share"]:
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0.0)
    for c in ["form", "table", "issuer_cik", "officer_title", "acceptance_datetime"]:
        if c not in df:
            df[c] = ""
        df[c] = df[c].fillna("").astype(str)
    df["issuer_cik"] = df["issuer_cik"].str.lstrip("0")
    return df


def load_cik_map(path: str = CIK_CACHE_FILE) -> dict[str, str]:
    with open(path) as f:
        return {k: str(v).lstrip("0") for k, v in json.load(f).items()}


def load_ohlc(symbol: str, directory: str = OHLC_DIR) -> pd.DataFrame:
    path = os.path.join(directory, f"{symbol}.csv")
    if not os.path.exists(path):
        return pd.DataFrame()
    df = pd.read_csv(path, index_col=0)
    df.index = pd.to_datetime(df.index, utc=True).tz_localize(None).normalize()
    return df[["Open", "Close"]].astype(float).sort_index()


def close_on_or_before(px: pd.DataFrame, d) -> float | None:
    if px.empty or pd.isna(d):
        return None
    i = int(px.index.searchsorted(pd.Timestamp(d), side="right")) - 1
    return float(px["Close"].iloc[i]) if i >= 0 else None


def split_factor(splits: list[tuple[pd.Timestamp, float]], d) -> float:
    """Iloczyn współczynników splitów PO dniu d (cena z Form 4 jest nominalna, ceny yfinance — skorygowane)."""
    f = 1.0
    for when, ratio in splits:
        if pd.Timestamp(when) > pd.Timestamp(d) and ratio > 0:
            f *= ratio
    return f


def clean_transactions(tx: pd.DataFrame, cik_map: dict[str, str],
                       prices: dict[str, pd.DataFrame],
                       splits: dict[str, list[tuple[pd.Timestamp, float]]] | None = None) -> tuple[pd.DataFrame, dict]:
    """Krok po kroku wg teczki; zwraca (czyste BUY, liczniki odrzuceń).

    splits (teczka SEKTOR-VS-SYGNAL, 08.11.2026): gdy podane, cena/ilość z Form 4 są przeliczane na bazę
    skorygowaną o splity PRZED regułą ceny (wartość transakcji bez zmian). None = zachowanie HORYZONT 1:1.
    """
    log: dict[str, int] = {"rows_in": len(tx)}
    expected = tx["symbol"].map(cik_map).fillna("")
    issuer_ok = (tx["issuer_cik"] != "") & (tx["issuer_cik"] == expected)
    log["drop_foreign_or_missing_issuer"] = int((~issuer_ok).sum())
    t = tx[issuer_ok]

    t = t[t["transaction_type"] == "BUY"]
    log["buy_rows"] = len(t)
    nd = t["table"] == "ND"
    log["drop_derivative_table"] = int((~nd).sum())
    t = t[nd]
    log["drop_10b51_plan"] = int(t["is_10b51_plan"].sum())
    t = t[~t["is_10b51_plan"]]
    fund_only = t["is_ten_pct_owner"] & ~t["is_officer"] & ~t["is_director"]
    log["drop_fund_only"] = int(fund_only.sum())
    t = t[~fund_only]
    nonpos = (t["shares"] <= 0) | (t["price_per_share"] <= 0)
    log["drop_no_price_or_shares"] = int(nonpos.sum())
    t = t[~nonpos]

    # deduplikacja po treści (4/A, co-filingi) — zostaje najwcześniejszy filing (przy remisie: 4 przed 4/A)
    t = t.sort_values(["filing_date", "form"], kind="mergesort")
    dup = t.duplicated(subset=["symbol", "transaction_date", "shares", "price_per_share"], keep="first")
    log["drop_content_duplicates"] = int(dup.sum())
    t = t[~dup].copy()

    if splits is not None:
        f = np.array([split_factor(splits.get(sym, []), d) if pd.notna(d) else 1.0
                      for sym, d in zip(t["symbol"], t["transaction_date"])], dtype=float)
        log["split_adjusted"] = int((f != 1.0).sum())
        t["price_per_share"] = t["price_per_share"] / f
        t["shares"] = t["shares"] * f

    # reguła wiarygodności ceny (teczka): r = cena z Form 4 / Close z dnia transakcji (lub ostatniej sesji przed)
    values, status = [], []
    for _, r in t.iterrows():
        c = close_on_or_before(prices.get(r["symbol"], pd.DataFrame()), r["transaction_date"])
        if c is None or c <= 0:
            values.append(r["shares"] * r["price_per_share"]); status.append("no_close")
            continue
        q = r["price_per_share"] / c
        if PRICE_OK[0] <= q <= PRICE_OK[1]:
            values.append(r["shares"] * r["price_per_share"]); status.append("ok")
        elif PRICE_FIX[0] <= q <= PRICE_FIX[1]:
            values.append(r["shares"] * c); status.append("fixed")
        else:
            values.append(np.nan); status.append("excluded")
    t["value_clean"] = values
    t["price_status"] = status
    for k in ["fixed", "excluded", "no_close"]:
        log[f"price_{k}"] = int((t["price_status"] == k).sum())
    t = t[t["price_status"] != "excluded"].copy()
    t["is_csuite_prod"] = t["is_officer"] & t["officer_title"].map(is_csuite_title)
    log["rows_out"] = len(t)
    return t, log


# ──────────────────────────────────────────────────────────────────────────────
# Epizody i zwroty (testowane w tests/test_horizon_backtest.py)
# ──────────────────────────────────────────────────────────────────────────────

def entry_index(sessions: pd.DatetimeIndex, filing_date) -> int | None:
    """Indeks pierwszej sesji ŚCIŚLE po dacie filingu (weekend/święto → następna sesja)."""
    i = int(sessions.searchsorted(pd.Timestamp(filing_date).normalize(), side="right"))
    return i if i < len(sessions) else None


def exit_index(entry_idx: int, n_sessions: int, n_total: int) -> int | None:
    """Wyjście na zamknięciu sesji entry + n − 1; None gdy brak danych do końca horyzontu."""
    j = entry_idx + n_sessions - 1
    return j if j < n_total else None


EPISODE_COLS = ["symbol", "first_filing", "entry_idx", "value", "is_csuite", "n_filings", "n_tx", "acceptance"]


def build_episodes(buys: pd.DataFrame, calendar: pd.DatetimeIndex, gap: int = EPISODE_GAP_SESSIONS) -> pd.DataFrame:
    """Epizod = ticker + kolejne filingi BUY, których wejścia dzieli ≤ gap sesji (łańcuchowo)."""
    if buys.empty:
        return pd.DataFrame(columns=EPISODE_COLS)
    b = buys.copy()
    if "acceptance_datetime" not in b:
        b["acceptance_datetime"] = ""
    filings = (b.groupby(["symbol", "filing_date"], as_index=False)
               .agg(value=("value_clean", "sum"), is_csuite=("is_csuite_prod", "any"),
                    n_tx=("value_clean", "size"), acceptance=("acceptance_datetime", "min")))
    filings["entry_idx"] = [entry_index(calendar, d) for d in filings["filing_date"]]
    filings = filings[filings["entry_idx"].notna()].copy()
    filings["entry_idx"] = filings["entry_idx"].astype(int)
    rows = []
    for sym, g in filings.sort_values(["symbol", "filing_date"]).groupby("symbol"):
        cur = None
        for _, f in g.iterrows():
            if cur is not None and f["entry_idx"] - cur["last_idx"] <= gap:
                cur["value"] += float(f["value"])
                cur["is_csuite"] = cur["is_csuite"] or bool(f["is_csuite"])
                cur["n_filings"] += 1
                cur["n_tx"] += int(f["n_tx"])
                cur["last_idx"] = int(f["entry_idx"])
                continue
            if cur is not None:
                rows.append(cur)
            cur = {"symbol": sym, "first_filing": f["filing_date"], "entry_idx": int(f["entry_idx"]),
                   "value": float(f["value"]), "is_csuite": bool(f["is_csuite"]), "n_filings": 1,
                   "n_tx": int(f["n_tx"]), "acceptance": f["acceptance"], "last_idx": int(f["entry_idx"])}
        if cur is not None:
            rows.append(cur)
    if not rows:
        return pd.DataFrame(columns=EPISODE_COLS)
    return pd.DataFrame(rows).drop(columns=["last_idx"]).reset_index(drop=True)


def assign_groups(ep: pd.DataFrame) -> dict[str, pd.DataFrame]:
    hc = ep[ep["symbol"].isin(HEALTHCARE_TICKERS)]
    return {
        "G1_hc_all": hc,
        "G2_hc_csuite": hc[hc["is_csuite"].astype(bool)],
        "G3_hc_100k": hc[hc["value"] >= MIN_VALUE_G3],
        "CTRL_info": ep[ep["symbol"].isin(CONTROL_TICKERS)],
    }


def net_matrix(px: pd.DataFrame, bench: pd.DataFrame, calendar: pd.DatetimeIndex, n: int,
               cost_pp: float = COST_PP) -> np.ndarray:
    """NET[e] dla każdego wejścia e na kalendarzu: open[e] → close[e+n−1], minus benchmark, minus koszt.

    Długość = len(calendar) − n + 1 (tylko wejścia z pełnym horyzontem); NaN gdy brak ceny.
    """
    m = len(calendar) - n + 1
    if m <= 0:
        return np.array([])
    p = px.reindex(calendar)
    bb = bench.reindex(calendar)
    o, c = p["Open"].to_numpy()[:m], p["Close"].to_numpy()[n - 1:n - 1 + m]
    bo, bc = bb["Open"].to_numpy()[:m], bb["Close"].to_numpy()[n - 1:n - 1 + m]
    with np.errstate(invalid="ignore", divide="ignore"):
        out = (c / o - 1) * 100 - (bc / bo - 1) * 100 - cost_pp
    bad = ~((o > 0) & (c > 0) & (bo > 0) & (bc > 0))
    out[bad] = np.nan
    return out


def episode_nets(ep: pd.DataFrame, nets: dict[str, np.ndarray]) -> np.ndarray:
    vals = []
    for _, e in ep.iterrows():
        arr = nets.get(e["symbol"])
        i = int(e["entry_idx"])
        vals.append(arr[i] if arr is not None and 0 <= i < len(arr) else np.nan)
    return np.asarray(vals, dtype=float)


def permutation_pvalue(ep: pd.DataFrame, nets: dict[str, np.ndarray], b: int = B_PERM,
                       seed: int = SEED) -> tuple[float | None, np.ndarray]:
    """Przesunięcie kalendarza: wszystkie wejścia +k sesji (ten sam k), cyklicznie w [0, M).

    Statystyka = średni NET epizodów z pełnym horyzontem. p jednostronne: (1 + #perm ≥ obs) / (B + 1).
    """
    vals = episode_nets(ep, nets)
    ok = ~np.isnan(vals)
    if ok.sum() < 2:
        return None, np.array([])
    syms = ep["symbol"].to_numpy()[ok]
    idx = ep["entry_idx"].to_numpy().astype(int)[ok]
    m = len(nets[syms[0]])
    obs = float(vals[ok].mean())
    rng = np.random.default_rng(seed)
    ks = rng.integers(1, m, size=b)
    stack = np.vstack([nets[s] for s in syms])          # (N, M)
    rows = np.arange(len(syms))[:, None]
    shifted = (idx[:, None] + ks[None, :]) % m          # (N, B)
    with np.errstate(invalid="ignore"):
        perm = np.nanmean(stack[rows, shifted], axis=0)
    perm = perm[~np.isnan(perm)]
    p = (1 + np.sum(perm >= obs)) / (len(perm) + 1)
    return float(p), perm


def cluster_bootstrap_ci(ep: pd.DataFrame, vals: np.ndarray, b: int = B_BOOT, seed: int = SEED,
                         level: float = 0.95) -> tuple[float | None, float | None]:
    """CI średniej NET z bootstrapu klastrowego po tickerach (losowanie tickerów ze zwracaniem)."""
    ok = ~np.isnan(vals)
    if ok.sum() < 2:
        return None, None
    df = pd.DataFrame({"s": ep["symbol"].to_numpy()[ok], "v": vals[ok]})
    groups = [g["v"].to_numpy() for _, g in df.groupby("s")]
    sums = np.array([g.sum() for g in groups])
    cnts = np.array([len(g) for g in groups])
    rng = np.random.default_rng(seed)
    pick = rng.integers(0, len(groups), size=(b, len(groups)))
    means = sums[pick].sum(axis=1) / cnts[pick].sum(axis=1)
    lo, hi = np.percentile(means, [(1 - level) / 2 * 100, (1 + level) / 2 * 100])
    return float(lo), float(hi)


def leave_one_ticker_out(ep: pd.DataFrame, vals: np.ndarray) -> dict[str, float]:
    ok = ~np.isnan(vals)
    df = pd.DataFrame({"s": ep["symbol"].to_numpy()[ok], "v": vals[ok]})
    return {s: float(df[df["s"] != s]["v"].mean()) for s in sorted(df["s"].unique()) if (df["s"] != s).any()}


def holm(pvals: dict[str, float | None]) -> dict[str, float | None]:
    """Skorygowane p metodą Holma (monotoniczne); None przepuszczane."""
    items = sorted([(k, v) for k, v in pvals.items() if v is not None], key=lambda kv: kv[1])
    m = len(items)
    out: dict[str, float | None] = {k: None for k, v in pvals.items() if v is None}
    running = 0.0
    for i, (k, p) in enumerate(items):
        running = max(running, min(1.0, (m - i) * p))
        out[k] = running
    return out


def verdict(mean: float | None, median: float | None, p: float | None, ci_hi: float | None,
            loto: dict[str, float]) -> dict:
    """Werdykt wg teczki: POZYTYWNY / NEGATYWNY / NIEROZSTRZYGNIĘTY."""
    checks = {
        "p_lt_alpha": p is not None and p < ALPHA,
        "mean_gt_0": mean is not None and mean > 0,
        "median_gt_0": median is not None and median > 0,
        "loto_same_sign": bool(loto) and mean is not None and all(np.sign(v) == np.sign(mean) for v in loto.values()),
    }
    if all(checks.values()):
        v = "POZYTYWNY"
    elif ci_hi is not None and ci_hi < NEGATIVE_UPPER_PP:
        v = "NEGATYWNY"
    else:
        v = "NIEROZSTRZYGNIĘTY"
    return {"verdict": v, "checks": checks, "negative_rule": f"CI95 hi < {NEGATIVE_UPPER_PP} pp", "ci_hi": ci_hi}


def winsorized_mean(vals: np.ndarray) -> float | None:
    v = vals[~np.isnan(vals)]
    if len(v) == 0:
        return None
    lo, hi = np.percentile(v, WINSOR)
    return float(np.clip(v, lo, hi).mean())


def acceptance_entry_shift(acceptance, first_filing, calendar: pd.DatetimeIndex) -> int:
    """−1 gdy filing zaakceptowany przed 9:30 ET w dniu sesji = dniu filingu (wejście na otwarciu tego dnia)."""
    if not isinstance(acceptance, str) or not acceptance.strip():
        return 0
    try:
        t = pd.Timestamp(acceptance.strip().rstrip("Z"))   # „Z" zdejmowane, strefa z ACCEPTANCE_TZ
    except ValueError:
        return 0
    et = (t.tz_localize(ACCEPTANCE_TZ) if t.tzinfo is None else t).tz_convert("America/New_York")
    day = pd.Timestamp(et.date())
    if day == pd.Timestamp(first_filing).normalize() and day in calendar and (et.hour, et.minute) < (9, 30):
        return -1
    return 0


# ──────────────────────────────────────────────────────────────────────────────
# Przygotowanie wspólne dla mde/run
# ──────────────────────────────────────────────────────────────────────────────

def prepare():
    calendar = load_ohlc(CALENDAR_SYMBOL).index
    prices = {s: load_ohlc(s) for s in HEALTHCARE_TICKERS + CONTROL_TICKERS}
    benches = {b: load_ohlc(b) for b in ALL_BENCHMARKS}
    tx = load_transactions()
    clean, log = clean_transactions(tx, load_cik_map(), prices)
    ep = build_episodes(clean, calendar)
    return calendar, prices, benches, clean, log, ep


def nets_for(n: int, calendar, prices, benches, bench_override: str | None = None) -> dict[str, np.ndarray]:
    out = {}
    for s, px in prices.items():
        if px.empty:
            continue
        out[s] = net_matrix(px, benches[bench_override or BENCHMARK_MAP[s]], calendar, n)
    return out


def cmd_mde() -> int:
    """N epizodów i MDE (moc 80%, α=0,05 jednostronnie) z rozkładu permutacyjnego — bez obserwowanej statystyki."""
    calendar, prices, benches, clean, log, ep = prepare()
    groups = assign_groups(ep)
    out = {"generated": date.today().isoformat(), "cleaning": log, "groups": {}}
    for g in ["G1_hc_all", "G2_hc_csuite", "G3_hc_100k"]:
        out["groups"][g] = {}
        for h in ["30d", "60d", "90d"]:
            nets = nets_for(HORIZONS[h], calendar, prices, benches)
            e = groups[g]
            n_ok = int((~np.isnan(episode_nets(e, nets))).sum())
            _, perm = permutation_pvalue(e, nets, b=2000)
            sd = float(np.std(perm)) if len(perm) else None
            out["groups"][g][h] = {"episodes": int(len(e)), "with_full_horizon": n_ok,
                                   "perm_sd_pp": sd, "mde_pp": (1.645 + 0.842) * sd if sd else None}
    os.makedirs(RESULTS_DIR, exist_ok=True)
    with open(MDE_FILE, "w") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    # Wypisujemy TYLKO N i MDE — bez statystyki obserwowanej (perm_sd liczone z przesuniętych dat)
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 0


def summarize_group(e: pd.DataFrame, nets: dict[str, np.ndarray], with_tests: bool) -> dict:
    vals = episode_nets(e, nets)
    v = vals[~np.isnan(vals)]
    res = {"episodes": int(len(e)), "n": int(len(v)),
           "mean": float(v.mean()) if len(v) else None,
           "median": float(np.median(v)) if len(v) else None,
           "hit": float((v > 0).mean() * 100) if len(v) else None,
           "winsorized_mean": winsorized_mean(vals)}
    if len(v):
        share = pd.Series(e["symbol"].to_numpy()[~np.isnan(vals)]).value_counts(normalize=True)
        res["max_ticker"] = {"symbol": share.index[0], "share": float(share.iloc[0]),
                             "flag": bool(share.iloc[0] > MAX_TICKER_SHARE)}
    if with_tests:
        p, _ = permutation_pvalue(e, nets)
        lo, hi = cluster_bootstrap_ci(e, vals)
        res.update({"p_perm": p, "ci95": [lo, hi], "loto": leave_one_ticker_out(e, vals)})
    return res


def acceptance_variant(e: pd.DataFrame, calendar, nets_by_h) -> dict:
    if e.empty:
        return {}
    shifted = e.copy()
    shifted["entry_idx"] = [int(r["entry_idx"]) + acceptance_entry_shift(r["acceptance"], r["first_filing"], calendar)
                            for _, r in e.iterrows()]
    n_shift = int((shifted["entry_idx"] != e["entry_idx"]).sum())
    return {"episodes_entered_same_day": n_shift,
            **{h: summarize_group(shifted, nets_by_h[h], False) for h in HORIZONS}}


def cmd_run() -> int:
    calendar, prices, benches, clean, log, ep = prepare()
    groups = assign_groups(ep)
    results = {"generated": date.today().isoformat(), "tx_file": TRANSACTIONS_FILE,
               "criteria": {"primary": PRIMARY, "alpha": ALPHA, "negative_upper_pp": NEGATIVE_UPPER_PP,
                            "cost_pp": COST_PP, "b_perm": B_PERM, "b_boot": B_BOOT, "horizons": HORIZONS,
                            "episode_gap_sessions": EPISODE_GAP_SESSIONS, "benchmark_map": BENCHMARK_MAP},
               "data": {"calendar": [str(calendar[0].date()), str(calendar[-1].date())], "cleaning": log,
                        "episodes": int(len(ep))},
               "groups": {}}
    nets_by_h = {h: nets_for(n, calendar, prices, benches) for h, n in HORIZONS.items()}
    tested = {PRIMARY, *SECONDARY}
    for g, e in groups.items():
        results["groups"][g] = {}
        for h, n in HORIZONS.items():
            r = summarize_group(e, nets_by_h[h], with_tests=(g, h) in tested)
            if g == "G1_hc_all":
                r["info_vs_XBI"] = summarize_group(e, nets_for(n, calendar, prices, benches, INFO_BENCHMARK), False)
            results["groups"][g][h] = r

    pg, ph = PRIMARY
    pr = results["groups"][pg][ph]
    results["primary_verdict"] = verdict(pr["mean"], pr["median"], pr["p_perm"], pr["ci95"][1], pr["loto"])
    results["secondary_holm"] = holm({f"{g}|{h}": results["groups"][g][h]["p_perm"] for g, h in SECONDARY})

    full = episode_nets(groups["G1_hc_all"], nets_by_h["90d"])
    common = groups["G1_hc_all"][~np.isnan(full)]
    results["G1_common_sample"] = {h: summarize_group(common, nets_by_h[h], False) for h in HORIZONS}
    results["G1_acceptance_variant"] = acceptance_variant(groups["G1_hc_all"], calendar, nets_by_h)

    os.makedirs(RESULTS_DIR, exist_ok=True)
    with open(RESULTS_FILE, "w") as f:
        json.dump(results, f, indent=2, ensure_ascii=False, default=str)
    tables = render_tables(results)
    with open(REPORT_TABLE_FILE, "w") as f:
        f.write(tables)
    print(tables)
    print(f"zapisano: {RESULTS_FILE}, {REPORT_TABLE_FILE}")
    return 0


# ──────────────────────────────────────────────────────────────────────────────
# Ceny i walidacja
# ──────────────────────────────────────────────────────────────────────────────

def cmd_prices(end: str) -> None:
    import yfinance as yf
    os.makedirs(OHLC_DIR, exist_ok=True)
    symbols = HEALTHCARE_TICKERS + CONTROL_TICKERS + ALL_BENCHMARKS
    missing = []
    for i, s in enumerate(symbols, 1):
        df = yf.Ticker(s).history(start=PRICE_START, end=end, auto_adjust=True)
        if df.empty:
            missing.append(s)
            print(f"[{i}/{len(symbols)}] {s}: BRAK DANYCH", flush=True)
            continue
        df = df[["Open", "High", "Low", "Close", "Volume"]]
        df.index.name = "Date"
        df.to_csv(os.path.join(OHLC_DIR, f"{s}.csv"))
        print(f"[{i}/{len(symbols)}] {s}: {len(df)} sesji {df.index[0].date()} → {df.index[-1].date()}", flush=True)
    print(f"brak danych: {missing}")


def validate_prices() -> list[str]:
    errors = []
    cal = load_ohlc(CALENDAR_SYMBOL).index
    if len(cal) == 0:
        return [f"brak {CALENDAR_SYMBOL}"]
    for s in HEALTHCARE_TICKERS + CONTROL_TICKERS + ALL_BENCHMARKS:
        df = load_ohlc(s)
        if df.empty:
            if s != "SEM":
                errors.append(f"{s}: brak pliku cen")
            continue
        if (df[["Open", "Close"]] <= 0).any().any():
            errors.append(f"{s}: ceny ≤ 0")
        if df[["Open", "Close"]].isna().any().any():
            errors.append(f"{s}: NaN w cenach")
        rng = cal[(cal >= df.index[0]) & (cal <= df.index[-1])]
        miss = rng.difference(df.index)
        if len(miss) > 0:
            errors.append(f"{s}: brak {len(miss)} sesji vs {CALENDAR_SYMBOL} (np. {miss[0].date()})")
        extra = df.index.difference(cal)
        if len(extra) > 0:
            errors.append(f"{s}: {len(extra)} sesji spoza kalendarza")
        jumps = df["Close"].pct_change().abs()
        big = jumps[jumps > 0.5]
        big = big[[(s, str(d.date())) not in VERIFIED_JUMPS for d in big.index]]
        if len(big) > 0:
            errors.append(f"{s}: skok >50% w {len(big)} sesjach (np. {big.index[0].date()}) — sprawdzić split")
        if df.index[-1] < cal[-1] - pd.Timedelta(days=7):
            errors.append(f"{s}: dane kończą się {df.index[-1].date()} ({CALENDAR_SYMBOL} {cal[-1].date()})")
    return errors


def validate_transactions(baseline_file: str | None = None) -> tuple[list[str], dict]:
    """Walidacja pliku v6: kolumny, 10b5-1, daty, statystyki fetchera per ticker, regresja vs pobranie bazowe."""
    errors, info = [], {}
    tx = load_transactions()
    info["rows"] = len(tx)
    info["tickers"] = int(tx["symbol"].nunique())
    info["by_type"] = tx["transaction_type"].value_counts().to_dict()
    info["filing_range"] = [str(tx["filing_date"].min().date()), str(tx["filing_date"].max().date())]
    for col in ["form", "table", "issuer_cik", "acceptance_datetime"]:
        empty = int(tx[col].str.strip().isin(["", "nan"]).sum())
        info[f"empty_{col}"] = empty
        if empty > 0.01 * len(tx):
            errors.append(f"kolumna {col}: {empty} pustych (>1%)")
    for t in ["SELL", "BUY"]:
        sub = tx[tx["transaction_type"] == t]
        info[f"plan_share_{t}"] = round(float(sub["is_10b51_plan"].mean() * 100), 1) if len(sub) else None
    if not info["plan_share_SELL"] or info["plan_share_SELL"] < 30:
        errors.append(f"udział planów 10b5-1 w SELL = {info['plan_share_SELL']}% — parser aff10b5One?")
    if tx["filing_date"].min() < pd.Timestamp("2023-04-01"):
        errors.append("filingi sprzed START_DATE")
    bad = tx[tx["transaction_date"].notna() & (tx["transaction_date"] > tx["filing_date"])]
    info["tx_after_filing"] = len(bad)
    if len(bad) > 0.01 * len(tx):
        errors.append(f"{len(bad)} transakcji z datą PO filingu (>1%)")

    stats_file = os.path.splitext(TRANSACTIONS_FILE)[0] + ".stats.json"
    if os.path.exists(stats_file):
        with open(stats_file) as f:
            st = json.load(f)
        problems = {s: v for s, v in st.items() if v.get("cik") and (
            v.get("failed_filings", 0) > 0 or v.get("batch_failed", 0) > 0 or v.get("ticker_error"))}
        info["fetch_problems"] = problems
        if problems:
            errors.append(f"problemy pobierania w {len(problems)} tickerach: {sorted(problems)}")
        empty_tickers = [s for s, v in st.items()
                         if v.get("cik") and v.get("rows", 0) == 0 and v.get("form4_in_range", 0) > 0]
        if empty_tickers:
            errors.append(f"tickery z Form 4 w zakresie, ale 0 wierszy: {empty_tickers}")
    else:
        errors.append(f"brak {stats_file} (walidacja per ticker niemożliwa)")

    if baseline_file and os.path.exists(baseline_file):
        old = pd.read_csv(baseline_file, usecols=["symbol"])
        a, b = old["symbol"].value_counts(), tx["symbol"].value_counts()
        diff = (b.reindex(a.index).fillna(0) - a).abs() / a.clip(lower=1)
        big = diff[diff > 0.05]
        info["baseline_rows"] = len(old)
        info["baseline_ticker_diff_gt5pct"] = {s: [int(a[s]), int(b.get(s, 0))] for s in big.index}
        if len(big):
            errors.append(f"{len(big)} tickerów różni się >5% od pobrania bazowego: {sorted(big.index)}")

    prices = {s: load_ohlc(s) for s in HEALTHCARE_TICKERS + CONTROL_TICKERS}
    clean, log = clean_transactions(tx, load_cik_map(), prices)
    info["cleaning"] = log
    ep = build_episodes(clean, load_ohlc(CALENDAR_SYMBOL).index)
    info["episodes"] = int(len(ep))
    info["episodes_by_group"] = {g: int(len(e)) for g, e in assign_groups(ep).items()}
    return errors, info


def cmd_validate(baseline: str | None) -> int:
    errors_tx, info = validate_transactions(baseline)
    print(json.dumps(info, indent=2, ensure_ascii=False, default=str))
    errors_px = validate_prices()
    for e in errors_tx + errors_px:
        print("BŁĄD:", e)
    print("WALIDACJA:", "OK" if not (errors_tx + errors_px) else f"{len(errors_tx + errors_px)} problemów")
    return 0 if not (errors_tx + errors_px) else 1


# ──────────────────────────────────────────────────────────────────────────────
# Raport
# ──────────────────────────────────────────────────────────────────────────────

def _num(x, fmt: str) -> str:
    return "—" if x is None else format(x, fmt)


def render_tables(results: dict) -> str:
    """Tabele md generowane z JSON — żadnych ręcznie przepisanych liczb w raporcie."""
    pv = results["primary_verdict"]
    crit = results["criteria"]["primary"]
    lines = [f"**Test główny {crit[0]} × {crit[1]}: {pv['verdict']}** (warunki: "
             + ", ".join(f"{k}={'✅' if v else '❌'}" for k, v in pv["checks"].items())
             + f"; reguła negatywna: {pv['negative_rule']}, CI95 hi = {_num(pv['ci_hi'], '+.2f')})", "",
             "| Grupa | Horyzont | N | śr NET | med NET | hit % | śr wins. | p perm | p Holm | CI95 śr NET | max ticker |",
             "|---|---|---|---|---|---|---|---|---|---|---|"]
    holm_p = results["secondary_holm"]
    for g, gd in results["groups"].items():
        for h, r in gd.items():
            ci = r.get("ci95")
            mt = r.get("max_ticker")
            lines.append(" | ".join([
                f"| {g}", h, str(r["n"]), _num(r["mean"], "+.2f"), _num(r["median"], "+.2f"), _num(r["hit"], ".0f"),
                _num(r["winsorized_mean"], "+.2f"), _num(r.get("p_perm"), ".4f"),
                _num(holm_p.get(f"{g}|{h}"), ".4f"),
                f"[{_num(ci[0], '+.2f')}; {_num(ci[1], '+.2f')}]" if ci else "—",
                (f"{mt['symbol']} {mt['share'] * 100:.0f}%{' ⚠' if mt['flag'] else ''} |" if mt else "— |")]))
    return "\n".join(lines) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["prices", "validate", "mde", "run"])
    ap.add_argument("--end", default=date.today().isoformat())
    ap.add_argument("--baseline", default=None, help="CSV z poprzedniego pobrania — regresja liczności per ticker")
    a = ap.parse_args()
    if a.cmd == "prices":
        cmd_prices(a.end)
        return 0
    if a.cmd == "validate":
        return cmd_validate(a.baseline)
    if a.cmd == "mde":
        return cmd_mde()
    return cmd_run()


if __name__ == "__main__":
    sys.exit(main())
