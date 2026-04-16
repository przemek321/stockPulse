/**
 * Testy detektora nietypowej aktywności opcyjnej.
 * Plik: src/collectors/options-flow/unusual-activity-detector.ts
 */

import {
  filterContracts,
  detectSpike,
  aggregatePerTicker,
  updateRollingAverage,
  calcOtmInfo,
  calcDte,
  type OptionsContract,
  type UnusualContract,
} from '../../src/collectors/options-flow/unusual-activity-detector';

// ── filterContracts ──

describe('filterContracts', () => {
  const today = new Date('2026-03-17');

  const makeContract = (
    overrides: Partial<OptionsContract> = {},
  ): OptionsContract => ({
    ticker: 'O:MRNA260417C00180000',
    underlying_ticker: 'MRNA',
    contract_type: 'call',
    strike_price: 180,
    expiration_date: '2026-04-17',
    ...overrides,
  });

  it('zachowuje kontrakty OTM z DTE ≤ 60', () => {
    const contracts = [makeContract({ strike_price: 150, expiration_date: '2026-04-17' })];
    const result = filterContracts(contracts, 120, today);
    expect(result).toHaveLength(1);
  });

  it('odrzuca kontrakty z DTE > 60', () => {
    const contracts = [makeContract({ expiration_date: '2026-06-17' })];
    const result = filterContracts(contracts, 120, today);
    expect(result).toHaveLength(0);
  });

  it('odrzuca kontrakty z DTE ≤ 0 (expired)', () => {
    const contracts = [makeContract({ expiration_date: '2026-03-16' })];
    const result = filterContracts(contracts, 120, today);
    expect(result).toHaveLength(0);
  });

  it('odrzuca kontrakty z OTM distance > 30%', () => {
    // call strike 200, underlying 120 → OTM 66%
    const contracts = [makeContract({ strike_price: 200 })];
    const result = filterContracts(contracts, 120, today);
    expect(result).toHaveLength(0);
  });

  it('odrzuca deep ITM kontrakty (OTM dist > 5% i nie OTM)', () => {
    // call strike 100, underlying 120 → ITM 16.7%
    const contracts = [makeContract({ strike_price: 100 })];
    const result = filterContracts(contracts, 120, today);
    expect(result).toHaveLength(0);
  });

  it('zachowuje lekko ITM kontrakty (OTM dist ≤ 5%)', () => {
    // call strike 118, underlying 120 → ITM 1.7%
    const contracts = [makeContract({ strike_price: 118, expiration_date: '2026-04-01' })];
    const result = filterContracts(contracts, 120, today);
    expect(result).toHaveLength(1);
  });

  it('poprawnie obsługuje put OTM', () => {
    // put strike 100, underlying 120 → OTM 16.7% (OK, ≤ 30%)
    const contracts = [makeContract({
      contract_type: 'put',
      strike_price: 100,
      expiration_date: '2026-04-01',
    })];
    const result = filterContracts(contracts, 120, today);
    expect(result).toHaveLength(1);
  });
});

// ── detectSpike ──

describe('detectSpike', () => {
  it('flaguje spike gdy volume/avg ≥ 3×', () => {
    const result = detectSpike(3000, 500, 10);
    expect(result.isUnusual).toBe(true);
    expect(result.spikeRatio).toBe(6);
  });

  it('nie flaguje gdy spike < 3×', () => {
    const result = detectSpike(1000, 500, 10);
    expect(result.isUnusual).toBe(false);
  });

  it('skip gdy za mało data points (< 5)', () => {
    const result = detectSpike(5000, 100, 3);
    expect(result.isUnusual).toBe(false);
  });

  it('skip gdy volume < 100 (szum)', () => {
    const result = detectSpike(50, 10, 10);
    expect(result.isUnusual).toBe(false);
  });

  it('skip gdy avg = 0 (dzielenie przez zero)', () => {
    const result = detectSpike(500, 0, 10);
    expect(result.isUnusual).toBe(false);
  });

  it('graniczny: volume = 3× avg → unusual', () => {
    const result = detectSpike(300, 100, 10);
    expect(result.isUnusual).toBe(true);
    expect(result.spikeRatio).toBe(3);
  });

  it('graniczny: volume = 2.99× avg → nie unusual', () => {
    const result = detectSpike(299, 100, 10);
    expect(result.isUnusual).toBe(false);
  });
});

// ── aggregatePerTicker ──

describe('aggregatePerTicker', () => {
  const makeUnusual = (
    overrides: Partial<UnusualContract> = {},
  ): UnusualContract => ({
    occSymbol: 'O:MRNA260417C00180000',
    symbol: 'MRNA',
    optionType: 'call',
    strike: 180,
    expiry: '2026-04-17',
    dte: 31,
    dailyVolume: 4200,
    avgVolume20d: 500,
    spikeRatio: 8.4,
    isOtm: true,
    otmDistance: 0.15,
    ...overrides,
  });

  it('null gdy brak unusual contracts', () => {
    expect(aggregatePerTicker('MRNA', [])).toBeNull();
  });

  it('oblicza call/put ratio poprawnie', () => {
    const contracts = [
      makeUnusual({ optionType: 'call', dailyVolume: 3000 }),
      makeUnusual({ optionType: 'call', dailyVolume: 1000 }),
      makeUnusual({ optionType: 'put', dailyVolume: 1000 }),
    ];
    const result = aggregatePerTicker('MRNA', contracts)!;
    expect(result.callPutRatio).toBe(0.8); // 4000 / 5000
    expect(result.callVolume).toBe(4000);
    expect(result.putVolume).toBe(1000);
  });

  it('wybiera headline contract z najwyższym spikeRatio', () => {
    const contracts = [
      makeUnusual({ spikeRatio: 3.5, occSymbol: 'A' }),
      makeUnusual({ spikeRatio: 12.0, occSymbol: 'B' }),
      makeUnusual({ spikeRatio: 5.0, occSymbol: 'C' }),
    ];
    const result = aggregatePerTicker('MRNA', contracts)!;
    expect(result.headlineContract.occSymbol).toBe('B');
  });

  it('zwraca prawidłowy totalUnusualContracts', () => {
    const contracts = [makeUnusual(), makeUnusual(), makeUnusual()];
    const result = aggregatePerTicker('MRNA', contracts)!;
    expect(result.totalUnusualContracts).toBe(3);
  });

  it('pure puts → callPutRatio = 0', () => {
    const contracts = [
      makeUnusual({ optionType: 'put', dailyVolume: 2000 }),
    ];
    const result = aggregatePerTicker('MRNA', contracts)!;
    expect(result.callPutRatio).toBe(0);
  });
});

// ── updateRollingAverage ──

describe('updateRollingAverage', () => {
  it('pierwszy data point: avg = newVolume', () => {
    const result = updateRollingAverage(0, 0, 1000);
    expect(result.avgVolume20d).toBe(1000);
    expect(result.dataPoints).toBe(1);
  });

  it('dodaje do istniejącej średniej', () => {
    // avg=500, 5 points, new=1000 → (500*5 + 1000) / 6 = 583.33
    const result = updateRollingAverage(500, 5, 1000);
    expect(result.avgVolume20d).toBeCloseTo(583.33, 1);
    expect(result.dataPoints).toBe(6);
  });

  it('cap na 20 data points', () => {
    const result = updateRollingAverage(500, 20, 1000);
    // (500*19 + 1000) / 20 = 525
    expect(result.avgVolume20d).toBe(525);
    expect(result.dataPoints).toBe(20);
  });

  it('nie przekracza 20 data points', () => {
    const result = updateRollingAverage(500, 25, 1000);
    expect(result.dataPoints).toBe(20);
  });

  // ── FLAG #21 fix: winsorization ──

  it('winsoryzuje volume >5× obecnego avg', () => {
    // avg=100, dp=10, volume=1000 (10× spike) → clip do 5×100=500
    // newAvg = (100*10 + 500) / 11 = 136.36
    const result = updateRollingAverage(100, 10, 1000);
    expect(result.avgVolume20d).toBeCloseTo(136.36, 1);
  });

  it('NIE winsoryzuje volume ≤5× avg', () => {
    // avg=100, dp=10, volume=400 (4× spike, poniżej progu)
    // newAvg = (100*10 + 400) / 11 = 127.27
    const result = updateRollingAverage(100, 10, 400);
    expect(result.avgVolume20d).toBeCloseTo(127.27, 1);
  });

  it('NIE winsoryzuje dla dp<5 (warmup period)', () => {
    // avg=100, dp=3, volume=1000 — dp<5, nie winsoryzujemy
    // newAvg = (100*3 + 1000) / 4 = 325
    const result = updateRollingAverage(100, 3, 1000);
    expect(result.avgVolume20d).toBe(325);
  });

  it('scenariusz camouflage: spike 100× nie zabija kolejnego 10×', () => {
    let avg = 100;
    let dp = 20;

    // Dzień 21: spike 100×
    const afterSpike = updateRollingAverage(avg, dp, 10000);
    avg = afterSpike.avgVolume20d;
    dp = afterSpike.dataPoints;
    // Z winsorization: avg powinno być < 200 (baseline nie zawyżony)
    expect(avg).toBeLessThan(200);

    // Dzień 22: prawdziwy spike 10× (volume=1000 vs normalne 100)
    const spikeRatio = 1000 / avg;
    expect(spikeRatio).toBeGreaterThan(3.0); // NADAL detectowany (próg 3×)
  });
});

// ── calcOtmInfo ──

describe('calcOtmInfo', () => {
  it('call OTM: strike > underlying', () => {
    const result = calcOtmInfo(150, 120, 'call');
    expect(result.isOtm).toBe(true);
    expect(result.otmDistance).toBe(0.25);
  });

  it('call ITM: strike < underlying', () => {
    const result = calcOtmInfo(100, 120, 'call');
    expect(result.isOtm).toBe(false);
  });

  it('put OTM: strike < underlying', () => {
    const result = calcOtmInfo(100, 120, 'put');
    expect(result.isOtm).toBe(true);
    expect(result.otmDistance).toBeCloseTo(0.1667, 3);
  });

  it('put ITM: strike > underlying', () => {
    const result = calcOtmInfo(150, 120, 'put');
    expect(result.isOtm).toBe(false);
  });
});

// ── calcDte ──

describe('calcDte', () => {
  it('oblicza DTE poprawnie', () => {
    const result = calcDte('2026-04-17', new Date('2026-03-17'));
    expect(result).toBe(31);
  });

  it('DTE = 0 dla dzisiejszej daty', () => {
    const result = calcDte('2026-03-17', new Date('2026-03-17'));
    expect(result).toBe(0);
  });

  it('ujemny DTE dla przeszłych dat', () => {
    const result = calcDte('2026-03-10', new Date('2026-03-17'));
    expect(result).toBeLessThan(0);
  });
});
