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
  catalystType: string | null;
  delivered: boolean;
  sentAt: string;
}

export interface EnrichedAnalysis {
  ticker: string;
  type: string;
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  urgency: 'HIGH' | 'MEDIUM' | 'LOW';
  summary: string;
  relevance: number;
  novelty: number;
  confidence: number;
  source_authority: number;
  temporal_signal: 'immediate' | 'short_term' | 'medium_term';
  catalyst_type: string;
  price_impact_direction: 'positive' | 'negative' | 'neutral';
  price_impact_magnitude: 'low' | 'medium' | 'high';
  conviction: number;
  escalation_reason: string;
  processing_time_ms: number;
}

export interface SentimentScore {
  id: number;
  symbol: string;
  score: number;
  confidence: number;
  source: string;
  model: string;
  rawText: string;
  externalId: string;
  enrichedAnalysis: EnrichedAnalysis | null;
  gptConviction: number | null;
  effectiveScore: number | null;
  timestamp: string;
}

/* ── Endpointy ──────────────────────────────── */

export const fetchHealth = () => get<HealthData>('/health');
export const fetchTickers = () => get<{ count: number; tickers: Ticker[] }>('/tickers');
export const fetchAlertRules = () => get<{ count: number; rules: AlertRule[] }>('/alerts/rules');
export const fetchAlerts = () => get<{ count: number; alerts: Alert[] }>('/alerts');
export const fetchSentimentScores = (limit = 500) =>
  get<{ count: number; scores: SentimentScore[] }>(`/sentiment/scores?limit=${limit}`);

export const fetchAiScores = (limit = 200) =>
  get<{ count: number; scores: SentimentScore[] }>(`/sentiment/scores?limit=${limit}&ai_only=true`);

export interface AiPipelineLog {
  id: number;
  symbol: string;
  source: string;
  entityType: string;
  entityId: number;
  status: string;
  tier: number | null;
  tierReason: string | null;
  finbertScore: number | null;
  finbertConfidence: number | null;
  inputText: string | null;
  pdufaContext: string | null;
  requestPayload: Record<string, any> | null;
  responsePayload: Record<string, any> | null;
  finbertDurationMs: number | null;
  azureDurationMs: number | null;
  errorMessage: string | null;
  sentimentScoreId: number | null;
  createdAt: string;
}

export const fetchPipelineLogs = (limit = 200) =>
  get<{ count: number; logs: AiPipelineLog[] }>(`/sentiment/pipeline-logs?limit=${limit}`);

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
