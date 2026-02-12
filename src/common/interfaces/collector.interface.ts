import { DataSource } from './data-source.enum';

/**
 * Interfejs bazowy dla każdego kolektora danych.
 * Każdy kolektor (Finnhub, Reddit, SEC EDGAR, StockTwits) go implementuje.
 */
export interface ICollector {
  /** Nazwa źródła danych */
  getSourceName(): DataSource;

  /** Uruchom cykl zbierania danych */
  collect(): Promise<number>;

  /** Status zdrowia kolektora (do /api/health) */
  getHealthStatus(): Promise<CollectorHealth>;
}

export interface CollectorHealth {
  source: DataSource;
  isHealthy: boolean;
  lastCollectionAt: Date | null;
  itemsCollected: number;
  errorMessage?: string;
}
