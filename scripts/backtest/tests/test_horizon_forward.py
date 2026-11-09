"""
Testy pomiaru w przód HORYZONT (teczka doc/TECZKA-HORYZONT-FORWARD-2026-11-08.md). Dane syntetyczne.
"""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pandas as pd

import horizon_forward as hf


def ep(rows):
    return pd.DataFrame(rows, columns=["symbol", "first_filing", "entry_idx", "value", "is_csuite",
                                       "n_filings", "n_tx", "acceptance"])


class TestForwardEpisodes:
    def test_tylko_pierwszy_filing_od_daty_startu(self):
        e = ep([["UNH", "2026-11-06", 1, 1e5, True, 1, 1, ""],      # in-sample
                ["UNH", "2026-11-09", 2, 1e5, True, 1, 1, ""],      # forward
                ["ELV", "2026-11-08", 3, 1e5, True, 1, 1, ""]])     # forward (granica włącznie)
        out = hf.forward_episodes(e)
        assert list(out["first_filing"]) == ["2026-11-09", "2026-11-08"]

    def test_poza_uniwersum_odpada(self):
        e = ep([["AAPL", "2026-12-01", 1, 1e5, True, 1, 1, ""], ["PFE", "2026-12-01", 1, 1e5, True, 1, 1, ""]])
        assert hf.forward_episodes(e).empty           # kontrola i rdzeń+ poza G1

    def test_uniwersum_to_28_tickerow_horyzont(self):
        assert len(hf.UNIVERSE) == 28 and "HIMS" in hf.UNIVERSE


class TestPendingLook:
    T = date(2028, 1, 1)

    def test_przed_progiem_brak_spojrzenia(self):
        assert hf.pending_look({"looks_done": []}, 19, self.T) is None

    def test_spojrzenie_1_przy_20(self):
        assert hf.pending_look({"looks_done": []}, 20, self.T) == 1

    def test_spojrzenie_2_dopiero_przy_40(self):
        s = {"looks_done": [1]}
        assert hf.pending_look(s, 39, self.T) is None
        assert hf.pending_look(s, 40, self.T) == 2

    def test_data_koncowa_wymusza_ostatnie(self):
        assert hf.pending_look({"looks_done": []}, 5, hf.FINAL_DATE) == 2
        assert hf.pending_look({"looks_done": [1]}, 25, hf.FINAL_DATE) == 2

    def test_po_zamknieciu_nic(self):
        assert hf.pending_look({"looks_done": [1], "closed": True}, 50, self.T) is None
        assert hf.pending_look({"looks_done": [1, 2]}, 50, hf.FINAL_DATE) is None


class TestVerdict:
    L = {"A": 5.0, "B": 3.0}

    def test_potwierdzona(self):
        assert hf.forward_verdict(20, 8.0, 4.0, 0.01, 15.0, self.L, 1) == "POTWIERDZONA"

    def test_alfa_na_spojrzenie_0025(self):
        assert hf.forward_verdict(20, 8.0, 4.0, 0.03, 15.0, self.L, 1) == "CZEKAMY_NA_SPOJRZENIE_2"

    def test_loto_zmienia_znak_blokuje(self):
        assert hf.forward_verdict(20, 8.0, 4.0, 0.01, 15.0, {"A": 5.0, "B": -1.0}, 1) != "POTWIERDZONA"

    def test_obalona_ci(self):
        assert hf.forward_verdict(20, 1.0, 0.5, 0.3, 2.9, self.L, 1) == "OBALONA"

    def test_obalona_srednia_i_mediana_niedodatnie(self):
        assert hf.forward_verdict(20, -0.1, 0.0, 0.6, 9.0, self.L, 1) == "OBALONA"

    def test_tylko_jedna_niedodatnia_nie_obala(self):
        assert hf.forward_verdict(20, -0.1, 0.5, 0.6, 9.0, self.L, 1) == "CZEKAMY_NA_SPOJRZENIE_2"

    def test_spojrzenie_2_konczy(self):
        assert hf.forward_verdict(40, 2.0, 1.0, 0.1, 9.0, self.L, 2) == "NIEROZSTRZYGNIETA_KONIEC"

    def test_male_n_na_koncu(self):
        assert hf.forward_verdict(12, 9.0, 5.0, 0.001, 20.0, self.L, 2) == "NIEROZSTRZYGALNE_N"


def test_benchmarki_z_mapy_horyzont():
    assert set(hf.benchmarks()) == {"IHF", "IHI", "IBB", "XLV", "SPY"}
