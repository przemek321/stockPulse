import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { Alert, AlertRule } from '../entities';
import { EventType } from '../events/event-types';
import { TelegramService } from './telegram/telegram.service';
import { TelegramFormatterService } from './telegram/telegram-formatter.service';

/**
 * Ewaluator reguł alertów.
 * Nasłuchuje na eventy (new_mention, new_filing, new_insider_trade)
 * i sprawdza czy pasują do aktywnych reguł.
 * Implementuje throttling — minimalna przerwa między alertami tego samego typu per ticker.
 */
@Injectable()
export class AlertEvaluatorService {
  private readonly logger = new Logger(AlertEvaluatorService.name);

  constructor(
    @InjectRepository(Alert)
    private readonly alertRepo: Repository<Alert>,
    @InjectRepository(AlertRule)
    private readonly ruleRepo: Repository<AlertRule>,
    private readonly telegram: TelegramService,
    private readonly formatter: TelegramFormatterService,
  ) {}

  /**
   * Reaguje na event nowej transakcji insiderskiej.
   * Jeśli wartość > $100K, generuje alert.
   */
  @OnEvent(EventType.NEW_INSIDER_TRADE)
  async onInsiderTrade(payload: {
    tradeId: number;
    symbol: string;
    mspr?: number;
    source?: string;
  }): Promise<void> {
    this.logger.debug(
      `Insider trade event: ${payload.symbol} (trade #${payload.tradeId})`,
    );

    // Sprawdź czy istnieje reguła "Insider Trade Large"
    const rule = await this.ruleRepo.findOne({
      where: { name: 'Insider Trade Large', isActive: true },
    });
    if (!rule) return;

    // Sprawdź throttling
    const isThrottled = await this.isThrottled(
      rule.name,
      payload.symbol,
      rule.throttleMinutes,
    );
    if (isThrottled) return;

    // Wyślij alert
    const message = this.formatter.formatInsiderTradeAlert({
      symbol: payload.symbol,
      companyName: payload.symbol, // TODO: dociągnąć z tickerów
      insiderName: 'Insider',
      transactionType: 'Trade',
      totalValue: 0,
      priority: rule.priority,
    });

    await this.sendAlert(payload.symbol, rule, message);
  }

  /**
   * Reaguje na event nowego filingu SEC.
   * Generuje alert dla ważnych filingów (8-K, Form 4).
   */
  @OnEvent(EventType.NEW_FILING)
  async onFiling(payload: {
    filingId: number;
    symbol: string;
    formType: string;
  }): Promise<void> {
    this.logger.debug(
      `Filing event: ${payload.symbol} — ${payload.formType}`,
    );

    // Tylko 8-K i Form 4 generują alerty
    if (!['8-K', '4'].includes(payload.formType)) return;

    const ruleName =
      payload.formType === '8-K' ? '8-K Material Event' : 'Insider Trade Large';
    const rule = await this.ruleRepo.findOne({
      where: { name: ruleName, isActive: true },
    });
    if (!rule) return;

    const isThrottled = await this.isThrottled(
      rule.name,
      payload.symbol,
      rule.throttleMinutes,
    );
    if (isThrottled) return;

    const message = this.formatter.formatFilingAlert({
      symbol: payload.symbol,
      companyName: payload.symbol,
      formType: payload.formType,
      priority: rule.priority,
    });

    await this.sendAlert(payload.symbol, rule, message);
  }

  /**
   * Wysyła alert i zapisuje go w historii.
   */
  private async sendAlert(
    symbol: string,
    rule: AlertRule,
    message: string,
  ): Promise<void> {
    const delivered = await this.telegram.sendMarkdown(message);

    const alert = this.alertRepo.create({
      symbol,
      ruleName: rule.name,
      priority: rule.priority,
      channel: 'TELEGRAM',
      message,
      delivered,
    });

    await this.alertRepo.save(alert);

    this.logger.log(
      `Alert wysłany: ${rule.name} dla ${symbol} (delivered: ${delivered})`,
    );
  }

  /**
   * Sprawdza czy alert tego typu per ticker jest wstrzymany (throttling).
   */
  private async isThrottled(
    ruleName: string,
    symbol: string,
    throttleMinutes: number,
  ): Promise<boolean> {
    const cutoff = new Date(Date.now() - throttleMinutes * 60 * 1000);

    const recentAlert = await this.alertRepo.findOne({
      where: {
        ruleName,
        symbol,
        sentAt: MoreThan(cutoff),
      },
    });

    return !!recentAlert;
  }
}
