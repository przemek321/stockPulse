import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Wynik wzbogaconej analizy z Azure OpenAI gpt-4o-mini */
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

/**
 * Klient do Azure Analysis Service (VM z gpt-4o-mini).
 * 2. etap pipeline: FinBERT (szybki bulk) → VM/LLM (niuansowa analiza).
 * Eskalacja następuje gdy FinBERT ma niską pewność lub niezdecydowany wynik.
 *
 * Wywołuje POST /analyze na Azure VM (processor.js).
 * Serwis jest opcjonalny — jeśli AZURE_ANALYSIS_URL nie jest ustawiony,
 * pipeline działa tylko z FinBERT (graceful degradation).
 */
@Injectable()
export class AzureOpenaiClientService {
  private readonly logger = new Logger(AzureOpenaiClientService.name);
  private readonly analysisUrl: string;
  private readonly enabled: boolean;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.analysisUrl = this.config.get<string>('AZURE_ANALYSIS_URL', '');
    this.timeoutMs = this.config.get<number>('AZURE_ANALYSIS_TIMEOUT_MS', 30000);

    if (this.analysisUrl) {
      this.enabled = true;
      this.logger.log(
        `Azure Analysis Service aktywny (${this.analysisUrl})`,
      );
    } else {
      this.enabled = false;
      this.logger.warn(
        'Azure Analysis Service nie skonfigurowany — pipeline działa tylko z FinBERT. ' +
          'Ustaw AZURE_ANALYSIS_URL w .env (np. http://74.248.113.3:3100) aby włączyć 2-etapowy pipeline.',
      );
    }
  }

  /** Czy serwis jest skonfigurowany i gotowy do użycia */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Wzbogacona analiza sentymentu pojedynczego tekstu.
   * Wywołuje POST /analyze na Azure VM.
   * Zwraca wielowymiarową analizę lub null jeśli błąd/niedostępność.
   */
  async analyze(
    text: string,
    symbol: string,
    escalationReason: string,
    pdufaContext?: string | null,
  ): Promise<EnrichedAnalysis | null> {
    if (!this.enabled) return null;

    try {
      const payload: Record<string, string> = {
        text,
        symbol,
        escalation_reason: escalationReason,
      };
      if (pdufaContext) {
        payload.pdufa_context = pdufaContext;
      }

      const response = await fetch(`${this.analysisUrl}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        this.logger.error(
          `Azure Analysis error: ${response.status} — ${error.error || response.statusText}`,
        );
        return null;
      }

      return await response.json();
    } catch (err) {
      this.logger.error(`Błąd Azure Analysis Service: ${err.message}`);
      return null;
    }
  }
}
