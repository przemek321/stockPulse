/**
 * Agent: Options Flow Alert Service
 *
 * Weryfikuje flow: scoring → correlation → Telegram alert.
 * Plik: src/options-flow/options-flow-alert.service.ts
 */

import { OptionsFlowAlertService } from '../../src/options-flow/options-flow-alert.service';

// ── Mocki ──

function createMockFlow(overrides: any = {}) {
  return {
    id: 1,
    symbol: 'MRNA',
    occSymbol: 'O:MRNA260417C00180000',
    optionType: 'call',
    strike: 180,
    underlyingPrice: 155,
    expiry: '2026-04-17',
    dte: 31,
    dailyVolume: 4200,
    avgVolume20d: 500,
    volumeSpikeRatio: 8.4,
    isOtm: true,
    otmDistance: 0.16,
    conviction: 0,
    direction: 'mixed',
    pdufaBoosted: false,
    sessionDate: '2026-03-17',
    ...overrides,
  };
}

function createMockFlowRepo(flow: any = null) {
  return {
    findOne: jest.fn(async () => flow ?? createMockFlow()),
    update: jest.fn(async () => ({})),
  };
}

function createMockAlertRepo() {
  return {
    create: jest.fn((d: any) => ({ id: 1, ...d })),
    save: jest.fn(async (e: any) => e),
    findOne: jest.fn(async () => null),
    count: jest.fn(async () => 0),
  };
}

function createMockRuleRepo(rule: any = null) {
  return {
    findOne: jest.fn(async () => rule ?? {
      id: 1, name: 'Unusual Options Activity',
      priority: 'HIGH', throttleMinutes: 120, isActive: true,
    }),
  };
}

function createMockScoring(result: any = null) {
  return {
    scoreFlow: jest.fn(async () => result ?? {
      conviction: 0.65,
      direction: 'positive',
      pdufaBoosted: false,
      callPutRatio: 0.80,
    }),
  };
}

function createMockCorrelation() {
  return {
    storeSignal: jest.fn(async () => ({})),
    schedulePatternCheck: jest.fn(),
  };
}

function createMockTelegram() {
  return { sendMarkdown: jest.fn(async () => true) };
}

function createMockFormatter() {
  return { formatOptionsFlowAlert: jest.fn(() => 'options alert message') };
}

function createMockFinnhub() {
  return { getQuote: jest.fn(async () => 155.5) };
}

function createMockTickerRepo(overrides: any = {}) {
  return {
    findOne: jest.fn(async () => overrides.ticker ?? { symbol: 'UNH', observationOnly: false, sector: 'healthcare' }),
  };
}

// AlertDispatcherService (TASK-01, 22.04.2026) — centralny punkt dispatch.
// Mock honoruje priority order: observation → suppressed, default → telegram path.
// Dispatcher woła telegram.sendMarkdown WEWNĄTRZ siebie (alert-dispatcher.service.ts:147),
// więc w testach jednostkowych options-flow-alert.service asercje sprawdzają
// `dispatcher.dispatch`, NIE bezpośrednio `telegram.sendMarkdown` (wzorzec spójny
// z test/unit/options-flow-obs-gate.spec.ts).
function createMockDispatcher() {
  return {
    dispatch: jest.fn().mockImplementation(async (params: any) => {
      const suppressed = params.isObservationTicker
        ? 'observation'
        : params.isGptMissingData
          ? 'gpt_missing_data'
          : params.isSellNoEdge
            ? 'sell_no_edge'
            : null;
      if (suppressed) {
        return {
          action: `ALERT_DB_ONLY_${suppressed.toUpperCase()}`,
          ticker: params.ticker,
          ruleName: params.ruleName,
          channel: 'db_only',
          delivered: false,
          suppressedBy: suppressed,
        };
      }
      return {
        action: 'ALERT_SENT_TELEGRAM',
        ticker: params.ticker,
        ruleName: params.ruleName,
        channel: 'telegram',
        delivered: true,
        suppressedBy: null,
      };
    }),
  };
}

function createAlertService(overrides: any = {}) {
  const flowRepo = overrides.flowRepo ?? createMockFlowRepo();
  const alertRepo = overrides.alertRepo ?? createMockAlertRepo();
  const ruleRepo = overrides.ruleRepo ?? createMockRuleRepo();
  const tickerRepo = overrides.tickerRepo ?? createMockTickerRepo(overrides);
  const scoring = overrides.scoring ?? createMockScoring();
  const correlation = overrides.correlation ?? createMockCorrelation();
  const telegram = overrides.telegram ?? createMockTelegram();
  const formatter = overrides.formatter ?? createMockFormatter();
  const finnhub = overrides.finnhub ?? createMockFinnhub();
  const dispatcher = overrides.dispatcher ?? createMockDispatcher();

  const service = new OptionsFlowAlertService(
    flowRepo as any,
    alertRepo as any,
    ruleRepo as any,
    tickerRepo as any,
    scoring as any,
    correlation as any,
    telegram as any,
    formatter as any,
    finnhub as any,
    dispatcher as any,
  );
  return { service, flowRepo, alertRepo, ruleRepo, scoring, correlation, telegram, formatter, finnhub, dispatcher };
}

// ── Testy flow ──

describe('Options Flow Alert — routing', () => {
  it('SKIP gdy flow not found', async () => {
    const { service } = createAlertService({
      flowRepo: { findOne: jest.fn(async () => null), update: jest.fn() },
    });
    const result = await service.onOptionsFlow({ flowId: 999, symbol: 'MRNA' });
    expect(result.action).toBe('SKIP_NOT_FOUND');
  });

  it('ALERT_SENT_TELEGRAM gdy conviction ≥ 0.50 i pdufaBoosted', async () => {
    const { service, correlation, dispatcher } = createAlertService({
      scoring: createMockScoring({ conviction: 0.65, direction: 'positive', pdufaBoosted: true, callPutRatio: 0.80 }),
    });
    const result = await service.onOptionsFlow({ flowId: 1, symbol: 'MRNA' });
    // Dispatcher zwraca ALERT_SENT_TELEGRAM dla happy path (alert-dispatcher.service.ts:150);
    // telegram.sendMarkdown jest wołany WEWNĄTRZ dispatchera, więc asercja na dispatcher.dispatch.
    expect(result.action).toBe('ALERT_SENT_TELEGRAM');
    expect(correlation.storeSignal).toHaveBeenCalled();
    expect(dispatcher.dispatch).toHaveBeenCalled();
  });

  it('CORRELATION_STORED gdy conviction ≥ 0.50 ale BEZ pdufaBoosted (Sprint 11)', async () => {
    const { service, correlation, telegram } = createAlertService({
      scoring: createMockScoring({ conviction: 0.65, direction: 'positive', pdufaBoosted: false, callPutRatio: 0.80 }),
    });
    const result = await service.onOptionsFlow({ flowId: 1, symbol: 'MRNA' });
    expect(result.action).toBe('CORRELATION_STORED');
    expect(correlation.storeSignal).toHaveBeenCalled();
    expect(telegram.sendMarkdown).not.toHaveBeenCalled();
  });

  it('CORRELATION_STORED gdy 0.25 ≤ conviction < 0.50', async () => {
    const { service, correlation, telegram } = createAlertService({
      scoring: createMockScoring({ conviction: 0.35, direction: 'positive', pdufaBoosted: false, callPutRatio: 0.70 }),
    });
    const result = await service.onOptionsFlow({ flowId: 1, symbol: 'MRNA' });
    expect(result.action).toBe('CORRELATION_STORED');
    expect(correlation.storeSignal).toHaveBeenCalled();
    expect(telegram.sendMarkdown).not.toHaveBeenCalled();
  });

  it('SKIP_LOW_CONVICTION gdy conviction < 0.25', async () => {
    const { service, correlation, telegram } = createAlertService({
      scoring: createMockScoring({ conviction: 0.15, direction: 'mixed', pdufaBoosted: false, callPutRatio: 0.50 }),
    });
    const result = await service.onOptionsFlow({ flowId: 1, symbol: 'MRNA' });
    expect(result.action).toBe('SKIP_LOW_CONVICTION');
    expect(correlation.storeSignal).not.toHaveBeenCalled();
    expect(telegram.sendMarkdown).not.toHaveBeenCalled();
  });
});

// ── Testy CorrelationService integration ──

describe('Options Flow Alert — CorrelationService', () => {
  it('storeSignal z source_category=options', async () => {
    const { service, correlation } = createAlertService({
      scoring: createMockScoring({ conviction: 0.40, direction: 'positive', pdufaBoosted: false, callPutRatio: 0.75 }),
    });
    await service.onOptionsFlow({ flowId: 1, symbol: 'MRNA' });

    expect(correlation.storeSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        source_category: 'options',
        ticker: 'MRNA',
        catalyst_type: 'unusual_options',
        direction: 'positive',
      }),
    );
    expect(correlation.schedulePatternCheck).toHaveBeenCalledWith('MRNA');
  });

  it('ujemny conviction → direction negative', async () => {
    const { service, correlation } = createAlertService({
      scoring: createMockScoring({ conviction: -0.40, direction: 'negative', pdufaBoosted: false, callPutRatio: 0.20 }),
    });
    await service.onOptionsFlow({ flowId: 1, symbol: 'MRNA' });

    expect(correlation.storeSignal).toHaveBeenCalledWith(
      expect.objectContaining({ direction: 'negative' }),
    );
  });
});

// ── Testy throttling ──

describe('Options Flow Alert — throttling', () => {
  it('THROTTLED gdy ostatni alert < throttle window', async () => {
    const recentAlert = {
      sentAt: new Date(Date.now() - 30 * 60_000), // 30 min temu (throttle = 120 min)
    };
    const alertRepo = createMockAlertRepo();
    alertRepo.findOne.mockResolvedValue(recentAlert as any);

    const { service, telegram } = createAlertService({
      alertRepo,
      scoring: createMockScoring({ conviction: 0.65, direction: 'positive', pdufaBoosted: true, callPutRatio: 0.80 }),
    });
    const result = await service.onOptionsFlow({ flowId: 1, symbol: 'MRNA' });
    expect(result.action).toBe('THROTTLED');
    expect(telegram.sendMarkdown).not.toHaveBeenCalled();
  });

  it('ALERT_SENT_TELEGRAM gdy ostatni alert > throttle window', async () => {
    const oldAlert = {
      sentAt: new Date(Date.now() - 180 * 60_000), // 3h temu (throttle = 120 min)
    };
    const alertRepo = createMockAlertRepo();
    alertRepo.findOne.mockResolvedValue(oldAlert as any);

    const { service, dispatcher } = createAlertService({
      alertRepo,
      scoring: createMockScoring({ conviction: 0.65, direction: 'positive', pdufaBoosted: true, callPutRatio: 0.80 }),
    });
    const result = await service.onOptionsFlow({ flowId: 1, symbol: 'MRNA' });
    expect(result.action).toBe('ALERT_SENT_TELEGRAM');
    expect(dispatcher.dispatch).toHaveBeenCalled();
  });
});

// ── Testy priority ──

describe('Options Flow Alert — priority', () => {
  it('conviction ≥ 0.70 → CRITICAL (pdufaBoosted)', async () => {
    const { service, alertRepo } = createAlertService({
      scoring: createMockScoring({ conviction: 0.75, direction: 'positive', pdufaBoosted: true, callPutRatio: 0.90 }),
    });
    await service.onOptionsFlow({ flowId: 1, symbol: 'MRNA' });

    expect(alertRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 'CRITICAL' }),
    );
  });

  it('conviction < 0.70 → HIGH (pdufaBoosted)', async () => {
    const { service, alertRepo } = createAlertService({
      scoring: createMockScoring({ conviction: 0.55, direction: 'positive', pdufaBoosted: true, callPutRatio: 0.75 }),
    });
    await service.onOptionsFlow({ flowId: 1, symbol: 'MRNA' });

    expect(alertRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 'HIGH' }),
    );
  });
});

// ── Test reguła nieaktywna ──

describe('Options Flow Alert — reguła', () => {
  it('SKIP_NO_RULE gdy reguła nie istnieje (conviction ≥ 0.50 + pdufaBoosted ale brak reguły)', async () => {
    const { service, telegram, dispatcher } = createAlertService({
      ruleRepo: { findOne: jest.fn(async () => null) },
      scoring: createMockScoring({ conviction: 0.65, direction: 'positive', pdufaBoosted: true, callPutRatio: 0.80 }),
    });
    const result = await service.onOptionsFlow({ flowId: 1, symbol: 'MRNA' });
    // sendAlert wraca SKIP_NO_RULE (options-flow-alert.service.ts:144) PRZED
    // dispatcherem — stary komentarz "zwraca false → THROTTLED" był stale
    // (kod zwraca string action, nie boolean).
    expect(result.action).toBe('SKIP_NO_RULE');
    expect(telegram.sendMarkdown).not.toHaveBeenCalled();
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });
});
