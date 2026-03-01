import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../../queues/queue-names.const';
import { PdufaBioService } from './pdufa-bio.service';

/**
 * BullMQ processor dla kolejki PDUFA.bio.
 * Przetwarza joby scrapingu kalendarza PDUFA.
 */
@Processor(QUEUE_NAMES.PDUFA_BIO)
export class PdufaBioProcessor extends WorkerHost {
  private readonly logger = new Logger(PdufaBioProcessor.name);

  constructor(private readonly pdufaBioService: PdufaBioService) {
    super();
  }

  async process(job: Job): Promise<number> {
    this.logger.log(`Rozpoczynam scraping PDUFA.bio (job ${job.id})`);
    return this.pdufaBioService.runCollectionCycle();
  }
}
