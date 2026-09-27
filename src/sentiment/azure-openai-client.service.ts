import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logged } from '../common/decorators/logged.decorator';
import { errMsg } from '../common/utils/error-message.util';
import {
  isEnrichedAnalysisPayload,
  readAzureErrorMessage,
  unwrapAzureCustomResult,
} from './azure-analysis-api.types';

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
  @Logged('sentiment')
  async analyze(
    text: string,
    symbol: string,
    escalationReason: string,
    pdufaContext?: string | null,
    source?: string,
  ): Promise<EnrichedAnalysis | null> {
    if (!this.enabled) return null;

    try {
      const payload: Record<string, string> = {
        text,
        symbol,
        escalation_reason: escalationReason,
      };
      if (pdufaContext !== undefined && pdufaContext !== null && pdufaContext !== '') {
        payload.pdufa_context = pdufaContext;
      }
      if (source !== undefined && source !== '') {
        payload.source = source;
      }

      const response = await fetch(`${this.analysisUrl}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        // Body błędu VM to `{ error: string }`; nie-JSON → `{}` → fallback na statusText.
        const errorBody: unknown = await response.json().catch((): unknown => ({}));
        this.logger.error(
          `Azure Analysis error: ${response.status} — ${readAzureErrorMessage(errorBody) ?? response.statusText}`,
        );
        return null;
      }

      const data: unknown = await response.json();
      if (!isEnrichedAnalysisPayload(data)) {
        this.logger.warn(
          `Azure Analysis: odpowiedź bez sentiment/conviction (${JSON.stringify(data).slice(0, 200)}) — pomijam`,
        );
        return null;
      }
      return data;
    } catch (err) {
      this.logger.error(`Błąd Azure Analysis Service: ${errMsg(err)}`);
      return null;
    }
  }

  /**
   * Wysyła custom prompt do Azure VM (endpoint /analyze/custom).
   * Używany przez SEC Filing GPT Pipeline do analizy filingów z per-typ promptami.
   * Graceful degradation: zwraca null gdy VM niedostępna lub endpoint nie istnieje.
   * Wynik to surowy JSON z VM (string z tekstem GPT albo obiekt) — kształt waliduje
   * Zod w pipeline'ach (`parseGptResponse`), dlatego typ zwracany to `unknown`.
   */
  async analyzeCustomPrompt(prompt: string): Promise<unknown> {
    if (!this.enabled) return null;

    try {
      const response = await fetch(`${this.analysisUrl}/analyze/custom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        if (response.status === 404) {
          this.logger.warn(
            'Azure VM nie wspiera /analyze/custom — pomijam analizę GPT. ' +
              'Dodaj endpoint w stock_pulse_azure/processor.js.',
          );
        } else {
          this.logger.error(
            `Azure /analyze/custom error: ${response.status} — ${response.statusText}`,
          );
        }
        return null;
      }

      const data: unknown = await response.json();
      return unwrapAzureCustomResult(data);
    } catch (err) {
      this.logger.error(`Błąd Azure /analyze/custom: ${errMsg(err)}`);
      return null;
    }
  }
}
