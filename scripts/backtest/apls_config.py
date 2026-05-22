"""
APLS-class universe expansion — backtest Faza 2 (2026-05-23).

6 viable tickers z Faza 1.A (doc/APLS-FAZA-1-RESULTS-2026-05-23.md):
  Tier 1 (strict PASS):   URGN, ARDX, MNKD, CRSP
  Tier 2 (stretch PASS):  AXSM (cap >$10B), RCKT (cap <$1B)

Hipotezy primary:
  H_APLS_ALL:     all discretionary BUY (replikuje V5 H5 all_buys d=+0.75)
  H_APLS_CSUITE:  C-suite BUY (replikuje V5 csuite_buys d=+0.92)
  H_APLS_TIER:    strict tier vs stretch tier (czy stretch zachowuje edge)

Decision gate (Faza 3 entry):
  d >= 0.5 raw + p<0.01:     idź seed observation 30d
  d 0.2-0.5:                  seed obs ALE konserwatywny threshold $200K + C-suite only
  d <0.2:                     drop expansion empirically
"""
from __future__ import annotations

from datetime import date

# --- Zakres czasowy (trailing 24 mies., szerzej niż V5 dla większego N) ---
START_DATE = date(2024, 5, 1)
END_DATE = date(2026, 5, 1)

# --- SEC EDGAR ---
SEC_USER_AGENT = "StockPulse APLS-backtest przemyslaw.klosowski@outlook.com"
SEC_BASE_URL = "https://data.sec.gov"
SEC_RATE_LIMIT = 0.12  # ~8 req/sec

# --- Horyzonty cenowe (trading days) ---
HORIZONS = {
    "1d": 1,
    "3d": 3,
    "7d": 5,
    "30d": 21,
}

# --- Progi ---
VALUE_THRESHOLDS = [100_000, 500_000, 1_000_000]
CSUITE_TITLES = [
    "CEO", "CFO", "COO", "CMO", "CTO", "CIO", "CLO",
    "President", "Chairman", "Vice Chairman",
    "EVP", "Executive Vice President",
    "Chief Executive", "Chief Financial", "Chief Operating",
    "Chief Medical", "Chief Technology", "Chief Legal",
    "Chief Commercial", "Chief Scientific",
]

# --- APLS-class tickers (6 viable z Faza 1.A) ---
TIER_STRICT = ["URGN", "ARDX", "MNKD", "CRSP"]
TIER_STRETCH = ["AXSM", "RCKT"]
ALL_TICKERS = TIER_STRICT + TIER_STRETCH

# --- Ścieżki ---
DATA_DIR = "data/apls"
TRANSACTIONS_FILE = f"{DATA_DIR}/form4_transactions.csv"
PRICES_DIR = f"{DATA_DIR}/prices"
CIK_CACHE_FILE = f"{DATA_DIR}/cik_map.json"
RESULTS_DIR = f"{DATA_DIR}/results"

TX_COLUMNS = [
    "symbol", "filing_date", "transaction_date", "insider_name",
    "insider_role", "officer_title", "is_officer", "is_director",
    "is_ten_pct_owner", "transaction_type", "shares", "price_per_share",
    "total_value", "shares_owned_after", "is_10b51_plan",
    "is_csuite", "is_healthcare", "tier", "accession_number",
]
