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

    // CRON: 16:30 America/New_York (30 min po zamknięciu NYSE 16:00 ET), pon-pt
    // Użycie IANA timezone zamiast hardcoded UTC — automatycznie obsługuje DST
    // (20:30 UTC w EDT / 21:30 UTC w EST)
    await this.queue.add(
      'collect-options-flow',
      {},
      {
        repeat: { pattern: '30 16 * * 1-5', tz: 'America/New_York' },
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 50 },
      },
    );

    this.logger.log(
      'Zaplanowano zbieranie options flow: CRON 16:30 America/New_York (pon-pt, 30 min po zamknięciu NYSE, DST-aware)',
    );
  }
}
