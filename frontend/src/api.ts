/** Pomocnicze funkcje do komunikacji z backendem StockPulse */

const BASE = '/api';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

/* ── Typy ────────────────────────────────────── */

export interface HealthData {
  status: string;
  timestamp: string;
  telegram: { configured: boolean };
  collectors: CollectorInfo[];
}

export interface CollectorInfo {
  source: string;
  isHealthy: boolean;
  lastCollectionAt: string | null;
  itemsCollected: number;
}

export interface Ticker {
  id: number;
  symbol: string;
  name: string;
  cik: string;
  subsector: string;
  priority: string;
  aliases: string[];
  keyMetrics: string[];
  ceo: string;
  cfo: string;
  notes: string;
  isActive: boolean;
}

export interface NewsArticle {
  id: number;
  symbol: string;
  headline: string;
  source: string;
  url: string;
  summary: string;
  publishedAt: string;
}

export interface AlertRule {
  id: number;
  name: string;
  condition: string;
  priority: string;
  throttleMinutes: number;
  isActive: boolean;
}

export interface Alert {
  id: number;
  symbol: string;
  ruleName: string;
  priority: string;
  channel: string;
  message: string;
  delivered: boolean;
  sentAt: string;
}

/* ── Endpointy ──────────────────────────────── */

export const fetchHealth = () => get<HealthData>('/health');
export const fetchTickers = () => get<{ count: number; tickers: Ticker[] }>('/tickers');
export const fetchAlertRules = () => get<{ count: number; rules: AlertRule[] }>('/alerts/rules');
export const fetchAlerts = () => get<{ count: number; alerts: Alert[] }>('/alerts');
