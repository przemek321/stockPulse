"""
Pobieranie historycznych cen z yfinance.
Cache na dysk per ticker (CSV), nie pobiera ponownie.
"""
from __future__ import annotations

import os
from datetime import timedelta

import pandas as pd
import yfinance as yf

from config import ALL_TICKERS, END_DATE, PRICES_DIR, START_DATE


def _price_file(symbol: str) -> str:
    return os.path.join(PRICES_DIR, f"{symbol}.csv")


def _read_prices_csv(path: str) -> pd.DataFrame:
    """Wczytuje CSV z cenami, normalizuje index do naive datetime (bez timezone)."""
    df = pd.read_csv(path, index_col=0)
    # Konwersja indeksu: strip timezone, wymuś DatetimeIndex
    df.index = pd.to_datetime(df.index, utc=True).tz_localize(None)
    return df


def fetch_prices_for_ticker(symbol: str, force: bool = False) -> pd.DataFrame:
    """Pobiera dzienne OHLC dla jednego tickera. Cache lokalny."""
    path = _price_file(symbol)
    if os.path.exists(path) and not force:
        return _read_prices_csv(path)

    # Margines +60 dni na horyzonty (30d od ostatniej transakcji)
    start = START_DATE - timedelta(days=10)
    end = END_DATE + timedelta(days=60)

    try:
        ticker = yf.Ticker(symbol)
        df = ticker.history(start=start.isoformat(), end=end.isoformat(),
                           auto_adjust=True)
        if df.empty:
            print(f"  [WARN] {symbol}: brak danych cenowych z yfinance")
            return pd.DataFrame()

        # Zostawiamy tylko Close (adjusted) — wystarczy do backtesta
        df = df[["Close"]].copy()
        df.index.name = "Date"
        df.to_csv(path)
        return df

    except Exception as e:
        print(f"  [WARN] {symbol}: błąd yfinance — {e}")
        return pd.DataFrame()


def fetch_all_prices(force: bool = False) -> dict[str, pd.DataFrame]:
    """Pobiera ceny dla wszystkich tickerów. Zwraca {symbol: DataFrame}."""
    os.makedirs(PRICES_DIR, exist_ok=True)

    prices = {}
    cached = 0
    fetched = 0

    for i, symbol in enumerate(ALL_TICKERS):
        path = _price_file(symbol)
        if os.path.exists(path) and not force:
            prices[symbol] = _read_prices_csv(path)
            cached += 1
        else:
            print(f"[PRICES] [{i+1}/{len(ALL_TICKERS)}] {symbol}...", end=" ", flush=True)
            df = fetch_prices_for_ticker(symbol, force)
            if not df.empty:
                prices[symbol] = df
                fetched += 1
                print(f"{len(df)} dni")
            else:
                print("brak danych")

    print(f"[PRICES] GOTOWE: {len(prices)} tickerów "
          f"({cached} z cache, {fetched} pobranych)")
    return prices


def get_price_at_date(prices_df: pd.DataFrame, target_date: pd.Timestamp,
                      offset_days: int = 0) -> float | None:
    """
    Zwraca cenę zamknięcia w najbliższy dzień handlowy ≥ target_date + offset.
    offset_days to dni HANDLOWE (nie kalendarzowe).
    """
    if prices_df.empty:
        return None

    # Znajdź indeks target_date w dniach handlowych
    trading_days = prices_df.index

    # Znajdź pierwszy dzień handlowy >= target_date
    mask = trading_days >= target_date
    if not mask.any():
        return None

    start_idx = mask.argmax()  # pierwszy True
    target_idx = start_idx + offset_days

    if target_idx >= len(trading_days):
        return None

    return prices_df.iloc[target_idx]["Close"]


if __name__ == "__main__":
    fetch_all_prices()
