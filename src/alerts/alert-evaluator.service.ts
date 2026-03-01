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

    // Tylko 8-K generuje alert z filingów.
    // Form 4 jest obsługiwany przez onInsiderTrade — nie duplikujemy.
    if (payload.formType !== '8-K') return;

    const ruleName = '8-K Material Event';
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
   * Reaguje na wynik analizy sentymentu.
   * Sprawdza dwa niezależne warunki:
   * 1. Sentiment Crash: score < -0.5 AND confidence > 0.7
   * 2. High Conviction Signal: |conviction| > 1.5
   */
  @OnEvent(EventType.SENTIMENT_SCORED)
  async onSentimentScored(payload: {
    scoreId: number;
    symbol: string;
    score: number;
    confidence: number;
    label: string;
    source: string;
    model: string;
    conviction: number | null;
    enrichedAnalysis: Record<string, any> | null;
  }): Promise<void> {
    await Promise.all([
      this.checkSentimentCrash(payload),
      this.checkHighConviction(payload),
    ]);
  }

  /**
   * Sprawdza regułę "Sentiment Crash" — silny negatywny sygnał.
   */
  private async checkSentimentCrash(payload: {
    symbol: string;
    score: number;
    confidence: number;
    source: string;
    model: string;
    enrichedAnalysis: Record<string, any> | null;
  }): Promise<void> {
    if (payload.score >= -0.5 || payload.confidence < 0.7) return;

    this.logger.debug(
      `Negatywny sentyment: ${payload.symbol} score=${payload.score} (${payload.model})`,
    );

    const ruleName = 'Sentiment Crash';
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

    const message = this.formatter.formatSentimentAlert({
      symbol: payload.symbol,
      companyName: payload.symbol,
      priority: rule.priority,
      ruleName,
      sentimentScore: payload.score,
      details: `Model: ${payload.model}, Źródło: ${payload.source}, Confidence: ${payload.confidence.toFixed(2)}`,
      enrichedAnalysis: payload.enrichedAnalysis,
    });

    await this.sendAlert(payload.symbol, rule, message);
  }

  /**
   * Sprawdza regułę "High Conviction Signal" — |conviction| > 1.5.
   * Wymaga enrichedAnalysis (wynik 2-etapowej analizy AI).
   */
  private async checkHighConviction(payload: {
    symbol: string;
    score: number;
    confidence: number;
    source: string;
    conviction: number | null;
    enrichedAnalysis: Record<string, any> | null;
  }): Promise<void> {
    if (payload.conviction == null || Math.abs(payload.conviction) < 1.5) {
      return;
    }

    this.logger.debug(
      `High conviction: ${payload.symbol} conviction=${payload.conviction}`,
    );

    const ruleName = 'High Conviction Signal';
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

    const message = this.formatter.formatConvictionAlert({
      symbol: payload.symbol,
      priority: rule.priority,
      conviction: payload.conviction,
      finbertScore: payload.score,
      finbertConfidence: payload.confidence,
      source: payload.source,
      enrichedAnalysis: payload.enrichedAnalysis!,
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
    // Minimalny throttle 1 min — zapobiega spamowi przy batch importach
    const effectiveMinutes = Math.max(throttleMinutes, 1);
    const cutoff = new Date(Date.now() - effectiveMinutes * 60 * 1000);

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
