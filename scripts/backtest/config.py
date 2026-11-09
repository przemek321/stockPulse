"""
Konfiguracja backtesta insider trading patterns.
Tickery healthcare (42) + control group large-cap (25).
Zakres: 3 lata wstecz (kwiecień 2023 – kwiecień 2026).
"""

import os
from datetime import date

# --- Zakres czasowy ---
# BT_END_DATE (ISO) nadpisuje koniec zakresu bez zmiany domyślnego (Sprint 15) — 08.11.2026 dla backtestu
# horyzontów 30/60/90d (scripts/backtest/horizon_backtest.py), który potrzebuje Form 4 do listopada 2026.
# BT_START_DATE — teczka HORYZONT-FORWARD (08.11.2026): okno pobierania dla pomiaru w przód (domyślnie bez zmian).
START_DATE = date.fromisoformat(os.environ.get("BT_START_DATE", "2023-04-01"))
END_DATE = date.fromisoformat(os.environ.get("BT_END_DATE", "2026-04-05"))

# --- SEC EDGAR ---
SEC_USER_AGENT = "StockPulse Backtest research@stockpulse.local"
SEC_BASE_URL = "https://data.sec.gov"
# BT_SEC_RATE_LIMIT — na malinie (IP produkcji, limit SEC 10 req/s współdzielony z kolektorami) używać ≥ 0.5
SEC_RATE_LIMIT = float(os.environ.get("BT_SEC_RATE_LIMIT", "0.12"))  # ~8 req/sec (bezpieczny margines pod limit 10/s)

# --- Horyzonty cenowe (dni handlowe) ---
HORIZONS = {
    "1d": 1,
    "3d": 3,
    "7d": 5,     # 5 trading days ≈ 7 calendar days
    "30d": 21,   # 21 trading days ≈ 30 calendar days
}

# --- Progi hipotez ---
CLUSTER_WINDOW_DAYS = 7       # H1: okno klastra insiderów
CLUSTER_MIN_INSIDERS = 2      # H1: minimum insiderów w klastrze
VALUE_THRESHOLDS = [100_000, 500_000, 1_000_000]  # H2: progi wartości transakcji

# --- C-suite regex (spójny z Form4Pipeline) ---
CSUITE_TITLES = [
    "CEO", "CFO", "COO", "CMO", "CTO", "CIO", "CLO",
    "President", "Chairman", "Vice Chairman",
    "EVP", "Executive Vice President",
    "Chief Executive", "Chief Financial", "Chief Operating",
    "Chief Medical", "Chief Technology", "Chief Legal",
    "Chief Commercial", "Chief Scientific",
]

# --- Tickery healthcare (42 — z healthcare-universe.json) ---
# V2 (10.04.2026): zawężone do 28-tickerowego overlap między backtest a production
# Usunięto: ABC, ACCD, AZN, CAH, INSP, IRTC, JNJ, MCK, MRK, NVO, PFE, RPRX, SNY, SWAV
# Powód: production nie monitoruje tych tickerów (P0.5 fix)
HEALTHCARE_TICKERS = [
    # Managed Care (insurance SIC 6324 — wciąż monitorowane w production)
    "UNH", "ELV", "HUM", "CNC", "MOH", "CI",
    # Hospitals & Facilities
    "HCA", "THC", "UHS", "ENSG", "SEM",
    # Health Tech / Services
    "HIMS", "TDOC", "DOCS", "OSCR", "GDRX",
    # Med Devices / Robotics
    "ISRG", "DXCM", "PODD",
    # Pharma / Biotech
    "ABBV", "BMY", "GILD", "MRNA", "REGN", "VRTX",
    "BIIB", "AMGN", "LLY",
]

# --- Control group: large-cap non-healthcare (25) ---
CONTROL_TICKERS = [
    # Tech
    "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA",
    # Finance
    "JPM", "GS", "BAC", "MS", "WFC",
    # Consumer
    "WMT", "COST", "PG", "KO", "PEP", "MCD",
    # Energy
    "XOM", "CVX", "COP",
    # Industrial
    "CAT", "DE", "HON", "GE",
]

# --- Semi supply chain (14 — doc/stockpulse-semi-supply-chain.json; teczka SEKTOR-VS-SYGNAL 08.11.2026) ---
SEMI_TICKERS = [
    "MU", "WDC", "STX",                    # pamięć
    "KLIC", "ONTO", "CAMT", "NVMI",        # sprzęt
    "AMKR", "ASX",                         # packaging (OSAT)
    "DELL", "HPQ", "HPE", "SMCI", "NTAP",  # OEM
]

# BT_UNIVERSE=semi → fetcher pobiera TYLKO semi (osobny plik transakcji i osobna mapa CIK — nie rusza v6
# ani cik_map.json teczki HORYZONT). Domyślnie zachowanie bez zmian (healthcare + kontrola).
UNIVERSE = os.environ.get("BT_UNIVERSE", "default")
if UNIVERSE not in ("default", "semi"):
    raise ValueError(f"BT_UNIVERSE: nieznane uniwersum {UNIVERSE!r}")
ALL_TICKERS = SEMI_TICKERS if UNIVERSE == "semi" else HEALTHCARE_TICKERS + CONTROL_TICKERS

# --- Ścieżki danych ---
DATA_DIR = "data"
# BT_TX_FILE nadpisuje plik transakcji (08.11.2026: v6 z kolumnami form/table/issuer/acceptance — teczka HORYZONT)
TRANSACTIONS_FILE = os.environ.get(
    "BT_TX_FILE",
    f"{DATA_DIR}/form4_transactions_semi.csv" if UNIVERSE == "semi" else f"{DATA_DIR}/form4_transactions.csv")
SEMI_TRANSACTIONS_FILE = f"{DATA_DIR}/form4_transactions_semi.csv"
PRICES_DIR = f"{DATA_DIR}/prices"
CIK_CACHE_FILE_DEFAULT = f"{DATA_DIR}/cik_map.json"
CIK_CACHE_FILE_SEMI = f"{DATA_DIR}/cik_map_semi.json"
CIK_CACHE_FILE = CIK_CACHE_FILE_SEMI if UNIVERSE == "semi" else CIK_CACHE_FILE_DEFAULT
RESULTS_DIR = f"{DATA_DIR}/results"

# --- Kolumny transakcji CSV ---
TX_COLUMNS = [
    "symbol", "filing_date", "transaction_date", "insider_name",
    "insider_role", "officer_title", "is_officer", "is_director",
    "is_ten_pct_owner", "transaction_type", "shares", "price_per_share",
    "total_value", "shares_owned_after", "is_10b51_plan",
    "is_csuite", "is_healthcare", "accession_number",
    # 08.11.2026 (recenzja teczki HORYZONT): typ formularza (4 / 4/A), tabela (ND = non-derivative,
    # D = derivative), emitent z XML (odrzucanie filingów, w których spółka jest ownerem CUDZYCH akcji)
    # i godzina akceptacji EDGAR (wariant wejścia informacyjny).
    "form", "table", "issuer_cik", "issuer_symbol", "acceptance_datetime",
]
