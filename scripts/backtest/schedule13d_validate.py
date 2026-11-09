"""Teczka 13D — walidacja klasyfikatora (krok 3): próba warstwowa, anonimizacja, precyzja/czułość ważona.

  sample  → data/schedule13d/validation/sample.jsonl (teksty zanonimizowane, BEZ etykiety klasyfikatora)
            + key.json (id → accession, warstwa, etykieta klasyfikatora; nie pokazywać etykietującemu)
  score   ← validation/labels.json {id: "A" | "nonA"} → precyzja A, czułość A ważona warstwami, CI (bootstrap
            warstwowy), macierz pomyłek, plik do weryfikacji usera (20 losowych).

Progi (pre-rejestracja v3): precyzja A ≥ 80%, czułość A ≥ 75% (ważona).
"""
from __future__ import annotations

import csv
import json
import random
import re
import sys

import numpy as np

from schedule13d_classify import RULES_HASH, item2_text
from schedule13d_fetch import DATA, EXCLUDED_SIC

V = DATA / "validation"
PREVIOUS = [DATA / "validation_r1" / "key.json"]       # próby wcześniejszych rund — próba nowa musi być rozłączna
N_A, N_ENRICHED, N_REST = 40, 50, 50
ENRICH_RE = re.compile(r"letter to (the )?(board|issuer|company)|nominat\w* (a slate|candidates|notice)|nomination "
                       r"(notice|letter)|proxy contest|(proxy|consent) solicitation|cooperation agreement|special "
                       r"meeting|presentation to|\burged\b|\bdemand", re.I)
MAX_CHARS = 9000
SEED = 2026_11_08_2                                 # runda 2 (runda 1: 2026_11_08)
PREC_MIN, REC_MIN = 0.80, 0.75

MONTHS = r"(January|February|March|April|May|June|July|August|September|October|November|December)"


NAME_STOP = {"the", "and", "inc", "llc", "lp", "l.p", "ltd", "corp", "corporation", "company", "co", "of", "fund",
             "funds", "capital", "management", "partners", "holdings", "holding", "group", "advisors", "advisers",
             "investment", "investments", "master", "value", "global", "trust", "series", "class", "common",
             "financial", "international", "sa", "plc", "ag", "nv", "new", "york", "asset", "assets", "limited",
             "partnership", "opportunities", "opportunity", "equity", "ventures", "associates", "family", "foundation"}


def anonymize(text: str, names: list[str], tickers: list[str], cusip: str) -> str:
    t = text
    for n in sorted({n for n in names if n and len(n) > 2}, key=len, reverse=True):
        t = re.sub(re.escape(n), "[PODMIOT]", t, flags=re.I)
    words = {w.strip(",.()/").lower() for n in names if n for w in re.split(r"[\s/]+", n)}
    for w in sorted((w for w in words if len(w) >= 3 and w not in NAME_STOP and not w.isdigit()), key=len,
                    reverse=True):
        t = re.sub(rf"\b{re.escape(w)}\b", "[PODMIOT]", t, flags=re.I)
    for tk in tickers:
        if tk and len(tk) >= 2:
            t = re.sub(rf"\b{re.escape(tk)}\b", "[TICKER]", t)
    if cusip:
        t = t.replace(cusip, "[CUSIP]")
    t = re.sub(rf"{MONTHS}\s+\d{{1,2}},?\s+\d{{4}}", "[DATA]", t)
    t = re.sub(r"\b\d{1,2}/\d{1,2}/\d{2,4}\b", "[DATA]", t)
    t = re.sub(r"\b(19|20)\d{2}\b", "[ROK]", t)
    t = re.sub(r"\$\s?[\d,.]+( (million|billion|thousand))?", "[KWOTA]", t, flags=re.I)
    t = re.sub(r"\b\d{1,3}(,\d{3})+(\.\d+)?\b", "[LICZBA]", t)
    return t


def _items() -> dict[str, dict]:
    return {r["accession"]: r for r in (json.loads(l) for l in open(DATA / "items.jsonl"))}


def cmd_sample() -> None:
    V.mkdir(exist_ok=True)
    items = _items()
    used = {v["accession"] for p in PREVIOUS if p.exists() for v in json.loads(p.read_text())["items"].values()}
    cl = [r for r in csv.DictReader(open(DATA / "classified.csv"))
          if r["subject_sic"] not in EXCLUDED_SIC and r["accession"] not in used]
    strata = {"A": [], "nonA_enriched": [], "nonA_rest": []}
    for r in cl:
        it = items[r["accession"]]
        if r["cls"] == "A":
            strata["A"].append(r)
        elif ENRICH_RE.search(" ".join([it["item4"], it["item6"], it["exhibits"]])):
            strata["nonA_enriched"].append(r)
        else:
            strata["nonA_rest"].append(r)
    rng = random.Random(SEED)
    want = {"A": N_A, "nonA_enriched": N_ENRICHED, "nonA_rest": N_REST}
    picked = []
    for s, rows in strata.items():
        picked += [(s, r) for r in rng.sample(rows, min(want[s], len(rows)))]
    rng.shuffle(picked)
    key, out = {}, []
    for i, (s, r) in enumerate(picked, 1):
        it = items[r["accession"]]
        names = [it["issuer_name"], it["subject_name"]] + it["filer_names"].split("|") + [p["name"] for p in it["persons"]]
        tick = []
        sp = DATA / "submissions" / f"{r['subject_cik']}.json"
        if sp.exists():
            tick = json.loads(sp.read_text()).get("tickers", [])
        raw = "\n\n".join([
            "ITEM 2 (zgłaszający):\n" + item2_text(DATA / "xml" / f"{r['accession']}.xml")[:1500],
            "ITEM 3:\n" + it["item3"][:1500], "ITEM 4:\n" + it["item4"], "ITEM 6:\n" + it["item6"][:2000],
            "ZAŁĄCZNIKI:\n" + it["exhibits"][:1000]])
        txt = anonymize(raw, names, tick, it["issuer_cusip"])[:MAX_CHARS]
        sid = f"V{i:03d}"
        key[sid] = {"accession": r["accession"], "stratum": s, "cls": r["cls"], "why": r["why"]}
        out.append({"id": sid, "text": txt})
    with open(V / "sample.jsonl", "w") as f:
        for o in out:
            f.write(json.dumps(o, ensure_ascii=False) + "\n")
    # wagi warstw = liczności w CAŁEJ populacji (z filingami wcześniejszych rund), nie w puli losowania
    full = [r for r in csv.DictReader(open(DATA / "classified.csv")) if r["subject_sic"] not in EXCLUDED_SIC]
    sizes = {"A": 0, "nonA_enriched": 0, "nonA_rest": 0}
    for r in full:
        it = items[r["accession"]]
        if r["cls"] == "A":
            sizes["A"] += 1
        elif ENRICH_RE.search(" ".join([it["item4"], it["item6"], it["exhibits"]])):
            sizes["nonA_enriched"] += 1
        else:
            sizes["nonA_rest"] += 1
    (V / "key.json").write_text(json.dumps({"rules_hash": RULES_HASH, "strata_sizes": sizes, "items": key}, indent=1))
    print(f"warstwy (populacja): {sizes}; próba: {len(out)} → {V / 'sample.jsonl'}")


def weighted_metrics(rows: list[dict], sizes: dict[str, int]) -> tuple[float | None, float | None]:
    """rows: [{stratum, cls, label}]. Precyzja = w warstwie A; czułość = TP_A / (TP_A + szac. FN z warstw nie-A)."""
    by = {}
    for r in rows:
        by.setdefault(r["stratum"], []).append(r)
    a = by.get("A", [])
    prec = sum(r["label"] == "A" for r in a) / len(a) if a else None
    est_true_a = {s: (sum(r["label"] == "A" for r in rs) / len(rs)) * sizes[s] for s, rs in by.items() if rs}
    tp = est_true_a.get("A", 0.0)
    fn = sum(v for s, v in est_true_a.items() if s != "A")
    rec = tp / (tp + fn) if (tp + fn) > 0 else None
    return prec, rec


def cmd_score() -> None:
    key = json.loads((V / "key.json").read_text())
    labels = json.loads((V / "labels.json").read_text())
    rows = [{**key["items"][i], "id": i, "label": "A" if lab == "A" else "nonA"} for i, lab in labels.items()]
    sizes = key["strata_sizes"]
    prec, rec = weighted_metrics(rows, sizes)
    rng = np.random.default_rng(1)
    by = {}
    for r in rows:
        by.setdefault(r["stratum"], []).append(r)
    boots = []
    for _ in range(5000):
        bs = [x for rs in by.values() for x in rng.choice(rs, size=len(rs), replace=True)]
        boots.append(weighted_metrics(list(bs), sizes))
    pci = np.nanpercentile([b[0] if b[0] is not None else np.nan for b in boots], [2.5, 97.5]).tolist()
    rci = np.nanpercentile([b[1] if b[1] is not None else np.nan for b in boots], [2.5, 97.5]).tolist()
    conf = {}
    for r in rows:
        k = f"{r['stratum']}→{r['label']}"
        conf[k] = conf.get(k, 0) + 1
    res = {"rules_hash": key["rules_hash"], "n_labeled": len(rows), "precision_A": prec, "precision_ci": pci,
           "recall_A_weighted": rec, "recall_ci": rci, "confusion": conf, "strata_sizes": sizes,
           "pass": prec is not None and rec is not None and prec >= PREC_MIN and rec >= REC_MIN}
    (V / "score.json").write_text(json.dumps(res, indent=1))
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    {"sample": cmd_sample, "score": cmd_score}[sys.argv[1]]()
