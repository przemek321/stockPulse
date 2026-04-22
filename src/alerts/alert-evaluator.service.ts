import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, FindOptionsWhere } from 'typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { Alert, AlertRule, Ticker } from '../entities';
import { EventType } from '../events/event-types';
import { TelegramService } from './telegram/telegram.service';
import { TelegramFormatterService } from './telegram/telegram-formatter.service';
import { CorrelationService } from '../correlation/correlation.service';
import { SourceCategory, StoredSignal } from '../correlation/types/correlation.types';
import { Logged } from '../common/decorators/logged.decorator';
import { FinnhubService } from '../collectors/finnhub/finnhub.service';
import { AlertDeliveryGate } from './alert-delivery-gate.service';

/**
 * Ewaluator reguł alertów.
 * Nasłuchuje na eventy (new_mention, new_filing, new_insider_trade)
 * i sprawdza czy pasują do aktywnych reguł.
 * Implementuje throttling — minimalna przerwa między alertami tego samego typu per ticker.
 */
// Sprint 11: INSIDER_AGGREGATION_WINDOW_MS + InsiderBatch usunięte — insider trades obsługiwane przez Form4Pipeline

@Injectable()
export class AlertEvaluatorService {
  private readonly logger = new Logger(AlertEvaluatorService.name);

  /** Cache reguł alertów — TTL 5 min, unika powtarzanych zapytań do DB */
  private rulesCache: Map<string, AlertRule | null> = new Map();
  private rulesCacheExpiry = 0;
  private static readonly RULES_CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(
    @InjectRepository(Alert)
    private readonly alertRepo: Repository<Alert>,
    @InjectRepository(AlertRule)
    private readonly ruleRepo: Repository<AlertRule>,
    @InjectRepository(Ticker)
    private readonly tickerRepo: Repository<Ticker>,
    private readonly telegram: TelegramService,
    private readonly formatter: TelegramFormatterService,
    private readonly finnhub: FinnhubService,
    private readonly deliveryGate: AlertDeliveryGate,
    @Optional() private readonly correlation?: CorrelationService,
  ) {}

  // Sprint 11: onInsiderTrade() handler usunięty (Sprint 16b).
  // Insider trades obsługuje wyłącznie Form4Pipeline (GPT-enriched conviction).
  // Reguła "Insider Trade Large" pozostaje w DB jako disabled (audit trail).

  /**
   * Reaguje na event nowego filingu SEC.
   * Generuje alert dla ważnych filingów (8-K, Form 4).
   */
  @OnEvent(EventType.NEW_FILING)
  @Logged('alerts')
  async onFiling(payload: {
    filingId: number;
    symbol: string;
    formType: string;
  }): Promise<{ action: string; symbol: string; formType: string }> {
    this.logger.debug(
      `Filing event: ${payload.symbol} — ${payload.formType}`,
    );

    // Tylko 8-K generuje alert z filingów.
    // Form 4 jest obsługiwany przez Form4Pipeline — nie duplikujemy.
    if (payload.formType !== '8-K') {
      return { action: 'SKIP_NOT_8K', symbol: payload.symbol, formType: payload.formType };
    }

    const ruleName = '8-K Material Event';
    const rule = await this.getRule(ruleName);
    if (!rule) {
      return { action: 'SKIP_NO_RULE', symbol: payload.symbol, formType: payload.formType };
    }

    const isThrottled = await this.isThrottled(
      rule.name,
      payload.symbol,
      rule.throttleMinutes,
    );
    if (isThrottled) {
      return { action: 'THROTTLED', symbol: payload.symbol, formType: payload.formType };
    }

    const ticker = await this.tickerRepo.findOne({
      where: { symbol: payload.symbol },
    });

    const message = this.formatter.formatFilingAlert({
      symbol: payload.symbol,
      companyName: ticker?.name ?? payload.symbol,
      formType: payload.formType,
      priority: rule.priority,
    });

    const alertAction = await this.sendAlert(payload.symbol, rule, message, undefined, {
      sourceCategory: '8k',
      conviction: 0.5, // bazowy conviction dla 8-K bez analizy GPT
      direction: 'negative', // 8-K material events domyślnie negatywne
    });
    return { action: alertAction, symbol: payload.symbol, formType: payload.formType };
  }

  /**
   * Wysyła alert i zapisuje go w historii.
   * Po wysłaniu rejestruje sygnał w CorrelationService do detekcji wzorców.
   */
  private async sendAlert(
    symbol: string,
    rule: AlertRule,
    message: string,
    catalystType?: string,
    correlationData?: {
      sourceCategory: SourceCategory;
      conviction: number;
      direction: 'positive' | 'negative' | 'neutral';
    },
  ): Promise<string> {
    // Observation mode: ticker z observationOnly=true → DB only, brak Telegramu
    const ticker = await this.tickerRepo.findOne({ where: { symbol } });
    const isObservation = ticker?.observationOnly === true;

    // Sprint 16 FLAG #10: shared AlertDeliveryGate zamiast lokalnego checku
    let dailyLimitHit = false;
    if (!isObservation) {
      const gateCheck = await this.deliveryGate.canDeliverToTelegram(symbol);
      if (!gateCheck.allowed) {
        dailyLimitHit = true;
      }
    }

    // Ustal powód niedostarczenia (jeśli jest)
    let nonDeliveryReason: string | null = null;
    if (isObservation) nonDeliveryReason = 'observation';
    else if (dailyLimitHit) nonDeliveryReason = 'daily_limit';

    const delivered = (dailyLimitHit || isObservation)
      ? false
      : await this.telegram.sendMarkdown(message);

    // Price Outcome Tracker — pobierz cenę PRZED zapisem (1 zapis zamiast 2)
    let priceAtAlert: number | null = null;
    try {
      priceAtAlert = await this.finnhub.getQuote(symbol);
      if (priceAtAlert) {
        this.logger.debug(`PriceOutcome: ${symbol} priceAtAlert=$${priceAtAlert}`);
      }
    } catch (err) {
      this.logger.warn(`PriceOutcome getQuote error: ${err.message}`);
    }

    const alert = this.alertRepo.create({
      symbol,
      ruleName: rule.name,
      priority: rule.priority,
      channel: 'TELEGRAM',
      message,
      delivered,
      nonDeliveryReason,
      catalystType: catalystType ?? null,
      alertDirection: correlationData?.direction === 'neutral' ? null : (correlationData?.direction ?? null),
      priceAtAlert,
    });

    await this.alertRepo.save(alert);

    // Granularny action dla observability
    let alertAction: string;
    if (isObservation) alertAction = 'ALERT_DB_ONLY_OBSERVATION';
    else if (dailyLimitHit) alertAction = 'ALERT_DB_ONLY_DAILY_LIMIT';
    else if (delivered) alertAction = 'ALERT_SENT_TELEGRAM';
    else alertAction = 'ALERT_TELEGRAM_FAILED';

    this.logger.log(
      `Alert ${alertAction}: ${rule.name} dla ${symbol}`,
    );

    // Rejestruj sygnał w CorrelationService
    if (this.correlation && correlationData) {
      try {
        const signal: StoredSignal = {
          id: `${rule.name}-${symbol}-${Date.now()}`,
          ticker: symbol,
          source_category: correlationData.sourceCategory,
          conviction: correlationData.conviction,
          direction: correlationData.direction === 'neutral'
            ? (correlationData.conviction >= 0 ? 'positive' : 'negative')
            : correlationData.direction,
          catalyst_type: catalystType ?? 'unknown',
          timestamp: Date.now(),
        };
        await this.correlation.storeSignal(signal);
        this.correlation.schedulePatternCheck(symbol);
      } catch (err) {
        this.logger.warn(`Correlation storeSignal error: ${err.message}`);
      }
    }

    return alertAction;
  }

  /** Mapuje nazwę źródła na kategorię dla CorrelationService */
  private mapSourceCategory(source: string): SourceCategory {
    switch (source?.toLowerCase()) {
      case 'stocktwits':
      case 'reddit':
        return 'social';
      case 'finnhub':
        return 'news';
      default:
        return 'news';
    }
  }

  /**
   * Pobiera regułę alertu z cache (TTL 5 min) lub z DB.
   * Redukuje liczbę zapytań — reguły zmieniają się rzadko.
   */
  private async getRule(name: string): Promise<AlertRule | null> {
    const now = Date.now();
    if (now > this.rulesCacheExpiry) {
      this.rulesCache.clear();
      this.rulesCacheExpiry = now + AlertEvaluatorService.RULES_CACHE_TTL_MS;
    }

    if (this.rulesCache.has(name)) {
      return this.rulesCache.get(name)!;
    }

    const rule = await this.ruleRepo.findOne({
      where: { name, isActive: true },
    });
    this.rulesCache.set(name, rule);
    return rule;
  }

  /**
   * Sprawdza czy alert tego typu per ticker jest wstrzymany (throttling).
   * Jeśli catalystType podany → throttle per (rule, symbol, catalyst).
   * Jeśli nie → per (rule, symbol) jak dotąd.
   */
  private async isThrottled(
    ruleName: string,
    symbol: string,
    throttleMinutes: number,
    catalystType?: string,
  ): Promise<boolean> {
    // Minimalny throttle 1 min — zapobiega spamowi przy batch importach
    const effectiveMinutes = Math.max(throttleMinutes, 1);
    const cutoff = new Date(Date.now() - effectiveMinutes * 60 * 1000);

    const where: FindOptionsWhere<Alert> = {
      ruleName,
      symbol,
      sentAt: MoreThan(cutoff),
    };
    if (catalystType) {
      where.catalystType = catalystType;
    }

    const count = await this.alertRepo.count({ where });

    return count > 0;
  }
}
