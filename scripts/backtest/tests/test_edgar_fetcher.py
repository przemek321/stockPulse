"""
Testy dla edgar_fetcher — multi-reportingOwner (FLAG #34) + 10b5-1 per-tx (FLAG #35).
"""
from __future__ import annotations

import xml.etree.ElementTree as ET
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from edgar_fetcher import _merge_reporting_owners, _parse_form4_xml


def _make_xml(owners: list, tx_code: str = "P", coding_extra: str = "") -> str:
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
