"""
TASK-12 (23.04.2026): testy rendering direct-comparison sub_groups w raporcie.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from report_generator import (
    _direct_comparison_meta,
    _direct_comparison_sig,
    _direct_comparison_table,
)


class TestDirectComparisonMeta:
    def test_cluster_single_detected(self):
        sub = {"n_cluster": 21, "n_single": 49, "tx_type": "BUY", "horizons": {}}
        meta = _direct_comparison_meta(sub)
        assert meta is not None
        assert meta["label_a"] == "cluster"
        assert meta["label_b"] == "single"
        assert meta["d_key"] == "cohens_d"

    def test_hc_ctrl_detected(self):
        sub = {"n_hc": 973, "n_ctrl": 1393, "horizons": {}}
        meta = _direct_comparison_meta(sub)
        assert meta is not None
        assert meta["label_a"] == "hc"
        assert meta["label_b"] == "ctrl"
        assert meta["d_key"] == "effect_size_d"

    def test_standard_returns_none(self):
        sub = {"n": 100, "horizons": {"1d": {"n": 100}}}
        assert _direct_comparison_meta(sub) is None

    def test_partial_keys_returns_none(self):
        # Safety: sama n_cluster bez n_single → NIE direct comparison
        assert _direct_comparison_meta({"n_cluster": 10, "horizons": {}}) is None
        assert _direct_comparison_meta({"n_hc": 10, "horizons": {}}) is None


class TestDirectComparisonSig:
    def test_strict_bonferroni(self):
        assert _direct_comparison_sig({"significant_bonferroni_strict": True}) == "✓✓✓"

    def test_bonferroni(self):
        assert _direct_comparison_sig({"significant_bonferroni": True}) == "✓✓"

    def test_005_only(self):
        assert _direct_comparison_sig({"significant_005": True}) == "✓"

    def test_none(self):
        assert _direct_comparison_sig({}) == "✗"


class TestDirectComparisonTable:
    def _cluster_fixture(self):
        return {
            "n_cluster": 21, "n_single": 49, "tx_type": "BUY",
            "horizons": {
                "1d": {
                    "n_cluster": 21, "n_single": 49,
                    "mean_cluster": 1.89, "mean_single": 1.00,
                    "p_value": 0.4450, "cohens_d": 0.22,
                    "significant_bonferroni_strict": False,
                    "significant_bonferroni": False,
                },
                "3d": {
                    "n_cluster": 21, "n_single": 49,
                    "mean_cluster": 1.69, "mean_single": 2.15,
                    "p_value": 0.6999, "cohens_d": -0.10,
                },
                "7d": {
                    "n_cluster": 21, "n_single": 49,
                    "mean_cluster": 2.53, "mean_single": 2.59,
                    "p_value": 0.9549, "cohens_d": -0.01,
                },
                "30d": {
                    "n_cluster": 21, "n_single": 49,
                    "mean_cluster": 3.14, "mean_single": 5.72,
                    "p_value": 0.3710, "cohens_d": -0.23,
                },
            },
        }

    def _hc_fixture(self):
        return {
            "n_hc": 973, "n_ctrl": 1393,
            "horizons": {
                "30d": {
                    "n_hc": 965, "n_ctrl": 1376,
                    "avg_hc_pct": 0.706, "avg_ctrl_pct": 2.274,
                    "p_value": 0.0162, "effect_size_d": -0.144,
                    "significant_005": True,
                    "significant_bonferroni": False,
                },
            },
        }

    def test_cluster_renders_header_and_rows(self):
        sub = self._cluster_fixture()
        meta = _direct_comparison_meta(sub)
        out = _direct_comparison_table(sub, meta)
        assert "N_cluster" in out and "N_single" in out
        assert "Avg cluster" in out and "Avg single" in out
        assert "+0.22" in out  # 1d cohens_d
        assert "-0.23" in out  # 30d cohens_d
        assert "0.4450" in out  # 1d p-value formatted
        # Wszystkie 4 horyzonty obecne
        for horizon in ("1d", "3d", "7d", "30d"):
            assert f"| {horizon} |" in out

    def test_hc_renders_005_sig_marker(self):
        sub = self._hc_fixture()
        meta = _direct_comparison_meta(sub)
        out = _direct_comparison_table(sub, meta)
        # 30d: p=0.0162 → significant_005=True → ✓
        lines = [ln for ln in out.split("\n") if ln.startswith("| 30d")]
        assert len(lines) == 1
        assert "✓" in lines[0]
        assert "-0.14" in lines[0]  # effect_size_d

    def test_note_row_renders_gracefully(self):
        sub = {
            "n_cluster": 2, "n_single": 1, "tx_type": "BUY",
            "horizons": {
                "1d": {
                    "n_cluster": 2, "n_single": 1,
                    "note": "insufficient N (<3)",
                },
                "3d": {}, "7d": {}, "30d": {},
            },
        }
        meta = _direct_comparison_meta(sub)
        out = _direct_comparison_table(sub, meta)
        assert "insufficient N (<3)" in out


class TestGenerateReportIntegration:
    """Integracja: JSON z nowymi sub_groups → markdown zawiera sekcje."""

    def test_produces_both_sections_from_real_json(self, tmp_path):
        import json

        import report_generator

        results_path = Path(__file__).parent.parent / "data" / "results" / "backtest_results.json"
        tx_path = Path(__file__).parent.parent / "data" / "form4_transactions.csv"
        if not results_path.exists() or not tx_path.exists():
            # Environment nie ma danych produkcyjnych — skip (integration only)
            import pytest
            pytest.skip("brak backtest_results.json / transactions CSV")

        with open(results_path) as f:
            results = json.load(f)
        report = report_generator.generate_report(results, str(tx_path))

        assert "### cluster_buy_vs_single_buy" in report
        assert "### hc_vs_ctrl_direct" in report
        assert "N_cluster=21" in report
        assert "N_hc=973" in report

    def test_skips_direct_comparison_when_absent(self):
        # Graceful fallback: JSON bez direct-comparison sub_groups → brak crash
        import report_generator

        results = [{
            "name": "H_FAKE",
            "description": "Fake",
            "n_events": 10,
            "horizons": {},
            "sub_groups": {
                "standard": {"n": 10, "horizons": {}},
            },
        }]
        # Stub minimal CSV
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False) as f:
            f.write("symbol,transaction_type,is_10b51_plan,is_csuite\n")
            f.write("XYZ,BUY,False,True\n")
            csv_path = f.name

        report = report_generator.generate_report(results, csv_path)
        # No crash, sekcja "standard" wyrenderowana
        assert "### standard" in report
        assert "cluster_buy_vs_single_buy" not in report
