import { Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { EventType } from '../events/event-types';
import { OptionsFlow, Alert, AlertRule } from '../entities';
import { OptionsFlowScoringService } from './options-flow-scoring.service';
import { CorrelationService } from '../correlation/correlation.service';
import { TelegramService } from '../alerts/telegram/telegram.service';
import { TelegramFormatterService } from '../alerts/telegram/telegram-formatter.service';
import { FinnhubService } from '../collectors/finnhub/finnhub.service';
import { Logged } from '../common/decorators/logged.decorator';

/** Minimalny |conviction| do rejestracji w CorrelationService */
const MIN_CONVICTION_CORRELATION = 0.25;

/** Minimalny |conviction| do standalone alertu Telegram */
const MIN_CONVICTION_ALERT = 0.50;

/** Max alertów Telegram per ticker per dzień */
const MAX_DAILY_ALERTS = 5;

/**
 * Alert service dla options flow.
 *
 * Reaguje na NEW_OPTIONS_FLOW:
 * 1. Scoring (heurystyka bez GPT)
 * 2. |conviction| ≥ 0.25 → zapis do CorrelationService (Redis)
 * 3. |conviction| ≥ 0.50 → standalone alert Telegram
 */
@Injectable()
export class OptionsFlowAlertService {
  private readonly logger = new Logger(OptionsFlowAlertService.name);

  /** Cache reguły alertu (TTL 5 min) */
  private cachedRule: { rule: AlertRule | null; expiry: number } | null = null;

  constructor(
    @InjectRepository(OptionsFlow)
    private readonly flowRepo: Repository<OptionsFlow>,
    @InjectRepository(Alert)
    private readonly alertRepo: Repository<Alert>,
    @InjectRepository(AlertRule)
    private readonly ruleRepo: Repository<AlertRule>,
    private readonly scoring: OptionsFlowScoringService,
    @Optional() private readonly correlation: CorrelationService,
    private readonly telegram: TelegramService,
    private readonly formatter: TelegramFormatterService,
    @Optional() private readonly finnhub: FinnhubService,
  ) {}

  @OnEvent(EventType.NEW_OPTIONS_FLOW)
  @Logged('options-flow')
  async onOptionsFlow(payload: {
    flowId: number;
    symbol: string;
  }): Promise<{ action: string; symbol: string; conviction?: number }> {
    const flow = await this.flowRepo.findOne({ where: { id: payload.flowId } });
    if (!flow) return { action: 'SKIP_NOT_FOUND', symbol: payload.symbol };

    // Score
    const result = await this.scoring.scoreFlow(flow);

    // Zapisz conviction do options_flow record
    await this.flowRepo.update(flow.id, {
      conviction: result.conviction,
      direction: result.direction,
      pdufaBoosted: result.pdufaBoosted,
    });

    const absConv = Math.abs(result.conviction);

    // Rejestruj w CorrelationService
    if (absConv >= MIN_CONVICTION_CORRELATION && this.correlation) {
      this.correlation.storeSignal({
        id: `options-${flow.id}`,
        ticker: flow.symbol,
        source_category: 'options',
        conviction: result.conviction,
        direction: result.direction === 'mixed'
          ? (result.conviction > 0 ? 'positive' : 'negative')
          : result.direction as 'positive' | 'negative',
        catalyst_type: 'unusual_options',
        timestamp: Date.now(),
      });
      this.correlation.schedulePatternCheck(flow.symbol);
    }

    // Standalone alert Telegram
    if (absConv >= MIN_CONVICTION_ALERT) {
      const sent = await this.sendAlert(flow, result);
      if (sent) {
        return {
          action: 'ALERT_SENT',
          symbol: flow.symbol,
          conviction: result.conviction,
        };
      }
      return {
        action: 'THROTTLED',
        symbol: flow.symbol,
        conviction: result.conviction,
      };
    }

    return {
      action: absConv >= MIN_CONVICTION_CORRELATION ? 'CORRELATION_STORED' : 'SKIP_LOW_CONVICTION',
      symbol: flow.symbol,
      conviction: result.conviction,
    };
  }

  /**
   * Wysyła alert Telegram i zapisuje do tabeli alerts.
   */
  private async sendAlert(
    flow: OptionsFlow,
    scoring: { conviction: number; direction: string; pdufaBoosted: boolean; callPutRatio: number },
  ): Promise<boolean> {
    const rule = await this.getRule();
    if (!rule) return false;

    // Sprawdź throttle
    const throttleMs = (rule.throttleMinutes || 120) * 60_000;
    const recentAlert = await this.alertRepo.findOne({
      where: {
        symbol: flow.symbol,
        ruleName: rule.name,
      },
      order: { sentAt: 'DESC' },
    });

    if (recentAlert) {
      const elapsed = Date.now() - new Date(recentAlert.sentAt).getTime();
      if (elapsed < throttleMs) return false;
    }

    // Sprawdź daily limit per ticker
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayCount = await this.alertRepo.count({
      where: {
        symbol: flow.symbol,
        sentAt: MoreThanOrEqual(todayStart),
      },
    });
    if (todayCount >= MAX_DAILY_ALERTS) return false;

    // Priority
    const priority = Math.abs(scoring.conviction) >= 0.7 ? 'CRITICAL' : 'HIGH';

    // Format i wyślij
    const message = this.formatter.formatOptionsFlowAlert({
      symbol: flow.symbol,
      priority,
      conviction: scoring.conviction,
      direction: scoring.direction,
      callPutRatio: scoring.callPutRatio,
      headlineContract: {
        optionType: flow.optionType,
        strike: Number(flow.strike),
        expiry: flow.expiry.toString(),
        dte: flow.dte,
        dailyVolume: flow.dailyVolume,
        avgVolume20d: Number(flow.avgVolume20d),
        spikeRatio: Number(flow.volumeSpikeRatio),
        otmDistance: Number(flow.otmDistance),
      },
      pdufaBoosted: scoring.pdufaBoosted,
      sessionDate: flow.sessionDate.toString(),
    });

    const delivered = await this.telegram.sendMarkdown(message);

    // Price at alert
    let priceAtAlert: number | undefined;
    try {
      if (this.finnhub) {
        priceAtAlert = (await this.finnhub.getQuote(flow.symbol)) ?? undefined;
      }
    } catch { /* noop */ }

    // Zapisz alert
    await this.alertRepo.save(
      this.alertRepo.create({
        symbol: flow.symbol,
        ruleName: rule.name,
        priority,
        channel: 'TELEGRAM',
        message,
        delivered,
        catalystType: 'unusual_options',
        alertDirection: scoring.conviction > 0 ? 'positive' : 'negative',
        priceAtAlert,
      }),
    );

    this.logger.log(
      `Alert: ${flow.symbol} unusual options conviction=${scoring.conviction.toFixed(3)} ${scoring.direction}`,
    );

    return true;
  }

  /**
   * Pobiera regułę "Unusual Options Activity" z cache (TTL 5 min).
   */
  private async getRule(): Promise<AlertRule | null> {
    if (this.cachedRule && Date.now() < this.cachedRule.expiry) {
      return this.cachedRule.rule;
    }

    const rule = await this.ruleRepo.findOne({
      where: { name: 'Unusual Options Activity', isActive: true },
    });

    this.cachedRule = { rule, expiry: Date.now() + 5 * 60_000 };
    return rule;
  }
}
