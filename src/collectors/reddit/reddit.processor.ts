import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../../queues/queue-names.const';
import { RedditService } from './reddit.service';

/**
 * BullMQ processor dla kolejki Reddit.
 * Przetwarza joby zbierania wzmianek z subredditów.
 */
@Processor(QUEUE_NAMES.REDDIT)
export class RedditProcessor extends WorkerHost {
  private readonly logger = new Logger(RedditProcessor.name);

  constructor(private readonly redditService: RedditService) {
    super();
  }

  async process(job: Job): Promise<{ collector: string; count: number }> {
    this.logger.log(`Rozpoczynam cykl zbierania Reddit (job ${job.id})`);
    return this.redditService.runCollectionCycle();
  }
}
