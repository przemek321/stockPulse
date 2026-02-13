import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { OnEvent } from '@nestjs/event-emitter';
import { EventType } from '../events/event-types';
import { QUEUE_NAMES } from '../queues/queue-names.const';
import { DataSource } from '../common/interfaces/data-source.enum';

/**
 * Nasłuchuje eventów z kolektorów i dodaje joby do kolejki sentiment-analysis.
 * Każda nowa wzmianka lub artykuł trafia do FinBERT do analizy sentymentu.
 */
@Injectable()
export class SentimentListenerService {
  private readonly logger = new Logger(SentimentListenerService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.SENTIMENT)
    private readonly sentimentQueue: Queue,
  ) {}

  /**
   * Nowa wzmianka z Reddit/StockTwits → kolejka sentymentu.
   * Dla każdego wykrytego tickera tworzymy osobny job.
   */
  @OnEvent(EventType.NEW_MENTION)
  async onNewMention(payload: {
    mentionId: number;
    symbol: string;
    source: DataSource;
  }): Promise<void> {
    this.logger.debug(
      `Nowa wzmianka: ${payload.symbol} z ${payload.source} (mention #${payload.mentionId})`,
    );

    await this.sentimentQueue.add(
      'analyze-mention',
      {
        type: 'mention',
        entityId: payload.mentionId,
        symbol: payload.symbol,
        source: payload.source,
      },
      {
        // Reddit/StockTwits = wyższy priorytet (real-time social sentiment)
        priority: payload.source === DataSource.REDDIT ? 5 : 10,
        // Drobny delay — pewność że encja jest zapisana w bazie
        delay: 500,
      },
    );
  }

  /**
   * Nowy artykuł z Finnhub → kolejka sentymentu.
   */
  @OnEvent(EventType.NEW_ARTICLE)
  async onNewArticle(payload: {
    articleId: number;
    symbol: string;
    source: DataSource;
  }): Promise<void> {
    this.logger.debug(
      `Nowy artykuł: ${payload.symbol} z ${payload.source} (article #${payload.articleId})`,
    );

    await this.sentimentQueue.add(
      'analyze-article',
      {
        type: 'article',
        entityId: payload.articleId,
        symbol: payload.symbol,
        source: payload.source,
      },
      {
        // Artykuły news mają wyższy priorytet (ważniejsze źródło)
        priority: 3,
        delay: 500,
      },
    );
  }
}
