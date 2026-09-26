import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  OptionsFlow,
  OptionsVolumeBaseline,
  Ticker,
  CollectionLog,
} from '../../entities';
import { QUEUE_NAMES } from '../../queues/queue-names.const';
import { OptionsFlowProcessor } from './options-flow.processor';
import { OptionsFlowScheduler } from './options-flow.scheduler';
import { OptionsFlowService } from './options-flow.service';

/**
 * Moduł kolektora options flow (Polygon.io Free Tier, EOD).
 * Wykrywa nietypową aktywność opcyjną (volume spike > 3× avg).
 * Wymaga POLYGON_API_KEY. Free tier: 5 req/min, EOD only.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      OptionsFlow,
      OptionsVolumeBaseline,
      Ticker,
      CollectionLog,
    ]),
    BullModule.registerQueue({ name: QUEUE_NAMES.OPTIONS_FLOW }),
  ],
  providers: [OptionsFlowService, OptionsFlowProcessor, OptionsFlowScheduler],
  exports: [OptionsFlowService],
})
export class OptionsFlowCollectorModule {}
