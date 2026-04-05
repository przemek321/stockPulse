#!/usr/bin/env python3
"""
StockPulse Backtest — Insider Trading Patterns
Walidacja hipotez na 3 latach danych SEC EDGAR Form 4.

Użycie:
    python run_backtest.py              # Pełny backtest (fetch + analyze + report)
    python run_backtest.py fetch        # Tylko pobieranie danych
    python run_backtest.py fetch --force  # Wymuś ponowne pobranie
    python run_backtest.py analyze      # Tylko analiza (wymaga danych)
    python run_backtest.py report       # Tylko raport (wymaga wyników)
"""

import argparse
import json
import os
import sys
import time
from dataclasses import asdict

from config import RESULTS_DIR, TRANSACTIONS_FILE


def stage_fetch(force: bool = False):
    """Etap 1: Pobieranie Form 4 z SEC EDGAR + ceny z yfinance."""
    from edgar_fetcher import fetch_all_form4
    from price_fetcher import fetch_all_prices

    print("=" * 60)
    print("ETAP 1: POBIERANIE DANYCH")
    print("=" * 60)

    t0 = time.time()
    tx_file = fetch_all_form4(force_refetch=force)
    prices = fetch_all_prices(force=force)
    elapsed = time.time() - t0

    print(f"\n[FETCH] Zakończone w {elapsed:.0f}s ({elapsed/60:.1f} min)")
    return tx_file, prices


def stage_analyze(tx_file: str = None, prices: dict = None):
    """Etap 2: Analiza hipotez."""
    from analyzer import run_analysis

    if tx_file is None:
        tx_file = TRANSACTIONS_FILE
    if not os.path.exists(tx_file):
        print(f"[BŁĄD] Brak pliku transakcji: {tx_file}")
        print("       Uruchom najpierw: python run_backtest.py fetch")
        sys.exit(1)

    if prices is None:
        from price_fetcher import fetch_all_prices
        prices = fetch_all_prices()

    t0 = time.time()
    results = run_analysis(tx_file, prices)
    elapsed = time.time() - t0
    print(f"\n[ANALIZA] Zakończone w {elapsed:.1f}s")
    return results


def stage_report(results=None, tx_file: str = None):
    """Etap 3: Generowanie raportu markdown."""
    from report_generator import generate_report, save_report

    if tx_file is None:
        tx_file = TRANSACTIONS_FILE

    if results is None:
        results_path = os.path.join(RESULTS_DIR, "backtest_results.json")
        if not os.path.exists(results_path):
            print(f"[BŁĄD] Brak wyników: {results_path}")
            print("       Uruchom najpierw: python run_backtest.py analyze")
            sys.exit(1)
        with open(results_path) as f:
            results = json.load(f)

    report = generate_report(results, tx_file)
    path = save_report(report)
    print(f"\n{'=' * 60}")
    print(f"RAPORT GOTOWY: {path}")
    print(f"{'=' * 60}")
    return path


def main():
    parser = argparse.ArgumentParser(
        description="StockPulse Backtest — Insider Trading Patterns"
    )
    parser.add_argument(
        "stage", nargs="?", default="all",
        choices=["all", "fetch", "analyze", "report"],
        help="Etap do uruchomienia (domyślnie: all)"
    )
    parser.add_argument(
        "--force", action="store_true",
        help="Wymuś ponowne pobranie danych (ignoruj cache)"
    )
    args = parser.parse_args()

    print(f"\n{'=' * 60}")
    print("StockPulse Backtest — Insider Trading Patterns")
    print(f"{'=' * 60}\n")

    if args.stage in ("all", "fetch"):
        tx_file, prices = stage_fetch(force=args.force)
    else:
        tx_file = TRANSACTIONS_FILE
        prices = None

    if args.stage in ("all", "analyze"):
        results = stage_analyze(tx_file, prices)
    else:
        results = None

    if args.stage in ("all", "report"):
        stage_report(results, tx_file)


if __name__ == "__main__":
    main()
