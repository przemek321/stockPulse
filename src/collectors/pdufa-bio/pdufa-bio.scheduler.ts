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
    // WYŁĄCZONY 21.06.2026: pdufa.bio przepisany na Next.js client-side render
    // (kalendarz /calendar bez <table> w statycznym HTML → scraper 404/PARSER_EMPTY).
    // Kolektor karmił TYLKO PDUFA boost options flow (wyłączone 10.06) + był obalony
    // jako sygnał (badanie 09.06: brak run-up przed decyzją FDA). Martwy → cleanup-only
    // (wzorzec StockTwits/Finnhub/Options). Kod/dane/entity/endpoint zostają — odwracalne
    // (przywróć add() z git history po ewentualnej naprawie scrapera).
    const existing = await this.queue.getRepeatableJobs();
    for (const job of existing) {
      await this.queue.removeRepeatableByKey(job.key);
    }
    await this.queue.drain(true); // czyść delayed/waiting (lekcja options: removeRepeatable nie tyka zmaterializowanych)

    this.logger.warn('PDUFA.bio collector WYŁĄCZONY (21.06.2026 — strona client-rendered, kolektor martwy: options off + sygnał obalony)');
  }
}
