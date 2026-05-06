import { Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { EventType } from '../events/event-types';
import { OptionsFlow, Alert, AlertRule, Ticker } from '../entities';
import { OptionsFlowScoringService } from './options-flow-scoring.service';
import { CorrelationService } from '../correlation/correlation.service';
import { TelegramService } from '../alerts/telegram/telegram.service';
import { TelegramFormatterService } from '../alerts/telegram/telegram-formatter.service';
import { FinnhubService } from '../collectors/finnhub/finnhub.service';
import { Logged } from '../common/decorators/logged.decorator';
import { AlertDispatcherService, buildDispatcherUnavailableFallback } from '../alerts/alert-dispatcher.service';

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
    @InjectRepository(Ticker)
    private readonly tickerRepo: Repository<Ticker>,
    private readonly scoring: OptionsFlowScoringService,
    @Optional() private readonly correlation: CorrelationService,
    private readonly telegram: TelegramService,
    private readonly formatter: TelegramFormatterService,
    @Optional() private readonly finnhub: FinnhubService,
    @Optional() private readonly dispatcher?: AlertDispatcherService,
  ) {}

  @OnEvent(EventType.NEW_OPTIONS_FLOW)
  @Logged('options-flow')
  async onOptionsFlow(payload: {
    flowId: number;
    symbol: string;
    traceId?: string;
  }): Promise<{ action: string; symbol: string; conviction?: number; traceId?: string }> {
    const flow = await this.flowRepo.findOne({ where: { id: payload.flowId } });
    if (!flow) return { action: 'SKIP_NOT_FOUND', symbol: payload.symbol, traceId: payload.traceId };

    // Score
    const result = await this.scoring.scoreFlow(flow);

    // Zapisz conviction do options_flow record
    await this.flowRepo.update(flow.id, {
      conviction: result.conviction,
      direction: result.direction,
      pdufaBoosted: result.pdufaBoosted,
    });

    const absConv = Math.abs(result.conviction);

    // S19-FIX-03b (06.05.2026): observation gate dla options-flow correlation path.
    // FIX-03 (29.04, b7ca9aa) dodał gate w Form4Pipeline + Form8kPipeline ale
    // pominął OptionsFlowAlertService — semi tickers (ONTO/AMKR/DELL/KLIC/ASX
    // potwierdzone w logach 24h 05.05-06.05: 14 contracts → 14 storeSignal
    // w Redis Sorted Set) leakowały do correlation mimo observationOnly=true.
    // CLAUDE.md ("Semi tickers: zero footprint w Redis") było fałszywe.
    // Materialnie 24h: low — 3 aktywne wzorce wymagają form4 component
    // (FIX-03 blokuje), żaden pattern nie fired. Długoterminowo: backtest
    // semi vertical (FIX-09) miałby skażony baseline + każdy nowy options-only
    // pattern w przyszłości natychmiastowy obs leak. Lookup tickerRepo był
    // już w sendAlert path (Telegram dispatch); podnosimy wyżej żeby Redis
    // też respektował obs flag.
    const ticker = await this.tickerRepo.findOne({ where: { symbol: flow.symbol } });
    const isObservationTicker = ticker?.observationOnly === true;

    // Rejestruj w CorrelationService — tylko dla non-observation tickerów
    if (absConv >= MIN_CONVICTION_CORRELATION && this.correlation && !isObservationTicker) {
      await this.correlation.storeSignal({
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
    } else if (absConv >= MIN_CONVICTION_CORRELATION && isObservationTicker) {
      this.logger.debug(
        `OptionsFlow ${flow.symbol}: pomijam correlation.storeSignal ` +
          `(observation ticker — backtest semi vertical baseline preservation)`,
      );
    }

    // Sprint 11: Standalone alert TYLKO gdy pdufaBoosted=true
    // Bez PDUFA kontekstu options spike = szum (52.5% hit rate)
    if (absConv >= MIN_CONVICTION_ALERT && result.pdufaBoosted) {
      const alertAction = await this.sendAlert(flow, result);
      return {
        action: alertAction,
        symbol: flow.symbol,
        conviction: result.conviction,
        traceId: payload.traceId,
      };
    }

    return {
      action: absConv >= MIN_CONVICTION_CORRELATION ? 'CORRELATION_STORED' : 'SKIP_LOW_CONVICTION',
      symbol: flow.symbol,
      conviction: result.conviction,
      traceId: payload.traceId,
    };
  }

  /**
   * Wysyła alert Telegram i zapisuje do tabeli alerts.
   * Zwraca granularny action string zamiast boolean.
   */
  private async sendAlert(
    flow: OptionsFlow,
    scoring: { conviction: number; direction: string; pdufaBoosted: boolean; callPutRatio: number },
  ): Promise<string> {
    const rule = await this.getRule();
    if (!rule) return 'SKIP_NO_RULE';

    // Sprawdź throttle
    const throttleMs = (rule.throttleMinutes || 120) * 60_000;
    const recentAlert = await this.alertRepo.findOne({
      where: {
        symbol: flow.symbol,
        ruleName: rule.name,
        delivered: true,
      },
      order: { sentAt: 'DESC' },
    });

    if (recentAlert) {
      const elapsed = Date.now() - new Date(recentAlert.sentAt).getTime();
      if (elapsed < throttleMs) return 'THROTTLED';
    }

    // Sprawdź daily limit per ticker
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayCount = await this.alertRepo.count({
      where: {
        symbol: flow.symbol,
        delivered: true,
        sentAt: MoreThanOrEqual(todayStart),
      },
    });
    if (todayCount >= MAX_DAILY_ALERTS) return 'ALERT_DB_ONLY_DAILY_LIMIT';

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

    // TASK-01: centralized dispatch via AlertDispatcherService.
    // Options flow standalone alert NIE był gated przez daily limit (pre-TASK-01).
    // Zachowuję to poprzez bypassDailyLimit=true — zmiana policy to osobny task.
    const ticker = await this.tickerRepo.findOne({ where: { symbol: flow.symbol } });
    const dispatchResult = this.dispatcher
      ? await this.dispatcher.dispatch({
          ticker: flow.symbol,
          ruleName: rule.name,
          message,
          isObservationTicker: ticker?.observationOnly === true,
          bypassDailyLimit: true,
        })
      : buildDispatcherUnavailableFallback({ ticker: flow.symbol, ruleName: rule.name });

    const delivered = dispatchResult.delivered;
    const nonDeliveryReason = dispatchResult.suppressedBy;

    // Price at alert
    let priceAtAlert: number | undefined;
    try {
      if (this.finnhub) {
        priceAtAlert = (await this.finnhub.getQuote(flow.symbol)) ?? undefined;
      }
    } catch { /* noop */ }

    // Zapisz alert
    try {
      await this.alertRepo.save(
        this.alertRepo.create({
          symbol: flow.symbol,
          ruleName: rule.name,
          priority,
          channel: 'TELEGRAM',
          message,
          delivered,
          nonDeliveryReason,
          catalystType: 'unusual_options',
          alertDirection: scoring.conviction > 0 ? 'positive' : 'negative',
          priceAtAlert,
        }),
      );
    } catch (err) {
      this.logger.error(`Failed to save Options Flow alert for ${flow.symbol}: ${err.message}`);
    }

    this.logger.log(
      `Alert: ${flow.symbol} unusual options conviction=${scoring.conviction.toFixed(3)} ${scoring.direction}`,
    );

    return dispatchResult.action;
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
