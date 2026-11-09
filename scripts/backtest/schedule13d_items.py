"""Teczka 13D — krok 1: XML (`primary_doc.xml`) initial SCHEDULE 13D z ery XML (akceptacja ≥ 18.12.2024).

Wynik: data/schedule13d/items.jsonl — po jednym rekordzie na accession (pola z okładki + teksty Item 3/4/6
+ lista załączników). Surowe XML w data/schedule13d/xml/. EDGAR ≤ 1 req/s (jak schedule13d_fetch).
NIC tu nie dotyka cen.
"""
from __future__ import annotations

import csv
import json
import sys
import xml.etree.ElementTree as ET

from schedule13d_fetch import DATA, SEC_MIN_INTERVAL_S, Throttled, fail, load_env, log

PERIOD_START = "20241218"


def _strip_ns(root: ET.Element) -> ET.Element:
    for el in root.iter():
        if isinstance(el.tag, str) and "}" in el.tag:
            el.tag = el.tag.split("}", 1)[1]
    return root


def _text(root: ET.Element, path: str) -> str:
    el = root.find(path)
    return (el.text or "").strip() if el is not None and el.text else ""


def parse_primary_xml(xml_text: str) -> dict:
    root = _strip_ns(ET.fromstring(xml_text))
    persons = []
    for rp in root.iter("reportingPersonInfo"):
        persons.append({
            "name": _text(rp, "reportingPersonName"),
            "cik": _text(rp, "reportingPersonCIK").lstrip("0"),
            "type": _text(rp, "typeOfReportingPerson"),
            "fund_type": _text(rp, "fundType"),
            "percent": _text(rp, "percentOfClass"),
        })
    return {
        "submission_type": _text(root, ".//submissionType"),
        "date_of_event": _text(root, ".//dateOfEvent"),
        "issuer_cik": _text(root, ".//issuerInfo/issuerCIK").lstrip("0"),
        "issuer_cusip": _text(root, ".//issuerInfo/issuerCUSIP"),
        "issuer_name": _text(root, ".//issuerInfo/issuerName"),
        "persons": persons,
        "item3": _text(root, ".//item3/fundsSource"),
        "item4": _text(root, ".//item4/transactionPurpose"),
        "item6": _text(root, ".//item6/contractDescription"),
        "exhibits": _text(root, ".//filedExhibits"),
    }


def main() -> int:
    env = load_env()
    sec = Throttled(SEC_MIN_INTERVAL_S, {"User-Agent": env["SEC_USER_AGENT"], "Accept-Encoding": "gzip, deflate"})
    (DATA / "xml").mkdir(exist_ok=True)
    with open(DATA / "filings.csv") as f:
        rows = [r for r in csv.DictReader(f) if r["acceptance"][:8] >= PERIOD_START]
    log(f"[1] filingów w okresie (akceptacja ≥ {PERIOD_START}): {len(rows)}")
    out = open(DATA / "items.jsonl", "w")
    for i, r in enumerate(rows):
        acc = r["accession"]
        xp = DATA / "xml" / f"{acc}.xml"
        if not xp.exists():
            base = f"https://www.sec.gov/Archives/edgar/data/{r['subject_cik']}/{acc.replace('-', '')}"
            resp = sec.get(f"{base}/primary_doc.xml")
            if resp is None or resp.status_code != 200:
                idx = sec.get(f"{base}/index.json")
                name = None
                if idx is not None and idx.status_code == 200:
                    items = idx.json().get("directory", {}).get("item", [])
                    xmls = [it["name"] for it in items if it["name"].endswith(".xml")]
                    name = xmls[0] if xmls else None
                resp = sec.get(f"{base}/{name}") if name else None
                if resp is None or resp.status_code != 200:
                    fail("xml", acc, "brak primary_doc.xml")
                    continue
            xp.write_text(resp.text)
        try:
            rec = parse_primary_xml(xp.read_text())
        except ET.ParseError as e:
            fail("xml_parse", acc, str(e))
            continue
        rec.update({k: r[k] for k in ("accession", "form", "acceptance", "subject_cik", "subject_name",
                                      "subject_sic", "filer_ciks", "filer_names")})
        out.write(json.dumps(rec) + "\n")
        if (i + 1) % 200 == 0:
            log(f"[1] {i + 1}/{len(rows)}")
    out.close()
    log("[1] gotowe")
    return 0


if __name__ == "__main__":
    sys.exit(main())
