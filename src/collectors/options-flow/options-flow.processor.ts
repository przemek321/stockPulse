import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../../queues/queue-names.const';
import { OptionsFlowService } from './options-flow.service';

/**
 * BullMQ processor dla kolejki options-flow.
 * Przetwarza joby zbierania danych opcyjnych z Polygon.io.
 */
@Processor(QUEUE_NAMES.OPTIONS_FLOW)
export class OptionsFlowProcessor extends WorkerHost {
  private readonly logger = new Logger(OptionsFlowProcessor.name);

  constructor(private readonly optionsFlowService: OptionsFlowService) {
    super();
  }

  async process(job: Job): Promise<{ collector: string; count: number }> {
    this.logger.log(`Rozpoczynam cykl zbierania options flow (job ${job.id})`);
    return this.optionsFlowService.runCollectionCycle();
  }
}
