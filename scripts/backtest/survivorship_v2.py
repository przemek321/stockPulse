"""
Survivorship bias check v2 — bez naive name filter.

Strategia: pobierz SIC dla WSZYSTKICH 10000+ listed companies.
~25 min @ 8 req/s. Jednorazowe, cache'owane.
Potem: filtr po SIC code (healthcare), porównanie z naszymi 42.
"""

from __future__ import annotations
import json
import time
from pathlib import Path

import requests

from config import HEALTHCARE_TICKERS, SEC_USER_AGENT

SESSION = requests.Session()
SESSION.headers.update({"User-Agent": SEC_USER_AGENT, "Accept-Encoding": "gzip, deflate"})

HEALTHCARE_SIC = {
    2833, 2834, 2835, 2836,
    3841, 3842, 3843, 3845,
    8000, 8011, 8060, 8062, 8071, 8090,
    8731,
}

CACHE_DIR = Path("data/survivorship_cache")
CACHE_DIR.mkdir(parents=True, exist_ok=True)


def fetch_companies():
    cache = CACHE_DIR / "company_tickers_exchange.json"
    if cache.exists():
        return json.loads(cache.read_text())
    resp = SESSION.get("https://www.sec.gov/files/company_tickers_exchange.json")
    resp.raise_for_status()
    data = resp.json()
    fields = data["fields"]
    rows = data["data"]
    companies = [dict(zip(fields, r)) for r in rows]
    cache.write_text(json.dumps(companies))
    return companies


def fetch_meta(cik):
    cik_padded = str(cik).zfill(10)
    cache = CACHE_DIR / f"sic_{cik_padded}.json"
    if cache.exists():
        try:
            return json.loads(cache.read_text())
        except Exception:
            cache.unlink()

    url = f"https://data.sec.gov/submissions/CIK{cik_padded}.json"
    try:
        resp = SESSION.get(url, timeout=10)
        time.sleep(0.13)
        if resp.status_code != 200:
            return None
        data = resp.json()
        sic = data.get("sicCode") or data.get("sic")
        try:
            sic = int(sic) if sic else None
        except (ValueError, TypeError):
            sic = None

        # Form 4 Q1 2023 check
        had_form4 = False
        recent = data.get("filings", {}).get("recent", {})
        forms = recent.get("form", [])
        dates = recent.get("filingDate", [])
        for i in range(len(forms)):
            if forms[i] in ("4", "4/A") and "2023-01-01" <= dates[i] <= "2023-03-31":
                had_form4 = True
                break

        # Older batches (jeśli firma ma >1000 filings)
        if not had_form4:
            for fr in data.get("filings", {}).get("files", []):
                file_url = f"https://data.sec.gov/submissions/{fr['name']}"
                try:
                    r2 = SESSION.get(file_url, timeout=10)
                    time.sleep(0.13)
                    if r2.status_code == 200:
                        b = r2.json()
                        f2 = b.get("form", [])
                        d2 = b.get("filingDate", [])
                        for i in range(len(f2)):
                            if f2[i] in ("4", "4/A") and "2023-01-01" <= d2[i] <= "2023-03-31":
                                had_form4 = True
                                break
                    if had_form4:
                        break
                except Exception:
                    continue

        result = {
            "sic": sic,
            "form4_q1_2023": had_form4,
            "ticker": (data.get("tickers") or [None])[0],
            "name": data.get("name"),
        }
        cache.write_text(json.dumps(result))
        return result
    except Exception as e:
        return None


def main():
    print("=" * 70)
    print("SURVIVORSHIP CHECK V2 — pełny scan SIC dla healthcare")
    print("=" * 70)
    print()

    companies = fetch_companies()
    listed = [c for c in companies if c.get("exchange") in ("NYSE", "Nasdaq", "NYSE Arca", "OTC")]
    print(f"SEC listed companies (NYSE/Nasdaq/OTC): {len(listed)}")

    # Najpierw sprawdź nasze 42 — krytyczne żeby były w cache
    print()
    print("KROK 1: sprawdzam metadane dla naszych 42 healthcare tickerów")
    our_meta = {}
    for t in HEALTHCARE_TICKERS:
        found = [c for c in listed if c.get("ticker") == t]
        if not found:
            print(f"  {t}: BRAK W SEC company_tickers_exchange.json (delisted/nieistniejący?)")
            our_meta[t] = None
            continue
        cik = found[0]["cik"]
        meta = fetch_meta(str(cik))
        our_meta[t] = meta
        sic = meta.get("sic") if meta else None
        f4 = meta.get("form4_q1_2023") if meta else False
        is_hc = sic in HEALTHCARE_SIC if sic else False
        print(f"  {t:6s} CIK={cik:8d} SIC={sic} HC={'✓' if is_hc else '✗'} F4_Q1_23={'✓' if f4 else '✗'}")

    print()
    our_in_2023 = sum(1 for t, m in our_meta.items()
                      if m and m.get("sic") in HEALTHCARE_SIC and m.get("form4_q1_2023"))
    our_total = sum(1 for m in our_meta.values() if m is not None)
    print(f"Z naszych 42: {our_in_2023}/42 ma healthcare SIC + filował Form 4 w Q1 2023")
    print(f"  ({our_total} istnieje w current SEC list)")
    print()

    # KROK 2: pełny scan listed companies (cache działa)
    print("KROK 2: pełny scan SIC dla wszystkich listed companies")
    cached = sum(1 for f in CACHE_DIR.iterdir() if f.name.startswith("sic_"))
    print(f"  Już w cache: {cached}")
    print(f"  Do pobrania: ~{len(listed) - cached}")
    print(f"  Czas: ~{(len(listed) - cached) * 0.15 / 60:.0f} min")
    print()

    healthcare_2023 = []
    checked = 0
    for c in listed:
        cik = c["cik"]
        meta = fetch_meta(str(cik))
        checked += 1
        if checked % 200 == 0:
            print(f"  [{checked}/{len(listed)}] checked, found {len(healthcare_2023)} healthcare Q1 2023")

        if not meta:
            continue
        if meta.get("sic") in HEALTHCARE_SIC and meta.get("form4_q1_2023"):
            healthcare_2023.append({
                "cik": cik,
                "name": c.get("name") or meta.get("name"),
                "ticker": c.get("ticker") or meta.get("ticker"),
                "sic": meta.get("sic"),
                "exchange": c.get("exchange"),
            })

    print()
    print(f"Healthcare companies aktywne w Q1 2023 (Form 4 + healthcare SIC): {len(healthcare_2023)}")
    print()

    # KROK 3: porównanie
    our_set = set(HEALTHCARE_TICKERS)
    their_tickers = {c["ticker"] for c in healthcare_2023 if c.get("ticker")}

    in_both = our_set & their_tickers
    only_us = our_set - their_tickers
    only_them = their_tickers - our_set

    print("=" * 70)
    print("PORÓWNANIE")
    print("=" * 70)
    print(f"Nasze 42 tickerów: {len(our_set)}")
    print(f"Healthcare aktywne Q1 2023 (current SEC): {len(their_tickers)}")
    print(f"Overlap: {len(in_both)} ({len(in_both)/42*100:.0f}% z naszej listy, {len(in_both)/len(their_tickers)*100:.1f}% universe)")
    print(f"Tylko u nas: {len(only_us)}")
    print(f"Tylko w SEC universe: {len(only_them)}")
    print()

    if only_us:
        print(f"NASZE TICKERY KTÓRYCH NIE ZNALEŹLI W SEC HC UNIVERSE Q1 2023 ({len(only_us)}):")
        for t in sorted(only_us):
            m = our_meta.get(t)
            if m is None:
                reason = "brak w SEC company list"
            elif m.get("sic") not in HEALTHCARE_SIC:
                reason = f"SIC={m.get('sic')} nie healthcare"
            elif not m.get("form4_q1_2023"):
                reason = "brak Form 4 w Q1 2023"
            else:
                reason = "??"
            print(f"  {t:6s} — {reason}")
        print()

    # Top 30 healthcare których brakuje
    only_them_with_data = [c for c in healthcare_2023 if c.get("ticker") and c["ticker"] in only_them]
    print(f"SAMPLE 30 HEALTHCARE TICKERÓW W Q1 2023 KTÓRYCH NAM BRAKUJE:")
    for c in sorted(only_them_with_data, key=lambda x: x.get("name") or "")[:30]:
        print(f"  {c['ticker']:8s} {c['name'][:55]:55s} SIC {c['sic']}")
    print()

    # Save
    out = Path("data/results/survivorship_v2.json")
    out.write_text(json.dumps({
        "our_tickers_42": sorted(our_set),
        "our_passing_filter": sorted(in_both),
        "our_failing_filter": {
            t: ("missing_in_SEC" if not our_meta.get(t) else
                f"SIC={our_meta[t].get('sic')}" if our_meta[t].get("sic") not in HEALTHCARE_SIC else
                "no_form4_q1_2023")
            for t in only_us
        },
        "healthcare_universe_2023_count": len(healthcare_2023),
        "missing_from_our_list_count": len(only_them),
        "missing_sample": only_them_with_data[:50],
    }, indent=2))

    print("=" * 70)
    print("PODSUMOWANIE")
    print("=" * 70)
    coverage_universe = len(in_both) / len(healthcare_2023) * 100 if healthcare_2023 else 0
    print(f"Pokrycie SEC healthcare universe: {coverage_universe:.1f}% ({len(in_both)}/{len(healthcare_2023)})")
    print()
    if coverage_universe < 5:
        print("⚠️  KRYTYCZNE: <5% pokrycia.")
        print("    Backtest jest na ekstremalnie wąskiej liście (cherry-picked giants).")
        print("    Wnioski Sprint 15 NIE generalizują się na healthcare universe.")
        print()
        print("    Nasze 42 to large-cap pharma + select biotech z headlines.")
        print("    Brakuje: ~480 mniejszych biotech / mid-cap healthcare.")
        print("    Edge insider BUY d=0.43 może być specyficzny dla large-cap healthcare.")
    print()
    print(f"Wyniki: {out}")


if __name__ == "__main__":
    main()
