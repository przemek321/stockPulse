import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Klient HTTP do FinBERT sidecar (Python FastAPI).
 * Wysyła teksty do analizy sentymentu i zwraca wyniki.
 */
@Injectable()
export class FinbertClientService {
  private readonly logger = new Logger(FinbertClientService.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>(
      'FINBERT_SIDECAR_URL',
      'http://finbert:8000',
    );
    this.timeoutMs = this.config.get<number>(
      'FINBERT_REQUEST_TIMEOUT_MS',
      30000,
    );
  }

  /**
   * Analiza sentymentu pojedynczego tekstu.
   */
  async analyze(text: string): Promise<FinbertResult> {
    const response = await fetch(`${this.baseUrl}/api/sentiment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`FinBERT error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Batch analiza sentymentu (do BATCH_SIZE tekstów).
   */
  async analyzeBatch(texts: string[]): Promise<FinbertResult[]> {
    if (texts.length === 0) return [];

    const response = await fetch(`${this.baseUrl}/api/sentiment/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`FinBERT batch error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.results;
  }

  /**
   * Sprawdza czy sidecar jest dostępny i model załadowany.
   */
  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return false;
      const data = await response.json();
      return data.model_loaded === true;
    } catch {
      return false;
    }
  }
}

/** Wynik analizy sentymentu z FinBERT */
export interface FinbertResult {
  label: 'positive' | 'negative' | 'neutral';
  score: number;
  confidence: number;
  probabilities: Record<string, number>;
  processing_time_ms: number;
}
