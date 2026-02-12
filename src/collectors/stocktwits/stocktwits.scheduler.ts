import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../../queues/queue-names.const';

/**
 * Scheduler cyklicznego zbierania danych ze StockTwits.
 * Dodaje powtarzający się job do kolejki przy starcie modułu.
 */
@Injectable()
export class StocktwitsScheduler implements OnModuleInit {
  private readonly logger = new Logger(StocktwitsScheduler.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.STOCKTWITS)
    private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    // Usuń poprzednie repeatable joby (żeby uniknąć duplikatów po restarcie)
    const existing = await this.queue.getRepeatableJobs();
    for (const job of existing) {
      await this.queue.removeRepeatableByKey(job.key);
    }

    // Dodaj nowy repeatable job — co 5 minut
    await this.queue.add(
      'collect-stocktwits',
      {},
      {
        repeat: { every: 5 * 60 * 1000 }, // 5 minut
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 50 },
      },
    );

    this.logger.log('Zaplanowano zbieranie StockTwits co 5 minut');
  }
}
