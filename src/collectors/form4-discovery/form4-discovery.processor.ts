import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../../queues/queue-names.const';
import { Form4DiscoveryService } from './form4-discovery.service';

/**
 * BullMQ processor kolejki form4-discovery (Pakiet 2).
 * Dwa joby: 'poll' (atom getcurrent co 5 min) i 'reconcile' (nightly daily-index).
 */
@Processor(QUEUE_NAMES.FORM4_DISCOVERY)
export class Form4DiscoveryProcessor extends WorkerHost {
  private readonly logger = new Logger(Form4DiscoveryProcessor.name);

  constructor(private readonly discovery: Form4DiscoveryService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === 'reconcile') {
      this.logger.log(`Discovery reconciliation start (job ${job.id})`);
      return this.discovery.runReconciliation();
    }
    return this.discovery.runDiscoveryCycle();
  }
}
