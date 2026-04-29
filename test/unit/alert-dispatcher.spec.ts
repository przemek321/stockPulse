import {
  AlertDispatcherService,
  DispatchParams,
  buildDispatcherUnavailableFallback,
} from '../../src/alerts/alert-dispatcher.service';

/**
 * Testy jednostkowe dla AlertDispatcherService (TASK-01, 22.04.2026).
 *
 * Weryfikuje:
 *   - Priority order suppression (observation > sell_no_edge > csuite_sell >
 *     cluster_sell > silent > daily_limit)
 *   - Return value zawiera {action, channel, suppressedBy, delivered}
 *   - bypassDailyLimit pomija gate
 *   - Telegram failure → action=ALERT_TELEGRAM_FAILED
 */

class FakeTelegramService {
  sendResult = true;
  async sendMarkdown(_message: string): Promise<boolean> {
    return this.sendResult;
  }
}

class FakeAlertDeliveryGate {
  allowed = true;
  async canDeliverToTelegram(_symbol: string): Promise<{ allowed: boolean; count: number; limit: number }> {
    return { allowed: this.allowed, count: this.allowed ? 0 : 5, limit: 5 };
  }
}

function buildDispatcher() {
  const telegram = new FakeTelegramService();
  const gate = new FakeAlertDeliveryGate();
  const dispatcher = new AlertDispatcherService(telegram as any, gate as any);
  return { dispatcher, telegram, gate };
}

const baseParams: DispatchParams = {
  ticker: 'TEST',
  ruleName: 'Test Rule',
  message: 'test message',
};

describe('AlertDispatcherService.dispatch — suppression priority', () => {
  it('observation ticker wygrywa nad wszystkim', async () => {
    const { dispatcher } = buildDispatcher();
    const result = await dispatcher.dispatch({
      ...baseParams,
      isObservationTicker: true,
      isSellNoEdge: true,
      isCsuiteSellObservation: true,
      isClusterSellObservation: true,
      isSilent: true,
    });
    expect(result.suppressedBy).toBe('observation');
    expect(result.action).toBe('ALERT_DB_ONLY_OBSERVATION');
    expect(result.channel).toBe('db_only');
    expect(result.delivered).toBe(false);
  });

  it('sell_no_edge wygrywa nad csuite/cluster/silent/daily', async () => {
    const { dispatcher } = buildDispatcher();
    const result = await dispatcher.dispatch({
      ...baseParams,
      isSellNoEdge: true,
      isCsuiteSellObservation: true,
      isClusterSellObservation: true,
      isSilent: true,
    });
    expect(result.suppressedBy).toBe('sell_no_edge');
    expect(result.action).toBe('ALERT_DB_ONLY_SELL_NO_EDGE');
  });

  it('gpt_missing_data wygrywa nad sell_no_edge/csuite/cluster/silent/daily (S19-FIX-01)', async () => {
    const { dispatcher } = buildDispatcher();
    const result = await dispatcher.dispatch({
      ...baseParams,
      isGptMissingData: true,
      isSellNoEdge: true,
      isCsuiteSellObservation: true,
      isClusterSellObservation: true,
      isSilent: true,
    });
    expect(result.suppressedBy).toBe('gpt_missing_data');
    expect(result.action).toBe('ALERT_DB_ONLY_GPT_MISSING_DATA');
    expect(result.channel).toBe('db_only');
    expect(result.delivered).toBe(false);
  });

  it('observation wygrywa nad gpt_missing_data', async () => {
    const { dispatcher } = buildDispatcher();
    const result = await dispatcher.dispatch({
      ...baseParams,
      isObservationTicker: true,
      isGptMissingData: true,
    });
    expect(result.suppressedBy).toBe('observation');
  });

  it('gpt_missing_data wygrywa nad daily_limit (gate by-blokował)', async () => {
    const { dispatcher, gate } = buildDispatcher();
    gate.allowed = false;
    const result = await dispatcher.dispatch({
      ...baseParams,
      isGptMissingData: true,
    });
    expect(result.suppressedBy).toBe('gpt_missing_data');
    expect(result.action).toBe('ALERT_DB_ONLY_GPT_MISSING_DATA');
  });

  it('csuite_sell_no_edge wygrywa nad cluster/silent/daily', async () => {
    const { dispatcher } = buildDispatcher();
    const result = await dispatcher.dispatch({
      ...baseParams,
      isCsuiteSellObservation: true,
      isClusterSellObservation: true,
      isSilent: true,
    });
    expect(result.suppressedBy).toBe('csuite_sell_no_edge');
    expect(result.action).toBe('ALERT_DB_ONLY_CSUITE_SELL_NO_EDGE');
  });

  it('cluster_sell_no_edge wygrywa nad silent/daily', async () => {
    const { dispatcher } = buildDispatcher();
    const result = await dispatcher.dispatch({
      ...baseParams,
      isClusterSellObservation: true,
      isSilent: true,
    });
    expect(result.suppressedBy).toBe('cluster_sell_no_edge');
    expect(result.action).toBe('ALERT_DB_ONLY_CLUSTER_SELL_NO_EDGE');
  });

  it('silent_rule wygrywa nad daily_limit', async () => {
    const { dispatcher, gate } = buildDispatcher();
    gate.allowed = false;
    const result = await dispatcher.dispatch({ ...baseParams, isSilent: true });
    expect(result.suppressedBy).toBe('silent_rule');
    expect(result.action).toBe('ALERT_DB_ONLY_SILENT_RULE');
  });

  it('daily_limit gdy gate blokuje', async () => {
    const { dispatcher, gate } = buildDispatcher();
    gate.allowed = false;
    const result = await dispatcher.dispatch(baseParams);
    expect(result.suppressedBy).toBe('daily_limit');
    expect(result.action).toBe('ALERT_DB_ONLY_DAILY_LIMIT');
  });
});

describe('AlertDispatcherService.dispatch — delivery path', () => {
  it('wysyła Telegram gdy brak suppression', async () => {
    const { dispatcher } = buildDispatcher();
    const result = await dispatcher.dispatch(baseParams);
    expect(result.delivered).toBe(true);
    expect(result.channel).toBe('telegram');
    expect(result.action).toBe('ALERT_SENT_TELEGRAM');
    expect(result.suppressedBy).toBeNull();
  });

  it('telegram_failed gdy sendMarkdown zwraca false', async () => {
    const { dispatcher, telegram } = buildDispatcher();
    telegram.sendResult = false;
    const result = await dispatcher.dispatch(baseParams);
    expect(result.delivered).toBe(false);
    expect(result.channel).toBe('db_only');
    expect(result.action).toBe('ALERT_TELEGRAM_FAILED');
    expect(result.suppressedBy).toBe('telegram_failed');
  });
});

describe('AlertDispatcherService.dispatch — bypassDailyLimit', () => {
  it('bankruptcy (bypassDailyLimit=true) ignoruje daily limit', async () => {
    const { dispatcher, gate } = buildDispatcher();
    gate.allowed = false;
    const result = await dispatcher.dispatch({ ...baseParams, bypassDailyLimit: true });
    expect(result.delivered).toBe(true);
    expect(result.action).toBe('ALERT_SENT_TELEGRAM');
    expect(result.suppressedBy).toBeNull();
  });

  it('bypassDailyLimit NIE ignoruje observation ticker', async () => {
    const { dispatcher } = buildDispatcher();
    const result = await dispatcher.dispatch({
      ...baseParams,
      isObservationTicker: true,
      bypassDailyLimit: true,
    });
    expect(result.suppressedBy).toBe('observation');
    expect(result.delivered).toBe(false);
  });
});

describe('AlertDispatcherService.dispatch — @Logged meta extraction', () => {
  it('zwraca ticker, ruleName, traceId dla @Logged extractLogMeta', async () => {
    const { dispatcher } = buildDispatcher();
    const result = await dispatcher.dispatch({
      ticker: 'AAPL',
      ruleName: 'Form 4 Insider BUY',
      traceId: 'trace-123',
      message: 'm',
    });
    expect(result.ticker).toBe('AAPL');
    expect(result.ruleName).toBe('Form 4 Insider BUY');
    expect(result.traceId).toBe('trace-123');
    expect(result.action).toBeDefined(); // extractLogMeta wyciąga action → decisionReason
  });
});

describe('buildDispatcherUnavailableFallback (FOLLOW-1, 23.04.2026)', () => {
  it('zwraca DispatchResult compatible shape z suppressedBy=dispatcher_unavailable', () => {
    const result = buildDispatcherUnavailableFallback({
      ticker: 'AAPL',
      ruleName: 'Form 4 Insider BUY',
    });
    expect(result.suppressedBy).toBe('dispatcher_unavailable');
    expect(result.action).toBe('ALERT_DB_ONLY_DISPATCHER_UNAVAILABLE');
    expect(result.channel).toBe('db_only');
    expect(result.delivered).toBe(false);
    expect(result.ticker).toBe('AAPL');
    expect(result.ruleName).toBe('Form 4 Insider BUY');
  });

  it('traceId undefined gdy nie przekazany (Form8k bankruptcy / Correlation / OptionsFlow)', () => {
    const result = buildDispatcherUnavailableFallback({
      ticker: 'NVDA',
      ruleName: '8-K Bankruptcy',
    });
    expect(result.traceId).toBeUndefined();
  });

  it('traceId propagowany gdy przekazany (Form4, Form8k main path)', () => {
    const result = buildDispatcherUnavailableFallback({
      ticker: 'MRNA',
      ruleName: 'Form 4 Insider BUY',
      traceId: 'trace-abc-123',
    });
    expect(result.traceId).toBe('trace-abc-123');
  });
});
