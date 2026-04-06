import { Controller, Get, Post, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull, DataSource } from 'typeorm';
import { Alert, AlertRule } from '../../entities';
import { PriceOutcomeService } from '../../price-outcome/price-outcome.service';

/**
 * GET /api/alerts — historia alertów, reguły, timeline sygnałów.
 */
@Controller('alerts')
export class AlertsController {
  constructor(
    @InjectRepository(Alert)
    private readonly alertRepo: Repository<Alert>,
    @InjectRepository(AlertRule)
    private readonly ruleRepo: Repository<AlertRule>,
    private readonly priceOutcome: PriceOutcomeService,
    private readonly dataSource: DataSource,
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
   * Timeline sygnałów per ticker — chronologiczna sekwencja alertów
   * z deltami cenowymi między sygnałami, odstępami czasowymi i trafnością.
   * ?symbol=GILD (opcjonalne — bez symbolu zwraca wszystkie tickery) &days=30 &limit=50
   */
  @Get('timeline')
  async getTimeline(
    @Query('symbol') symbol?: string,
    @Query('days') daysParam?: string,
    @Query('limit') limitParam?: string,
  ) {
    // Bez symbolu — zwróć ostatnie alerty ze wszystkich tickerów (widok domyślny)
    if (!symbol) {
      return this.getRecentTimeline(daysParam, limitParam);
    }

    const sym = symbol.toUpperCase();
    const days = Math.max(1, Math.min(parseInt(daysParam || '30', 10) || 30, 365));
    const limit = Math.max(1, Math.min(parseInt(limitParam || '50', 10) || 50, 200));

    const rows = await this.dataSource.query(`
      SELECT
        id,
        symbol,
        "ruleName",
        priority,
        "alertDirection",
        "catalystType",
        message,
        "priceAtAlert",
        price1h, price4h, price1d, price3d,
        "sentAt",
        -- Conviction wyciągnięty z message (MarkdownV2 escaping: "Conviction: 0\.505")
        (regexp_match(
          replace(replace(message, E'\\\\.', '.'), E'\\\\-', '-'),
          'Conviction:\\s*([+-]?\\d+\\.?\\d*)', 'i'
        ))[1]::numeric AS conviction,
        CASE
          WHEN LAG("priceAtAlert") OVER w IS NOT NULL AND LAG("priceAtAlert") OVER w > 0
          THEN ROUND(("priceAtAlert" / LAG("priceAtAlert") OVER w - 1) * 100, 2)
          ELSE NULL
        END AS "priceDeltaFromPrevPct",
        EXTRACT(EPOCH FROM ("sentAt" - LAG("sentAt") OVER w)) / 3600 AS "hoursSincePrev",
        CASE
          WHEN LAG("alertDirection") OVER w IS NOT NULL AND "alertDirection" IS NOT NULL
          THEN LAG("alertDirection") OVER w = "alertDirection"
          ELSE NULL
        END AS "sameDirectionAsPrev",
        CASE
          WHEN price1d IS NOT NULL AND "priceAtAlert" IS NOT NULL AND "alertDirection" IS NOT NULL
          THEN CASE
            WHEN "alertDirection" = 'positive' AND price1d > "priceAtAlert" THEN true
            WHEN "alertDirection" = 'negative' AND price1d < "priceAtAlert" THEN true
            ELSE false
          END
          ELSE NULL
        END AS "directionCorrect1d"
      FROM alerts
      WHERE symbol = $1
        AND "priceAtAlert" IS NOT NULL
        AND "sentAt" > NOW() - INTERVAL '1 day' * $2
      WINDOW w AS (PARTITION BY symbol ORDER BY "sentAt")
      ORDER BY "sentAt" DESC
      LIMIT $3
    `, [sym, days, limit]);

    const alerts = rows.map((r: any) => ({
      ...r,
      priceAtAlert: r.priceAtAlert != null ? Number(r.priceAtAlert) : null,
      price1h: r.price1h != null ? Number(r.price1h) : null,
      price4h: r.price4h != null ? Number(r.price4h) : null,
      price1d: r.price1d != null ? Number(r.price1d) : null,
      price3d: r.price3d != null ? Number(r.price3d) : null,
      conviction: r.conviction != null ? Number(r.conviction) : null,
      priceDeltaFromPrevPct: r.priceDeltaFromPrevPct != null ? Number(r.priceDeltaFromPrevPct) : null,
      hoursSincePrev: r.hoursSincePrev != null ? Math.round(Number(r.hoursSincePrev) * 10) / 10 : null,
    }));

    // Summary
    const directions = alerts.filter((a: any) => a.alertDirection).map((a: any) => a.alertDirection);
    const positive = directions.filter((d: string) => d === 'positive').length;
    const negative = directions.filter((d: string) => d === 'negative').length;
    const totalDir = directions.length;
    const consistency = totalDir > 0 ? Math.round(Math.max(positive, negative) / totalDir * 100) : null;
    const dominant = positive > negative ? 'positive' : negative > positive ? 'negative' : 'mixed';

    const correct = alerts.filter((a: any) => a.directionCorrect1d === true).length;
    const evaluated = alerts.filter((a: any) => a.directionCorrect1d != null).length;
    const hitRate = evaluated > 0 ? Math.round(correct / evaluated * 100) : null;

    const gaps = alerts.filter((a: any) => a.hoursSincePrev != null).map((a: any) => a.hoursSincePrev);
    const avgGap = gaps.length > 0 ? Math.round(gaps.reduce((s: number, v: number) => s + v, 0) / gaps.length * 10) / 10 : null;

    return {
      symbol: sym,
      alerts,
      summary: {
        totalAlerts: alerts.length,
        avgHoursBetween: avgGap,
        directionConsistency: consistency,
        hitRate1d: hitRate,
        dominantDirection: dominant,
      },
    };
  }

  /**
   * Tickery z alertami — do dropdown na froncie Signal Timeline.
   * Zwraca tickery z >= 2 alertami w ostatnich N dni, posortowane po ilości alertów.
   */
  @Get('timeline/symbols')
  async getTimelineSymbols(@Query('days') daysParam?: string) {
    const days = Math.max(1, Math.min(parseInt(daysParam || '30', 10) || 30, 365));

    const rows = await this.dataSource.query(`
      SELECT symbol, COUNT(*)::int AS "alertCount",
        MAX("sentAt") AS "lastAlert"
      FROM alerts
      WHERE "sentAt" > NOW() - INTERVAL '1 day' * $1
      GROUP BY symbol
      ORDER BY COUNT(*) DESC
    `, [days]);

    return { symbols: rows };
  }

  /**
   * Ostatnie alerty ze wszystkich tickerów — widok domyślny Signal Timeline.
   * Sortowane po dacie (najnowsze na górze), bez window functions per ticker.
   */
  private async getRecentTimeline(daysParam?: string, limitParam?: string) {
    const days = Math.max(1, Math.min(parseInt(daysParam || '7', 10) || 7, 90));
    const limit = Math.max(1, Math.min(parseInt(limitParam || '30', 10) || 30, 100));

    const rows = await this.dataSource.query(`
      SELECT
        id, symbol, "ruleName", priority, "alertDirection", "catalystType",
        message, "priceAtAlert", price1h, price4h, price1d, price3d, "sentAt",
        (regexp_match(
          replace(replace(message, E'\\\\.', '.'), E'\\\\-', '-'),
          'Conviction:\\s*([+-]?\\d+\\.?\\d*)', 'i'
        ))[1]::numeric AS conviction,
        CASE
          WHEN price1d IS NOT NULL AND "priceAtAlert" IS NOT NULL AND "alertDirection" IS NOT NULL
          THEN CASE
            WHEN "alertDirection" = 'positive' AND price1d > "priceAtAlert" THEN true
            WHEN "alertDirection" = 'negative' AND price1d < "priceAtAlert" THEN true
            ELSE false
          END
          ELSE NULL
        END AS "directionCorrect1d"
      FROM alerts
      WHERE "sentAt" > NOW() - INTERVAL '1 day' * $1
      ORDER BY "sentAt" DESC
      LIMIT $2
    `, [days, limit]);

    const alerts = rows.map((r: any) => ({
      ...r,
      priceAtAlert: r.priceAtAlert != null ? Number(r.priceAtAlert) : null,
      price1h: r.price1h != null ? Number(r.price1h) : null,
      price4h: r.price4h != null ? Number(r.price4h) : null,
      price1d: r.price1d != null ? Number(r.price1d) : null,
      price3d: r.price3d != null ? Number(r.price3d) : null,
      conviction: r.conviction != null ? Number(r.conviction) : null,
      hoursSincePrev: null,
      priceDeltaFromPrevPct: null,
      sameDirectionAsPrev: null,
    }));

    return { symbol: null, alerts, summary: null };
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
