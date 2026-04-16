"""
Testy dla analyzer — Cohen's d + winsorization (FLAG #32).
"""
from __future__ import annotations

import numpy as np
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from analyzer import _cohens_d, _winsorize


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
