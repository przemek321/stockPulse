/**
 * Nazwy kolejek BullMQ w systemie StockPulse.
 * Każdy kolektor ma swoją kolejkę + kolejka na analizę sentymentu i alerty.
 */
export const QUEUE_NAMES = {
  /** Zbieranie wzmianek ze StockTwits */
  STOCKTWITS: 'stocktwits-collector',

  /** Zbieranie newsów i danych z Finnhub */
  FINNHUB: 'finnhub-collector',

  /** Zbieranie filingów z SEC EDGAR */
  SEC_EDGAR: 'sec-edgar-collector',

  /** Zbieranie wzmianek z Reddit */
  REDDIT: 'reddit-collector',

  /** Analiza sentymentu (FinBERT + Claude) — Faza 2 */
  SENTIMENT: 'sentiment-analysis',

  /** Ewaluacja reguł alertów i wysyłka powiadomień */
  ALERTS: 'alert-processing',

  /** Scraping kalendarza PDUFA z pdufa.bio */
  PDUFA_BIO: 'pdufa-bio-collector',
} as const;

/** Typ z nazwami kolejek */
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** Lista wszystkich nazw kolejek (do rejestracji) */
export const ALL_QUEUE_NAMES = Object.values(QUEUE_NAMES);
