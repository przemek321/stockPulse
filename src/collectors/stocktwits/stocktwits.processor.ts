import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../../queues/queue-names.const';
import { StocktwitsService } from './stocktwits.service';

/**
 * BullMQ processor dla kolejki StockTwits.
 * Przetwarza joby zbierania wzmianek.
 */
@Processor(QUEUE_NAMES.STOCKTWITS)
export class StocktwitsProcessor extends WorkerHost {
  private readonly logger = new Logger(StocktwitsProcessor.name);

  constructor(private readonly stocktwitsService: StocktwitsService) {
    super();
  }

  async process(job: Job): Promise<number> {
    this.logger.log(`Rozpoczynam cykl zbierania StockTwits (job ${job.id})`);
    return this.stocktwitsService.runCollectionCycle();
  }
}
