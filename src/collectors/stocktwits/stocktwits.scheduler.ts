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
    // Sprint 11: StockTwits wyłączony — hit rate 55.7% = brak edge'u.
    // Kolektor generował 77% wolumenu (2362/2tyg) z zerową wartością predykcyjną.
    // Kod zachowany na wypadek ponownego włączenia.
    const existing = await this.queue.getRepeatableJobs();
    for (const job of existing) {
      await this.queue.removeRepeatableByKey(job.key);
    }
    this.logger.warn('StockTwits collector WYŁĄCZONY (Sprint 11 — brak edge)');
  }
}
