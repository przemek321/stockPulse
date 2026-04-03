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
   * Sprint 11: Sentiment pipeline WYŁĄCZONY.
   * FinBERT na StockTwits = 55.7% hit rate (moneta).
   * GPT na Finnhub news = powtarzanie HFT.
   * System skupia się na insider pipeline + PDUFA + korelacji insider×options.
   *
   * Event handlery wyłączone — kolektory StockTwits i Finnhub news też zatrzymane.
   * Kod zachowany na wypadek ponownego włączenia.
   */

  // @OnEvent(EventType.NEW_MENTION) — WYŁĄCZONY Sprint 11
  async onNewMention(payload: {
    mentionId: number;
    symbol: string;
    source: DataSource;
  }): Promise<void> {
    // Sprint 11: nie dodajemy do kolejki sentymentu
    this.logger.debug(`Mention ${payload.symbol} z ${payload.source} — POMINIĘTY (Sprint 11)`);
  }

  // @OnEvent(EventType.NEW_ARTICLE) — WYŁĄCZONY Sprint 11
  async onNewArticle(payload: {
    articleId: number;
    symbol: string;
    source: DataSource;
  }): Promise<void> {
    // Sprint 11: nie dodajemy do kolejki sentymentu
    this.logger.debug(`Article ${payload.symbol} z ${payload.source} — POMINIĘTY (Sprint 11)`);
  }
}
