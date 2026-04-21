import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../../queues/queue-names.const';

/**
 * Scheduler dla kolektora PDUFA.bio.
 * Scraping co 6 godzin — daty PDUFA zmieniają się rzadko.
 */
@Injectable()
export class PdufaBioScheduler implements OnModuleInit {
  private readonly logger = new Logger(PdufaBioScheduler.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.PDUFA_BIO)
    private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    // Usuń stare repeatable joby (zapobiega duplikatom po restarcie)
    const existing = await this.queue.getRepeatableJobs();
    for (const job of existing) {
      await this.queue.removeRepeatableByKey(job.key);
    }

    // Scraping strony co 6 godzin.
    // Cron pattern zamiast `every: ms` dla deterministycznego timingu (nie dryfuje od restartu).
    await this.queue.add(
      'collect-pdufa-bio',
      {},
      {
        repeat: { pattern: '15 */6 * * *', tz: 'UTC' },
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 50 },
      },
    );

    // Natychmiastowy pierwszy run po starcie
    await this.queue.add('collect-pdufa-bio-init', {}, {
      removeOnComplete: { count: 1 },
      removeOnFail: { count: 5 },
    });

    this.logger.log('Zaplanowano scraping PDUFA.bio: CRON 15 */6 * * * UTC (00:15/06:15/12:15/18:15, + natychmiastowy start)');
  }
}
