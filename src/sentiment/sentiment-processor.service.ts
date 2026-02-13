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
import { FinbertClientService } from './finbert-client.service';
import { DataSource } from '../common/interfaces/data-source.enum';

/** Dane jobu w kolejce sentiment-analysis */
interface SentimentJobData {
  type: 'mention' | 'article';
  entityId: number;
  symbol: string;
  source: DataSource;
}

/**
 * BullMQ processor dla kolejki sentiment-analysis.
 * Pobiera tekst z RawMention lub NewsArticle, wysyła do FinBERT sidecar,
 * zapisuje wynik do sentiment_scores i emituje event SENTIMENT_SCORED.
 */
@Processor(QUEUE_NAMES.SENTIMENT)
export class SentimentProcessorService extends WorkerHost {
  private readonly logger = new Logger(SentimentProcessorService.name);

  constructor(
    private readonly finbert: FinbertClientService,
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

    // Wyślij do FinBERT
    const result = await this.finbert.analyze(textData.text);

    // Zapisz wynik do sentiment_scores
    const sentimentScore = this.sentimentRepo.create({
      symbol,
      score: result.score,
      confidence: result.confidence,
      source,
      model: 'finbert',
      rawText: textData.text.substring(0, 500),
      externalId: textData.externalId,
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
      model: 'finbert',
    });

    this.logger.debug(
      `Sentyment ${symbol}: ${result.score.toFixed(3)} (${result.label}, confidence: ${result.confidence.toFixed(3)})`,
    );

    return saved;
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
