import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { Alert } from '../entities';
import { FinnhubService } from '../collectors/finnhub/finnhub.service';
import { Logged } from '../common/decorators/logged.decorator';
import { isNyseOpen, getEffectiveStartTime } from '../common/utils/market-hours.util';

/**
 * CRON service uzupełniający ceny akcji po wysłaniu alertu.
 * Sprawdza co godzinę alerty z priceAtAlert, ale bez kompletnych danych cenowych.
 * Uzupełnia price1h/4h/1d/3d w zależności od czasu od alertu.
 *
 * Odpytuje Finnhub TYLKO gdy giełda NYSE jest otwarta (pon-pt 9:30-16:00 ET).
 * Poza sesją cena = last close — identyczna dla wielu slotów, bezwartościowa.
 *
 * Optymalizacja: grupuje alerty per symbol, 1 zapytanie Finnhub na symbol (nie na slot).
 */
@Injectable()
export class PriceOutcomeService {
  private readonly logger = new Logger(PriceOutcomeService.name);

  /** Sloty czasowe do uzupełnienia ticker price */
  private readonly SLOTS = [
    { field: 'price1h' as const, delayMs: 1 * 60 * 60 * 1000, label: '1h' },
    { field: 'price4h' as const, delayMs: 4 * 60 * 60 * 1000, label: '4h' },
    { field: 'price1d' as const, delayMs: 24 * 60 * 60 * 1000, label: '1d' },
    { field: 'price3d' as const, delayMs: 72 * 60 * 60 * 1000, label: '3d' },
  ];

  /**
   * Sloty sektorowego benchmark (XBI/IBB) — tylko 1d i 3d.
   * Skip 1h/4h: sektor benchmark intraday ma niski signal-to-noise dla outcome
   * interpretation. Patrz `doc/FOLLOWUP-XBI-ADJUSTMENT.md`.
   *
   * Code review P1 #4 (28.05.2026): explicit `xbi1d/xbi3d/ibb1d/ibb3d` field
   * assignments zamiast dynamic `as any` indexing — type-safe na compile,
   * zero runtime surprise przy rename column. 2 sloty × 2 benchmarki = 4 lines
   * (acceptable duplication vs `as any` cast w 5 miejscach).
   */
  private readonly SLOT_1D_DELAY_MS = 24 * 60 * 60 * 1000;
  private readonly SLOT_3D_DELAY_MS = 72 * 60 * 60 * 1000;

  /** Symbole sektorowe — biotech ETF benchmark (XBI mid-cap, IBB large-cap weighted) */
  private readonly XBI_SYMBOL = 'XBI';
  private readonly IBB_SYMBOL = 'IBB';

  /** Max zapytań Finnhub na cykl CRON (free tier = 60/min) */
  private readonly MAX_QUOTES_PER_CYCLE = 30;

  /** Hard timeout — po 7d oznacz alert jako done nawet jeśli brak slotów (np. długi weekend + święto) */
  private readonly HARD_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;

  constructor(
    @InjectRepository(Alert)
    private readonly alertRepo: Repository<Alert>,
    private readonly finnhub: FinnhubService,
  ) {}

  /**
   * CRON co godzinę — uzupełnia ceny dla alertów oczekujących na outcome.
   * Pomija cykl gdy giełda NYSE zamknięta (cena = last close, bezwartościowa).
   * Grupuje po symbolu: 1 zapytanie API = wszystkie sloty tego symbolu.
   */
  @Cron('0 * * * *', { timeZone: 'UTC' })
  @Logged('price-outcome')
  async fillPriceOutcomes(): Promise<{ processed: number; updated: number }> {
    if (!isNyseOpen()) {
      this.logger.debug('PriceOutcome: giełda NYSE zamknięta — pomijam cykl');
      return { processed: 0, updated: 0 };
    }

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

    // Pobierz XBI/IBB raz na cykl (1 zapytanie each) — używamy do wszystkich
    // alertów których 1d/3d slot wpadł do tego cyklu. Sektor benchmark "current"
    // jest valid jako "close NYSE w okno alert+1d/+3d" gdy CRON odpala w sesji.
    // Code review P1 #3 (28.05.2026): per-leg `.catch(() => null)` — jeśli XBI
    // throw nie blokuje IBB (inconsistent z `captureAlertSnapshot` helper pre-fix).
    let xbiQuote: number | null = null;
    let ibbQuote: number | null = null;
    const needsSectorAnyAlert = alerts.some((alert) => {
      const effectiveStart = getEffectiveStartTime(new Date(alert.sentAt)).getTime();
      return (
        (now >= effectiveStart + this.SLOT_1D_DELAY_MS && alert.xbi1d == null) ||
        (now >= effectiveStart + this.SLOT_3D_DELAY_MS && alert.xbi3d == null)
      );
    });
    if (needsSectorAnyAlert) {
      [xbiQuote, ibbQuote] = await Promise.all([
        this.finnhub.getQuote(this.XBI_SYMBOL).catch(() => null),
        this.finnhub.getQuote(this.IBB_SYMBOL).catch(() => null),
      ]);
      quotesUsed += 2;
    }

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
        const effectiveStart = getEffectiveStartTime(new Date(alert.sentAt)).getTime();
        for (const slot of this.SLOTS) {
          if (effectiveStart + slot.delayMs <= now && alert[slot.field] == null) {
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

      // Wypełnij WSZYSTKIE due sloty dla wszystkich alertów tego symbolu.
      // Sloty liczone od efektywnego startu (otwarcie NYSE dla alertów pre-market).
      for (const alert of symbolAlerts) {
        const effectiveStart = getEffectiveStartTime(new Date(alert.sentAt)).getTime();
        let changed = false;

        for (const slot of this.SLOTS) {
          if (effectiveStart + slot.delayMs > now) continue;
          if (alert[slot.field] != null) continue;

          if (price != null) {
            (alert as any)[slot.field] = price;
            changed = true;
            this.logger.debug(
              `PriceOutcome: ${symbol} ${slot.label}=$${price} (alert #${alert.id})`,
            );
          }
        }

        // Zapisz sektor benchmark (XBI/IBB) dla due slotów 1d/3d — typed explicit
        // assignment. Snapshot per cykl, ten sam quote dla wszystkich alertów które
        // trafiły w to okno (race-free lokalnie — w praktyce <60s drift między
        // alertami w tej samej godzinie, sektor benchmark wewnątrz sesji prawie
        // nieruchomy). P1 #4: replaces dynamic `as any` [field] indexing.
        if (now >= effectiveStart + this.SLOT_1D_DELAY_MS) {
          if (alert.xbi1d == null && xbiQuote != null) {
            alert.xbi1d = xbiQuote;
            changed = true;
          }
          if (alert.ibb1d == null && ibbQuote != null) {
            alert.ibb1d = ibbQuote;
            changed = true;
          }
        }
        if (now >= effectiveStart + this.SLOT_3D_DELAY_MS) {
          if (alert.xbi3d == null && xbiQuote != null) {
            alert.xbi3d = xbiQuote;
            changed = true;
          }
          if (alert.ibb3d == null && ibbQuote != null) {
            alert.ibb3d = ibbQuote;
            changed = true;
          }
        }

        // Oznacz jako done gdy: wszystkie 4 sloty wypełnione LUB hard timeout 7d od alertu
        const allSlotsFilled = this.SLOTS.every(
          (s) => alert[s.field] != null,
        );
        const hardTimeout = new Date(alert.sentAt).getTime() + this.HARD_TIMEOUT_MS <= now;
        if (allSlotsFilled || hardTimeout) {
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
   * Backfill: zamyka stare alerty bez priceAtAlert (>3d).
   *
   * Sprint 16 FLAG #25 fix: NIE ustawia priceAtAlert dla recent alertów.
   * Stary kod używał getQuote() (current price) jako priceAtAlert dla alertów
   * do 3 dni wstecz — to nadpisywało dane obecną ceną, niszcząc outcome
   * measurement (priceAtAlert ≈ price1d → 0% move artifact).
   *
   * Proper backfill wymagałby historical price z Finnhub /candle endpoint,
   * ale to osobny projekt. Lepiej null niż złe dane.
   */
  async backfillOldAlerts(): Promise<{ backfilled: number; closedExpired: number }> {
    // Zamknij stare alerty (>3d) bez priceAtAlert — nie da się ich uzupełnić
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

    this.logger.log(
      `PriceOutcome backfill: zamknięto ${closedExpired} expired alertów ` +
      `(>3d bez priceAtAlert). Recent alerty bez priceAtAlert pozostawione — ` +
      `backfill obecną ceną był źródłem data contamination (FLAG #25).`,
    );
    return { backfilled: 0, closedExpired };
  }
}
