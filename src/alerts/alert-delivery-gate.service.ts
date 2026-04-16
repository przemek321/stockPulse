import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { Alert } from '../entities';

/**
 * Centralna bramka dostarczania alertów z shared daily limit per ticker.
 *
 * Sprint 16 FLAG #10 fix: wcześniej daily limit był sprawdzany tylko
 * w AlertEvaluator.sendAlert(). Form4Pipeline, Form8kPipeline,
 * CorrelationService wysyłały Telegramy niezależnie — ticker mógł
 * dostać 15+ alertów dziennie.
 *
 * Teraz wszystkie pipeline'y wołają canDeliverToTelegram() przed wysyłką.
 */
@Injectable()
export class AlertDeliveryGate {
  private readonly logger = new Logger(AlertDeliveryGate.name);

  static readonly MAX_TELEGRAM_ALERTS_PER_SYMBOL_PER_DAY = 5;

  constructor(
    @InjectRepository(Alert)
    private readonly alertRepo: Repository<Alert>,
  ) {}

  /**
   * Sprawdza czy można dostarczyć alert na Telegram dla tego symbolu.
   * Zwraca true jeśli poniżej limitu, false jeśli osiągnięty.
   */
  async canDeliverToTelegram(symbol: string): Promise<{
    allowed: boolean;
    count: number;
    limit: number;
  }> {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const count = await this.alertRepo.count({
      where: {
        symbol,
        delivered: true,
        sentAt: MoreThanOrEqual(todayStart),
      },
    });

    const limit = AlertDeliveryGate.MAX_TELEGRAM_ALERTS_PER_SYMBOL_PER_DAY;
    const allowed = count < limit;

    if (!allowed) {
      this.logger.debug(
        `Daily limit hit: ${symbol} ma ${count} delivered alerts dziś (limit ${limit})`,
      );
    }

    return { allowed, count, limit };
  }
}
