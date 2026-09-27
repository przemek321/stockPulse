import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logged } from '../common/decorators/logged.decorator';
import { errMsg } from '../common/utils/error-message.util';
import { isEnrichedAnalysisPayload } from './anthropic-client.types';
import { EnrichedAnalysis } from './azure-openai-client.service';

/**
 * Klient Anthropic Claude do analizy SEC filingów i sentymentu.
 * Zastępuje AzureOpenaiClientService (gpt-4o-mini na Azure VM).
 *
 * Interfejs publiczny identyczny z AzureOpenaiClientService:
 * - isEnabled() — czy klucz API jest skonfigurowany
 * - analyze() — wzbogacona analiza sentymentu (Sprint 11: wyłączony)
 * - analyzeCustomPrompt() — custom prompt dla SEC Filing Pipeline
 *
 * Konfiguracja .env:
 * - ANTHROPIC_API_KEY — klucz API (wymagany)
 * - ANTHROPIC_MODEL — model (domyślnie claude-sonnet-4-6)
 * - ANTHROPIC_TIMEOUT_MS — timeout w ms (domyślnie 30000)
 */
@Injectable()
export class AnthropicClientService {
  private readonly logger = new Logger(AnthropicClientService.name);
  private readonly client: Anthropic | null;
  private readonly model: string;
  private readonly enabled: boolean;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY', '');
    this.model = this.config.get<string>('ANTHROPIC_MODEL', 'claude-sonnet-4-6');
    const timeoutMs = this.config.get<number>('ANTHROPIC_TIMEOUT_MS', 30000);

    if (apiKey) {
      this.client = new Anthropic({ apiKey, timeout: timeoutMs });
      this.enabled = true;
      this.logger.log(`Anthropic Claude aktywny (model: ${this.model})`);
    } else {
      this.client = null;
      this.enabled = false;
      this.logger.warn(
        'Anthropic API nie skonfigurowane — pipeline GPT wyłączony. ' +
          'Ustaw ANTHROPIC_API_KEY w .env aby włączyć analizę AI.',
      );
    }
  }

  /** Czy serwis jest skonfigurowany i gotowy do użycia */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Wysyła custom prompt do Claude i zwraca sparsowany JSON.
   * Używany przez Form4Pipeline i Form8kPipeline do analizy SEC filingów.
   * Prompty już zawierają instrukcję "Respond with JSON only" — Claude respektuje to.
   * Prefill asystenta "{" wymusza czysty JSON bez preambuły.
   *
   * Zwraca surowy wynik `JSON.parse` jako `unknown` (kształt zależy od promptu — pipeline'y
   * Form4/Form8k same go walidują) albo `null` przy braku klucza / nie-tekstowej
   * odpowiedzi / błędzie API lub parsowania.
   */
  async analyzeCustomPrompt(prompt: string): Promise<unknown> {
    if (!this.client) return null;

    try {
      const message = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        messages: [
          { role: 'user', content: prompt + '\n\nRespond with JSON only. No markdown, no preamble, no explanation.' },
        ],
      });

      const block = message.content[0];
      if (block.type !== 'text') {
        this.logger.warn('Anthropic: odpowiedź nie jest tekstem');
        return null;
      }

      // Wyczyść markdown wrapper gdyby Claude go dodał
      const cleaned = block.text
        .replace(/^```json?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      const parsed: unknown = JSON.parse(cleaned);
      return parsed;
    } catch (err) {
      this.logger.error(`Anthropic analyzeCustomPrompt error: ${errMsg(err)}`);
      return null;
    }
  }

  /**
   * Wzbogacona analiza sentymentu (kompatybilność z AzureOpenaiClientService).
   * Sprint 11: sentiment pipeline wyłączony — ta metoda nie jest aktywnie wywoływana.
   * Zachowana na wypadek reaktywacji pipeline'u.
   */
  @Logged('sentiment')
  async analyze(
    text: string,
    symbol: string,
    escalationReason: string,
    pdufaContext?: string | null,
    source?: string,
  ): Promise<EnrichedAnalysis | null> {
    if (!this.client) return null;

    try {
      const systemPrompt = [
        'You are a financial sentiment analyst specializing in healthcare stocks.',
        'Analyze the following text and return a JSON object with these fields:',
        'ticker, type, sentiment (BULLISH/BEARISH/NEUTRAL), urgency (HIGH/MEDIUM/LOW),',
        'summary (po polsku), relevance (0-1), novelty (0-1), confidence (0-1),',
        'source_authority (0-1), temporal_signal (immediate/short_term/medium_term),',
        'catalyst_type, price_impact_direction (positive/negative/neutral),',
        'price_impact_magnitude (low/medium/high), conviction (-2 to +2),',
        'escalation_reason.',
        '',
        `Symbol: ${symbol}`,
        `Source: ${source !== undefined && source !== '' ? source : 'unknown'}`,
        `Escalation reason: ${escalationReason}`,
        pdufaContext !== undefined && pdufaContext !== null && pdufaContext !== ''
          ? `PDUFA context: ${pdufaContext}`
          : '',
        '',
        'Respond with JSON only, no preamble or explanation.',
      ].filter(Boolean).join('\n');

      const message = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          { role: 'user', content: text },
        ],
      });

      const block = message.content[0];
      if (block.type !== 'text') return null;

      const cleaned = block.text
        .replace(/^```json?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      const result: unknown = JSON.parse(cleaned);
      if (!isEnrichedAnalysisPayload(result)) {
        this.logger.warn('Anthropic analyze: odpowiedź JSON nie jest obiektem');
        return null;
      }
      const enriched: EnrichedAnalysis = { ...result, processing_time_ms: 0 };
      return enriched;
    } catch (err) {
      this.logger.error(`Anthropic analyze error: ${errMsg(err)}`);
      return null;
    }
  }
}
