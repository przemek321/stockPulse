"""
Konfiguracja backtesta insider trading patterns.
Tickery healthcare (42) + control group large-cap (25).
Zakres: 3 lata wstecz (kwiecień 2023 – kwiecień 2026).
"""

from datetime import date

# --- Zakres czasowy ---
START_DATE = date(2023, 4, 1)
END_DATE = date(2026, 4, 5)

# --- SEC EDGAR ---
SEC_USER_AGENT = "StockPulse Backtest research@stockpulse.local"
SEC_BASE_URL = "https://data.sec.gov"
SEC_RATE_LIMIT = 0.12  # ~8 req/sec (bezpieczny margines pod limit 10/s)

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

ALL_TICKERS = HEALTHCARE_TICKERS + CONTROL_TICKERS

# --- Ścieżki danych ---
DATA_DIR = "data"
TRANSACTIONS_FILE = f"{DATA_DIR}/form4_transactions.csv"
PRICES_DIR = f"{DATA_DIR}/prices"
CIK_CACHE_FILE = f"{DATA_DIR}/cik_map.json"
RESULTS_DIR = f"{DATA_DIR}/results"

# --- Kolumny transakcji CSV ---
TX_COLUMNS = [
    "symbol", "filing_date", "transaction_date", "insider_name",
    "insider_role", "officer_title", "is_officer", "is_director",
    "is_ten_pct_owner", "transaction_type", "shares", "price_per_share",
    "total_value", "shares_owned_after", "is_10b51_plan",
    "is_csuite", "is_healthcare", "accession_number",
]
