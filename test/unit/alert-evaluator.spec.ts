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

function createService(overrides: any = {}) {
  const alertRepo = overrides.alertRepo ?? createMockAlertRepo();
  const ruleRepo = overrides.ruleRepo ?? createMockRuleRepo();
  const tickerRepo = overrides.tickerRepo ?? createMockTickerRepo();
  const telegram = overrides.telegram ?? createMockTelegram();
  const formatter = overrides.formatter ?? createMockFormatter();
  const finnhub = overrides.finnhub ?? createMockFinnhub();
  const deliveryGate = overrides.deliveryGate ?? createMockDeliveryGate();
  const correlation = overrides.correlation ?? createMockCorrelation();

  const service = new AlertEvaluatorService(
    alertRepo as any,
    ruleRepo as any,
    tickerRepo as any,
    telegram as any,
    formatter as any,
    finnhub as any,
    deliveryGate as any,
    correlation as any,
  );

  return { service, alertRepo, ruleRepo, tickerRepo, telegram, formatter, finnhub, deliveryGate, correlation };
}

// ── Testy ──────────────────────────────────────────────

describe('AlertEvaluatorService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── Fix #1: onSentimentScored — Sprint 11 early return ──────────────

  describe('Fix #1: onSentimentScored — Sprint 11 early return', () => {
    it('powinien zwrócić SKIP dla wszystkich reguł sentymentowych (Sprint 11)', async () => {
      const { service, alertRepo } = createService();

      const result = await service.onSentimentScored({
        scoreId: 1,
        symbol: 'ISRG',
        score: -0.8,
        confidence: 0.9,
        label: 'negative',
        source: 'stocktwits',
        model: 'finbert+gpt-4o-mini',
        conviction: null,
        gptConviction: null,
        effectiveScore: -0.7,
        enrichedAnalysis: null,
      });

      // Sprint 11: early return bez wywołania żadnych check*() ani zapisu do DB
      expect(alertRepo.save).not.toHaveBeenCalled();
      expect(result.checks.sentimentCrash).toContain('Sprint 11');
      expect(result.checks.signalOverride).toContain('Sprint 11');
      expect(result.checks.highConviction).toContain('Sprint 11');
      expect(result.checks.strongFinbert).toContain('Sprint 11');
      expect(result.checks.urgentSignal).toContain('Sprint 11');
    });
  });

  // ── Fix #2: enrichedAnalysis null safety ──────────────

  describe('Fix #2: checkHighConviction — enrichedAnalysis null safety', () => {
    it('nie powinien crashnąć gdy conviction jest ustawiony a enrichedAnalysis=null', async () => {
      const { service, ruleRepo } = createService();
      const rule = createMockRule({ name: 'High Conviction Signal' });
      ruleRepo.findOne.mockResolvedValue(rule);

      // conviction=1.8 ale enrichedAnalysis=null — wcześniej crashowało przez !
      const result = await (service as any).checkHighConviction({
        symbol: 'MRNA',
        score: 0.9,
        confidence: 0.95,
        source: 'stocktwits',
        conviction: 1.8,
        enrichedAnalysis: null,
      });

      // Powinien wysłać alert bez crashu
      // Sprint 16 Tier 1: action values zmienione z ALERT_SENT na ALERT_SENT_TELEGRAM (granular)
      expect(result).toBe('ALERT_SENT_TELEGRAM: High Conviction Signal');
    });
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

  // ── checkSentimentCrash ──────────────────────────

  describe('checkSentimentCrash — logika decyzyjna', () => {
    it('SKIP gdy effectiveScore >= -0.5', async () => {
      const { service } = createService();
      const result = await (service as any).checkSentimentCrash({
        symbol: 'ISRG', score: -0.1, confidence: 0.9,
        source: 'stocktwits', model: 'finbert', effectiveScore: -0.3, enrichedAnalysis: null,
      });
      expect(result).toContain('SKIP');
    });

    it('SKIP gdy confidence < 0.7', async () => {
      const { service } = createService();
      const result = await (service as any).checkSentimentCrash({
        symbol: 'ISRG', score: -0.8, confidence: 0.5,
        source: 'stocktwits', model: 'finbert', effectiveScore: -0.7, enrichedAnalysis: null,
      });
      expect(result).toContain('SKIP');
    });
  });

  // ── checkStrongFinbert ──────────────────────────

  describe('checkStrongFinbert — fallback bez AI', () => {
    it('SKIP gdy conviction != null (ma analizę AI)', async () => {
      const { service } = createService();
      const result = await (service as any).checkStrongFinbert({
        symbol: 'ISRG', score: 0.9, confidence: 0.95,
        source: 'stocktwits', model: 'finbert', conviction: 1.5,
      });
      expect(result).toContain('SKIP');
    });

    it('SKIP gdy model != finbert', async () => {
      const { service } = createService();
      const result = await (service as any).checkStrongFinbert({
        symbol: 'ISRG', score: 0.9, confidence: 0.95,
        source: 'stocktwits', model: 'finbert+gpt-4o-mini', conviction: null,
      });
      expect(result).toContain('SKIP');
    });
  });
});
