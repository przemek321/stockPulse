#!/usr/bin/env python3
"""
Audyt backfill 10b5-1 (Pakiet 1 fix #0, 09.06.2026).

Kontekst: parser produkcyjny czytał per-transaction tag Rule10b5-1Transaction,
który nie występuje w realnych filingach — prawdziwy znacznik to doc-level
<aff10b5One> (obowiązkowy od kwietnia 2023). Efekt: 0/3394 wierszy insider_trades
ma is10b51Plan=true. Ten skrypt sprawdza, ile historycznych transakcji
faktycznie pochodziło z planów 10b5-1.

TYLKO AUDYT — zero zmian w bazie. Wejście: trades_export.csv (psql \\copy),
wyjście: aff_flags.csv (accession → flaga) + podsumowanie na stdout.

Rate limit SEC: ~4 req/s (limit to 10 req/s). ~1250 filingów × 2 requesty ≈ 10 min.

Użycie:
    python3 scripts/audit/audit_10b51_backfill.py
"""
from __future__ import annotations

import csv
import json
import re
import sys
import time
import urllib.request
from collections import defaultdict
from pathlib import Path

UA = "StockPulse audit przemyslaw.klosowski@outlook.com"
BASE_DIR = Path(__file__).parent
TRADES_CSV = BASE_DIR / "trades_export.csv"
FLAGS_CSV = BASE_DIR / "aff_flags.csv"
DELAY_S = 0.13  # ~4 req/s przy 2 requestach per filing

AFF_RE = re.compile(r"<aff10b5One>\s*(1|true)\s*</aff10b5One>", re.IGNORECASE)
# Per-transaction fallback — w praktyce nie występuje, ale liczymy dla kompletu
PER_TX_RE = re.compile(r"<(?:is)?[Rr]ule10b5-?1Transaction>\s*(1|Y|true)", re.IGNORECASE)


def fetch(url: str) -> bytes | None:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read()
    except Exception as e:
        print(f"  FETCH_FAIL {url}: {e}", file=sys.stderr)
        return None


def find_xml_url(dir_url: str) -> str | None:
    """Znajduje surowy XML Form 4 w katalogu filingu przez index.json."""
    data = fetch(dir_url.rstrip("/") + "/index.json")
    if data is None:
        return None
    try:
        items = json.loads(data)["directory"]["item"]
    except (KeyError, json.JSONDecodeError):
        return None
    for item in items:
        name = item.get("name", "")
        # surowy XML — pomijamy renderowane wersje xslF345X*/
        if name.lower().endswith(".xml") and "/" not in name:
            return dir_url.rstrip("/") + "/" + name
    return None


def main() -> None:
    rows = list(csv.DictReader(open(TRADES_CSV)))
    print(f"Wierszy transakcji: {len(rows)}")

    # accession → documentUrl (pierwsza niepusta)
    filings: dict[str, str | None] = {}
    for r in rows:
        acc = r["accession"]
        if acc not in filings or not filings[acc]:
            filings[acc] = r["documentUrl"] or None
    print(f"Unikalnych filingów: {len(filings)}")

    # Resume: wczytaj już sprawdzone (skrypt można bezpiecznie restartować)
    done: dict[str, str] = {}
    if FLAGS_CSV.exists():
        for r in csv.DictReader(open(FLAGS_CSV)):
            done[r["accession"]] = r["flag"]
        print(f"Wznawiam — już sprawdzone: {len(done)}")

    out = open(FLAGS_CSV, "a", newline="")
    writer = csv.writer(out)
    if not done:
        writer.writerow(["accession", "flag"])  # flag: plan / discretionary / no_url / fetch_fail

    todo = [(acc, url) for acc, url in sorted(filings.items()) if acc not in done]
    for i, (acc, url) in enumerate(todo):
        if not url:
            flag = "no_url"
        else:
            xml_url = find_xml_url(url)
            time.sleep(DELAY_S)
            if not xml_url:
                flag = "fetch_fail"
            else:
                xml = fetch(xml_url)
                time.sleep(DELAY_S)
                if xml is None:
                    flag = "fetch_fail"
                else:
                    text = xml.decode("utf-8", errors="replace")
                    flag = "plan" if (AFF_RE.search(text) or PER_TX_RE.search(text)) else "discretionary"
        done[acc] = flag
        writer.writerow([acc, flag])
        out.flush()
        if (i + 1) % 50 == 0:
            print(f"  {i + 1}/{len(todo)} ({(i + 1) * 100 // len(todo)}%)")
    out.close()

    # ── Podsumowanie ────────────────────────────────────────────────
    by_type: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for r in rows:
        flag = done.get(r["accession"], "missing")
        t = r["transactionType"]
        by_type[t][f"n_{flag}"] += 1
        try:
            by_type[t][f"val_{flag}"] += float(r["totalValue"] or 0)
        except ValueError:
            pass

    print("\n=== AUDYT 10b5-1: transakcje wg typu ===")
    print(f"{'typ':<10} {'plan':>6} {'discr':>6} {'fail':>5} {'%plan':>6} {'$plan (mln)':>12}")
    for t in sorted(by_type):
        d = by_type[t]
        n_plan = int(d["n_plan"])
        n_disc = int(d["n_discretionary"])
        n_fail = int(d["n_fetch_fail"] + d["n_no_url"] + d["n_missing"])
        total = n_plan + n_disc
        pct = f"{n_plan * 100 / total:.0f}%" if total else "—"
        print(f"{t:<10} {n_plan:>6} {n_disc:>6} {n_fail:>5} {pct:>6} {d['val_plan'] / 1e6:>12.1f}")

    n_filings_plan = sum(1 for f in done.values() if f == "plan")
    print(f"\nFilingi z aff10b5One=1: {n_filings_plan}/{len(done)} "
          f"({n_filings_plan * 100 // max(len(done), 1)}%)")
    print(f"Wyniki per filing: {FLAGS_CSV}")


if __name__ == "__main__":
    main()
