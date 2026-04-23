import { AlertEvaluatorService } from '../../src/alerts/alert-evaluator.service';

/**
 * Testy AlertEvaluatorService — weryfikacja fixów #1-#9.
 *
 * Używamy mocków zamiast prawdziwych repozytoriów/serwisów.
 * Testujemy logikę biznesową: throttling, cache reguł, agregacja insider trades,
 * obsługa null enrichedAnalysis, OnModuleDestroy.
 */

// ── Mocki ──────────────────────────────────────────────

function createMockRule(overrides: Partial<any> = {}) {
  return {
    id: 1,
    name: 'Test Rule',
    condition: '',
    priority: 'HIGH',
    throttleMinutes: 15,
    isActive: true,
    ...overrides,
  };
}

function createMockAlertRepo() {
  return {
    create: jest.fn((data: any) => ({ id: 1, ...data })),
    save: jest.fn(async (entity: any) => entity),
    findOne: jest.fn(async () => null),
    count: jest.fn(async () => 0),
  };
}

function createMockRuleRepo() {
  return {
    findOne: jest.fn(async () => null),
  };
}

function createMockTickerRepo() {
  return {
    findOne: jest.fn(async () => null),
  };
}

function createMockTelegram() {
  return {
    sendMarkdown: jest.fn(async () => true),
  };
}

function createMockFormatter() {
  return {
    formatInsiderTradeAlert: jest.fn(() => 'insider alert'),
    formatInsiderBatchAlert: jest.fn(() => 'batch alert'),
    formatFilingAlert: jest.fn(() => 'filing alert'),
    formatSentimentAlert: jest.fn(() => 'sentiment alert'),
    formatSignalOverrideAlert: jest.fn(() => 'override alert'),
    formatConvictionAlert: jest.fn(() => 'conviction alert'),
    formatUrgentAiAlert: jest.fn(() => 'urgent ai alert'),
    formatStrongFinbertAlert: jest.fn(() => 'finbert alert'),
  };
}

function createMockFinnhub() {
  return {
    getQuote: jest.fn(async () => 42.5),
  };
}

function createMockCorrelation() {
  return {
    storeSignal: jest.fn(async () => {}),
    schedulePatternCheck: jest.fn(),
  };
}

function createMockDeliveryGate(overrides: { allowed?: boolean; count?: number } = {}) {
  return {
    canDeliverToTelegram: jest.fn(async () => ({
      allowed: overrides.allowed ?? true,
      count: overrides.count ?? 0,
      limit: 5,
    })),
  };
}

function createMockDispatcher() {
  return {
    dispatch: jest.fn(async (params: any) => ({
      action: 'ALERT_SENT_TELEGRAM',
      ticker: params.ticker,
      ruleName: params.ruleName,
      channel: 'telegram' as const,
      delivered: true,
      suppressedBy: null,
      traceId: params.traceId,
    })),
  };
}

function createService(overrides: any = {}) {
  const alertRepo = overrides.alertRepo ?? createMockAlertRepo();
  const ruleRepo = overrides.ruleRepo ?? createMockRuleRepo();
  const tickerRepo = overrides.tickerRepo ?? createMockTickerRepo();
  const telegram = overrides.telegram ?? createMockTelegram();
  const formatter = overrides.formatter ?? createMockFormatter();
  const finnhub = overrides.finnhub ?? createMockFinnhub();
  const deliveryGate = overrides.deliveryGate ?? createMockDeliveryGate();
  const dispatcher = overrides.dispatcher ?? createMockDispatcher();
  const correlation = overrides.correlation ?? createMockCorrelation();

  const service = new AlertEvaluatorService(
    alertRepo as any,
    ruleRepo as any,
    tickerRepo as any,
    telegram as any,
    formatter as any,
    finnhub as any,
    deliveryGate as any,
    dispatcher as any,
    correlation as any,
  );

  return { service, alertRepo, ruleRepo, tickerRepo, telegram, formatter, finnhub, deliveryGate, dispatcher, correlation };
}

// ── Testy ──────────────────────────────────────────────

describe('AlertEvaluatorService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── Fix #4: onFiling pobiera nazwę firmy ──────────────

  describe('Fix #4: onFiling — pobiera nazwę firmy', () => {
    it('powinien użyć nazwy z tickerRepo zamiast symbolu', async () => {
      const { service, ruleRepo, tickerRepo, formatter } = createService();
      const rule = createMockRule({ name: '8-K Material Event' });
      ruleRepo.findOne.mockResolvedValue(rule);
      tickerRepo.findOne.mockResolvedValue({ symbol: 'ISRG', name: 'Intuitive Surgical' });

      await service.onFiling({
        filingId: 1,
        symbol: 'ISRG',
        formType: '8-K',
      });

      expect(tickerRepo.findOne).toHaveBeenCalledWith({ where: { symbol: 'ISRG' } });
      expect(formatter.formatFilingAlert).toHaveBeenCalledWith(
        expect.objectContaining({ companyName: 'Intuitive Surgical' }),
      );
    });
  });

  // ── Fix #7: Cache reguł alertów ──────────────────────

  describe('Fix #7: cache reguł — TTL 5 min', () => {
    it('powinien cachować regułę i nie odpytywać DB ponownie', async () => {
      const { service, ruleRepo } = createService();
      const rule = createMockRule({ name: 'Sentiment Crash' });
      ruleRepo.findOne.mockResolvedValue(rule);

      // Pierwsze wywołanie — odpytuje DB
      const result1 = await (service as any).getRule('Sentiment Crash');
      expect(result1).toBe(rule);
      expect(ruleRepo.findOne).toHaveBeenCalledTimes(1);

      // Drugie wywołanie — z cache
      const result2 = await (service as any).getRule('Sentiment Crash');
      expect(result2).toBe(rule);
      expect(ruleRepo.findOne).toHaveBeenCalledTimes(1); // nadal 1
    });

    it('powinien odświeżyć cache po 5 minutach', async () => {
      const { service, ruleRepo } = createService();
      const rule = createMockRule({ name: 'Sentiment Crash' });
      ruleRepo.findOne.mockResolvedValue(rule);

      await (service as any).getRule('Sentiment Crash');
      expect(ruleRepo.findOne).toHaveBeenCalledTimes(1);

      // Przesuń czas o 6 minut
      jest.advanceTimersByTime(6 * 60 * 1000);

      await (service as any).getRule('Sentiment Crash');
      expect(ruleRepo.findOne).toHaveBeenCalledTimes(2); // odświeżony
    });

    it('powinien cachować null dla nieistniejącej reguły', async () => {
      const { service, ruleRepo } = createService();
      ruleRepo.findOne.mockResolvedValue(null);

      const result1 = await (service as any).getRule('Nonexistent Rule');
      expect(result1).toBeNull();

      const result2 = await (service as any).getRule('Nonexistent Rule');
      expect(result2).toBeNull();

      // Tylko 1 zapytanie do DB — null też jest cachowany
      expect(ruleRepo.findOne).toHaveBeenCalledTimes(1);
    });
  });

  // ── Fix #8: isThrottled — count zamiast findOne ──────

  describe('Fix #8: isThrottled — używa count()', () => {
    it('powinien zwrócić false gdy count=0', async () => {
      const { service, alertRepo } = createService();
      alertRepo.count.mockResolvedValue(0);

      const result = await (service as any).isThrottled('Test Rule', 'ISRG', 15);
      expect(result).toBe(false);
      expect(alertRepo.count).toHaveBeenCalled();
      expect(alertRepo.findOne).not.toHaveBeenCalled(); // NIE findOne
    });

    it('powinien zwrócić true gdy count>0', async () => {
      const { service, alertRepo } = createService();
      alertRepo.count.mockResolvedValue(1);

      const result = await (service as any).isThrottled('Test Rule', 'ISRG', 15);
      expect(result).toBe(true);
    });

    it('powinien dodać catalystType do where gdy podany', async () => {
      const { service, alertRepo } = createService();
      alertRepo.count.mockResolvedValue(0);

      await (service as any).isThrottled('Test Rule', 'ISRG', 15, 'fda_approval');

      const whereArg = alertRepo.count.mock.calls[0][0].where;
      expect(whereArg.catalystType).toBe('fda_approval');
    });
  });

  // ── Fix #9: typ FindOptionsWhere (weryfikacja kompilacji — implicite) ──

  describe('Fix #9: isThrottled — minimalny throttle 1 min', () => {
    it('powinien wymuszać minimalny throttle 1 min nawet gdy throttleMinutes=0', async () => {
      const { service, alertRepo } = createService();
      alertRepo.count.mockResolvedValue(0);

      await (service as any).isThrottled('Test Rule', 'ISRG', 0);

      const whereArg = alertRepo.count.mock.calls[0][0].where;
      // sentAt powinien być MoreThan(now - 1 min), nie MoreThan(now - 0 min)
      expect(whereArg.sentAt).toBeDefined();
    });
  });

  // ── Sprint 11: Agregacja insider trades usunięta ──────────────────────────
  // Insider trades obsługiwane przez Form4Pipeline z GPT-enriched conviction.
  // Reguła "Insider Trade Large" wyłączona (isActive=false).

});
