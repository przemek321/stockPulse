import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { Alert } from '../entities';
import { FinnhubService } from '../collectors/finnhub/finnhub.service';
import { Logged } from '../common/decorators/logged.decorator';

/**
 * CRON service uzupełniający ceny akcji po wysłaniu alertu.
 * Sprawdza co godzinę alerty z priceAtAlert, ale bez kompletnych danych cenowych.
 * Uzupełnia price1h/4h/1d/3d w zależności od czasu od alertu.
 */
@Injectable()
export class PriceOutcomeService {
  private readonly logger = new Logger(PriceOutcomeService.name);

  /** Sloty czasowe do uzupełnienia */
  private readonly SLOTS = [
    { field: 'price1h' as const, delayMs: 1 * 60 * 60 * 1000, label: '1h' },
    { field: 'price4h' as const, delayMs: 4 * 60 * 60 * 1000, label: '4h' },
    { field: 'price1d' as const, delayMs: 24 * 60 * 60 * 1000, label: '1d' },
    { field: 'price3d' as const, delayMs: 72 * 60 * 60 * 1000, label: '3d' },
  ];

  /** Max zapytań Finnhub na cykl CRON (free tier = 60/min) */
  private readonly MAX_QUOTES_PER_CYCLE = 30;

  constructor(
    @InjectRepository(Alert)
    private readonly alertRepo: Repository<Alert>,
    private readonly finnhub: FinnhubService,
  ) {}

  /**
   * CRON co godzinę — uzupełnia ceny dla alertów oczekujących na outcome.
   */
  @Cron('0 * * * *')
  @Logged('price-outcome')
  async fillPriceOutcomes(): Promise<{ processed: number; updated: number }> {
    const alerts = await this.alertRepo.find({
      where: {
        priceOutcomeDone: false,
        priceAtAlert: Not(IsNull()),
      },
      order: { sentAt: 'ASC' },
    });

    if (alerts.length === 0) {
      return { processed: 0, updated: 0 };
    }

    this.logger.log(`PriceOutcome: ${alerts.length} alertów do uzupełnienia`);

    const now = Date.now();
    let quotesUsed = 0;
    let updated = 0;

    for (const alert of alerts) {
      if (quotesUsed >= this.MAX_QUOTES_PER_CYCLE) {
        this.logger.debug(
          `PriceOutcome: limit ${this.MAX_QUOTES_PER_CYCLE} zapytań — reszta w następnym cyklu`,
        );
        break;
      }

      const alertTime = new Date(alert.sentAt).getTime();
      let changed = false;

      for (const slot of this.SLOTS) {
        // Slot jeszcze nie minął
        if (alertTime + slot.delayMs > now) continue;

        // Slot już wypełniony
        if (alert[slot.field] != null) continue;

        // Pobierz cenę
        if (quotesUsed >= this.MAX_QUOTES_PER_CYCLE) break;
        const price = await this.finnhub.getQuote(alert.symbol);
        quotesUsed++;

        if (price != null) {
          (alert as any)[slot.field] = price;
          changed = true;
          this.logger.debug(
            `PriceOutcome: ${alert.symbol} ${slot.label}=$${price} (alert #${alert.id})`,
          );
        }

        // Dla tego alertu pobieramy jedną cenę na cykl
        // (ta sama cena dotyczy jednego momentu — nie pobieraj wielokrotnie)
        break;
      }

      // Sprawdź czy najdłuższy slot (3d) się wypełnił lub minął
      if (alertTime + this.SLOTS[3].delayMs <= now) {
        alert.priceOutcomeDone = true;
        changed = true;
      }

      if (changed) {
        await this.alertRepo.save(alert);
        updated++;
      }
    }

    this.logger.log(
      `PriceOutcome: przetworzono ${updated}/${alerts.length}, zapytań Finnhub: ${quotesUsed}`,
    );
    return { processed: alerts.length, updated };
  }
}
