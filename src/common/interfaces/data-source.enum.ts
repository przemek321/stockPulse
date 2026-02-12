/**
 * Enum źródeł danych w systemie StockPulse.
 * Używany w encjach i kolektorach do identyfikacji pochodzenia danych.
 */
export enum DataSource {
  REDDIT = 'REDDIT',
  FINNHUB = 'FINNHUB',
  SEC_EDGAR = 'SEC_EDGAR',
  STOCKTWITS = 'STOCKTWITS',
}
