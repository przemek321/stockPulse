"""
Testy logiki backtestu horyzontów 30/60/90d (teczka doc/TECZKA-HORYZONT-30-60-90-2026-11-08.md,
sekcja „Poprawka planu po recenzji"). Dane syntetyczne — bez sieci i bez plików z data/.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import numpy as np
import pandas as pd
import pytest

import horizon_backtest as hb


def sessions(start="2026-01-05", n=30, skip=()):
    """Dni robocze od poniedziałku start, z pominięciem dat ze skip (święta)."""
    days = pd.bdate_range(start, periods=n + len(skip))
    days = days[~days.isin(pd.to_datetime(list(skip)))]
    return days[:n]


def ohlc(idx, open_=100.0, close=100.0):
    return pd.DataFrame({"Open": open_, "Close": close}, index=idx, dtype=float)


# ── wejście / wyjście ─────────────────────────────────────────────────────────

class TestEntryIndex:
    def test_filing_on_friday_enters_monday_open(self):
        s = sessions()
        assert s[hb.entry_index(s, pd.Timestamp("2026-01-09"))] == pd.Timestamp("2026-01-12")

    def test_filing_on_saturday_enters_monday(self):
        s = sessions()
        assert s[hb.entry_index(s, pd.Timestamp("2026-01-10"))] == pd.Timestamp("2026-01-12")

    def test_filing_midweek_enters_next_day_not_same_day(self):
        s = sessions()
        assert s[hb.entry_index(s, pd.Timestamp("2026-01-07"))] == pd.Timestamp("2026-01-08")

    def test_holiday_skipped(self):
        s = sessions(skip=["2026-01-19"])
        assert s[hb.entry_index(s, pd.Timestamp("2026-01-16"))] == pd.Timestamp("2026-01-20")

    def test_filing_on_last_session_has_no_entry(self):
        s = sessions(n=5)
        assert hb.entry_index(s, s[-1]) is None

    def test_filing_timestamp_with_time_is_normalized(self):
        s = sessions()
        assert s[hb.entry_index(s, pd.Timestamp("2026-01-07 21:30"))] == pd.Timestamp("2026-01-08")


class TestExitIndex:
    def test_holds_exactly_n_sessions(self):
        assert hb.exit_index(0, 5, 30) == 4
        assert hb.exit_index(10, 21, 40) == 30

    def test_none_when_data_ends_before_horizon(self):
        assert hb.exit_index(10, 21, 30) is None
        assert hb.exit_index(9, 21, 30) == 29


# ── C-suite = wzorce produkcyjne ──────────────────────────────────────────────

@pytest.mark.parametrize("title,expected", [
    ("Chief Executive Officer", True), ("CEO", True), ("President and CEO", True), ("President", True),
    ("Chairman of the Board", True), ("Chairwoman", True), ("EVP, Finance", True), ("CFO & Treasurer", True),
    ("Principal Accounting Officer", True),
    ("Medical Director", False), ("Managing Director", False), ("Director", False),   # „CTO" ⊂ „DIRECTOR"
    ("Senior Vice President", False), ("Vice President, Finance", False), ("SVP, Sales", False),
    ("EVP, General Counsel", False), ("", False), (None, False), (float("nan"), False),
])
def test_csuite_matches_production_patterns(title, expected):
    assert hb.is_csuite_title(title) is expected


# ── czyszczenie transakcji ───────────────────────────────────────────────────

CIK = {"UNH": "731766", "GILD": "882095"}


def tx_rows(rows):
    base = {"symbol": "UNH", "filing_date": pd.Timestamp("2026-01-07"), "transaction_date": pd.Timestamp("2026-01-06"),
            "insider_name": "A", "officer_title": "CEO", "transaction_type": "BUY", "is_10b51_plan": False,
            "shares": 1000.0, "price_per_share": 100.0, "total_value": 100_000.0, "is_officer": True,
            "is_director": False, "is_ten_pct_owner": False, "is_csuite": True, "is_healthcare": True,
            "form": "4", "table": "ND", "issuer_cik": "731766", "acceptance_datetime": ""}
    return pd.DataFrame([{**base, **r} for r in rows])


def unh_prices(close=100.0):
    return {"UNH": ohlc(sessions(start="2026-01-01", n=20), close=close)}


class TestCleanTransactions:
    def test_each_filter_counted(self):
        tx = tx_rows([
            {},                                                         # 0 zostaje
            {"issuer_cik": "999", "shares": 1.0},                       # 1 cudzy emitent
            {"issuer_cik": "", "shares": 2.0},                          # 2 brak emitenta
            {"table": "D", "shares": 3.0},                              # 3 derivative
            {"is_10b51_plan": True, "shares": 4.0},                     # 4 plan
            {"is_officer": False, "is_ten_pct_owner": True, "shares": 5.0},   # 5 sam fundusz
            {"price_per_share": 0.0, "shares": 6.0},                    # 6 bez ceny
            {"transaction_type": "SELL", "shares": 7.0},                # 7 SELL
        ])
        out, log = hb.clean_transactions(tx, CIK, unh_prices())
        assert list(out["shares"]) == [1000.0]
        assert log["drop_foreign_or_missing_issuer"] == 2
        assert log["drop_derivative_table"] == 1
        assert log["drop_10b51_plan"] == 1
        assert log["drop_fund_only"] == 1
        assert log["drop_no_price_or_shares"] == 1

    def test_director_with_ten_pct_kept(self):
        tx = tx_rows([{"is_officer": False, "is_director": True, "is_ten_pct_owner": True}])
        assert len(hb.clean_transactions(tx, CIK, unh_prices())[0]) == 1

    def test_amendment_and_cofiling_deduplicated_keep_earliest(self):
        tx = tx_rows([
            {"filing_date": pd.Timestamp("2026-01-20"), "form": "4/A", "accession_number": "amend"},
            {"filing_date": pd.Timestamp("2026-01-07"), "form": "4", "accession_number": "orig"},
            {"filing_date": pd.Timestamp("2026-01-07"), "form": "4", "insider_name": "Trust", "accession_number": "co"},
            {"filing_date": pd.Timestamp("2026-01-07"), "shares": 500.0, "accession_number": "other"},  # inna treść
        ])
        out, log = hb.clean_transactions(tx, CIK, unh_prices())
        assert log["drop_content_duplicates"] == 2
        assert sorted(out["shares"]) == [500.0, 1000.0]
        assert (out["filing_date"] == pd.Timestamp("2026-01-07")).all()

    def test_price_rule(self):
        tx = tx_rows([
            {"price_per_share": 110.0, "shares": 10.0},     # r=1,1 → ok
            {"price_per_share": 50.0, "shares": 20.0},      # r=0,5 → fixed: 20 × Close
            {"price_per_share": 0.53, "shares": 30.0},      # r≈0,005 → excluded
            {"price_per_share": 600.0, "shares": 40.0},     # r=6 → excluded
        ])
        out, log = hb.clean_transactions(tx, CIK, unh_prices(close=100.0))
        v = dict(zip(out["shares"], out["value_clean"]))
        assert v[10.0] == pytest.approx(1100.0)
        assert v[20.0] == pytest.approx(2000.0)
        assert 30.0 not in v and 40.0 not in v
        assert log["price_fixed"] == 1 and log["price_excluded"] == 2

    def test_price_uses_last_close_before_weekend_transaction(self):
        idx = sessions(start="2026-01-05", n=10)
        px = ohlc(idx, close=100.0)
        px.loc[pd.Timestamp("2026-01-09"), "Close"] = 200.0          # piątek
        tx = tx_rows([{"transaction_date": pd.Timestamp("2026-01-10"), "price_per_share": 190.0}])  # sobota
        out, log = hb.clean_transactions(tx, CIK, {"UNH": px})
        assert log["price_fixed"] == 0 and out["price_status"].iloc[0] == "ok"

    def test_csuite_recomputed_with_production_patterns(self):
        tx = tx_rows([{"officer_title": "Medical Director", "is_csuite": True, "shares": 1.0},
                      {"officer_title": "President and CEO", "is_csuite": False, "shares": 2.0}])
        out, _ = hb.clean_transactions(tx, CIK, unh_prices())
        assert dict(zip(out["shares"], out["is_csuite_prod"])) == {1.0: False, 2.0: True}


# ── epizody ──────────────────────────────────────────────────────────────────

def clean_rows(rows):
    base = {"symbol": "UNH", "filing_date": pd.Timestamp("2026-01-07"), "value_clean": 100_000.0,
            "is_csuite_prod": False, "acceptance_datetime": ""}
    return pd.DataFrame([{**base, **r} for r in rows])


class TestEpisodes:
    def setup_method(self):
        self.cal = sessions(n=60)

    def test_filings_within_gap_merge(self):
        b = clean_rows([{"filing_date": self.cal[2]}, {"filing_date": self.cal[5], "is_csuite_prod": True,
                                                       "value_clean": 50_000.0}])
        ep = hb.build_episodes(b, self.cal)
        assert len(ep) == 1
        e = ep.iloc[0]
        assert e["first_filing"] == self.cal[2] and e["entry_idx"] == 3
        assert e["value"] == pytest.approx(150_000.0) and bool(e["is_csuite"]) and e["n_filings"] == 2

    def test_gap_boundary(self):
        five = hb.build_episodes(clean_rows([{"filing_date": self.cal[2]}, {"filing_date": self.cal[7]}]), self.cal)
        six = hb.build_episodes(clean_rows([{"filing_date": self.cal[2]}, {"filing_date": self.cal[8]}]), self.cal)
        assert len(five) == 1 and len(six) == 2

    def test_chaining(self):
        b = clean_rows([{"filing_date": self.cal[i]} for i in (2, 6, 10, 14)])
        ep = hb.build_episodes(b, self.cal)
        assert len(ep) == 1 and ep.iloc[0]["n_filings"] == 4

    def test_same_day_multiple_transactions_one_filing(self):
        b = clean_rows([{}, {"value_clean": 1.0}])
        ep = hb.build_episodes(b, self.cal)
        assert len(ep) == 1 and ep.iloc[0]["n_filings"] == 1 and ep.iloc[0]["n_tx"] == 2

    def test_tickers_separate(self):
        b = clean_rows([{}, {"symbol": "GILD"}])
        assert sorted(hb.build_episodes(b, self.cal)["symbol"]) == ["GILD", "UNH"]

    def test_filing_after_calendar_dropped(self):
        b = clean_rows([{"filing_date": self.cal[-1]}])
        assert hb.build_episodes(b, self.cal).empty

    def test_groups(self):
        ep = pd.DataFrame([
            {"symbol": "UNH", "value": 100_000.0, "is_csuite": True},
            {"symbol": "UNH", "value": 99_999.0, "is_csuite": False},
            {"symbol": "AAPL", "value": 1e6, "is_csuite": True},
        ])
        g = hb.assign_groups(ep)
        assert (len(g["G1_hc_all"]), len(g["G2_hc_csuite"]), len(g["G3_hc_100k"])) == (2, 1, 1)
        assert list(g["CTRL_info"]["symbol"]) == ["AAPL"]

    def test_benchmark_map_covers_universe(self):
        for s in hb.HEALTHCARE_TICKERS + hb.CONTROL_TICKERS:
            assert s in hb.BENCHMARK_MAP
        assert hb.BENCHMARK_MAP["AAPL"] == "SPY" and hb.BENCHMARK_MAP["UNH"] == "IHF"


# ── zwroty ───────────────────────────────────────────────────────────────────

class TestNetMatrix:
    def test_values_and_length(self):
        cal = sessions(n=10)
        px, bench = ohlc(cal), ohlc(cal)
        px.loc[cal[2], "Open"] = 100.0
        px.loc[cal[6], "Close"] = 110.0            # wejście 2, n=5 → wyjście 6
        bench.loc[cal[2], "Open"] = 50.0
        bench.loc[cal[6], "Close"] = 52.0
        nets = hb.net_matrix(px, bench, cal, 5, cost_pp=1.0)
        assert len(nets) == 10 - 5 + 1
        assert nets[2] == pytest.approx(10.0 - 4.0 - 1.0)
        assert nets[0] == pytest.approx(-1.0)      # płasko: 0 − 0 − koszt

    def test_gap_on_filing_day_not_counted(self):
        cal = sessions(n=10)
        px = ohlc(cal)
        px.loc[cal[1], "Close"] = 150.0            # luka w dniu filingu (cal[1])
        px.loc[cal[2:], ["Open", "Close"]] = 150.0  # od wejścia płasko
        ep = pd.DataFrame([{"symbol": "X", "entry_idx": hb.entry_index(cal, cal[1])}])
        v = hb.episode_nets(ep, {"X": hb.net_matrix(px, ohlc(cal), cal, 5, cost_pp=0.0)})
        assert v[0] == pytest.approx(0.0)

    def test_missing_prices_give_nan(self):
        cal = sessions(n=10)
        px = ohlc(cal).drop(cal[3])
        nets = hb.net_matrix(px, ohlc(cal), cal, 2)
        assert np.isnan(nets[3]) and np.isnan(nets[2]) and not np.isnan(nets[4])

    def test_episode_beyond_full_horizon_is_nan(self):
        cal = sessions(n=10)
        nets = {"X": hb.net_matrix(ohlc(cal), ohlc(cal), cal, 5)}
        v = hb.episode_nets(pd.DataFrame([{"symbol": "X", "entry_idx": 6}, {"symbol": "Y", "entry_idx": 0}]), nets)
        assert np.isnan(v).all()


# ── statystyka ───────────────────────────────────────────────────────────────

def ep_frame(symbols, idx):
    return pd.DataFrame({"symbol": symbols, "entry_idx": idx})


class TestPermutation:
    def test_flat_series_gives_p_one(self):
        nets = {"A": np.zeros(100), "B": np.zeros(100)}
        p, _ = hb.permutation_pvalue(ep_frame(["A", "B"], [10, 20]), nets, b=500)
        assert p == pytest.approx(1.0)

    def test_strong_signal_small_p(self):
        a = np.zeros(200)
        a[[10, 50, 90, 130]] = 20.0
        p, perm = hb.permutation_pvalue(ep_frame(["A"] * 4, [10, 50, 90, 130]), {"A": a}, b=2000)
        assert p < 0.01 and len(perm) == 2000

    def test_shift_is_common_for_all_episodes(self):
        # dwa tickery, sygnał tylko gdy OBA wejścia trafiają w swoje piki jednocześnie → p małe tylko przy wspólnym k
        a, b = np.zeros(100), np.zeros(100)
        a[10], b[60] = 10.0, 10.0
        p, perm = hb.permutation_pvalue(ep_frame(["A", "B"], [10, 60]), {"A": a, "B": b}, b=3000)
        assert perm.max() < 10.0                   # żaden wspólny przesuw nie trafia w oba piki naraz
        assert p < 0.01

    def test_deterministic(self):
        rng = np.random.default_rng(0)
        nets = {"A": rng.normal(size=300)}
        e = ep_frame(["A"] * 5, [5, 40, 80, 120, 200])
        assert hb.permutation_pvalue(e, nets, b=300)[0] == hb.permutation_pvalue(e, nets, b=300)[0]


class TestBootstrapLotoHolmVerdict:
    def test_bootstrap_constant(self):
        e = ep_frame(["A", "A", "B"], [0, 1, 2])
        lo, hi = hb.cluster_bootstrap_ci(e, np.array([2.0, 2.0, 2.0]), b=200)
        assert lo == pytest.approx(2.0) and hi == pytest.approx(2.0)

    def test_bootstrap_brackets_mean(self):
        rng = np.random.default_rng(1)
        e = ep_frame([f"T{i % 8}" for i in range(80)], list(range(80)))
        v = rng.normal(1.0, 3.0, 80)
        lo, hi = hb.cluster_bootstrap_ci(e, v, b=1000)
        assert lo < v.mean() < hi

    def test_loto(self):
        e = ep_frame(["A", "A", "B"], [0, 1, 2])
        out = hb.leave_one_ticker_out(e, np.array([1.0, 3.0, 10.0]))
        assert out == {"A": pytest.approx(10.0), "B": pytest.approx(2.0)}

    def test_holm(self):
        out = hb.holm({"a": 0.01, "b": 0.04, "c": 0.03, "d": None})
        assert out["a"] == pytest.approx(0.03) and out["c"] == pytest.approx(0.06)
        assert out["b"] == pytest.approx(0.06) and out["d"] is None

    def test_verdict_positive(self):
        v = hb.verdict(2.0, 1.0, 0.01, 6.0, {"A": 1.5, "B": 2.5})
        assert v["verdict"] == "POZYTYWNY"

    def test_verdict_negative(self):
        assert hb.verdict(-1.0, -0.5, 0.7, 2.9, {"A": -1.0})["verdict"] == "NEGATYWNY"

    def test_verdict_inconclusive(self):
        assert hb.verdict(0.5, 0.2, 0.2, 5.0, {"A": 0.4})["verdict"] == "NIEROZSTRZYGNIĘTY"

    def test_loto_sign_flip_blocks_positive(self):
        v = hb.verdict(2.0, 1.0, 0.01, 6.0, {"A": 1.5, "UNH": -0.2})
        assert v["verdict"] != "POZYTYWNY" and v["checks"]["loto_same_sign"] is False

    def test_winsorized(self):
        v = np.array(list(range(100)) + [10_000.0])
        assert hb.winsorized_mean(v) < np.mean(v)


# ── wariant akceptacji ───────────────────────────────────────────────────────

class TestAcceptance:
    """acceptanceDateTime z EDGAR jest w UTC (zweryfikowane 08.11.2026); styczeń = EST (UTC−5)."""

    def setup_method(self):
        self.cal = sessions(n=20)
        self.day = pd.Timestamp("2026-01-07")

    def test_utc_confirmed_constant(self):
        assert hb.ACCEPTANCE_TZ == "UTC"

    def test_premarket_same_day_shifts_entry(self):
        assert hb.acceptance_entry_shift("2026-01-07T13:15:00.000Z", self.day, self.cal) == -1   # 08:15 ET

    def test_open_boundary_and_after_no_shift(self):
        assert hb.acceptance_entry_shift("2026-01-07T14:29:00.000Z", self.day, self.cal) == -1   # 09:29 ET
        assert hb.acceptance_entry_shift("2026-01-07T14:30:00.000Z", self.day, self.cal) == 0    # 09:30 ET
        assert hb.acceptance_entry_shift("2026-01-07T22:05:00.000Z", self.day, self.cal) == 0    # 17:05 ET

    def test_utc_after_midnight_is_previous_et_day(self):
        # 03:00 UTC 08.01 = 22:00 ET 07.01 → dzień ET ≠ dzień filingu 08.01 → brak przesunięcia
        assert hb.acceptance_entry_shift("2026-01-08T03:00:00.000Z", pd.Timestamp("2026-01-08"), self.cal) == 0

    def test_other_day_or_empty_no_shift(self):
        assert hb.acceptance_entry_shift("2026-01-06T13:00:00.000Z", self.day, self.cal) == 0
        assert hb.acceptance_entry_shift("", self.day, self.cal) == 0
        assert hb.acceptance_entry_shift("garbage", self.day, self.cal) == 0


# ── wczytywanie i raport ─────────────────────────────────────────────────────

HEADER = ("symbol,filing_date,transaction_date,insider_name,insider_role,officer_title,is_officer,is_director,"
          "is_ten_pct_owner,transaction_type,shares,price_per_share,total_value,shares_owned_after,is_10b51_plan,"
          "is_csuite,is_healthcare,accession_number")


def test_load_v6_csv(tmp_path):
    p = tmp_path / "tx.csv"
    p.write_text(HEADER + ",form,table,issuer_cik,issuer_symbol,acceptance_datetime\n"
                 "UNH,2026-01-07,2026-01-05,A,Officer,CEO,True,False,False,BUY,10,100,1000,10,False,True,True,"
                 "0001,4,ND,0000731766,UNH,2026-01-07T17:00:00.000Z\n")
    tx = hb.load_transactions(str(p))
    assert tx["issuer_cik"].iloc[0] == "731766" and tx["table"].iloc[0] == "ND"
    assert tx["is_officer"].dtype == bool


def test_load_old_csv_without_new_columns(tmp_path):
    p = tmp_path / "tx.csv"
    p.write_text(HEADER + "\nUNH,2026-01-07,2026-01-05,A,Officer,CEO,True,False,False,BUY,10,100,1000,10,False,True,True,1\n")
    tx = hb.load_transactions(str(p))
    assert tx["issuer_cik"].iloc[0] == "" and tx["table"].iloc[0] == ""


def test_render_tables_smoke():
    grp = {"episodes": 3, "n": 3, "mean": 1.0, "median": 0.5, "hit": 66.7, "winsorized_mean": 1.0,
           "max_ticker": {"symbol": "UNH", "share": 0.4, "flag": True}, "p_perm": 0.2, "ci95": [-1.0, 3.0]}
    res = {"criteria": {"primary": ["G1_hc_all", "90d"]},
           "primary_verdict": hb.verdict(1.0, 0.5, 0.2, 3.0, {"A": 1.0}),
           "secondary_holm": {"G1_hc_all|30d": 0.5},
           "groups": {"G1_hc_all": {"90d": grp, "30d": {**grp, "p_perm": None, "ci95": None}}}}
    out = hb.render_tables(res)
    assert "NIEROZSTRZYGNIĘTY" in out and "UNH 40% ⚠" in out and "| G1_hc_all | 30d |" in out
