import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { BaseCollectorService } from '../shared/base-collector.service';
import { PdufaCatalyst, CollectionLog } from '../../entities';
import { DataSource } from '../../common/interfaces/data-source.enum';
import { EventType } from '../../events/event-types';
import { Logged } from '../../common/decorators/logged.decorator';
import { parsePdufaCalendarHtml } from './pdufa-parser';

/**
 * Kolektor danych PDUFA z pdufa.bio.
 * Scrapuje kalendarz dat decyzji FDA (PDUFA dates) ze strony HTML.
 * Częstotliwość: co 6 godzin (daty PDUFA zmieniają się rzadko).
 * Przechowuje WSZYSTKIE eventy — nie tylko te pasujące do naszych tickerów.
 *
 * Główna wartość: buildPdufaContext() zwraca tekst wstrzykiwany
 * do prompta GPT-4o-mini na Azure VM → AI lepiej ocenia relevance.
 */
@Injectable()
export class PdufaBioService extends BaseCollectorService {
  protected readonly logger = new Logger(PdufaBioService.name);

  constructor(
    @InjectRepository(CollectionLog)
    collectionLogRepo: Repository<CollectionLog>,
    @InjectRepository(PdufaCatalyst)
    private readonly pdufaRepo: Repository<PdufaCatalyst>,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super(collectionLogRepo);
  }

  getSourceName(): DataSource {
    return DataSource.PDUFA_BIO;
  }

  /**
   * Wrapper zachowujący kontrakt BaseCollectorService (Promise<number>)
   * dla getHealthStatus i innych bazowych metod. Rozszerzony wynik
   * (inserted + parsed) wyciągamy w runCollectionCycle przez scrapeAndInsert.
   */
  async collect(): Promise<number> {
    const { inserted } = await this.scrapeAndInsert();
    return inserted;
  }

  /**
   * Override BaseCollectorService.runCollectionCycle — dodaje `parsed` count
   * do output dla obserwacji parsera w system_logs. Gdy parsed===0, zwraca
   * action='PARSER_EMPTY' (level=warn) — sygnał że scraper nie widzi
   * żadnych wierszy (HTTP OK ale parser zwrócił 0).
   *
   * TASK-06 (23.04.2026): diagnostyka pokazała że count=0 jest legit gdy
   * dedup (parsed>0, inserted=0). Prawdziwy alarm to parsed=0.
   */
  @Logged('collectors')
  async runCollectionCycle(): Promise<{
    collector: string;
    count: number;
    parsed: number;
    action?: string;
  }> {
    const collector = this.getSourceName();
    const start = Date.now();
    try {
      const { inserted, parsed } = await this.scrapeAndInsert();
      await this.logCollection('SUCCESS', inserted, Date.now() - start);
      if (parsed === 0) {
        return { collector, count: inserted, parsed, action: 'PARSER_EMPTY' };
      }
      return { collector, count: inserted, parsed };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Błąd cyklu zbierania: ${msg}`);
      await this.logCollection('FAILED', 0, Date.now() - start, msg);
      throw error;
    }
  }

  /**
   * Scrapuje stronę pdufa.bio i zapisuje nowe eventy PDUFA.
   * Zwraca {inserted, parsed}:
   * - parsed = liczba wierszy zwróconych przez parser (zdrowie scrapera)
   * - inserted = liczba NOWYCH eventów (po dedup); istniejące tylko aktualizują scrapedAt
   */
  private async scrapeAndInsert(): Promise<{
    inserted: number;
    parsed: number;
  }> {
    const year = new Date().getFullYear();
    const url = `https://www.pdufa.bio/pdufa-calendar-${year}`;

    const html = await this.fetchPage(url);
    const parsed = parsePdufaCalendarHtml(html);

    if (parsed.length === 0) {
      this.logger.warn(
        'Brak eventów PDUFA w HTML — możliwa zmiana struktury strony',
      );
      return { inserted: 0, parsed: 0 };
    }

    this.logger.log(`Sparsowano ${parsed.length} eventów PDUFA z pdufa.bio`);

    let inserted = 0;

    for (const event of parsed) {
      // Deduplikacja: (ticker + drugName + pdufaDate) — UNIQUE constraint
      const exists = await this.pdufaRepo.findOne({
        where: {
          symbol: event.ticker,
          drugName: event.drugName,
          pdufaDate: new Date(event.date),
        },
      });

      if (exists) {
        // Zaktualizuj scrapedAt — wiemy że event nadal jest aktualny
        exists.scrapedAt = new Date();
        await this.pdufaRepo.save(exists);
        continue;
      }

      const pdufaEvent = this.pdufaRepo.create({
        symbol: event.ticker,
        drugName: event.drugName,
        indication: event.indication || undefined,
        therapeuticArea: event.therapeuticArea || undefined,
        pdufaDate: new Date(event.date),
        eventType: 'pdufa',
      });

      await this.pdufaRepo.save(pdufaEvent);
      inserted++;

      this.eventEmitter.emit(EventType.NEW_PDUFA_EVENT, {
        pdufaEventId: pdufaEvent.id,
        symbol: event.ticker,
        drugName: event.drugName,
        pdufaDate: event.date,
        indication: event.indication,
        therapeuticArea: event.therapeuticArea,
        traceId: randomUUID(),
      });

      this.logger.log(
        `Nowy PDUFA: ${event.ticker} — ${event.drugName} (${event.date})`,
      );
    }

    return { inserted, parsed: parsed.length };
  }

  /**
   * Nadchodzące katalizatory PDUFA dla konkretnego tickera.
   * Używane przez SentimentProcessorService do wstrzyknięcia kontekstu AI.
   */
  async getUpcomingCatalysts(
    symbol: string,
    daysAhead = 90,
  ): Promise<PdufaCatalyst[]> {
    const now = new Date();
    const limit = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

    return this.pdufaRepo
      .createQueryBuilder('p')
      .where('p.symbol = :symbol', { symbol })
      .andWhere('p.outcome IS NULL')
      .andWhere('p.pdufaDate >= :now', { now: now.toISOString().split('T')[0] })
      .andWhere('p.pdufaDate <= :limit', {
        limit: limit.toISOString().split('T')[0],
      })
      .orderBy('p.pdufaDate', 'ASC')
      .getMany();
  }

  /**
   * Wszystkie nadchodzące katalizatory PDUFA (pending) w oknie daysAhead.
   * Używane do Telegram summary.
   */
  async getAllUpcoming(daysAhead = 7): Promise<PdufaCatalyst[]> {
    const now = new Date();
    const limit = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

    return this.pdufaRepo
      .createQueryBuilder('p')
      .where('p.outcome IS NULL')
      .andWhere('p.pdufaDate >= :now', { now: now.toISOString().split('T')[0] })
      .andWhere('p.pdufaDate <= :limit', {
        limit: limit.toISOString().split('T')[0],
      })
      .orderBy('p.pdufaDate', 'ASC')
      .getMany();
  }

  /**
   * Buduje kontekst PDUFA do wstrzyknięcia w prompt GPT-4o-mini.
   * Format: jedna linia per katalizator z datą i odległością w dniach.
   */
  buildPdufaContext(catalysts: PdufaCatalyst[]): string {
    const now = new Date();

    return catalysts
      .map((c) => {
        const daysUntil = Math.ceil(
          (new Date(c.pdufaDate).getTime() - now.getTime()) /
            (24 * 60 * 60 * 1000),
        );
        const odin = c.odinTier
          ? `, ODIN: ${c.odinTier}${c.odinScore ? ` ${c.odinScore}%` : ''}`
          : '';

        return (
          `PDUFA: ${c.drugName}` +
          (c.indication ? `, indication: ${c.indication}` : '') +
          `, date: ${new Date(c.pdufaDate).toISOString().split('T')[0]}` +
          ` (${daysUntil} days)` +
          odin
        );
      })
      .join('\n');
  }

  /**
   * Pobiera HTML strony pdufa.bio.
   */
  private async fetchPage(url: string): Promise<string> {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'StockPulse/1.0 (Healthcare Monitoring)',
        Accept: 'text/html',
      },
    });

    if (!res.ok) {
      throw new Error(`PDUFA.bio HTTP ${res.status}: ${res.statusText}`);
    }

    return res.text();
  }
}
