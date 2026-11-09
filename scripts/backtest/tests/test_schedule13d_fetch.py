"""Testy czystych funkcji fetchera teczki 13D (kroki 0a–0c)."""
import datetime as dt

from schedule13d_fetch import (
    is_initial_13d, parse_hdr_sgml, parse_idx_line, polygon_window_start, price_tickers, quarters,
)

HDR = """<SEC-HEADER>0001213900-25-002719.hdr.sgml : 20250110
<ACCEPTANCE-DATETIME>20250110170003
<ACCESSION-NUMBER>0001213900-25-002719
<TYPE>SCHEDULE 13D
<FILING-DATE>20250110
<SUBJECT-COMPANY>
<COMPANY-DATA>
<CONFORMED-NAME>180 Life Sciences Corp.
<CIK>0001690080
<ASSIGNED-SIC>2834
</COMPANY-DATA>
<FORMER-COMPANY>
<FORMER-CONFORMED-NAME>KBL MERGER CORP. IV
</FORMER-COMPANY>
</SUBJECT-COMPANY>
<FILED-BY>
<COMPANY-DATA>
<CONFORMED-NAME>Goodman Anthony Brian
<CIK>0001672837
</COMPANY-DATA>
</FILED-BY>
<FILED-BY>
<COMPANY-DATA>
<CONFORMED-NAME>Second Fund LP
<CIK>0000000042
</COMPANY-DATA>
</FILED-BY>
</SEC-HEADER>
"""


def test_parse_idx_line_new_and_old_form_names():
    a = parse_idx_line("SCHEDULE 13D     180 Life Sciences Corp.                                       1690080     "
                       "2025-01-10  edgar/data/1690080/0001213900-25-002719.txt         ")
    assert a["form"] == "SCHEDULE 13D" and a["cik"] == "1690080" and a["date"] == "2025-01-10"
    assert a["accession"] == "0001213900-25-002719"
    b = parse_idx_line("SC 13D/A         Some  Co  Inc                                                 123         "
                       "2024-11-04  edgar/data/123/0000000000-24-000001.txt")
    assert b["form"] == "SC 13D/A"


def test_parse_idx_line_rejects_header_and_dashes():
    assert parse_idx_line("Form Type   Company Name      CIK         Date Filed  File Name") is None
    assert parse_idx_line("-" * 80) is None


def test_is_initial_13d_excludes_amendments_and_13g():
    assert is_initial_13d("SC 13D") and is_initial_13d("SCHEDULE 13D")
    for f in ("SC 13D/A", "SCHEDULE 13D/A", "SC 13G", "SCHEDULE 13G", "13D"):
        assert not is_initial_13d(f)


def test_parse_hdr_subject_vs_filers():
    h = parse_hdr_sgml(HDR)
    assert h.acceptance == "20250110170003" and h.form == "SCHEDULE 13D"
    assert (h.subject_cik, h.subject_sic, h.subject_name) == ("1690080", "2834", "180 Life Sciences Corp.")
    assert h.filers == [("1672837", "Goodman Anthony Brian"), ("42", "Second Fund LP")]


def test_quarters_span_year_boundary():
    assert quarters((2024, 4), dt.date(2025, 5, 1)) == [(2024, 4), (2025, 1), (2025, 2)]


def test_polygon_window_start():
    assert polygon_window_start(dt.date(2026, 11, 8)) == dt.date(2024, 11, 6)
    assert polygon_window_start(dt.date(2026, 11, 8), 2) == dt.date(2024, 11, 8)


def test_price_tickers_filters_types_and_merges_current():
    ref = [{"ticker": "ATNF", "type": "CS"}, {"ticker": "ATNFW", "type": "WARRANT"},
           {"ticker": "XYZ", "type": "ADRC"}, {"ticker": "PFDX", "type": "PFD"}]
    assert price_tickers(ref, ["ETHZ"]) == ["ATNF", "ETHZ", "XYZ"]
