import { Injectable, Logger } from '@nestjs/common';
import { TelegramService } from './telegram/telegram.service';
import { AlertDeliveryGate } from './alert-delivery-gate.service';
import { Logged } from '../common/decorators/logged.decorator';

/**
 * Kontekst dispatch'u alertu — caller ustala flagi suppression na podstawie
 * pipeline-specific logiki (ticker observation, sell_no_edge, cluster_sell etc.).
 *
 * Priorytet suppression (najbardziej-specific wygrywa):
 *   1. isObservationTicker  — semi supply chain / healthcare observation mode
 *   2. isSellNoEdge         — Sprint 17 Form4 SELL (V4 backtest: zero edge)
 *   3. isCsuiteSellObservation — Sprint 16b Form4 C-suite SELL
 *   4. isClusterSellObservation — Sprint 15 Correlation INSIDER_CLUSTER SELL
 *   5. isSilent             — silent rule (reserved, po cleanup SILENT_RULES brak)
 *   6. dailyLimitHit        — AlertDeliveryGate shared limit (chyba że bypassDailyLimit)
 */
export interface DispatchParams {
  ticker: string;
  ruleName: string;
  traceId?: string;
  parentTraceId?: string;
  message: string;

  isObservationTicker?: boolean;
  isSellNoEdge?: boolean;
  isCsuiteSellObservation?: boolean;
  isClusterSellObservation?: boolean;
  isSilent?: boolean;
  bypassDailyLimit?: boolean;
}

/**
 * Wynik dispatch'u — struktura dopasowana do @Logged extractLogMeta,
 * `action` mapuje się na `decision_reason` w system_logs.
 */
export interface DispatchResult {
  action: string;
  ticker: string;
  ruleName: string;
  traceId?: string;
  channel: 'telegram' | 'db_only';
  delivered: boolean;
  suppressedBy: string | null;
}

/**
 * Centralny punkt dispatch'u alertów. Zastępuje rozproszoną logikę suppression
 * w pipeline'ach (Form4, Form8k, Correlation, OptionsFlow, AlertEvaluator).
 *
 * Zalety:
 *   - Jedno miejsce decyzji channel=telegram|db_only
 *   - @Logged('alerts') łapie KAŻDY dispatch → system_logs ma complete audit trail
 *   - Unified `suppressedBy` values: observation, sell_no_edge, csuite_sell_no_edge,
 *     cluster_sell_no_edge, silent_rule, daily_limit, telegram_failed
 *
 * TASK-01 (22.04.2026): Audyt logów ujawnił brak obserwowalności finalnej decyzji
 * dispatch. system_logs pokazywały STORED / PATTERNS_DETECTED / THROTTLED ale nie
 * "czy alert poszedł na Telegram". Ten serwis zamyka gap.
 */
@Injectable()
export class AlertDispatcherService {
  private readonly logger = new Logger(AlertDispatcherService.name);

  constructor(
    private readonly telegram: TelegramService,
    private readonly deliveryGate: AlertDeliveryGate,
  ) {}

  @Logged('alerts')
  async dispatch(params: DispatchParams): Promise<DispatchResult> {
    const { ticker, ruleName, traceId, message, bypassDailyLimit } = params;

    let suppressedBy: string | null = null;

    if (params.isObservationTicker) {
      suppressedBy = 'observation';
    } else if (params.isSellNoEdge) {
      suppressedBy = 'sell_no_edge';
    } else if (params.isCsuiteSellObservation) {
      suppressedBy = 'csuite_sell_no_edge';
    } else if (params.isClusterSellObservation) {
      suppressedBy = 'cluster_sell_no_edge';
    } else if (params.isSilent) {
      suppressedBy = 'silent_rule';
    } else if (!bypassDailyLimit) {
      const gateCheck = await this.deliveryGate.canDeliverToTelegram(ticker);
      if (!gateCheck.allowed) {
        suppressedBy = 'daily_limit';
      }
    }

    let delivered: boolean;
    let action: string;
    let channel: 'telegram' | 'db_only';

    if (suppressedBy) {
      delivered = false;
      channel = 'db_only';
      action = `ALERT_DB_ONLY_${suppressedBy.toUpperCase()}`;
    } else {
      delivered = await this.telegram.sendMarkdown(message);
      if (delivered) {
        channel = 'telegram';
        action = 'ALERT_SENT_TELEGRAM';
      } else {
        channel = 'db_only';
        action = 'ALERT_TELEGRAM_FAILED';
        suppressedBy = 'telegram_failed';
        this.logger.error(
          `TELEGRAM FAILED: ${ruleName} dla ${ticker} not delivered — saved to DB`,
        );
      }
    }

    return { action, ticker, ruleName, traceId, channel, delivered, suppressedBy };
  }
}
