"""Teczka 13D — krok 3: klasyfikator regułowy Item 4 (A aktywista / B pozostałe / C transakcyjne-insiderskie).

Ślepy na ceny: wejście = wyłącznie teksty z XML (Item 2/3/4/6 + lista załączników).
Kolejność: insider → C; sygnał A → A, chyba że zgłaszający jest STRONĄ transakcji (→ C); wzorce C → C; reszta B.\n(Aktywista sprzeciwiający się ogłoszonej fuzji / going-private = A; kontrahent fuzji = C.)
A wymaga KONKRETNEGO, już podjętego działania (pre-rejestracja v3) — sama możliwość („may nominate",
„may engage in discussions", „strategic alternatives", „(a) through (j)") to boilerplate i NIE daje A.

Uruchomienie: ./.venv/bin/python -u schedule13d_classify.py  → data/schedule13d/classified.csv + hash reguł.
"""
from __future__ import annotations

import csv
import hashlib
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from schedule13d_fetch import DATA

NEG = r"(?<!not )(?<!no )(?<!never )"

# --- C: transakcyjne / insiderskie (wykluczone z testu)
C_PATTERNS = [
    r"agreement and plan of (merger|reorganization)", r"\bmerger agreement\b", r"business combination agreement",
    r"\bbusiness combination\b", r"voting (and|&) support agreement", r"\bsupport agreement\b",
    r"tender offer", r"initial public offering", r"in connection with the (issuer'?s )?ipo\b",
    r"restricted stock units?", r"\brsus?\b", r"\bprsus?\b", r"\bvesting\b", r"equity incentive plan",
    r"employment agreement", r"\bspin-?off\b", r"share exchange agreement", r"\bexchange agreement\b",
    r"asset purchase agreement", r"contribution agreement", r"as consideration for", r"going[- ]private",
    r"rule 13e-3", r"plan of arrangement", r"bankruptcy|chapter 11|plan of reorganization",
    r"conversion of (the )?(convertible )?(notes?|debentures?|preferred)",
]
# Insider: zgłaszający pełni funkcję w emitencie (MBO / założyciel / zarząd) → C
INSIDER_PATTERNS = [
    r"(serves?|serving|is|are) (as )?(a |the )?(member of the board of directors|director|directors|chairman|"
    r"chief executive officer|chief financial officer|president|founder|co-founder)s? of the (issuer|company)",
    r"(chief executive officer|chief financial officer|chairman|president|founder) of the (issuer|company)\b",
    r"executive officer of the (issuer|company)",
]
# --- A: konkretne, podjęte działanie aktywisty
A_PATTERNS = [
    NEG + r"(delivered|sent|submitted|issued|transmitted) (a|an|its|their) (private |public |open )?letter\b",
    NEG + r"letter (was |were )?(delivered|sent) to (the )?(issuer|company|board)",
    NEG + r"(delivered|submitted|provided) (a |its |their )?(formal )?(notice of (its |their )?(intent(ion)? to )?"
          r"nominat\w*|nomination notice|notice of nomination)",
    NEG + r"nomination (letter|notice)", NEG + r"nominating a slate", NEG + r"to nominate a slate",
    NEG + r"(submitted|delivered) (to the (issuer|company) )?a (notice of )?requisition",
    NEG + r"(commenced|launched|initiated|engaged in|waging) (a |its |their )?proxy (contest|fight)",
    NEG + r"(commenced|launched|filed) .{0,40}(proxy|consent) solicitation",
    NEG + r"(filed|submitted|delivered) (a |its |their )?(preliminary |definitive )?consent (statement|solicitation)",
    NEG + r"(requested|demanded|called) (a |the )?special meeting",
    NEG + r"(request|demand) that the (issuer|company|board) .{0,60}call a special meeting",
    r"cooperation agreement.{0,400}(standstill|board of directors|appoint|nominat)",
    r"(standstill|appoint|nominat).{0,400}cooperation agreement",
    r"\bsettlement agreement\b.{0,200}(board|director)",
    NEG + r"(delivered|made|gave|sent) (a |an )?presentation to (the )?(issuer|company|board|management)",
    NEG + r"(submitted|delivered|sent|made) (a |an )?(non-binding |unsolicited |written )?"
          r"(proposal|indication of interest|offer) to (acquire|purchase)",
    NEG + r"(publicly )?(called on|urged|demanded that) (the )?(issuer|company|board)",
    NEG + r"intends? to vote (all of )?(its |their )?(shares )?against",
]
# Zgłaszający jest STRONĄ transakcji (kontrahent fuzji, sygnatariusz support agreement) → C nawet przy sygnale A.
# (Poprawka #1: bez „merger sub" — pada też w opisie cudzej fuzji, przeciw której walczy aktywista; bez SPA/stock
# purchase — tak aktywista bywa po prostu kupuje akcje.)
PARTY_PATTERNS = [
    r"reporting persons? (has |have )?(also )?(entered|enter) into (an |the |a )?(agreement and plan of merger|"
    r"merger agreement|business combination agreement|(voting (and|&) )?support agreement|voting agreement|"
    r"share exchange agreement)",
    r"concurrently with the execution (and delivery )?of the (merger|business combination) agreement",
]
# Załączniki-artefakty kampanii (lista filedExhibits)
A_EXHIBIT_PATTERNS = [
    r"letter (to|addressed to) (the )?(board|issuer|company|shareholders|stockholders)",
    r"nomination notice|notice of nomination", r"cooperation agreement", r"\bpresentation\b",
    r"(non-binding |unsolicited )?proposal (letter|to acquire)",
]
# Boilerplate — dokumentacja + test, że SAM nie daje A
BOILERPLATE = [
    "may engage in discussions", "may nominate", "strategic alternatives", "(a) through (j)",
    "intend to review", "from time to time", "may seek to", "may propose",
]

RULES_SOURCE = json.dumps([C_PATTERNS, INSIDER_PATTERNS, A_PATTERNS, PARTY_PATTERNS, A_EXHIBIT_PATTERNS],
                          ensure_ascii=False)
RULES_HASH = hashlib.sha256(RULES_SOURCE.encode()).hexdigest()[:12]


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").replace("’", "'").replace("“", '"').replace("”", '"')).lower()


def first_match(patterns: list[str], text: str) -> str | None:
    for p in patterns:
        m = re.search(p, text)
        if m:
            return m.group(0)[:80]
    return None


def classify(item2: str, item3: str, item4: str, item6: str, exhibits: str) -> tuple[str, str]:
    """Zwraca (klasa, uzasadnienie = trafiony fragment)."""
    body = norm(" ".join([item3, item4, item6]))
    who = norm(item2) + " " + body
    ex = norm(exhibits)
    ins = first_match(INSIDER_PATTERNS, who)
    if ins:
        return "C", f"INSIDER:{ins}"
    a = first_match(A_PATTERNS, body)
    ae = None if a else first_match(A_EXHIBIT_PATTERNS, ex)
    if a or ae:
        party = first_match(PARTY_PATTERNS, body)
        if party:
            return "C", f"PARTY:{party}"
        return "A", f"A:{a}" if a else f"A_EX:{ae}"
    c = first_match(C_PATTERNS, body)
    if c:
        return "C", f"C:{c}"
    return "B", ""


def item2_text(xml_path: Path) -> str:
    try:
        root = ET.fromstring(xml_path.read_text())
    except ET.ParseError:
        return ""
    parts = []
    for el in root.iter():
        tag = el.tag.split("}", 1)[-1] if isinstance(el.tag, str) else ""
        if tag in ("principalJob", "principalBusinessAddress", "filingPersonName") or tag.startswith("item2"):
            parts.append(" ".join(t.strip() for t in el.itertext() if t.strip()))
    return " ".join(parts)


def main() -> int:
    rows = [json.loads(l) for l in open(DATA / "items.jsonl")]
    out = []
    for r in rows:
        i2 = item2_text(DATA / "xml" / f"{r['accession']}.xml")
        cls, why = classify(i2, r["item3"], r["item4"], r["item6"], r["exhibits"])
        out.append({"accession": r["accession"], "acceptance": r["acceptance"], "subject_cik": r["subject_cik"],
                    "subject_sic": r["subject_sic"], "date_of_event": r["date_of_event"],
                    "filer_names": r["filer_names"], "cls": cls, "why": why})
    with open(DATA / "classified.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
        w.writeheader()
        w.writerows(out)
    from collections import Counter
    print(f"reguły {RULES_HASH}: {Counter(o['cls'] for o in out)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
