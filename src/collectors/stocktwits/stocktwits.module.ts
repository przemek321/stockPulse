import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { StocktwitsService } from './stocktwits.service';
import { StocktwitsProcessor } from './stocktwits.processor';
import { StocktwitsScheduler } from './stocktwits.scheduler';
import { RawMention, Ticker, CollectionLog } from '../../entities';
import { QUEUE_NAMES } from '../../queues/queue-names.const';

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
