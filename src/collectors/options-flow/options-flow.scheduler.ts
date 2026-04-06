import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { QUEUE_NAMES } from '../../queues/queue-names.const';

/**
 * Scheduler dla kolektora options flow (Polygon.io EOD).
 *
 * CRON: 20:30 UTC (22:30 CEST) — po zamknięciu NYSE (20:00 UTC) + 30 min bufor.
 * Tylko pon-pt (dni handlowe).
 * Bez POLYGON_API_KEY scheduler nie startuje.
 */
@Injectable()
export class OptionsFlowScheduler implements OnModuleInit {
  private readonly logger = new Logger(OptionsFlowScheduler.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.OPTIONS_FLOW)
    private readonly queue: Queue,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const apiKey = this.config.get<string>('POLYGON_API_KEY', '');
    if (!apiKey) {
      this.logger.warn(
        'Brak POLYGON_API_KEY — scheduler options-flow nieaktywny',
      );
      return;
    }

    // Usuń stare repeatable joby
    const existing = await this.queue.getRepeatableJobs();
    for (const job of existing) {
      await this.queue.removeRepeatableByKey(job.key);
    }

    // CRON: 20:30 UTC (22:30 CEST / 22:30 polskiego), pon-pt
    // NYSE zamyka 22:00 polskiego (20:00 UTC), +30 min bufor na EOD dane Polygon
    await this.queue.add(
      'collect-options-flow',
      {},
      {
        repeat: { pattern: '30 20 * * 1-5', tz: 'UTC' },
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 50 },
      },
    );

    this.logger.log(
      'Zaplanowano zbieranie options flow: CRON 20:30 UTC / 22:30 CEST (pon-pt, 30 min po zamknięciu NYSE)',
    );
  }
}
