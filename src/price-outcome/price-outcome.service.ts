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
 *
 * Optymalizacja: grupuje alerty per symbol, 1 zapytanie Finnhub na symbol (nie na slot).
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
   * Grupuje po symbolu: 1 zapytanie API = wszystkie sloty tego symbolu.
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

    // Grupuj alerty per symbol — 1 zapytanie API per symbol zamiast per alert
    const bySymbol = new Map<string, Alert[]>();
    for (const alert of alerts) {
      const list = bySymbol.get(alert.symbol) ?? [];
      list.push(alert);
      bySymbol.set(alert.symbol, list);
    }

    for (const [symbol, symbolAlerts] of bySymbol) {
      if (quotesUsed >= this.MAX_QUOTES_PER_CYCLE) {
        this.logger.debug(
          `PriceOutcome: limit ${this.MAX_QUOTES_PER_CYCLE} zapytań — reszta w następnym cyklu`,
        );
        break;
      }

      // Sprawdź czy którykolwiek alert tego symbolu potrzebuje ceny
      let needsQuote = false;
      for (const alert of symbolAlerts) {
        const alertTime = new Date(alert.sentAt).getTime();
        for (const slot of this.SLOTS) {
          if (alertTime + slot.delayMs <= now && alert[slot.field] == null) {
            needsQuote = true;
            break;
          }
        }
        if (needsQuote) break;
      }

      // Pobierz cenę raz per symbol
      let price: number | null = null;
      if (needsQuote) {
        price = await this.finnhub.getQuote(symbol);
        quotesUsed++;
      }

      // Wypełnij WSZYSTKIE due sloty dla wszystkich alertów tego symbolu
      for (const alert of symbolAlerts) {
        const alertTime = new Date(alert.sentAt).getTime();
        let changed = false;

        for (const slot of this.SLOTS) {
          if (alertTime + slot.delayMs > now) continue;
          if (alert[slot.field] != null) continue;

          if (price != null) {
            (alert as any)[slot.field] = price;
            changed = true;
            this.logger.debug(
              `PriceOutcome: ${symbol} ${slot.label}=$${price} (alert #${alert.id})`,
            );
          }
        }

        // Sprawdź czy najdłuższy slot (3d) minął
        if (alertTime + this.SLOTS[3].delayMs <= now) {
          alert.priceOutcomeDone = true;
          changed = true;
        }

        if (changed) {
          await this.alertRepo.save(alert);
          updated++;
        }
      }
    }

    this.logger.log(
      `PriceOutcome: przetworzono ${updated}/${alerts.length}, zapytań Finnhub: ${quotesUsed}`,
    );
    return { processed: alerts.length, updated };
  }

  /**
   * Backfill: ustawia priceAtAlert dla starych alertów, które go nie mają.
   * Używa aktualnej ceny Finnhub (przybliżenie — lepsza niż null).
   * Oznacza alerty starsze niż 3d jako priceOutcomeDone=true.
   */
  async backfillOldAlerts(): Promise<{ backfilled: number; closedExpired: number }> {
    // 1. Zamknij stare alerty (>3d) bez priceAtAlert — nie da się ich uzupełnić
    const THREE_DAYS_MS = 72 * 60 * 60 * 1000;
    const cutoffDate = new Date(Date.now() - THREE_DAYS_MS);

    const expiredAlerts = await this.alertRepo
      .createQueryBuilder('alert')
      .where('alert.priceAtAlert IS NULL')
      .andWhere('alert.priceOutcomeDone = false')
      .andWhere('alert.sentAt < :cutoff', { cutoff: cutoffDate })
      .getMany();

    let closedExpired = 0;
    for (const alert of expiredAlerts) {
      alert.priceOutcomeDone = true;
      await this.alertRepo.save(alert);
      closedExpired++;
    }

    // 2. Backfill alertów <3d bez priceAtAlert — ustaw aktualną cenę
    const recentAlerts = await this.alertRepo
      .createQueryBuilder('alert')
      .where('alert.priceAtAlert IS NULL')
      .andWhere('alert.priceOutcomeDone = false')
      .andWhere('alert.sentAt >= :cutoff', { cutoff: cutoffDate })
      .getMany();

    let backfilled = 0;
    const priceCache = new Map<string, number | null>();

    for (const alert of recentAlerts) {
      if (!priceCache.has(alert.symbol)) {
        priceCache.set(alert.symbol, await this.finnhub.getQuote(alert.symbol));
      }
      const price = priceCache.get(alert.symbol);
      if (price != null) {
        alert.priceAtAlert = price as any;
        await this.alertRepo.save(alert);
        backfilled++;
      }
    }

    this.logger.log(
      `PriceOutcome backfill: zamknięto ${closedExpired} expired, backfill ${backfilled} recent`,
    );
    return { backfilled, closedExpired };
  }
}
