import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../../queues/queue-names.const';

/**
 * Scheduler cyklicznego zbierania danych z Finnhub.
 * Dodaje repeatable job do kolejki przy starcie modułu.
 */
@Injectable()
export class FinnhubScheduler implements OnModuleInit {
  private readonly logger = new Logger(FinnhubScheduler.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.FINNHUB)
    private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    const existing = await this.queue.getRepeatableJobs();
    for (const job of existing) {
      await this.queue.removeRepeatableByKey(job.key);
    }

    // Co 10 minut — Finnhub ma limit 60 req/min, 32 tickery × 2 endpointy = 64 req
    await this.queue.add(
      'collect-finnhub',
      {},
      {
        repeat: { every: 10 * 60 * 1000 }, // 10 minut
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 50 },
      },
    );

    this.logger.log('Zaplanowano zbieranie Finnhub co 10 minut');
  }
}
