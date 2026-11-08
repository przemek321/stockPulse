"""
Testy teczki SEKTOR-VS-SYGNAL (doc/TECZKA-SEKTOR-VS-SYGNAL-2026-11-08.md, „Poprawka planu (v2)").
Dane syntetyczne — bez sieci i bez plików z data/.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import numpy as np
import pandas as pd
import pytest

import horizon_backtest as hb
import sector_backtest as sb
from config import CONTROL_TICKERS, HEALTHCARE_TICKERS, SEMI_TICKERS
from tests.test_horizon_backtest import CIK, ep_frame, ohlc, sessions, tx_rows, unh_prices


# ── korekta splitów ──────────────────────────────────────────────────────────

class TestSplits:
    def test_factor_only_after_transaction(self):
        sp = [(pd.Timestamp("2024-10-01"), 10.0)]
        assert hb.split_factor(sp, "2024-09-30") == 10.0
        assert hb.split_factor(sp, "2024-10-01") == 1.0   # dzień splitu: cena już po splicie
        assert hb.split_factor(sp, "2024-11-01") == 1.0

    def test_factor_multiplies_multiple_splits(self):
        sp = [(pd.Timestamp("2024-01-01"), 2.0), (pd.Timestamp("2025-01-01"), 3.0)]
        assert hb.split_factor(sp, "2023-06-01") == 6.0
        assert hb.split_factor(sp, "2024-06-01") == 3.0

    def test_pre_split_price_becomes_ok_value_unchanged(self):
        # cena Form 4 nominalna 1000 przed splitem 10:1, Close (skorygowany) = 100 → bez korekty q=10 → excluded
        tx = tx_rows([{"price_per_share": 1000.0, "shares": 100.0}])
        sp = {"UNH": [(pd.Timestamp("2026-02-01"), 10.0)]}
        out0, log0 = hb.clean_transactions(tx, CIK, unh_prices())
        assert log0["price_excluded"] == 1 and len(out0) == 0
        out, log = hb.clean_transactions(tx, CIK, unh_prices(), splits=sp)
        assert log["split_adjusted"] == 1 and log["price_excluded"] == 0
        assert out["price_status"].iloc[0] == "ok"
        assert out["value_clean"].iloc[0] == pytest.approx(100_000.0)   # 100 × 1000 = 1000 × 100
        assert out["shares"].iloc[0] == pytest.approx(1000.0)

    def test_none_keeps_horyzont_behaviour(self):
        tx = tx_rows([{}, {"shares": 5.0}])
        a, la = hb.clean_transactions(tx, CIK, unh_prices())
        b, lb = hb.clean_transactions(tx, CIK, unh_prices(), splits=None)
        assert la == lb and "split_adjusted" not in la
        pd.testing.assert_frame_equal(a, b)

    def test_empty_splits_identity(self):
        tx = tx_rows([{}])
        a, _ = hb.clean_transactions(tx, CIK, unh_prices())
        b, lb = hb.clean_transactions(tx, CIK, unh_prices(), splits={})
        assert lb["split_adjusted"] == 0
        pd.testing.assert_frame_equal(a, b)


# ── grupy i benchmarki ───────────────────────────────────────────────────────

class TestGroupsBenchmarks:
    def test_group_membership_disjoint(self):
        assert sb.group_of("UNH") == "HC" and sb.group_of("CAT") == "CTRL" and sb.group_of("SMCI") == "SEMI"
        with pytest.raises(KeyError):
            sb.group_of("XYZ")

    def test_every_ticker_has_benchmark(self):
        missing = [s for s in sb.ALL_SYMBOLS if s not in sb.SECTOR_BENCHMARK_MAP]
        assert missing == []

    def test_hc_benchmarks_identical_to_horyzont(self):
        for s in HEALTHCARE_TICKERS:
            assert sb.SECTOR_BENCHMARK_MAP[s] == hb.BENCHMARK_MAP[s]

    def test_ctrl_and_semi_not_benchmarked_to_spy_or_xbi(self):
        for s in CONTROL_TICKERS + SEMI_TICKERS:
            assert sb.SECTOR_BENCHMARK_MAP[s] not in ("SPY", "XBI")

    def test_semis_vs_soxx_oem_vs_xlk(self):
        assert sb.SECTOR_BENCHMARK_MAP["MU"] == "SOXX" and sb.SECTOR_BENCHMARK_MAP["SMCI"] == "XLK"

    def test_spy_mode_uses_spy_for_all(self):
        cal = sessions(n=40)
        up = ohlc(cal, 100.0, 110.0)
        prices = {"UNH": up, "CAT": up}
        benches = {"SPY": ohlc(cal), "IHF": ohlc(cal, 100.0, 120.0), "XLI": ohlc(cal, 100.0, 120.0)}
        nets = sb.nets_for(5, cal, prices, benches, "spy")
        assert np.allclose(nets["UNH"], 10.0 - 1.0) and np.allclose(nets["CAT"], 10.0 - 1.0)
        nets_s = sb.nets_for(5, cal, prices, benches, "sector")
        assert np.allclose(nets_s["UNH"], -10.0 - 1.0)


class TestCoverage:
    def test_missing_prices_raise(self):
        ep = ep_frame(["SMCI"], [0])
        with pytest.raises(RuntimeError, match="SMCI: brak cen"):
            sb.check_coverage(ep, {}, {"XLK": ohlc(sessions())}, sb.SECTOR_BENCHMARK_MAP)

    def test_missing_benchmark_raise(self):
        ep = ep_frame(["SMCI"], [0])
        with pytest.raises(RuntimeError, match="benchmarku XLK"):
            sb.check_coverage(ep, {"SMCI": ohlc(sessions())}, {}, sb.SECTOR_BENCHMARK_MAP)

    def test_ticker_missing_from_map_raises(self):
        with pytest.raises(RuntimeError, match="brak benchmarku w mapie"):
            sb.check_coverage(ep_frame(["SMCI"], [0]), {"SMCI": ohlc(sessions())}, {"XLK": ohlc(sessions())}, {})

    def test_ok_passes(self):
        sb.check_coverage(ep_frame(["SMCI"], [0]), {"SMCI": ohlc(sessions())}, {"XLK": ohlc(sessions())},
                          sb.SECTOR_BENCHMARK_MAP)


class TestCikMerge:
    def test_conflict_raises(self, tmp_path):
        a, b = tmp_path / "a.json", tmp_path / "b.json"
        a.write_text(json.dumps({"MU": "0000723125"}))
        b.write_text(json.dumps({"MU": "1"}))
        with pytest.raises(ValueError):
            sb.merged_cik_map([str(a), str(b)])

    def test_merge_strips_zeros(self, tmp_path):
        a, b = tmp_path / "a.json", tmp_path / "b.json"
        a.write_text(json.dumps({"UNH": "731766"}))
        b.write_text(json.dumps({"MU": "0000723125"}))
        assert sb.merged_cik_map([str(a), str(b)]) == {"UNH": "731766", "MU": "723125"}


class TestWdcMask:
    def test_window_covering_spinoff(self):
        cal = pd.bdate_range("2025-01-02", periods=120)
        k = int(cal.searchsorted(sb.WDC_SPINOFF_DATE))
        ep = ep_frame(["WDC", "WDC", "WDC", "MU"], [k - 10, k + 1, k - 70, k - 10])
        assert list(sb.wdc_spinoff_mask(ep, cal, 63)) == [True, False, False, False]


# ── różnica w różnicach ──────────────────────────────────────────────────────

def _series(m, peaks, val):
    a = np.zeros(m)
    a[peaks] = val
    return a


class TestDiffInDiff:
    M = 400

    def test_x_better_than_h_positive_d_small_p(self):
        px = [20, 60, 100, 140, 180, 220, 260, 300]
        nx = {f"X{i}": _series(self.M, [p], 10.0) for i, p in enumerate(px)}
        nh = {f"H{i}": np.zeros(self.M) for i in range(8)}
        d = sb.diff_in_diff(ep_frame(list(nx), px), nx, ep_frame(list(nh), px), nh, b=2000)
        assert d["D"] > 9 and d["p_two_sided"] < 0.01
        assert d["ci95"][0] > 0

    def test_sign_flips_when_groups_swapped(self):
        px = [20, 60, 100, 140]
        nx = {f"X{i}": _series(self.M, [p], 10.0) for i, p in enumerate(px)}
        nh = {f"H{i}": np.zeros(self.M) for i in range(4)}
        a = sb.diff_in_diff(ep_frame(list(nx), px), nx, ep_frame(list(nh), px), nh, b=500)
        b = sb.diff_in_diff(ep_frame(list(nh), px), nh, ep_frame(list(nx), px), nx, b=500)
        assert a["D"] == pytest.approx(-b["D"])

    def test_drift_removed(self):
        # X ma stały dryf +5 pp w KAŻDYM dniu (nie sygnał) → D ≈ 0, p duże
        rng = np.random.default_rng(1)
        nx = {f"X{i}": 5.0 + rng.normal(0, 1, self.M) for i in range(6)}
        nh = {f"H{i}": rng.normal(0, 1, self.M) for i in range(6)}
        idx = [30, 90, 150, 210, 270, 330]
        d = sb.diff_in_diff(ep_frame(list(nx), idx), nx, ep_frame(list(nh), idx), nh, b=2000)
        assert abs(d["D"]) < 1.5 and d["p_two_sided"] > 0.05
        assert d["null_mean_x"] - d["null_mean_h"] == pytest.approx(5.0, abs=0.3)

    def test_shift_common_to_both_groups(self):
        # X i H mają IDENTYCZNE serie (wspólny szok rynkowy) i te same wejścia → przy wspólnym przesunięciu
        # D_k = 0 dla każdego k (p = 1); przy niezależnych przesunięciach rozkład zerowy miałby rozrzut
        rng = np.random.default_rng(7)
        base = [rng.normal(0, 5, self.M) for _ in range(5)]
        nx = {f"X{i}": base[i] for i in range(5)}
        nh = {f"H{i}": base[i].copy() for i in range(5)}
        idx = [10, 80, 160, 240, 320]
        d = sb.diff_in_diff(ep_frame(list(nx), idx), nx, ep_frame(list(nh), idx), nh, b=1000)
        assert d["d_null_sd"] == pytest.approx(0.0, abs=1e-12)
        assert d["D"] == pytest.approx(0.0, abs=1e-12) and d["p_two_sided"] == pytest.approx(1.0)

    def test_two_sided_x_worse(self):
        px = [20, 60, 100, 140, 180, 220, 260, 300]
        nh = {f"H{i}": _series(self.M, [p], 10.0) for i, p in enumerate(px)}
        nx = {f"X{i}": np.zeros(self.M) for i in range(8)}
        d = sb.diff_in_diff(ep_frame(list(nx), px), nx, ep_frame(list(nh), px), nh, b=2000)
        assert d["D"] < -9 and d["p_two_sided"] < 0.01 and d["ci95"][1] < 0

    def test_insufficient(self):
        nets = {"A": np.zeros(50)}
        d = sb.diff_in_diff(ep_frame(["A"], [1]), nets, ep_frame(["A", "A"], [1, 2]), nets, b=100)
        assert d["D"] is None and d["n_x"] == 1

    def test_deterministic(self):
        rng = np.random.default_rng(3)
        nx = {"A": rng.normal(size=self.M)}
        nh = {"B": rng.normal(size=self.M)}
        e1, e2 = ep_frame(["A"] * 3, [5, 50, 90]), ep_frame(["B"] * 3, [10, 60, 99])
        assert sb.diff_in_diff(e1, nx, e2, nh, b=300) == sb.diff_in_diff(e1, nx, e2, nh, b=300)


# ── werdykt i reguły interpretacji ───────────────────────────────────────────

def _summary(n, mean=5.0, median=5.0, p=0.01, ci=(1.0, 9.0), loto=None):
    return {"n": n, "mean": mean, "median": median, "p_perm": p, "ci95": list(ci),
            "loto": loto if loto is not None else {"A": 4.0, "B": 6.0}}


class TestVerdictRules:
    def test_insufficient_n_threshold(self):
        assert sb.primary_verdict(_summary(14))["verdict"] == "INSUFFICIENT_N"
        assert sb.primary_verdict(_summary(15))["verdict"] == "POZYTYWNY"

    def test_rules(self):
        assert sb.interpret({"verdict": "INSUFFICIENT_N"}, {}) == "R3"
        assert sb.interpret({"verdict": "POZYTYWNY"}, {"ci95": [-5, -1]}) == "R1"
        assert sb.interpret({"verdict": "NEGATYWNY"}, {"ci95": [-9, -0.5]}) == "R2"
        assert sb.interpret({"verdict": "NEGATYWNY"}, {"ci95": [-9, 0.5]}) == "R4"
        assert sb.interpret({"verdict": "NIEROZSTRZYGNIĘTY"}, {"ci95": [-9, -1]}) == "R4"
        assert sb.interpret({"verdict": "NEGATYWNY"}, {"ci95": [None, None]}) == "R4"


def test_render_tables_smoke():
    g = {"episodes": 3, "n": 3, "mean": 1.0, "median": 0.5, "hit": 66.7, "p_perm": 0.2, "ci95": [-1.0, 3.0]}
    res = {"groups": {m: {gr: {h: g for h in hb.HORIZONS} for gr in sb.GROUPS} for m in ["sector", "spy"]},
           "diff_in_diff": {m: {"CTRL": {"D": 1.0, "p_two_sided": 0.5, "ci95": [-2.0, 3.0], "n_x": 3, "n_h": 40},
                                "SEMI": {"D": None, "p_two_sided": None, "ci95": [None, None], "n_x": 0, "n_h": 40}}
                            for m in ["sector", "spy"]},
           "primary_verdict": {"verdict": "INSUFFICIENT_N"},
           "ctrl_verdict_partially_unblinded": {"verdict": "NIEROZSTRZYGNIĘTY"}, "interpretation_rule": "R3"}
    out = sb.render_tables(res)
    assert "SEMI × 90d: INSUFFICIENT_N" in out and "| SEMI | — |" in out
