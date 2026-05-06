/**
 * S19-FIX-03b (06.05.2026): OptionsFlowAlertService nie zasilał Redis
 * Sorted Set dla observation tickers (semi).
 *
 * Trigger: logi 24h 05.05-06.05 ujawniły że ONTO/AMKR/DELL/KLIC/ASX
 * (5/14 semi tickers) miały łącznie 14 storeSignal w correlation Redis,
 * mimo `observationOnly=true`. FIX-03 (29.04, b7ca9aa) dodał gate w
 * Form4Pipeline + Form8kPipeline, ale pominął OptionsFlowAlertService —
 * `correlation.storeSignal` w `processOptionsFlow` (linia 79-91) wywołane
 * bezwarunkowo gdy `absConv >= MIN_CONVICTION_CORRELATION`.
 *
 * Materialnie 24h: low — 3 aktywne wzorce wymagają form4 component
 * (FIX-03 blokuje form4 dla obs), więc żaden pattern nie fired.
 * Długoterminowo: backtest semi vertical (FIX-09) miałby skażony baseline,
 * a każdy nowy options-only pattern w przyszłości natychmiast leak.
 *
 * Fix: lookup `tickerRepo.findOne` przed correlation.storeSignal,
 * `if (isObservationTicker) skip storeSignal + schedulePatternCheck`.
 */

import { OptionsFlowAlertService } from '../../src/options-flow/options-flow-alert.service';

function buildMocks(opts: {
  observationOnly: boolean;
  conviction: number;
  pdufaBoosted?: boolean;
  symbol?: string;
}) {
  const symbol = opts.symbol ?? 'ONTO';
  const flow = {
    id: 12345,
    symbol,
    optionType: 'CALL',
    strike: 200,
    expiry: new Date('2026-06-20'),
    dte: 45,
    dailyVolume: 50000,
    avgVolume20d: 1500,
    volumeSpikeRatio: 33.3,
    otmDistance: 0.05,
    sessionDate: new Date('2026-05-05'),
  };

  const mocks = {
    flowRepo: {
      findOne: jest.fn().mockResolvedValue(flow),
      update: jest.fn(),
    },
    alertRepo: {
      findOne: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      save: jest.fn(),
    },
    ruleRepo: {
      findOne: jest.fn().mockResolvedValue({
        name: 'Unusual Options Activity',
        throttleMinutes: 120,
        isActive: true,
      }),
    },
    tickerRepo: {
      findOne: jest.fn().mockResolvedValue({
        symbol,
        sector: opts.observationOnly ? 'semi_supply_chain' : 'healthcare',
        observationOnly: opts.observationOnly,
      }),
    },
    scoring: {
      scoreFlow: jest.fn().mockResolvedValue({
        conviction: opts.conviction,
        direction: opts.conviction >= 0 ? 'positive' : 'negative',
        pdufaBoosted: opts.pdufaBoosted ?? false,
        callPutRatio: 2.5,
      }),
    },
    correlation: {
      storeSignal: jest.fn(),
      schedulePatternCheck: jest.fn(),
    },
    telegram: { sendMarkdown: jest.fn() },
    formatter: { formatOptionsFlowAlert: jest.fn().mockReturnValue('mock message') },
    finnhub: { getQuote: jest.fn().mockResolvedValue(180) },
    dispatcher: {
      dispatch: jest.fn().mockImplementation(async (params: any) => ({
        action: params.isObservationTicker ? 'ALERT_DB_ONLY_OBSERVATION' : 'ALERT_SENT_TELEGRAM',
        ticker: params.ticker,
        ruleName: params.ruleName,
        channel: params.isObservationTicker ? 'db_only' : 'telegram',
        delivered: !params.isObservationTicker,
        suppressedBy: params.isObservationTicker ? 'observation' : null,
      })),
    },
  };

  const service = new OptionsFlowAlertService(
    mocks.flowRepo as any,
    mocks.alertRepo as any,
    mocks.ruleRepo as any,
    mocks.tickerRepo as any,
    mocks.scoring as any,
    mocks.correlation as any,
    mocks.telegram as any,
    mocks.formatter as any,
    mocks.finnhub as any,
    mocks.dispatcher as any,
  );

  return { service, mocks };
}

describe('OptionsFlowAlertService — obs gate dla correlation.storeSignal (S19-FIX-03b)', () => {
  it('ONTO obs ticker conviction=0.64 → storeSignal NIE wywołane (CRITICAL fix)', async () => {
    const { service, mocks } = buildMocks({
      observationOnly: true,
      conviction: 0.64,
      symbol: 'ONTO',
    });

    const result = await service.onOptionsFlow({ flowId: 12345, symbol: 'ONTO' });

    expect(result.action).toBe('CORRELATION_STORED');
    // Krytyczne: zero footprint w Redis Sorted Set mimo conviction >= 0.25
    expect(mocks.correlation.storeSignal).not.toHaveBeenCalled();
    expect(mocks.correlation.schedulePatternCheck).not.toHaveBeenCalled();
    expect(mocks.tickerRepo.findOne).toHaveBeenCalledWith({ where: { symbol: 'ONTO' } });
  });

  it('ASX obs ticker conviction=0.72 (CRITICAL range) → storeSignal NIE wywołane', async () => {
    const { service, mocks } = buildMocks({
      observationOnly: true,
      conviction: 0.72,
      symbol: 'ASX',
    });

    await service.onOptionsFlow({ flowId: 12345, symbol: 'ASX' });

    expect(mocks.correlation.storeSignal).not.toHaveBeenCalled();
    expect(mocks.correlation.schedulePatternCheck).not.toHaveBeenCalled();
  });

  it('healthcare core (BMY) conviction=0.67 → storeSignal WYWOŁANE (sanity)', async () => {
    const { service, mocks } = buildMocks({
      observationOnly: false,
      conviction: 0.67,
      symbol: 'BMY',
    });

    await service.onOptionsFlow({ flowId: 12345, symbol: 'BMY' });

    expect(mocks.correlation.storeSignal).toHaveBeenCalledTimes(1);
    expect(mocks.correlation.schedulePatternCheck).toHaveBeenCalledTimes(1);

    const signalArg = mocks.correlation.storeSignal.mock.calls[0][0];
    expect(signalArg.source_category).toBe('options');
    expect(signalArg.conviction).toBe(0.67);
    expect(signalArg.ticker).toBe('BMY');
  });

  it('obs ticker negative conviction (-0.40) → storeSignal NIE wywołane (kierunek bez znaczenia)', async () => {
    const { service, mocks } = buildMocks({
      observationOnly: true,
      conviction: -0.40,
      symbol: 'AMKR',
    });

    await service.onOptionsFlow({ flowId: 12345, symbol: 'AMKR' });

    expect(mocks.correlation.storeSignal).not.toHaveBeenCalled();
  });

  it('obs ticker conviction=0.20 (poniżej MIN_CONVICTION_CORRELATION) → SKIP_LOW_CONVICTION (gate nie wywołany)', async () => {
    const { service, mocks } = buildMocks({
      observationOnly: true,
      conviction: 0.20,
      symbol: 'KLIC',
    });

    const result = await service.onOptionsFlow({ flowId: 12345, symbol: 'KLIC' });

    expect(result.action).toBe('SKIP_LOW_CONVICTION');
    expect(mocks.correlation.storeSignal).not.toHaveBeenCalled();
  });

  it('obs ticker + pdufaBoosted=true + conviction=0.60 → storeSignal NIE, alert path też DB only via dispatcher', async () => {
    // Nawet jeśli pdufaBoosted=true (rzadkie dla semi — PDUFA to healthcare context),
    // dispatcher z isObservationTicker=true dalej zwraca ALERT_DB_ONLY_OBSERVATION.
    // Redis nadal zostaje czysty.
    const { service, mocks } = buildMocks({
      observationOnly: true,
      conviction: 0.60,
      pdufaBoosted: true,
      symbol: 'DELL',
    });

    await service.onOptionsFlow({ flowId: 12345, symbol: 'DELL' });

    expect(mocks.correlation.storeSignal).not.toHaveBeenCalled();
    expect(mocks.correlation.schedulePatternCheck).not.toHaveBeenCalled();
    // sendAlert path uruchomiony bo pdufaBoosted, ale dispatcher gate tłumi delivery
    expect(mocks.dispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        ticker: 'DELL',
        isObservationTicker: true,
      }),
    );
  });
});
