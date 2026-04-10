"""
Survivorship bias check dla backtesta Sprint 15.

Pytanie: czy nasze 42 healthcare tickery to lista "ocalałych" (survival bias)
czy reprezentatywna lista healthcare companies aktywnych w 2023?

Metoda:
1. Pobierz wszystkie CIKs z SEC company_tickers_exchange.json z healthcare SIC
2. Sprawdź które filowały Form 4 w Q1 2023 (z submissions.json)
3. Porównaj z 42 hardcoded tickerami z config.py
4. Zlicz tickery które były aktywne w 2023 ale nie są w naszej liście
"""

from __future__ import annotations
import json
import time
from pathlib import Path

import requests

from config import HEALTHCARE_TICKERS, SEC_USER_AGENT

SESSION = requests.Session()
SESSION.headers.update({"User-Agent": SEC_USER_AGENT, "Accept-Encoding": "gzip, deflate"})

# Healthcare SIC codes
HEALTHCARE_SIC = {
    2833: "Medicinal Chemicals",
    2834: "Pharmaceutical Preparations",
    2835: "In Vitro & In Vivo Diagnostics",
    2836: "Biological Products (No Diagnostics)",
    3841: "Surgical & Medical Instruments",
    3842: "Orthopedic, Prosthetic & Surgical",
    3843: "Dental Equipment & Supplies",
    3845: "Electromedical & Electrotherapeutic",
    8000: "Health Services",
    8011: "Services-Offices & Clinics of Doctors",
    8060: "Hospitals",
    8062: "General Medical & Surgical Hospitals",
    8071: "Medical Laboratories",
    8090: "Health Services - Other",
    8731: "Commercial Physical & Biological Research",
}

CACHE_DIR = Path("data/survivorship_cache")
CACHE_DIR.mkdir(parents=True, exist_ok=True)


def fetch_company_tickers_exchange() -> list[dict]:
    """Pobiera listę wszystkich SEC-registered companies z exchange info + SIC."""
    cache = CACHE_DIR / "company_tickers_exchange.json"
    if cache.exists():
        with open(cache) as f:
            return json.load(f)

    print("[1/4] Pobieranie company_tickers_exchange.json z SEC...")
    resp = SESSION.get("https://www.sec.gov/files/company_tickers_exchange.json")
    resp.raise_for_status()
    data = resp.json()
    # Format: { "fields": [...], "data": [[cik, name, ticker, exchange], ...] }
    fields = data.get("fields", [])
    rows = data.get("data", [])
    companies = [dict(zip(fields, row)) for row in rows]
    with open(cache, "w") as f:
        json.dump(companies, f)
    print(f"    Pobrano {len(companies)} companies (z exchange info)")
    return companies


def fetch_sic_for_cik(cik: str) -> int | None:
    """Pobiera SIC code dla CIK z submissions.json. Cache lokalny."""
    cik_padded = str(cik).zfill(10)
    cache = CACHE_DIR / f"sic_{cik_padded}.json"
    if cache.exists():
        with open(cache) as f:
            return json.load(f).get("sic")

    url = f"https://data.sec.gov/submissions/CIK{cik_padded}.json"
    try:
        resp = SESSION.get(url, timeout=10)
        time.sleep(0.12)  # rate limit ~8 req/s
        if resp.status_code != 200:
            return None
        data = resp.json()
        sic = data.get("sicCode") or data.get("sic")
        if sic:
            try:
                sic = int(sic)
            except ValueError:
                sic = None
        # Sprawdź też czy filował Form 4 w Q1 2023
        recent = data.get("filings", {}).get("recent", {})
        forms = recent.get("form", [])
        dates = recent.get("filingDate", [])
        had_form4_q1_2023 = False
        for i in range(len(forms)):
            if forms[i] in ("4", "4/A") and "2023-01" <= dates[i] <= "2023-03-31":
                had_form4_q1_2023 = True
                break
        # Older batches
        if not had_form4_q1_2023:
            for file_ref in data.get("filings", {}).get("files", []):
                file_url = f"https://data.sec.gov/submissions/{file_ref['name']}"
                try:
                    r2 = SESSION.get(file_url, timeout=10)
                    time.sleep(0.12)
                    if r2.status_code == 200:
                        batch = r2.json()
                        forms = batch.get("form", [])
                        dates = batch.get("filingDate", [])
                        for i in range(len(forms)):
                            if forms[i] in ("4", "4/A") and "2023-01" <= dates[i] <= "2023-03-31":
                                had_form4_q1_2023 = True
                                break
                        if had_form4_q1_2023:
                            break
                except Exception:
                    continue

        result = {"sic": sic, "form4_q1_2023": had_form4_q1_2023, "ticker": data.get("tickers", [None])[0]}
        with open(cache, "w") as f:
            json.dump(result, f)
        return sic
    except Exception as e:
        return None


def fetch_company_metadata(cik: str) -> dict | None:
    """Pobiera metadata z cache (po fetch_sic_for_cik)."""
    cik_padded = str(cik).zfill(10)
    cache = CACHE_DIR / f"sic_{cik_padded}.json"
    if cache.exists():
        with open(cache) as f:
            return json.load(f)
    return None


def main():
    print("=" * 70)
    print("SURVIVORSHIP BIAS CHECK — Sprint 15 backtest")
    print("=" * 70)
    print()

    # 1. Pobierz wszystkie SEC-registered companies
    companies = fetch_company_tickers_exchange()
    print(f"Total SEC companies (current): {len(companies)}")

    # 2. Pierwszy filtr: tylko z popularnych exchange (NYSE, Nasdaq)
    listed = [c for c in companies if c.get("exchange") in ("NYSE", "Nasdaq", "NYSE Arca", "OTC")]
    print(f"Listed on NYSE/Nasdaq/OTC: {len(listed)}")

    # 3. Filtr po nazwie — heurystyka żeby ograniczyć liczbę CIKs do sprawdzenia
    # (~10000 companies × 0.12s = 20 min na sprawdzenie wszystkich SIC)
    # Heurystyka: szukaj słów kluczowych w nazwie
    healthcare_keywords = [
        "pharma", "bio", "therapeutic", "medical", "health", "care",
        "drug", "medicine", "clinic", "hospital", "diagnostic", "genom",
        "vaccine", "oncolog", "neuro", "immun", "regen", "cell", "molecul",
        "labs", "laboratory", "scien", "rx", "med ", "med,", "medic",
    ]

    def is_healthcare_name(name: str) -> bool:
        n = name.lower()
        return any(kw in n for kw in healthcare_keywords)

    healthcare_candidates = [c for c in listed if is_healthcare_name(c.get("name", ""))]
    print(f"Healthcare candidates (by name keyword): {len(healthcare_candidates)}")
    print()

    # 4. Dla każdego candidate sprawdź SIC + czy filował Form 4 w Q1 2023
    print(f"[2/4] Sprawdzam SIC codes i Form 4 Q1 2023 dla {len(healthcare_candidates)} candidates...")
    print(f"    (rate limit 8 req/s = ~{len(healthcare_candidates) * 0.13:.0f}s)")
    print()

    healthcare_2023 = []
    checked = 0
    for c in healthcare_candidates:
        cik = c["cik"]
        sic = fetch_sic_for_cik(str(cik))
        meta = fetch_company_metadata(str(cik))
        checked += 1
        if checked % 50 == 0:
            print(f"    [{checked}/{len(healthcare_candidates)}] sprawdzonych...")

        if sic in HEALTHCARE_SIC and meta and meta.get("form4_q1_2023"):
            healthcare_2023.append({
                "cik": cik,
                "name": c.get("name"),
                "ticker": c.get("ticker") or meta.get("ticker"),
                "sic": sic,
                "exchange": c.get("exchange"),
            })

    print()
    print(f"[3/4] Znaleziono {len(healthcare_2023)} healthcare companies aktywnych w Q1 2023")
    print(f"    (filowały Form 4 + healthcare SIC + jest w current SEC list)")
    print()

    # 5. Porównaj z naszymi 42 tickerami
    our_set = set(HEALTHCARE_TICKERS)
    their_tickers = {c["ticker"] for c in healthcare_2023 if c["ticker"]}

    in_both = our_set & their_tickers
    only_us = our_set - their_tickers
    only_them = their_tickers - our_set

    print(f"[4/4] PORÓWNANIE:")
    print(f"    Nasze 42 tickerów: {len(our_set)}")
    print(f"    Healthcare aktywne w Q1 2023 (current SEC): {len(their_tickers)}")
    print(f"    W obu listach: {len(in_both)}")
    print(f"    Tylko u nas (możliwe że nie filowały Form 4 lub złe SIC): {len(only_us)}")
    print(f"    Tylko w SEC 2023, brak u nas (POTENCJALNY SURVIVORSHIP): {len(only_them)}")
    print()

    if only_us:
        print(f"NASZE TICKERY KTÓRE NIE FILOWAŁY Form 4 W Q1 2023 (lub nie healthcare SIC):")
        for t in sorted(only_us):
            print(f"  - {t}")
        print()

    print(f"SAMPLE 30 healthcare tickerów AKTYWNYCH W Q1 2023 KTÓRYCH NIE MAMY:")
    sample = sorted([c for c in healthcare_2023 if c["ticker"] and c["ticker"] not in our_set],
                    key=lambda c: c.get("name", ""))[:30]
    for c in sample:
        print(f"  {c['ticker']:8s} {c['name'][:50]:50s} SIC {c['sic']}")
    print()

    # 6. KLUCZOWE: ile z healthcare_2023 NIE MA już dziś (delisted)
    # current SEC company_tickers_exchange.json zawiera tylko AKTYWNE tickery
    # więc każdy ticker w healthcare_2023 który ma "ticker"=None lub został usunięty
    # Bardziej precyzyjny test: pobierz company_tickers.json z 2023 (jeśli archived)
    # Alternatywnie: szacujemy delta vs current

    # Save full results
    results_file = Path("data/results/survivorship_check.json")
    results_file.parent.mkdir(parents=True, exist_ok=True)
    with open(results_file, "w") as f:
        json.dump({
            "our_tickers": sorted(our_set),
            "healthcare_q1_2023_count": len(healthcare_2023),
            "in_both": sorted(in_both),
            "only_us": sorted(only_us),
            "only_them_sample": [c for c in sample],
            "all_2023_healthcare": [
                {"cik": c["cik"], "name": c["name"], "ticker": c["ticker"], "sic": c["sic"]}
                for c in healthcare_2023
            ],
        }, f, indent=2)
    print(f"Wyniki zapisane: {results_file}")
    print()

    # PODSUMOWANIE
    print("=" * 70)
    print("PODSUMOWANIE")
    print("=" * 70)
    coverage = len(in_both) / len(healthcare_2023) * 100 if healthcare_2023 else 0
    print(f"Pokrycie naszej listy vs realny universe Q1 2023: {coverage:.1f}%")
    print(f"Brakuje nam: {len(only_them)} tickerów które filowały Form 4 w Q1 2023")
    print()
    if coverage < 10:
        print("⚠️  KRYTYCZNE: <10% pokrycia. Backtest jest na cherry-picked liście,")
        print("    nie reprezentuje healthcare universe. Sprint 15 wymaga re-runu.")
    elif coverage < 30:
        print("⚠️  WYSOKIE RYZYKO: <30% pokrycia. Selection bias jest realny.")
        print("    Wyniki Sprint 15 prawdopodobnie zawyżone (cherry-picked giants).")
    else:
        print(f"OK: {coverage:.0f}% pokrycia. Selection bias akceptowalny.")
    print()
    print("UWAGA: To NIE jest pełny survivorship test. Pełny test wymaga:")
    print("1. Listy CIKs które filowały Form 4 w Q1 2023 ALE są dziś delisted")
    print("2. company_tickers.json z marca 2023 (archived)")
    print("3. SEC nie udostępnia archived list — trzeba użyć wayback machine")
    print()
    print("Ten skrypt sprawdza tylko 'ile healthcare tickerów było aktywnych w 2023'.")
    print("Pokazuje selection bias (cherry picking) ale nie pure survivorship.")


if __name__ == "__main__":
    main()
