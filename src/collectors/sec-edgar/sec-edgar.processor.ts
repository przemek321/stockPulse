import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../../queues/queue-names.const';
import { SecEdgarService } from './sec-edgar.service';

/**
 * BullMQ processor dla kolejki SEC EDGAR.
 * Przetwarza joby zbierania filingów i insider trades.
 */
@Processor(QUEUE_NAMES.SEC_EDGAR)
export class SecEdgarProcessor extends WorkerHost {
  private readonly logger = new Logger(SecEdgarProcessor.name);

  constructor(private readonly secEdgarService: SecEdgarService) {
    super();
  }

  async process(job: Job): Promise<number> {
    this.logger.log(`Rozpoczynam cykl zbierania SEC EDGAR (job ${job.id})`);
    return this.secEdgarService.runCollectionCycle();
  }
}
