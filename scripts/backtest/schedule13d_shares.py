"""Teczka 13D — krok 2 (dane): liczba akcji emitentów z SEC companyfacts (`dei:EntityCommonStockSharesOutstanding`).

Zapisuje tylko to jedno pole (pełne companyfacts ≈ kilka MB/emitent): data/schedule13d/shares/{cik}.json
= lista {"end", "val", "filed", "form", "accn"}. EDGAR ≤ 1 req/s.
"""
from __future__ import annotations

import json
import sys

from schedule13d_fetch import DATA, SEC_MIN_INTERVAL_S, Throttled, fail, issuers_for_download, load_env, log


def extract_shares(facts: dict) -> list[dict]:
    units = facts.get("facts", {}).get("dei", {}).get("EntityCommonStockSharesOutstanding", {}).get("units", {})
    out = []
    for vals in units.values():
        for v in vals:
            out.append({k: v.get(k) for k in ("end", "val", "filed", "form", "accn")})
    return sorted(out, key=lambda r: (r["filed"] or "", r["end"] or ""))


def main() -> int:
    env = load_env()
    sec = Throttled(SEC_MIN_INTERVAL_S, {"User-Agent": env["SEC_USER_AGENT"], "Accept-Encoding": "gzip, deflate"})
    (DATA / "shares").mkdir(exist_ok=True)
    ciks = issuers_for_download()
    log(f"[2s] emitentów: {len(ciks)}")
    for i, cik in enumerate(ciks):
        p = DATA / "shares" / f"{cik}.json"
        if p.exists():
            continue
        r = sec.get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{int(cik):010d}.json")
        if r is None or r.status_code not in (200, 404):
            fail("shares", cik, str(r.status_code if r is not None else "brak odp."))
            continue
        p.write_text(json.dumps(extract_shares(r.json()) if r.status_code == 200 else []))
        if (i + 1) % 200 == 0:
            log(f"[2s] {i + 1}/{len(ciks)}")
    log("[2s] gotowe")
    return 0


if __name__ == "__main__":
    sys.exit(main())
