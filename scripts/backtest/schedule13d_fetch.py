"""Teczka 13D — kroki 0a–0c (doc/TECZKA-13D-2026-11-08.md): pobranie surowych danych, BEZ analizy.

0a  index    — kwartalne form.idx z EDGAR (2024Q4 → bieżący), initial 13D (`SC 13D` + `SCHEDULE 13D`, bez /A),
               dedup po accession, nagłówki .hdr.sgml (acceptance, SUBJECT-COMPANY, SIC, FILED-BY).
0b  map      — emitenci (bez SIC 6726/6770): submissions SEC (bieżące tickery) + Polygon reference po CIK
               (`active=false` — tickery zdelistowane i dawne; bieżące z SEC submissions). Brak rozstrzygania „ticker na datę" — to krok 2.
0c  prices   — dzienne agregaty Polygona (NIESKORYGOWANE) dla wszystkich tickerów CS/ADRC emitentów
               + benchmarki IWM/SPY/XBI/XLV + globalna lista splitów; od najwcześniejszej daty w oknie free.

Wszystko cache'owane na dysku (wznawialne), surowe odpowiedzi zapisywane bez przetwarzania.
Budżety: EDGAR ≤ 1 req/s (limit 10 req/s SEC jest per IP — malina = IP produkcji, równolegle działa
fetcher Form 4), Polygon free 5 req/min.

Uruchomienie: ./.venv/bin/python -u schedule13d_fetch.py all   (albo index | map | prices)
"""
from __future__ import annotations

import csv
import datetime as dt
import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
DATA = HERE / "data" / "schedule13d"
ENV_FILE = HERE.parent.parent / ".env"

INITIAL_FORMS = {"SC 13D", "SCHEDULE 13D"}
EXCLUDED_SIC = {"6726", "6770"}          # fundusze zamknięte/inwestycyjne, SPAC (pre-rejestracja)
PRICE_TICKER_TYPES = {"CS", "ADRC"}
BENCHMARKS = ["IWM", "SPY", "XBI", "XLV"]
FIRST_QUARTER = (2024, 4)
SEC_MIN_INTERVAL_S = 1.0
POLYGON_MIN_INTERVAL_S = 12.5            # 5 req/min z zapasem
POLYGON_WINDOW_DAYS = 730

IDX_RE = re.compile(
    r"^(?P<form>\S.*?)\s{2,}(?P<name>.*?)\s{2,}(?P<cik>\d+)\s+(?P<date>\d{4}-\d{2}-\d{2})\s+(?P<file>edgar/\S+)\s*$"
)


# ---------------------------------------------------------------- czyste funkcje (testowane)

def parse_idx_line(line: str) -> dict | None:
    m = IDX_RE.match(line)
    if not m:
        return None
    d = m.groupdict()
    d["form"] = d["form"].strip()
    d["accession"] = Path(d["file"]).name.removesuffix(".txt")
    return d


def is_initial_13d(form: str) -> bool:
    return form.strip() in INITIAL_FORMS


def quarters(first: tuple[int, int], today: dt.date) -> list[tuple[int, int]]:
    y, q = first
    last = (today.year, (today.month - 1) // 3 + 1)
    out = []
    while (y, q) <= last:
        out.append((y, q))
        y, q = (y + 1, 1) if q == 4 else (y, q + 1)
    return out


def _blocks(text: str, tag: str) -> list[str]:
    return re.findall(rf"<{tag}>(.*?)</{tag}>", text, flags=re.S)


def _field(block: str, tag: str) -> str:
    m = re.search(rf"^<{tag}>(.*)$", block, flags=re.M)
    return m.group(1).strip() if m else ""


@dataclass
class Header:
    accession: str
    acceptance: str          # YYYYMMDDHHMMSS (czas ET wg EDGAR)
    form: str
    filing_date: str
    subject_cik: str
    subject_name: str
    subject_sic: str
    filers: list[tuple[str, str]] = field(default_factory=list)   # (cik, nazwa)


def parse_hdr_sgml(text: str) -> Header:
    subj = _blocks(text, "SUBJECT-COMPANY")
    s = subj[0] if subj else ""
    filers = [(_field(b, "CIK").lstrip("0"), _field(b, "CONFORMED-NAME")) for b in _blocks(text, "FILED-BY")]
    return Header(
        accession=_field(text, "ACCESSION-NUMBER"),
        acceptance=_field(text, "ACCEPTANCE-DATETIME"),
        form=_field(text, "TYPE"),
        filing_date=_field(text, "FILING-DATE"),
        subject_cik=_field(s, "CIK").lstrip("0"),
        subject_name=_field(s, "CONFORMED-NAME"),
        subject_sic=_field(s, "ASSIGNED-SIC"),
        filers=filers,
    )


def polygon_window_start(today: dt.date, extra_days: int = 0) -> dt.date:
    return today - dt.timedelta(days=POLYGON_WINDOW_DAYS + 2 - extra_days)


def price_tickers(ref_results: list[dict], current: list[str]) -> list[str]:
    """Tickery do pobrania cen: typy CS/ADRC z Polygon reference + bieżące z SEC submissions."""
    out = {r["ticker"] for r in ref_results if r.get("type") in PRICE_TICKER_TYPES and r.get("ticker")}
    out |= {t for t in current if t}
    return sorted(out)


# ---------------------------------------------------------------- I/O

def load_env(path: Path = ENV_FILE) -> dict[str, str]:
    env = {}
    for line in path.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


class Throttled:
    def __init__(self, min_interval: float, headers: dict | None = None):
        self.min_interval = min_interval
        self.last = 0.0
        self.s = requests.Session()
        if headers:
            self.s.headers.update(headers)

    def get(self, url: str, params: dict | None = None, tries: int = 5) -> requests.Response | None:
        for attempt in range(tries):
            wait = self.min_interval - (time.monotonic() - self.last)
            if wait > 0:
                time.sleep(wait)
            self.last = time.monotonic()
            try:
                r = self.s.get(url, params=params, timeout=60)
            except requests.RequestException as e:
                log(f"  ! {type(e).__name__} {url} (próba {attempt + 1})")
                time.sleep(5 * 2 ** attempt)
                continue
            if r.status_code == 200:
                return r
            if r.status_code in (403, 404):
                return r
            log(f"  ! HTTP {r.status_code} {url} (próba {attempt + 1})")
            time.sleep((60 if r.status_code == 429 else 5) * 2 ** attempt)
        return None


def log(msg: str) -> None:
    print(f"{dt.datetime.now():%H:%M:%S} {msg}", flush=True)


def fail(kind: str, key: str, why: str) -> None:
    with open(DATA / "failures.csv", "a", newline="") as f:
        csv.writer(f).writerow([dt.datetime.now().isoformat(timespec="seconds"), kind, key, why])


# ---------------------------------------------------------------- 0a

def cmd_index(sec: Throttled) -> None:
    (DATA / "idx").mkdir(parents=True, exist_ok=True)
    (DATA / "headers").mkdir(exist_ok=True)
    today = dt.date.today()
    rows: dict[str, dict] = {}
    for y, q in quarters(FIRST_QUARTER, today):
        p = DATA / "idx" / f"{y}Q{q}.idx"
        current = (y, q) == (today.year, (today.month - 1) // 3 + 1)
        if not p.exists() or current:
            r = sec.get(f"https://www.sec.gov/Archives/edgar/full-index/{y}/QTR{q}/form.idx")
            if r is None or r.status_code != 200:
                fail("idx", f"{y}Q{q}", str(r.status_code if r is not None else "brak odp."))
                continue
            p.write_bytes(r.content)
        n = 0
        for line in p.read_text(errors="replace").splitlines():
            d = parse_idx_line(line)
            if d and is_initial_13d(d["form"]):
                e = rows.setdefault(d["accession"], {**d, "idx_ciks": set()})
                e["idx_ciks"].add(d["cik"])
                n += 1
        log(f"[0a] {y}Q{q}: {n} wierszy initial 13D")
    log(f"[0a] unikalnych accession: {len(rows)}")

    out = []
    for i, (acc, d) in enumerate(sorted(rows.items(), key=lambda kv: kv[1]["date"])):
        hp = DATA / "headers" / f"{acc}.hdr.sgml"
        if not hp.exists():
            cik = sorted(d["idx_ciks"])[0]
            url = f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc.replace('-', '')}/{acc}.hdr.sgml"
            r = sec.get(url)
            if r is None or r.status_code != 200:
                fail("header", acc, str(r.status_code if r is not None else "brak odp."))
                continue
            hp.write_text(r.text)
        h = parse_hdr_sgml(hp.read_text())
        out.append({
            "accession": acc, "form": h.form or d["form"], "date_filed": d["date"], "acceptance": h.acceptance,
            "subject_cik": h.subject_cik, "subject_name": h.subject_name, "subject_sic": h.subject_sic,
            "filer_ciks": "|".join(c for c, _ in h.filers), "filer_names": "|".join(n for _, n in h.filers),
        })
        if (i + 1) % 200 == 0:
            log(f"[0a] nagłówki {i + 1}/{len(rows)}")
    with open(DATA / "filings.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
        w.writeheader()
        w.writerows(out)
    log(f"[0a] zapisano filings.csv: {len(out)} wierszy")


# ---------------------------------------------------------------- 0b

def issuers_for_download() -> list[str]:
    with open(DATA / "filings.csv") as f:
        rows = list(csv.DictReader(f))
    ciks = {r["subject_cik"] for r in rows if r["subject_cik"] and r["subject_sic"] not in EXCLUDED_SIC}
    return sorted(ciks, key=int)


def cmd_map(sec: Throttled, poly: Throttled, key: str) -> None:
    (DATA / "submissions").mkdir(exist_ok=True)
    (DATA / "polygon_ref").mkdir(exist_ok=True)
    ciks = issuers_for_download()
    log(f"[0b] emitentów (po wykluczeniu SIC 6726/6770): {len(ciks)}")
    for i, cik in enumerate(ciks):
        sp = DATA / "submissions" / f"{cik}.json"
        if not sp.exists():
            r = sec.get(f"https://data.sec.gov/submissions/CIK{int(cik):010d}.json")
            if r is None or r.status_code != 200:
                fail("submissions", cik, str(r.status_code if r is not None else "brak odp."))
            else:
                j = r.json()
                j.get("filings", {}).pop("recent", None)     # niepotrzebne, duże
                sp.write_text(json.dumps(j))
        if (i + 1) % 200 == 0:
            log(f"[0b] submissions {i + 1}/{len(ciks)}")
    for i, cik in enumerate(ciks):
        rp = DATA / "polygon_ref" / f"{cik}.json"
        if rp.exists():
            continue
        results = []
        for active in ("false",):              # bieżące tickery są w SEC submissions
            r = poly.get("https://api.polygon.io/v3/reference/tickers",
                         {"cik": f"{int(cik):010d}", "active": active, "limit": 1000, "apiKey": key})
            if r is None or r.status_code != 200:
                fail("polygon_ref", f"{cik}/{active}", str(r.status_code if r is not None else "brak odp."))
                results = None
                break
            results += r.json().get("results", [])
        if results is not None:
            rp.write_text(json.dumps(results))
        if (i + 1) % 50 == 0:
            log(f"[0b] polygon ref {i + 1}/{len(ciks)}")
    log("[0b] gotowe")


# ---------------------------------------------------------------- 0c

def all_price_tickers() -> list[str]:
    tick = set(BENCHMARKS)
    for cik in issuers_for_download():
        rp = DATA / "polygon_ref" / f"{cik}.json"
        sp = DATA / "submissions" / f"{cik}.json"
        ref = json.loads(rp.read_text()) if rp.exists() else []
        cur = json.loads(sp.read_text()).get("tickers", []) if sp.exists() else []
        tick |= set(price_tickers(ref, cur))
    # benchmarki pierwsze, potem alfabetycznie
    return BENCHMARKS + sorted(tick - set(BENCHMARKS))


def fetch_aggs(poly: Throttled, key: str, ticker: str, today: dt.date) -> dict | None:
    for extra in range(0, 8):
        start = polygon_window_start(today, extra)
        r = poly.get(f"https://api.polygon.io/v2/aggs/ticker/{ticker}/range/1/day/{start}/{today}",
                     {"adjusted": "false", "sort": "asc", "limit": 50000, "apiKey": key})
        if r is None:
            return None
        if r.status_code == 200:
            j = r.json()
            if j.get("status") == "NOT_AUTHORIZED":
                continue
            j["_requested_from"] = str(start)
            j["_fetched_at"] = dt.datetime.now().isoformat(timespec="seconds")
            return j
        if r.status_code == 403 and "NOT_AUTHORIZED" in r.text:
            continue                                       # okno free przesunęło się — dzień później
        return {"status": f"HTTP {r.status_code}", "body": r.text[:500]}
    return None


def cmd_prices(poly: Throttled, key: str) -> None:
    (DATA / "aggs").mkdir(exist_ok=True)
    today = dt.date.today()
    sp = DATA / "splits.json"
    if not sp.exists():
        allr, url, params = [], "https://api.polygon.io/v3/reference/splits", {
            "execution_date.gte": str(polygon_window_start(today) - dt.timedelta(days=30)),
            "limit": 1000, "apiKey": key}
        while url:
            r = poly.get(url, params)
            if r is None or r.status_code != 200:
                fail("splits", url, str(r.status_code if r is not None else "brak odp."))
                break
            j = r.json()
            allr += j.get("results", [])
            url, params = j.get("next_url"), {"apiKey": key}
        sp.write_text(json.dumps(allr))
        log(f"[0c] splity: {len(allr)}")
    tickers = all_price_tickers()
    log(f"[0c] tickerów do pobrania: {len(tickers)} (≈ {len(tickers) * POLYGON_MIN_INTERVAL_S / 3600:.1f} h)")
    for i, t in enumerate(tickers):
        ap = DATA / "aggs" / f"{t.replace('/', '_')}.json"
        if ap.exists():
            continue
        j = fetch_aggs(poly, key, t, today)
        if j is None:
            fail("aggs", t, "brak odp.")
            continue
        ap.write_text(json.dumps(j))
        if j.get("status") not in ("OK", "DELAYED"):
            fail("aggs", t, str(j.get("status")))
        if (i + 1) % 25 == 0:
            log(f"[0c] ceny {i + 1}/{len(tickers)}")
    log("[0c] gotowe")


def main(argv: list[str]) -> int:
    cmd = argv[1] if len(argv) > 1 else "all"
    env = load_env()
    ua, key = env.get("SEC_USER_AGENT"), env.get("POLYGON_API_KEY")
    if not ua or not key:
        print("Brak SEC_USER_AGENT albo POLYGON_API_KEY w .env", file=sys.stderr)
        return 2
    DATA.mkdir(parents=True, exist_ok=True)
    sec = Throttled(SEC_MIN_INTERVAL_S, {"User-Agent": ua, "Accept-Encoding": "gzip, deflate"})
    poly = Throttled(POLYGON_MIN_INTERVAL_S)
    if cmd in ("index", "all"):
        cmd_index(sec)
    if cmd in ("map", "all"):
        cmd_map(sec, poly, key)
    if cmd in ("prices", "all"):
        cmd_prices(poly, key)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
