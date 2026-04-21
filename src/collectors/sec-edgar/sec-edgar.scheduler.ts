import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../../queues/queue-names.const';

/**
 * Scheduler cyklicznego zbierania danych z SEC EDGAR.
 * Filingi aktualizują się rzadziej — wystarczy co 30 minut.
 */
@Injectable()
export class SecEdgarScheduler implements OnModuleInit {
  private readonly logger = new Logger(SecEdgarScheduler.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.SEC_EDGAR)
    private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    const existing = await this.queue.getRepeatableJobs();
    for (const job of existing) {
      await this.queue.removeRepeatableByKey(job.key);
    }

    // Co 30 minut — filingi nie zmieniają się tak często.
    // Cron pattern zamiast `every: ms` dla deterministycznego timingu (nie dryfuje od restartu).
    await this.queue.add(
      'collect-sec-edgar',
      {},
      {
        repeat: { pattern: '0,30 * * * *', tz: 'UTC' },
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 50 },
      },
    );

    this.logger.log('Zaplanowano zbieranie SEC EDGAR: CRON 0,30 * * * * UTC (co 30 min)');
  }
}
