"""
Testy dla analyzer — Cohen's d + winsorization (FLAG #32).
"""
from __future__ import annotations

import numpy as np
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pandas as pd

from analyzer import (
    _cohens_d, _winsorize,
    _collect_single_buy_events, _direct_cluster_vs_single, EventReturn,
    CLUSTER_WINDOW_DAYS,
)


class TestWinsorize:
    def test_clips_extremes(self):
        arr = np.arange(100.0)
        result = _winsorize(arr, pct=1.0)
        assert result.min() >= 0.99
        assert result.max() <= 98.01

    def test_small_array_unchanged(self):
        arr = np.array([1.0, 2.0, 3.0])
        result = _winsorize(arr)
        np.testing.assert_array_equal(result, arr)


class TestCohensD:
    def test_identical_d_near_zero(self):
        rng = np.random.RandomState(42)
        a = rng.normal(0, 1, 1000)
        b = rng.normal(0, 1, 1000)
        d = _cohens_d(a, b, winsorize=False)
        assert abs(d) < 0.15

    def test_shifted_positive_d(self):
        rng = np.random.RandomState(42)
        a = rng.normal(0.5, 1, 100)
        b = rng.normal(0.0, 1, 1000)
        d = _cohens_d(a, b, winsorize=False)
        assert 0.3 < d < 0.7

    def test_small_events_returns_none(self):
        d = _cohens_d(np.array([1.0, 2.0]), np.random.randn(100))
        assert d is None

    def test_winsorization_reduces_outlier_impact(self):
        rng = np.random.RandomState(42)
        a = rng.normal(0.5, 1, 100)
        b = np.concatenate([rng.normal(0.0, 1, 1000), np.array([50.0, -50.0, 100.0])])
        d_no = _cohens_d(a, b, winsorize=False)
        d_yes = _cohens_d(a, b, winsorize=True)
        assert d_yes > d_no

    def test_ddof_matters_small_n(self):
        rng = np.random.RandomState(42)
        small = rng.normal(0.7, 1, 12)
        baseline = rng.normal(0.0, 1, 5000)
        d_correct = _cohens_d(small, baseline, winsorize=False)
        pooled_old = np.sqrt((np.std(small, ddof=0)**2 + np.std(baseline, ddof=0)**2) / 2)
        d_old = (np.mean(small) - np.mean(baseline)) / pooled_old
        assert d_correct is not None
        assert abs(d_correct - d_old) > 0.01


class TestCollectSingleBuyEvents:
    """Sprint 17: _collect_single_buy_events wyciąga pojedyncze BUY (non-cluster)."""

    def _make_disc(self, rows):
        df = pd.DataFrame(rows)
        df["filing_date"] = pd.to_datetime(df["filing_date"])
        return df

    def _make_prices(self, symbols):
        """Generator prostych cen dla symboli — format zgodny z _compute_returns."""
        prices = {}
        for s in symbols:
            dates = pd.date_range("2025-01-01", "2025-12-31", freq="B")
            prices[s] = pd.DataFrame({
                "Date": dates,
                "Close": np.linspace(100, 120, len(dates)),
            }).set_index("Date")
        return prices

    def test_solo_buy_qualifies(self):
        df = self._make_disc([
            {"symbol": "AAPL", "transaction_type": "BUY", "filing_date": "2025-03-01",
             "insider_name": "Alice", "is_csuite": True},
        ])
        prices = self._make_prices(["AAPL"])
        events = _collect_single_buy_events(df, prices)
        assert len(events) == 1
        assert events[0].tx_type == "BUY"
        assert events[0].n_insiders == 1

    def test_two_insiders_in_window_is_cluster_not_single(self):
        df = self._make_disc([
            {"symbol": "AAPL", "transaction_type": "BUY", "filing_date": "2025-03-01",
             "insider_name": "Alice", "is_csuite": True},
            {"symbol": "AAPL", "transaction_type": "BUY", "filing_date": "2025-03-03",
             "insider_name": "Bob", "is_csuite": False},
        ])
        prices = self._make_prices(["AAPL"])
        events = _collect_single_buy_events(df, prices)
        # Pierwszy ma Alice+Bob w oknie → cluster, pomijany
        assert len(events) == 0

    def test_two_insiders_outside_window_are_both_single(self):
        # 7d < różnica < kilka tygodni → każdy BUY ma swoje solo window
        df = self._make_disc([
            {"symbol": "AAPL", "transaction_type": "BUY", "filing_date": "2025-03-01",
             "insider_name": "Alice", "is_csuite": True},
            {"symbol": "AAPL", "transaction_type": "BUY", "filing_date": "2025-04-01",
             "insider_name": "Bob", "is_csuite": False},
        ])
        prices = self._make_prices(["AAPL"])
        events = _collect_single_buy_events(df, prices)
        assert len(events) == 2

    def test_sell_ignored(self):
        df = self._make_disc([
            {"symbol": "AAPL", "transaction_type": "SELL", "filing_date": "2025-03-01",
             "insider_name": "Alice", "is_csuite": True},
        ])
        prices = self._make_prices(["AAPL"])
        events = _collect_single_buy_events(df, prices)
        assert len(events) == 0


class TestDirectClusterVsSingle:
    """Sprint 17: Welch's t-test cluster vs single events."""

    def _make_event(self, r1=0.02, r4=0.04, r30=0.05):
        return EventReturn(
            symbol="X", event_date="2025-01-01", price_at_event=100.0,
            returns={"1d": r1, "4d": r4, "30d": r30},
            tx_type="BUY", n_insiders=1,
            is_healthcare=True, is_csuite=True,
        )

    def test_cluster_edge_over_single_positive_d(self):
        # Cluster ma wyższe returns niż single → positive Cohen's d
        rng = np.random.RandomState(42)
        cluster = [self._make_event(r30=float(v)) for v in rng.normal(0.06, 0.02, 50)]
        single = [self._make_event(r30=float(v)) for v in rng.normal(0.02, 0.02, 100)]
        result = _direct_cluster_vs_single(cluster, single, "BUY")
        d = result["horizons"]["30d"]["cohens_d"]
        assert d is not None and d > 1.0

    def test_insufficient_n_returns_note(self):
        result = _direct_cluster_vs_single([self._make_event()], [self._make_event()], "BUY")
        assert result["horizons"]["30d"]["note"] == "insufficient N (<3)"

    def test_structure_has_tx_type_and_counts(self):
        rng = np.random.RandomState(42)
        cluster = [self._make_event(r30=float(v)) for v in rng.normal(0.05, 0.02, 10)]
        single = [self._make_event(r30=float(v)) for v in rng.normal(0.02, 0.02, 10)]
        result = _direct_cluster_vs_single(cluster, single, "BUY")
        assert result["tx_type"] == "BUY"
        assert result["n_cluster"] == 10
        assert result["n_single"] == 10
