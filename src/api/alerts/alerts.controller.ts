import { Controller, Get, Post, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull } from 'typeorm';
import { Alert, AlertRule } from '../../entities';
import { PriceOutcomeService } from '../../price-outcome/price-outcome.service';

/**
 * GET /api/alerts — historia alertów i reguły.
 */
@Controller('alerts')
export class AlertsController {
  constructor(
    @InjectRepository(Alert)
    private readonly alertRepo: Repository<Alert>,
    @InjectRepository(AlertRule)
    private readonly ruleRepo: Repository<AlertRule>,
    private readonly priceOutcome: PriceOutcomeService,
  ) {}

  /**
   * Lista ostatnich alertów.
   * ?limit=50 — ile wyników (domyślnie 50).
   * ?symbol=UNH — filtruj po tickerze.
   */
  @Get()
  async getAlerts(
    @Query('limit') limit?: string,
    @Query('symbol') symbol?: string,
  ) {
    const take = Math.min(parseInt(limit || '50', 10), 200);
    const where: Record<string, any> = {};
    if (symbol) {
      where.symbol = symbol.toUpperCase();
    }

    const alerts = await this.alertRepo.find({
      where,
      order: { sentAt: 'DESC' },
      take,
    });

    return {
      count: alerts.length,
      alerts,
    };
  }

  /**
   * Lista reguł alertów.
   */
  @Get('rules')
  async getRules() {
    const rules = await this.ruleRepo.find({
      order: { priority: 'ASC', name: 'ASC' },
    });

    return {
      count: rules.length,
      rules,
    };
  }

  /**
   * Trafność alertów — alerty z danymi cenowymi (Price Outcome Tracker).
   * ?limit=100&symbol=UNH
   * Zwraca delty procentowe i flagę trafności kierunku.
   */
  @Get('outcomes')
  async getOutcomes(
    @Query('limit') limit?: string,
    @Query('symbol') symbol?: string,
  ) {
    const take = Math.min(parseInt(limit || '100', 10), 500);
    const where: Record<string, any> = {
      priceAtAlert: Not(IsNull()),
    };
    if (symbol) {
      where.symbol = symbol.toUpperCase();
    }

    const alerts = await this.alertRepo.find({
      where,
      order: { sentAt: 'DESC' },
      take,
    });

    const outcomes = alerts.map((a) => {
      const p = Number(a.priceAtAlert);
      const delta = (price: number | null) =>
        price != null && p > 0 ? +((Number(price) - p) / p * 100).toFixed(2) : null;

      const delta1d = delta(a.price1d);

      // Trafność: kierunek alertu zgadza się ze zmianą ceny
      let directionCorrect: boolean | null = null;
      if (delta1d != null && a.alertDirection) {
        if (a.alertDirection === 'positive') directionCorrect = delta1d > 0;
        else if (a.alertDirection === 'negative') directionCorrect = delta1d < 0;
      }

      return {
        id: a.id,
        symbol: a.symbol,
        ruleName: a.ruleName,
        priority: a.priority,
        alertDirection: a.alertDirection,
        catalystType: a.catalystType,
        priceAtAlert: p,
        price1h: a.price1h != null ? Number(a.price1h) : null,
        price4h: a.price4h != null ? Number(a.price4h) : null,
        price1d: a.price1d != null ? Number(a.price1d) : null,
        price3d: a.price3d != null ? Number(a.price3d) : null,
        delta1h: delta(a.price1h),
        delta4h: delta(a.price4h),
        delta1d,
        delta3d: delta(a.price3d),
        directionCorrect,
        priceOutcomeDone: a.priceOutcomeDone,
        sentAt: a.sentAt,
      };
    });

    return { count: outcomes.length, outcomes };
  }

  /**
   * Backfill starych alertów bez priceAtAlert.
   * Zamyka expired (>3d) i uzupełnia recent (<3d) aktualną ceną.
   */
  @Post('outcomes/backfill')
  async backfillOutcomes() {
    return this.priceOutcome.backfillOldAlerts();
  }
}
