import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../queues/queue-names.const';
import { EventType } from '../events/event-types';
import { SentimentScore } from '../entities/sentiment-score.entity';
import { RawMention } from '../entities/raw-mention.entity';
import { NewsArticle } from '../entities/news-article.entity';
import { FinbertClientService, FinbertResult } from './finbert-client.service';
import {
  AzureOpenaiClientService,
  EnrichedAnalysis,
} from './azure-openai-client.service';
import { DataSource } from '../common/interfaces/data-source.enum';

/** Minimalna długość tekstu do analizy sentymentu (krótsze = szum) */
const MIN_TEXT_LENGTH = 20;

/** Progi eskalacji do LLM (2. etap pipeline) */
const LLM_ESCALATION_MIN_CONFIDENCE = 0.6;
const LLM_ESCALATION_MAX_ABS_SCORE = 0.3;

/** Dane jobu w kolejce sentiment-analysis */
interface SentimentJobData {
  type: 'mention' | 'article';
  entityId: number;
  symbol: string;
  source: DataSource;
}

/**
 * BullMQ processor dla kolejki sentiment-analysis.
 *
 * 2-etapowy pipeline:
 * 1. FinBERT sidecar — szybka analiza lokalna (GPU)
 * 2. Azure OpenAI gpt-4o-mini — eskalacja gdy FinBERT niepewny (confidence < 0.6 lub |score| < 0.3)
 *
 * Wynik zapisywany do sentiment_scores z opcjonalnym enrichedAnalysis (jsonb).
 */
@Processor(QUEUE_NAMES.SENTIMENT)
export class SentimentProcessorService extends WorkerHost {
  private readonly logger = new Logger(SentimentProcessorService.name);

  constructor(
    private readonly finbert: FinbertClientService,
    private readonly azureOpenai: AzureOpenaiClientService,
    @InjectRepository(SentimentScore)
    private readonly sentimentRepo: Repository<SentimentScore>,
    @InjectRepository(RawMention)
    private readonly mentionRepo: Repository<RawMention>,
    @InjectRepository(NewsArticle)
    private readonly articleRepo: Repository<NewsArticle>,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super();
  }

  async process(job: Job<SentimentJobData>): Promise<SentimentScore | null> {
    const { type, entityId, symbol, source } = job.data;

    this.logger.debug(
      `Analiza sentymentu: ${symbol} (${type} #${entityId})`,
    );

    // Pobierz tekst do analizy
    const textData = await this.extractText(type, entityId);
    if (!textData) {
      this.logger.warn(`Nie znaleziono ${type} #${entityId} — pomijam`);
      return null;
    }

    // Filtruj za krótkie teksty (sam ticker, emoji, "wow" itp.)
    if (textData.text.length < MIN_TEXT_LENGTH) {
      this.logger.debug(
        `Pomijam ${symbol} ${type} #${entityId} — za krótki tekst (${textData.text.length} znaków): "${textData.text}"`,
      );
      return null;
    }

    // 1. etap: FinBERT (szybka analiza lokalna)
    const result = await this.finbert.analyze(textData.text);

    // 2. etap: Eskalacja do LLM jeśli FinBERT niepewny
    let enrichedAnalysis: EnrichedAnalysis | null = null;
    let finalModel = 'finbert';

    const escalationReason = this.checkEscalation(result);
    if (escalationReason && this.azureOpenai.isEnabled()) {
      this.logger.debug(
        `Eskalacja do LLM: ${symbol} (${escalationReason}) — ` +
          `score=${result.score.toFixed(3)}, confidence=${result.confidence.toFixed(3)}`,
      );

      enrichedAnalysis = await this.azureOpenai.analyze(
        textData.text.substring(0, 500),
        symbol,
        escalationReason,
      );

      if (enrichedAnalysis) {
        finalModel = 'finbert+gpt-4o-mini';
        this.logger.debug(
          `LLM wynik ${symbol}: sentiment=${enrichedAnalysis.sentiment}, ` +
            `conviction=${enrichedAnalysis.conviction}, ` +
            `czas=${enrichedAnalysis.processing_time_ms}ms`,
        );
      }
    }

    // Zapisz wynik do sentiment_scores
    const sentimentScore = this.sentimentRepo.create({
      symbol,
      score: result.score,
      confidence: result.confidence,
      source,
      model: finalModel,
      rawText: textData.text.substring(0, 500),
      externalId: textData.externalId,
      enrichedAnalysis,
    });

    const saved = await this.sentimentRepo.save(sentimentScore);

    // Aktualizuj sentimentScore w NewsArticle (jeśli to artykuł)
    if (type === 'article') {
      await this.articleRepo.update(entityId, {
        sentimentScore: result.score,
      });
    }

    // Emituj event — AlertEvaluator i inne moduły mogą reagować
    this.eventEmitter.emit(EventType.SENTIMENT_SCORED, {
      scoreId: saved.id,
      symbol,
      score: result.score,
      confidence: result.confidence,
      label: result.label,
      source,
      model: finalModel,
      conviction: enrichedAnalysis?.conviction ?? null,
      enrichedAnalysis: enrichedAnalysis ?? null,
    });

    this.logger.debug(
      `Sentyment ${symbol}: ${result.score.toFixed(3)} ` +
        `(${result.label}, confidence: ${result.confidence.toFixed(3)}, model: ${finalModel})`,
    );

    return saved;
  }

  /**
   * Sprawdza czy wynik FinBERT wymaga eskalacji do LLM.
   * Zwraca powód eskalacji lub null jeśli nie trzeba.
   */
  private checkEscalation(result: FinbertResult): string | null {
    if (result.confidence < LLM_ESCALATION_MIN_CONFIDENCE) {
      return `low_confidence (${result.confidence.toFixed(3)})`;
    }
    if (Math.abs(result.score) < LLM_ESCALATION_MAX_ABS_SCORE) {
      return `undecided_score (${result.score.toFixed(3)})`;
    }
    return null;
  }

  /**
   * Wyciąga tekst do analizy z RawMention lub NewsArticle.
   */
  private async extractText(
    type: 'mention' | 'article',
    entityId: number,
  ): Promise<{ text: string; externalId: string } | null> {
    if (type === 'mention') {
      const mention = await this.mentionRepo.findOne({
        where: { id: entityId },
      });
      if (!mention) return null;

      // Łączymy tytuł i body — tytuł często zawiera więcej kontekstu
      const text = [mention.title, mention.body]
        .filter(Boolean)
        .join('. ')
        .trim();

      return { text, externalId: mention.externalId };
    }

    if (type === 'article') {
      const article = await this.articleRepo.findOne({
        where: { id: entityId },
      });
      if (!article) return null;

      // Headline + summary dają pełny kontekst
      const text = [article.headline, article.summary]
        .filter(Boolean)
        .join('. ')
        .trim();

      return { text, externalId: article.url };
    }

    return null;
  }
}
