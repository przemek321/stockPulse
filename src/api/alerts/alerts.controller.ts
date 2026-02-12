import { Controller, Get, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Alert, AlertRule } from '../../entities';

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
}
