/**
 * Enum źródeł danych w systemie StockPulse.
 * Używany w encjach i kolektorach do identyfikacji pochodzenia danych.
 */
export enum DataSource {
  REDDIT = 'REDDIT',
  FINNHUB = 'FINNHUB',
  SEC_EDGAR = 'SEC_EDGAR',
  STOCKTWITS = 'STOCKTWITS',
  /** Kalendarz PDUFA z pdufa.bio (daty decyzji FDA) */
  PDUFA_BIO = 'PDUFA_BIO',
  /** Options flow z Polygon.io (EOD volume spike detection) */
  POLYGON = 'POLYGON',
}
