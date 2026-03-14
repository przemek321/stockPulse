import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../../queues/queue-names.const';
import { FinnhubService } from './finnhub.service';

/**
 * BullMQ processor dla kolejki Finnhub.
 * Przetwarza joby zbierania newsów i danych insiderów.
 */
@Processor(QUEUE_NAMES.FINNHUB)
export class FinnhubProcessor extends WorkerHost {
  private readonly logger = new Logger(FinnhubProcessor.name);

  constructor(private readonly finnhubService: FinnhubService) {
    super();
  }

  async process(job: Job): Promise<{ collector: string; count: number }> {
    this.logger.log(`Rozpoczynam cykl zbierania Finnhub (job ${job.id})`);
    return this.finnhubService.runCollectionCycle();
  }
}
