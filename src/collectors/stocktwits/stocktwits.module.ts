import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RawMention, Ticker, CollectionLog } from '../../entities';
import { QUEUE_NAMES } from '../../queues/queue-names.const';
import { StocktwitsProcessor } from './stocktwits.processor';
import { StocktwitsScheduler } from './stocktwits.scheduler';
import { StocktwitsService } from './stocktwits.service';

/**
 * Moduł kolektora StockTwits.
 * Publiczne API — bez autoryzacji, ~200 req/hour.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([RawMention, Ticker, CollectionLog]),
    BullModule.registerQueue({ name: QUEUE_NAMES.STOCKTWITS }),
  ],
  providers: [StocktwitsService, StocktwitsProcessor, StocktwitsScheduler],
  exports: [StocktwitsService],
})
export class StocktwitsModule {}
