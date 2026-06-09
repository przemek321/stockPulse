import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../../queues/queue-names.const';

/**
 * Scheduler discovery Form 4 (Pakiet 2, 10.06.2026).
 *
 * POLL co 5 min: atom getcurrent ma cap 100 wpisów (50 filingów po dedup
 * Issuer+Reporting) i niedziałającą paginację — przy szczycie 16-19 ET
 * (~68% Form 4 wpada po sesji) okno 5 min jest konieczne, żeby nie gubić
 * burstów. Godziny 06-22 ET pokrywają cały dzień akceptacji filingów EDGAR.
 * Poza godzinami: zero pollingu (EDGAR nie przyjmuje filingów w nocy/weekend);
 * residua łapie nightly reconciliation.
 *
 * RECONCILE 22:40 ET: daily-index form.YYYYMMDD.idx kompletny po zamknięciu
 * akceptacji EDGAR (22:00 ET) — łapie wszystko, co przelało się ponad cap 100.
 *
 * DST-aware przez IANA tz (wzorzec options-flow ze Scheduler consolidation).
 */
@Injectable()
export class Form4DiscoveryScheduler implements OnModuleInit {
  private readonly logger = new Logger(Form4DiscoveryScheduler.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.FORM4_DISCOVERY)
    private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    // Usuń stare repeatable joby (deterministyczny stan po restarcie)
    const existing = await this.queue.getRepeatableJobs();
    for (const job of existing) {
      await this.queue.removeRepeatableByKey(job.key);
    }

    // Offset +2 min ('2-57/5' zamiast '*/5'): sloty :05/:35 należą do core
    // sec-edgar collectora (Scheduler consolidation de11193, 5-min stagger) —
    // pełne nałożenie dwóch kolektorów SEC z tego samego IP dawałoby 9-11 req/s
    // przy limicie SEC 10 req/s (weryfikacja adwersarialna 10.06.2026).
    await this.queue.add(
      'poll',
      {},
      {
        repeat: { pattern: '2-57/5 6-22 * * 1-5', tz: 'America/New_York' },
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 50 },
      },
    );

    await this.queue.add(
      'reconcile',
      {},
      {
        repeat: { pattern: '40 22 * * 1-5', tz: 'America/New_York' },
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 20 },
      },
    );

    this.logger.log(
      'Discovery Form 4 zaplanowany: poll 2-57/5 6-22 ET pon-pt (stagger vs core :05/:35) + reconcile 22:40 ET (Pakiet 2)',
    );
  }
}
