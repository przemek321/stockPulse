import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { FinnhubService } from './finnhub.service';
import { FinnhubProcessor } from './finnhub.processor';
import { FinnhubScheduler } from './finnhub.scheduler';
import { NewsArticle, InsiderTrade, Ticker, CollectionLog } from '../../entities';
import { QUEUE_NAMES } from '../../queues/queue-names.const';

/**
 * Moduł kolektora Finnhub.
 * Zbiera newsy spółek i dane insiderów.
 * Wymaga FINNHUB_API_KEY. Free tier: 60 req/min.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([NewsArticle, InsiderTrade, Ticker, CollectionLog]),
    BullModule.registerQueue({ name: QUEUE_NAMES.FINNHUB }),
  ],
  providers: [FinnhubService, FinnhubProcessor, FinnhubScheduler],
  exports: [FinnhubService],
})
export class FinnhubModule {}
