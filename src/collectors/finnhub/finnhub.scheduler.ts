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
    // Sprint 11: Finnhub news/MSPR wyłączony — HFT lag, brak edge'u.
    // Finnhub /quote zachowany dla Price Outcome Tracker (wywoływany bezpośrednio).
    // Kod schedulera zachowany na wypadek ponownego włączenia.
    const existing = await this.queue.getRepeatableJobs();
    for (const job of existing) {
      await this.queue.removeRepeatableByKey(job.key);
    }
    this.logger.warn('Finnhub collector WYŁĄCZONY (Sprint 11 — news/MSPR brak edge, /quote zachowany)');
  }
}
