"""
Testy dla edgar_fetcher — multi-reportingOwner (FLAG #34) + 10b5-1 per-tx (FLAG #35)
+ doc-level aff10b5One (Pakiet 1 fix #0, 09.06.2026).
"""
from __future__ import annotations

import xml.etree.ElementTree as ET
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from edgar_fetcher import _merge_reporting_owners, _parse_form4_xml


def _make_xml(owners: list, tx_code: str = "P", coding_extra: str = "",
              doc_extra: str = "") -> str:
    owners_xml = ""
    for o in owners:
        rel_parts = []
        if o.get("officer_title"):
            rel_parts.append(f"<officerTitle>{o['officer_title']}</officerTitle>")
        if o.get("is_officer"):
            rel_parts.append("<isOfficer>1</isOfficer>")
        if o.get("is_director"):
            rel_parts.append("<isDirector>1</isDirector>")
        if o.get("is_ten_pct"):
            rel_parts.append("<isTenPercentOwner>1</isTenPercentOwner>")
        owners_xml += f"""
        <reportingOwner>
            <reportingOwnerId><rptOwnerName>{o['name']}</rptOwnerName></reportingOwnerId>
            <reportingOwnerRelationship>{''.join(rel_parts)}</reportingOwnerRelationship>
        </reportingOwner>"""

    return f"""<?xml version="1.0"?>
    <ownershipDocument>
        {owners_xml}
        {doc_extra}
        <nonDerivativeTable>
            <nonDerivativeTransaction>
                <transactionDate><value>2026-03-01</value></transactionDate>
                <transactionCoding>
                    <transactionCode>{tx_code}</transactionCode>
                    {coding_extra}
                </transactionCoding>
                <transactionAmounts>
                    <transactionShares><value>1000</value></transactionShares>
                    <transactionPricePerShare><value>50</value></transactionPricePerShare>
                </transactionAmounts>
            </nonDerivativeTransaction>
        </nonDerivativeTable>
    </ownershipDocument>"""


class TestMergeReportingOwners:
    """FLAG #34: multi-reportingOwner fix."""

    def test_single_ceo(self):
        xml = _make_xml([{"name": "Smith John", "officer_title": "CEO", "is_officer": True}])
        root = ET.fromstring(xml)
        r = _merge_reporting_owners(root)
        assert r["insider_name"] == "Smith John"
        assert "CEO" in r["insider_role"]
        assert r["is_csuite"] is True

    def test_ceo_plus_director_preserves_csuite(self):
        xml = _make_xml([
            {"name": "Smith Jane", "is_director": True},
            {"name": "Smith John", "officer_title": "CEO", "is_officer": True},
        ])
        root = ET.fromstring(xml)
        r = _merge_reporting_owners(root)
        assert "CEO" in r["insider_role"]
        assert "Director" in r["insider_role"]
        assert r["is_csuite"] is True

    def test_co_filing_name(self):
        xml = _make_xml([
            {"name": "Smith John", "officer_title": "CEO", "is_officer": True},
            {"name": "Smith Jane", "is_director": True},
        ])
        root = ET.fromstring(xml)
        r = _merge_reporting_owners(root)
        assert "Smith John" in r["insider_name"]
        assert "co-filing" in r["insider_name"]

    def test_empty_owners(self):
        xml = '<?xml version="1.0"?><ownershipDocument><nonDerivativeTable></nonDerivativeTable></ownershipDocument>'
        root = ET.fromstring(xml)
        r = _merge_reporting_owners(root)
        assert r["insider_name"] == "Unknown"
        assert r["is_csuite"] is False

    def test_two_directors_no_csuite(self):
        xml = _make_xml([
            {"name": "Jane", "is_director": True},
            {"name": "Bob", "is_director": True},
        ])
        root = ET.fromstring(xml)
        r = _merge_reporting_owners(root)
        assert r["is_director"] is True
        assert r["is_csuite"] is False

    def test_parse_full_form4_with_multi_owner(self):
        xml = _make_xml([
            {"name": "Smith Jane", "is_director": True},
            {"name": "Smith John", "officer_title": "CEO", "is_officer": True},
        ])
        txns = _parse_form4_xml(xml, "TEST", "2026-03-01", "0000001")
        assert len(txns) == 1
        assert txns[0]["is_csuite"] is True
        assert txns[0]["is_director"] is True


class Test10b51PerTransaction:
    """FLAG #35: 10b5-1 detection per transakcja."""

    def test_flag_set(self):
        xml = _make_xml(
            [{"name": "Test", "is_officer": True}],
            tx_code="S",
            coding_extra="<isRule10b5-1Transaction>1</isRule10b5-1Transaction>",
        )
        txns = _parse_form4_xml(xml, "TEST", "2026-03-01", "001")
        assert txns[0]["is_10b51_plan"] is True

    def test_flag_not_set(self):
        xml = _make_xml([{"name": "Test", "is_officer": True}], tx_code="S")
        txns = _parse_form4_xml(xml, "TEST", "2026-03-01", "001")
        assert txns[0]["is_10b51_plan"] is False

    def test_flag_Y_value(self):
        xml = _make_xml(
            [{"name": "Test", "is_officer": True}],
            tx_code="S",
            coding_extra="<isRule10b5-1Transaction>Y</isRule10b5-1Transaction>",
        )
        txns = _parse_form4_xml(xml, "TEST", "2026-03-01", "001")
        assert txns[0]["is_10b51_plan"] is True

    def test_footnote_mention_not_flagged(self):
        xml = """<?xml version="1.0"?>
        <ownershipDocument>
            <reportingOwner>
                <reportingOwnerId><rptOwnerName>Test</rptOwnerName></reportingOwnerId>
                <reportingOwnerRelationship><isOfficer>1</isOfficer></reportingOwnerRelationship>
            </reportingOwner>
            <nonDerivativeTable>
                <nonDerivativeTransaction>
                    <transactionDate><value>2026-03-01</value></transactionDate>
                    <transactionCoding><transactionCode>S</transactionCode></transactionCoding>
                    <transactionAmounts>
                        <transactionShares><value>1000</value></transactionShares>
                        <transactionPricePerShare><value>50</value></transactionPricePerShare>
                    </transactionAmounts>
                </nonDerivativeTransaction>
            </nonDerivativeTable>
            <footnotes>
                <footnote>Executive terminated 10b5-1 trading plan in 2024.</footnote>
            </footnotes>
        </ownershipDocument>"""
        txns = _parse_form4_xml(xml, "TEST", "2026-03-01", "001")
        assert txns[0]["is_10b51_plan"] is False


class TestDocLevelAff10b5One:
    """Pakiet 1 fix #0 (09.06.2026): doc-level <aff10b5One> — jedyny realny znacznik."""

    def test_gild_oday_replay_aff_1_sell_is_plan(self):
        # GILD O'Day 29.04.2026: aff10b5One=1, kod S, ZERO per-transaction tagów
        xml = _make_xml(
            [{"name": "O'Day Daniel Patrick", "officer_title": "CEO", "is_officer": True}],
            tx_code="S",
            doc_extra="<aff10b5One>1</aff10b5One>",
        )
        txns = _parse_form4_xml(xml, "GILD", "2026-04-29", "001")
        assert txns[0]["is_10b51_plan"] is True

    def test_aff_0_is_discretionary(self):
        xml = _make_xml(
            [{"name": "Test", "is_officer": True}],
            tx_code="S",
            doc_extra="<aff10b5One>0</aff10b5One>",
        )
        txns = _parse_form4_xml(xml, "TEST", "2026-03-01", "001")
        assert txns[0]["is_10b51_plan"] is False

    def test_aff_true_variant(self):
        xml = _make_xml(
            [{"name": "Test", "is_officer": True}],
            doc_extra="<aff10b5One>true</aff10b5One>",
        )
        txns = _parse_form4_xml(xml, "TEST", "2026-03-01", "001")
        assert txns[0]["is_10b51_plan"] is True

    def test_aff_uppercase_TRUE_variant(self):
        # Spójność zbioru wartości z form4-parser.ts (strip().lower())
        xml = _make_xml(
            [{"name": "Test", "is_officer": True}],
            doc_extra="<aff10b5One>TRUE</aff10b5One>",
        )
        txns = _parse_form4_xml(xml, "TEST", "2026-03-01", "001")
        assert txns[0]["is_10b51_plan"] is True

    def test_missing_tag_pre_2023_filing(self):
        xml = _make_xml([{"name": "Test", "is_officer": True}], tx_code="S")
        txns = _parse_form4_xml(xml, "TEST", "2026-03-01", "001")
        assert txns[0]["is_10b51_plan"] is False

    def test_per_transaction_fallback_preserved(self):
        xml = _make_xml(
            [{"name": "Test", "is_officer": True}],
            tx_code="S",
            coding_extra="<isRule10b5-1Transaction>1</isRule10b5-1Transaction>",
            doc_extra="<aff10b5One>0</aff10b5One>",
        )
        txns = _parse_form4_xml(xml, "TEST", "2026-03-01", "001")
        assert txns[0]["is_10b51_plan"] is True


# ── 08.11.2026: kolumny form/table/issuer/acceptance + ponawianie zapytań (teczka HORYZONT) ──────────

import edgar_fetcher as ef
from config import TX_COLUMNS

ISSUER = "<issuer><issuerCik>0000882095</issuerCik><issuerTradingSymbol>gild</issuerTradingSymbol></issuer>"
DERIV = """
        <derivativeTable>
            <derivativeTransaction>
                <transactionDate><value>2026-03-02</value></transactionDate>
                <transactionCoding><transactionCode>P</transactionCode></transactionCoding>
                <transactionAmounts>
                    <transactionShares><value>500</value></transactionShares>
                    <transactionPricePerShare><value>0.53</value></transactionPricePerShare>
                </transactionAmounts>
            </derivativeTransaction>
        </derivativeTable>"""


def _xml_with(issuer: str = ISSUER, derivative: bool = False) -> str:
    xml = _make_xml([{"name": "Doe", "officer_title": "CEO", "is_officer": True}], doc_extra=issuer)
    if derivative:
        xml = xml.replace("</ownershipDocument>", DERIV + "\n    </ownershipDocument>")
    return xml


class TestNewColumns:
    def test_issuer_parsed_and_normalized(self):
        t = _parse_form4_xml(_xml_with(), "GILD", "2026-03-03", "acc", form="4", acceptance="2026-03-03T18:01:02.000Z")[0]
        assert t["issuer_cik"] == "882095"            # bez zer wiodących — porównywalne z cik_map
        assert t["issuer_symbol"] == "GILD"
        assert t["form"] == "4"
        assert t["acceptance_datetime"] == "2026-03-03T18:01:02.000Z"

    def test_table_marks_derivative_rows(self):
        txs = _parse_form4_xml(_xml_with(derivative=True), "GILD", "2026-03-03", "acc")
        assert [t["table"] for t in txs] == ["ND", "D"]
        assert txs[1]["transaction_type"] == "BUY"     # kod P w derivative — analiza musi go odrzucić po table

    def test_amendment_form_passed_through(self):
        assert _parse_form4_xml(_xml_with(), "GILD", "2026-03-03", "acc", form="4/A")[0]["form"] == "4/A"

    def test_missing_issuer_gives_empty_strings(self):
        t = _parse_form4_xml(_xml_with(issuer=""), "GILD", "2026-03-03", "acc")[0]
        assert t["issuer_cik"] == "" and t["issuer_symbol"] == ""

    def test_rows_have_exactly_tx_columns(self):
        t = _parse_form4_xml(_xml_with(), "GILD", "2026-03-03", "acc")[0]
        assert set(t) == set(TX_COLUMNS)

    def test_old_call_signature_still_works(self):
        assert len(_parse_form4_xml(_xml_with(), "GILD", "2026-03-03", "acc")) == 1


class _Resp:
    def __init__(self, code):
        self.status_code = code


class TestGetRetry:
    def _run(self, monkeypatch, codes):
        calls, sleeps = [], []
        seq = iter(codes)

        def fake_get(url, timeout=None):
            calls.append(url)
            c = next(seq)
            if isinstance(c, Exception):
                raise c
            return _Resp(c)

        monkeypatch.setattr(ef.SESSION, "get", fake_get)
        monkeypatch.setattr(ef, "_rate_limit", lambda: None)
        r = ef._get("u", sleep=sleeps.append)
        return r, calls, sleeps

    def test_retries_429_then_ok(self, monkeypatch):
        r, calls, sleeps = self._run(monkeypatch, [429, 503, 200])
        assert r.status_code == 200 and len(calls) == 3 and sleeps == [2, 4]

    def test_404_not_retried(self, monkeypatch):
        r, calls, _ = self._run(monkeypatch, [404])
        assert r.status_code == 404 and len(calls) == 1

    def test_network_error_retried(self, monkeypatch):
        r, calls, _ = self._run(monkeypatch, [ef.requests.ConnectionError("x"), 200])
        assert r.status_code == 200 and len(calls) == 2

    def test_gives_up_after_max_tries(self, monkeypatch):
        r, calls, sleeps = self._run(monkeypatch, [503] * ef.MAX_TRIES)
        assert r is None and len(calls) == ef.MAX_TRIES and sleeps == [2, 4, 8, 16]


def test_filter_keeps_4_and_4a_only_in_range(monkeypatch):
    fl = [{"form": "4", "date": "2024-01-02"}, {"form": "4/A", "date": "2024-01-03"},
          {"form": "8-K", "date": "2024-01-02"}, {"form": "4", "date": "2019-01-01"},
          {"form": "__BATCH_FAILED__", "date": ""}]
    assert [f["form"] for f in ef._filter_form4_in_range(fl)] == ["4", "4/A"]


class TestUniverseSwitch:
    """BT_UNIVERSE=semi: osobne uniwersum, osobny plik transakcji i mapa CIK (teczka SEKTOR-VS-SYGNAL)."""

    def _load(self, monkeypatch, env):
        import importlib
        import config
        for k in ("BT_UNIVERSE", "BT_TX_FILE"):
            monkeypatch.delenv(k, raising=False)
        for k, v in env.items():
            monkeypatch.setenv(k, v)
        return importlib.reload(config)

    def teardown_method(self):
        import importlib
        import os
        import config
        os.environ.pop("BT_UNIVERSE", None)
        importlib.reload(config)

    def test_default_unchanged(self, monkeypatch):
        c = self._load(monkeypatch, {})
        assert c.ALL_TICKERS == c.HEALTHCARE_TICKERS + c.CONTROL_TICKERS
        assert c.CIK_CACHE_FILE.endswith("cik_map.json")
        assert c.TRANSACTIONS_FILE.endswith("form4_transactions.csv")

    def test_semi_separate_files(self, monkeypatch):
        c = self._load(monkeypatch, {"BT_UNIVERSE": "semi"})
        assert c.ALL_TICKERS == c.SEMI_TICKERS and len(c.SEMI_TICKERS) == 14
        assert not set(c.SEMI_TICKERS) & set(c.HEALTHCARE_TICKERS + c.CONTROL_TICKERS)
        assert c.CIK_CACHE_FILE.endswith("cik_map_semi.json")
        assert c.TRANSACTIONS_FILE.endswith("form4_transactions_semi.csv")

    def test_semi_matches_universe_json(self, monkeypatch):
        import json
        from pathlib import Path
        c = self._load(monkeypatch, {})
        d = json.loads((Path(__file__).resolve().parents[3] / "doc/stockpulse-semi-supply-chain.json").read_text())
        tickers = {x["ticker"] for g in d["tickers"].values() for x in g["companies"]}
        assert tickers == set(c.SEMI_TICKERS)

    def test_unknown_universe_rejected(self, monkeypatch):
        import pytest
        with pytest.raises(ValueError):
            self._load(monkeypatch, {"BT_UNIVERSE": "xyz"})
