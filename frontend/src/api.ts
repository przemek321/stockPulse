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
  sector: string;
  priority: string;
  aliases: string[];
  keyMetrics: string[];
  ceo: string;
  cfo: string;
  notes: string;
  isActive: boolean;
  observationOnly: boolean;
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
  catalystType: string | null;
  delivered: boolean;
  sentAt: string;
}

/* ── Endpointy ──────────────────────────────── */

export const fetchHealth = () => get<HealthData>('/health');
export const fetchTickers = (sector?: string) =>
  get<{ count: number; tickers: Ticker[] }>(`/tickers${sector ? `?sector=${sector}` : ''}`);
export const fetchAlertRules = () => get<{ count: number; rules: AlertRule[] }>('/alerts/rules');
export const fetchAlerts = () => get<{ count: number; alerts: Alert[] }>('/alerts');

export interface SecFilingGpt {
  id: number;
  symbol: string;
  formType: string;
  filingDate: string;
  description: string;
  documentUrl: string;
  gptAnalysis: {
    conviction: number;
    summary: string;
    conclusion: string;
    key_facts: string[];
    price_impact: {
      direction: string;
      magnitude: string;
      confidence: number;
      time_horizon: string;
    };
    catalyst_type: string;
    requires_immediate_attention: boolean;
  };
  priceImpactDirection: string;
}

export const fetchFilingsGpt = (limit = 100) =>
  get<{ count: number; filings: SecFilingGpt[] }>(`/sentiment/filings-gpt?limit=${limit}`);

/* ── System Logs ──────────────────────────────── */

export interface SystemLog {
  id: number;
  createdAt: string;
  module: string;
  className: string;
  functionName: string;
  status: string;
  durationMs: number;
  input: Record<string, any> | null;
  output: Record<string, any> | null;
  errorMessage: string | null;
  // Tier 1 observability:
  traceId: string | null;
  parentTraceId: string | null;
  level: 'debug' | 'info' | 'warn' | 'error' | null;
  ticker: string | null;
  decisionReason: string | null;
}

export interface SystemLogFilters {
  module?: string;
  status?: string;
  level?: string;
  ticker?: string;
  limit?: number;
  offset?: number;
  dateFrom?: string;
  dateTo?: string;
}

/* ── System Stats (Jetson) ─────────────────── */

export interface SystemStats {
  available: boolean;
  temperature?: { zone: string; tempC: number }[];
  ram?: { totalMB: number; usedMB: number; percent: number };
  cpu?: { percent: number; cores: number };
  gpu?: { percent: number } | null;
}

export const fetchSystemStats = () => get<SystemStats>('/health/system-stats');

/* ── System Logs ──────────────────────────── */

export const fetchSystemLogs = (filters: SystemLogFilters = {}) => {
  const params = new URLSearchParams();
  if (filters.module) params.set('module', filters.module);
  if (filters.status) params.set('status', filters.status);
  if (filters.level) params.set('level', filters.level);
  if (filters.ticker) params.set('ticker', filters.ticker);
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.offset) params.set('offset', String(filters.offset));
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  const qs = params.toString();
  return get<{ count: number; total: number; logs: SystemLog[] }>(
    `/system-logs${qs ? `?${qs}` : ''}`,
  );
};

/* ── System Overview (status systemu) ── */

export interface CollectorHealth {
  source: string;
  status: 'OK' | 'WARNING' | 'CRITICAL';
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  lastSuccessAt: string | null;
  errorsLast24h: number;
  lastDurationMs: number | null;
  lastItemsCollected: number;
}

export interface SystemError {
  module: string;
  className: string;
  function: string;
  error: string;
  durationMs: number;
  at: string;
}

export interface SystemOverview {
  timestamp: string;
  overall: 'HEALTHY' | 'WARNING' | 'CRITICAL';
  collectors: {
    active: CollectorHealth[];
    disabled: string[];
  };
  systemErrors: SystemError[];
  alerts: {
    total7d: number;
    delivered7d: number;
    silent7d: number;
    tickers7d: number;
    last24h: number;
  } | null;
  failedJobs7d: number;
}

export const fetchSystemOverview = () => get<SystemOverview>('/health/system-overview');

/* ── Options Flow ────────────────────── */

export interface OptionsFlowData {
  id: number;
  symbol: string;
  occSymbol: string;
  optionType: string;
  strike: number;
  underlyingPrice: number;
  expiry: string;
  dte: number;
  dailyVolume: number;
  avgVolume20d: number;
  volumeSpikeRatio: number;
  isOtm: boolean;
  otmDistance: number;
  conviction: number;
  direction: string;
  pdufaBoosted: boolean;
  sessionDate: string;
  collectedAt: string;
}

export const fetchOptionsFlow = (limit = 100, symbol?: string) => {
  const params = new URLSearchParams({ limit: String(limit) });
  if (symbol) params.set('symbol', symbol);
  return get<{ data: OptionsFlowData[]; total: number; limit: number; quotes?: Record<string, number | null> }>(
    `/options-flow?${params}`,
  );
};

export const fetchOptionsFlowStats = () =>
  get<{ stats: { symbol: string; totalFlows: number; avgConviction: number; maxSpikeRatio: number; lastSession: string }[]; baselineRecords: number }>(
    '/options-flow/stats',
  );

/* ── Signal Timeline ────────────────────── */

export interface TimelineAlert {
  id: number;
  symbol: string;
  ruleName: string;
  priority: string;
  alertDirection: 'positive' | 'negative' | null;
  catalystType: string | null;
  message: string;
  priceAtAlert: number | null;
  price1h: number | null;
  price4h: number | null;
  price1d: number | null;
  price3d: number | null;
  conviction: number | null;
  sentAt: string;
  priceDeltaFromPrevPct: number | null;
  hoursSincePrev: number | null;
  sameDirectionAsPrev: boolean | null;
  directionCorrect1d: boolean | null;
}

export interface TimelineSummary {
  totalAlerts: number;
  avgHoursBetween: number | null;
  directionConsistency: number | null;
  hitRate1d: number | null;
  dominantDirection: 'positive' | 'negative' | 'mixed';
}

export interface TimelineResponse {
  symbol: string;
  alerts: TimelineAlert[];
  summary: TimelineSummary;
}

export interface TimelineSymbol {
  symbol: string;
  alertCount: number;
  lastAlert: string;
}

export const fetchTimeline = (symbol: string, days = 30, limit = 50) =>
  get<TimelineResponse>(`/alerts/timeline?symbol=${symbol}&days=${days}&limit=${limit}`);

export const fetchRecentTimeline = (days = 7, limit = 30) =>
  get<TimelineResponse>(`/alerts/timeline?days=${days}&limit=${limit}`);

export const fetchTimelineSymbols = (days = 30) =>
  get<{ symbols: TimelineSymbol[] }>(`/alerts/timeline/symbols?days=${days}`);

/* ── Price Outcome Tracker ──────────────── */

export interface AlertOutcome {
  id: number;
  symbol: string;
  ruleName: string;
  priority: string;
  alertDirection: string | null;
  catalystType: string | null;
  priceAtAlert: number;
  price1h: number | null;
  price4h: number | null;
  price1d: number | null;
  price3d: number | null;
  delta1h: number | null;
  delta4h: number | null;
  delta1d: number | null;
  delta3d: number | null;
  directionCorrect: boolean | null;
  priceOutcomeDone: boolean;
  sentAt: string;
}

export const fetchAlertOutcomes = (limit = 100, symbol?: string) => {
  const params = new URLSearchParams({ limit: String(limit) });
  if (symbol) params.set('symbol', symbol);
  return get<{ count: number; outcomes: AlertOutcome[] }>(
    `/alerts/outcomes?${params}`,
  );
};
