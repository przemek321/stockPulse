import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { SecEdgarService } from './sec-edgar.service';
import { SecEdgarProcessor } from './sec-edgar.processor';
import { SecEdgarScheduler } from './sec-edgar.scheduler';
import { SecFiling, InsiderTrade, Ticker, CollectionLog } from '../../entities';
import { QUEUE_NAMES } from '../../queues/queue-names.const';

/**
 * Moduł kolektora SEC EDGAR.
 * Zbiera filingi i dane insiderów. Darmowe API, wymaga User-Agent.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SecFiling, InsiderTrade, Ticker, CollectionLog]),
    BullModule.registerQueue({ name: QUEUE_NAMES.SEC_EDGAR }),
  ],
  providers: [SecEdgarService, SecEdgarProcessor, SecEdgarScheduler],
  exports: [SecEdgarService],
})
export class SecEdgarModule {}
