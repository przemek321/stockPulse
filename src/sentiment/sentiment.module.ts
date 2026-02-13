import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../queues/queue-names.const';
import { SentimentScore } from '../entities/sentiment-score.entity';
import { RawMention } from '../entities/raw-mention.entity';
import { NewsArticle } from '../entities/news-article.entity';
import { FinbertClientService } from './finbert-client.service';
import { SentimentListenerService } from './sentiment-listener.service';
import { SentimentProcessorService } from './sentiment-processor.service';

/**
 * Moduł analizy sentymentu.
 *
 * Odpowiada za pipeline: event z kolektora → BullMQ → FinBERT sidecar → zapis do bazy.
 *
 * Serwisy:
 * - FinbertClientService — HTTP klient do FinBERT sidecar (Python FastAPI)
 * - SentimentListenerService — nasłuchuje eventów NEW_MENTION/NEW_ARTICLE
 * - SentimentProcessorService — BullMQ processor kolejki sentiment-analysis
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SentimentScore, RawMention, NewsArticle]),
    BullModule.registerQueue({ name: QUEUE_NAMES.SENTIMENT }),
  ],
  providers: [
    FinbertClientService,
    SentimentListenerService,
    SentimentProcessorService,
  ],
  exports: [FinbertClientService],
})
export class SentimentModule {}
