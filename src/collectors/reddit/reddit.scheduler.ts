import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { QUEUE_NAMES } from '../../queues/queue-names.const';

/**
 * Scheduler cyklicznego zbierania danych z Reddit.
 * Aktywuje się tylko jeśli kredencjale Reddit są skonfigurowane.
 */
@Injectable()
export class RedditScheduler implements OnModuleInit {
  private readonly logger = new Logger(RedditScheduler.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.REDDIT)
    private readonly queue: Queue,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Wyczyść stare joby
    const existing = await this.queue.getRepeatableJobs();
    for (const job of existing) {
      await this.queue.removeRepeatableByKey(job.key);
    }

    // Sprawdź czy Reddit jest skonfigurowany
    if (!this.config.get('REDDIT_CLIENT_ID')) {
      this.logger.warn(
        'Reddit API nie skonfigurowane — scheduler nieaktywny. Ustaw REDDIT_* w .env.',
      );
      return;
    }

    // Co 10 minut
    await this.queue.add(
      'collect-reddit',
      {},
      {
        repeat: { every: 10 * 60 * 1000 },
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 50 },
      },
    );

    this.logger.log('Zaplanowano zbieranie Reddit co 10 minut');
  }
}
