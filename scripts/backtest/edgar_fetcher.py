"""
Pobieranie i parsowanie Form 4 z SEC EDGAR.
Obsługuje: CIK lookup, submissions.json (recent + starsze batche), XML parsing.
Cache na dysk — nie pobiera ponownie już ściągniętych danych.
"""
from __future__ import annotations

import csv
import json
import os
import re
import time
import xml.etree.ElementTree as ET
from datetime import date, datetime
from pathlib import Path
from typing import Optional

import requests

from config import (
    ALL_TICKERS, CONTROL_TICKERS, CSUITE_TITLES, DATA_DIR,
    CIK_CACHE_FILE, END_DATE, HEALTHCARE_TICKERS,
    SEC_BASE_URL, SEC_RATE_LIMIT, SEC_USER_AGENT,
    START_DATE, TRANSACTIONS_FILE, TX_COLUMNS,
)

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": SEC_USER_AGENT,
    "Accept-Encoding": "gzip, deflate",
})


def _rate_limit():
    """Prosty rate limiter — czeka SEC_RATE_LIMIT sekund między requestami."""
    time.sleep(SEC_RATE_LIMIT)


# =============================================================================
# CIK Lookup
# =============================================================================

def fetch_cik_map() -> dict[str, str]:
    """Pobiera mapowanie ticker → CIK z SEC company_tickers.json. Cache lokalny."""
    if os.path.exists(CIK_CACHE_FILE):
        with open(CIK_CACHE_FILE) as f:
            cached = json.load(f)
            if len(cached) >= len(ALL_TICKERS) * 0.8:
                return cached

    print("[CIK] Pobieram company_tickers.json z SEC...")
    resp = SESSION.get("https://www.sec.gov/files/company_tickers.json")
    resp.raise_for_status()
    data = resp.json()
    _rate_limit()

    # Format: { "0": {"cik_str": 320193, "ticker": "AAPL", "title": "..."}, ... }
    ticker_to_cik = {}
    for entry in data.values():
        ticker = entry["ticker"].upper()
        cik = str(entry["cik_str"])
        if ticker in ALL_TICKERS:
            ticker_to_cik[ticker] = cik

    missing = set(ALL_TICKERS) - set(ticker_to_cik.keys())
    if missing:
        print(f"[CIK] UWAGA: brak CIK dla {len(missing)} tickerów: {sorted(missing)}")

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(CIK_CACHE_FILE, "w") as f:
        json.dump(ticker_to_cik, f, indent=2)

    print(f"[CIK] Znaleziono {len(ticker_to_cik)}/{len(ALL_TICKERS)} CIK-ów")
    return ticker_to_cik


# =============================================================================
# Submissions (lista filingów per CIK)
# =============================================================================

def _fetch_submissions(cik: str) -> list[dict]:
    """Pobiera listę filingów z submissions.json (recent + older batches)."""
    cik_padded = cik.zfill(10)
    url = f"{SEC_BASE_URL}/submissions/CIK{cik_padded}.json"
    resp = SESSION.get(url)
    resp.raise_for_status()
    _rate_limit()
    data = resp.json()

    filings = []
    recent = data.get("filings", {}).get("recent", {})
    if recent:
        forms = recent.get("form", [])
        dates = recent.get("filingDate", [])
        accessions = recent.get("accessionNumber", [])
        doc_urls = recent.get("primaryDocument", [])
        for i in range(len(forms)):
            filings.append({
                "form": forms[i],
                "date": dates[i],
                "accession": accessions[i],
                "primary_doc": doc_urls[i] if i < len(doc_urls) else "",
            })

    # Starsze batche (jeśli firma ma >1000 filingów)
    older_files = data.get("filings", {}).get("files", [])
    for file_ref in older_files:
        file_url = f"{SEC_BASE_URL}/submissions/{file_ref['name']}"
        try:
            resp2 = SESSION.get(file_url)
            resp2.raise_for_status()
            _rate_limit()
            batch = resp2.json()
            forms = batch.get("form", [])
            dates = batch.get("filingDate", [])
            accessions = batch.get("accessionNumber", [])
            doc_urls = batch.get("primaryDocument", [])
            for i in range(len(forms)):
                filings.append({
                    "form": forms[i],
                    "date": dates[i],
                    "accession": accessions[i],
                    "primary_doc": doc_urls[i] if i < len(doc_urls) else "",
                })
        except Exception as e:
            print(f"  [WARN] Nie udało się pobrać {file_ref['name']}: {e}")

    return filings


def _filter_form4_in_range(filings: list[dict]) -> list[dict]:
    """Filtruje filingi: tylko Form 4 w zakresie dat."""
    result = []
    for f in filings:
        if f["form"] not in ("4", "4/A"):
            continue
        try:
            fdate = date.fromisoformat(f["date"])
        except ValueError:
            continue
        if START_DATE <= fdate <= END_DATE:
            result.append(f)
    return result


# =============================================================================
# Form 4 XML Parsing
# =============================================================================

def _safe_text(element, path: str) -> str:
    """Bezpieczne wyciąganie tekstu z XML (obsługuje brak elementu)."""
    el = element.find(path)
    if el is not None and el.text:
        return el.text.strip()
    # Sprawdź zagnieżdżone <value>
    val_el = element.find(f"{path}/value")
    if val_el is not None and val_el.text:
        return val_el.text.strip()
    return ""


def _safe_float(element, path: str) -> float:
    """Bezpieczne wyciąganie float z XML."""
    text = _safe_text(element, path)
    if not text:
        return 0.0
    try:
        return float(text.replace(",", ""))
    except ValueError:
        return 0.0


def _detect_10b51(xml_text: str) -> bool:
    """Heurystyka: czy filing wspomina o planie 10b5-1."""
    patterns = ["10b5-1", "10b5(1)", "Rule 10b5", "10b-5-1", "trading plan"]
    lower = xml_text.lower()
    return any(p.lower() in lower for p in patterns)


def _is_csuite(officer_title: str, is_officer: bool) -> bool:
    """Sprawdza czy tytuł pasuje do C-suite (spójne z Form4Pipeline)."""
    if not is_officer or not officer_title:
        return False
    title_upper = officer_title.upper()
    for t in CSUITE_TITLES:
        if t.upper() in title_upper:
            return True
    return False


def _parse_form4_xml(xml_text: str, symbol: str, filing_date: str,
                     accession: str) -> list[dict]:
    """Parsuje Form 4 XML → lista transakcji."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []

    is_10b51 = _detect_10b51(xml_text)
    is_hc = symbol in HEALTHCARE_TICKERS

    # Dane reportingOwner
    owner = root.find(".//reportingOwner")
    if owner is None:
        # Próba alternatywnej ścieżki
        owner = root
    
    insider_name = (
        _safe_text(root, ".//reportingOwner/reportingOwnerId/rptOwnerName")
        or _safe_text(root, ".//rptOwnerName")
        or "Unknown"
    )
    
    rel = root.find(".//reportingOwnerRelationship")
    is_officer = False
    is_director = False
    is_ten_pct = False
    officer_title = ""
    
    if rel is not None:
        is_officer = _safe_text(rel, "isOfficer") in ("1", "true", "True")
        is_director = _safe_text(rel, "isDirector") in ("1", "true", "True")
        is_ten_pct = _safe_text(rel, "isTenPercentOwner") in ("1", "true", "True")
        officer_title = _safe_text(rel, "officerTitle")

    insider_role = "Other"
    if is_officer:
        insider_role = f"Officer: {officer_title}" if officer_title else "Officer"
    elif is_director:
        insider_role = "Director"
    elif is_ten_pct:
        insider_role = "10% Owner"

    csuite = _is_csuite(officer_title, is_officer)

    # Parsowanie transakcji (nonDerivative + derivative)
    transactions = []
    for tx_path in [".//nonDerivativeTransaction", ".//derivativeTransaction"]:
        for tx in root.findall(tx_path):
            tx_date = _safe_text(tx, ".//transactionDate/value")
            if not tx_date:
                tx_date = _safe_text(tx, ".//transactionDate")
            if not tx_date:
                continue

            tx_code = _safe_text(tx, ".//transactionCoding/transactionCode")
            if not tx_code:
                continue

            # Mapowanie kodów SEC → typ
            code_map = {"P": "BUY", "S": "SELL", "M": "EXERCISE",
                        "A": "GRANT", "F": "TAX", "G": "GIFT",
                        "J": "OTHER", "C": "CONVERSION"}
            tx_type = code_map.get(tx_code.upper(), "OTHER")

            shares = _safe_float(tx, ".//transactionAmounts/transactionShares/value")
            if shares == 0:
                shares = _safe_float(tx, ".//transactionAmounts/transactionShares")
            
            price = _safe_float(tx, ".//transactionAmounts/transactionPricePerShare/value")
            if price == 0:
                price = _safe_float(tx, ".//transactionAmounts/transactionPricePerShare")

            total_value = shares * price
            
            shares_after = _safe_float(
                tx, ".//postTransactionAmounts/sharesOwnedFollowingTransaction/value"
            )
            if shares_after == 0:
                shares_after = _safe_float(
                    tx, ".//postTransactionAmounts/sharesOwnedFollowingTransaction"
                )

            transactions.append({
                "symbol": symbol,
                "filing_date": filing_date,
                "transaction_date": tx_date,
                "insider_name": insider_name,
                "insider_role": insider_role,
                "officer_title": officer_title,
                "is_officer": is_officer,
                "is_director": is_director,
                "is_ten_pct_owner": is_ten_pct,
                "transaction_type": tx_type,
                "shares": abs(shares),
                "price_per_share": price,
                "total_value": abs(total_value),
                "shares_owned_after": shares_after,
                "is_10b51_plan": is_10b51,
                "is_csuite": csuite,
                "is_healthcare": is_hc,
                "accession_number": accession,
            })

    return transactions


def _fetch_form4_xml(accession: str, primary_doc: str, cik: str) -> Optional[str]:
    """Pobiera XML Form 4 z SEC EDGAR.

    primary_doc często ma prefix XSLT (np. xslF345X06/plik.xml) — wycinamy go
    i pobieramy surowy XML z www.sec.gov (data.sec.gov zwraca 404 dla wielu filingów).
    """
    accession_clean = accession.replace("-", "")
    base_url = "https://www.sec.gov"  # data.sec.gov daje 404 na nowszych filingach

    # Wyciągnij nazwę pliku XML (bez xsl prefixu)
    xml_filename = ""
    if primary_doc:
        # np. "xslF345X06/wk-form4_123.xml" → "wk-form4_123.xml"
        xml_filename = primary_doc.split("/")[-1] if "/" in primary_doc else primary_doc

    # Próba 1: surowy XML (bez XSLT prefixu)
    if xml_filename:
        url = f"{base_url}/Archives/edgar/data/{cik}/{accession_clean}/{xml_filename}"
        try:
            resp = SESSION.get(url)
            _rate_limit()
            if resp.status_code == 200 and "<ownershipDocument" in resp.text:
                return resp.text
        except Exception:
            pass

    # Próba 2: filing index → szukaj linku do .xml
    index_url = f"{base_url}/Archives/edgar/data/{cik}/{accession_clean}/"
    try:
        resp = SESSION.get(index_url)
        _rate_limit()
        if resp.status_code == 200:
            xml_match = re.search(r'href="([^"]*\.xml)"', resp.text, re.IGNORECASE)
            if xml_match:
                found_xml = xml_match.group(1).lstrip("/")
                xml_url = f"{base_url}/Archives/edgar/data/{cik}/{accession_clean}/{found_xml}"
                resp2 = SESSION.get(xml_url)
                _rate_limit()
                if resp2.status_code == 200 and "<ownershipDocument" in resp2.text:
                    return resp2.text
    except Exception:
        pass

    return None


# =============================================================================
# Główna funkcja pobierania
# =============================================================================

def fetch_all_form4(force_refetch: bool = False) -> str:
    """
    Pobiera wszystkie Form 4 dla tickerów z config.
    Zapisuje do CSV. Zwraca ścieżkę do pliku.
    """
    if os.path.exists(TRANSACTIONS_FILE) and not force_refetch:
        with open(TRANSACTIONS_FILE) as f:
            reader = csv.reader(f)
            rows = sum(1 for _ in reader) - 1  # minus header
        print(f"[EDGAR] Dane już istnieją: {TRANSACTIONS_FILE} ({rows} transakcji)")
        print(f"        Aby pobrać ponownie: python run_backtest.py fetch --force")
        return TRANSACTIONS_FILE

    cik_map = fetch_cik_map()
    os.makedirs(DATA_DIR, exist_ok=True)

    all_transactions = []
    total_filings = 0
    errors = 0

    for i, symbol in enumerate(ALL_TICKERS):
        cik = cik_map.get(symbol)
        if not cik:
            print(f"[{i+1}/{len(ALL_TICKERS)}] {symbol}: brak CIK — pomijam")
            continue

        print(f"[{i+1}/{len(ALL_TICKERS)}] {symbol} (CIK {cik})...", end=" ", flush=True)

        try:
            filings = _fetch_submissions(cik)
            form4s = _filter_form4_in_range(filings)
            print(f"{len(form4s)} Form 4 w zakresie", end="", flush=True)

            ticker_tx = 0
            for j, filing in enumerate(form4s):
                xml = _fetch_form4_xml(filing["accession"], filing["primary_doc"], cik)
                if xml:
                    txs = _parse_form4_xml(
                        xml, symbol, filing["date"], filing["accession"]
                    )
                    all_transactions.extend(txs)
                    ticker_tx += len(txs)
                else:
                    errors += 1

                # Progress co 50 filingów
                if (j + 1) % 50 == 0:
                    print(f" [{j+1}]", end="", flush=True)

            total_filings += len(form4s)
            print(f" → {ticker_tx} transakcji")

        except Exception as e:
            print(f" BŁĄD: {e}")
            errors += 1

    # Zapis do CSV
    with open(TRANSACTIONS_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=TX_COLUMNS)
        writer.writeheader()
        writer.writerows(all_transactions)

    print(f"\n[EDGAR] GOTOWE: {len(all_transactions)} transakcji z {total_filings} "
          f"filingów ({errors} błędów)")
    print(f"        Zapisano: {TRANSACTIONS_FILE}")
    return TRANSACTIONS_FILE


if __name__ == "__main__":
    fetch_all_form4()
