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

    // Scraping strony co 6 godzin
    await this.queue.add(
      'collect-pdufa-bio',
      {},
      {
        repeat: { every: 6 * 60 * 60 * 1000 }, // 6 godzin
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 50 },
      },
    );

    // Natychmiastowy pierwszy run po starcie
    await this.queue.add('collect-pdufa-bio-init', {}, {
      removeOnComplete: { count: 1 },
      removeOnFail: { count: 5 },
    });

    this.logger.log('Zaplanowano scraping PDUFA.bio co 6 godzin (+ natychmiastowy start)');
  }
}
