/**
 * Testy heurystyki scoringu options flow.
 * Plik: src/options-flow/options-flow-scoring.service.ts
 */

import { OptionsFlowScoringService } from '../../src/options-flow/options-flow-scoring.service';
import { type TickerAggregation, type UnusualContract } from '../../src/collectors/options-flow/unusual-activity-detector';

// ── Mocki ──

function createMockPdufaRepo(upcoming: any = null) {
  return { findOne: jest.fn(async () => upcoming) };
}

function createService(pdufaOverride?: any) {
  const pdufaRepo = pdufaOverride ?? createMockPdufaRepo();
  const service = new OptionsFlowScoringService(pdufaRepo as any);
  return { service, pdufaRepo };
}

function makeHeadline(overrides: Partial<UnusualContract> = {}): UnusualContract {
  return {
    occSymbol: 'O:MRNA260417C00180000',
    symbol: 'MRNA',
    optionType: 'call',
    strike: 180,
    expiry: '2026-04-17',
    dte: 12,
    dailyVolume: 4200,
    avgVolume20d: 500,
    spikeRatio: 8.4,
    isOtm: true,
    otmDistance: 0.15,
    ...overrides,
  };
}

function makeAggregation(overrides: Partial<TickerAggregation> = {}): TickerAggregation {
  const headline = makeHeadline(overrides.headlineContract as any);
  return {
    symbol: 'MRNA',
    unusualContracts: [headline],
    callVolume: 4200,
    putVolume: 0,
    callPutRatio: 1.0,
    headlineContract: headline,
    totalUnusualContracts: 1,
    ...overrides,
  };
}

// ── Testy direction ──

describe('Options Flow Scoring — direction', () => {
  it('callPutRatio > 0.65 → positive', async () => {
    const { service } = createService();
    const result = await service.score(makeAggregation({ callPutRatio: 0.80 }));
    expect(result.direction).toBe('positive');
  });

  it('callPutRatio < 0.35 → negative', async () => {
    const { service } = createService();
    const result = await service.score(makeAggregation({
      callPutRatio: 0.20,
      headlineContract: makeHeadline({ optionType: 'put' }),
    }));
    expect(result.direction).toBe('negative');
    expect(result.conviction).toBeLessThan(0);
  });

  it('callPutRatio 0.35-0.65 → mixed z penalty 0.7', async () => {
    const { service } = createService();
    const resultMixed = await service.score(makeAggregation({ callPutRatio: 0.50 }));
    const resultClear = await service.score(makeAggregation({ callPutRatio: 0.80 }));
    expect(resultMixed.direction).toBe('mixed');
    // Mixed powinien mieć niższy |conviction| niż clear
    expect(Math.abs(resultMixed.conviction)).toBeLessThan(Math.abs(resultClear.conviction));
  });
});

// ── Testy conviction range ──

describe('Options Flow Scoring — conviction range', () => {
  it('conviction mieści się w [-1, +1]', async () => {
    const { service } = createService();
    const result = await service.score(makeAggregation({
      headlineContract: makeHeadline({ spikeRatio: 100, dailyVolume: 50000 }),
    }));
    expect(result.conviction).toBeLessThanOrEqual(1);
    expect(result.conviction).toBeGreaterThanOrEqual(-1);
  });

  it('silny spike → wysoki conviction', async () => {
    const { service } = createService();
    const result = await service.score(makeAggregation({
      callPutRatio: 0.90,
      headlineContract: makeHeadline({
        spikeRatio: 10,
        dailyVolume: 5000,
        otmDistance: 0.15,
        dte: 7,
      }),
    }));
    expect(Math.abs(result.conviction)).toBeGreaterThan(0.5);
  });

  it('słaby spike → niski conviction', async () => {
    const { service } = createService();
    const result = await service.score(makeAggregation({
      callPutRatio: 0.55,
      headlineContract: makeHeadline({
        spikeRatio: 3.1,
        dailyVolume: 150,
        otmDistance: 0.02,
        dte: 55,
      }),
    }));
    expect(Math.abs(result.conviction)).toBeLessThan(0.3);
  });
});

// ── Testy PDUFA boost ──

describe('Options Flow Scoring — PDUFA boost', () => {
  it('boost ×1.3 gdy PDUFA < 30 dni', async () => {
    const inFuture = new Date(Date.now() + 15 * 24 * 3600_000);
    const pdufaRepo = createMockPdufaRepo({
      symbol: 'MRNA',
      drugName: 'ribociclib',
      pdufaDate: inFuture.toISOString().split('T')[0],
    });
    const { service } = createService(pdufaRepo);
    const result = await service.score(makeAggregation());

    expect(result.pdufaBoosted).toBe(true);

    // Porównaj z wersją bez PDUFA
    const { service: service2 } = createService();
    const resultNoPdufa = await service2.score(makeAggregation());
    expect(Math.abs(result.conviction)).toBeGreaterThan(Math.abs(resultNoPdufa.conviction));
  });

  it('brak boost gdy PDUFA > 30 dni', async () => {
    const farFuture = new Date(Date.now() + 60 * 24 * 3600_000);
    const pdufaRepo = createMockPdufaRepo({
      symbol: 'MRNA',
      drugName: 'ribociclib',
      pdufaDate: farFuture.toISOString().split('T')[0],
    });
    const { service } = createService(pdufaRepo);
    const result = await service.score(makeAggregation());

    expect(result.pdufaBoosted).toBe(false);
  });

  it('brak boost gdy brak PDUFA', async () => {
    const { service } = createService();
    const result = await service.score(makeAggregation());
    expect(result.pdufaBoosted).toBe(false);
  });
});

// ── Testy komponentów scoringu ──

describe('Options Flow Scoring — komponenty', () => {
  it('wyższy spikeRatio → wyższy conviction', async () => {
    const { service } = createService();
    const low = await service.score(makeAggregation({
      headlineContract: makeHeadline({ spikeRatio: 3.5 }),
    }));
    const high = await service.score(makeAggregation({
      headlineContract: makeHeadline({ spikeRatio: 10 }),
    }));
    expect(Math.abs(high.conviction)).toBeGreaterThan(Math.abs(low.conviction));
  });

  it('wyższy volume → wyższy conviction', async () => {
    const { service } = createService();
    const low = await service.score(makeAggregation({
      headlineContract: makeHeadline({ dailyVolume: 200 }),
    }));
    const high = await service.score(makeAggregation({
      headlineContract: makeHeadline({ dailyVolume: 10000 }),
    }));
    expect(Math.abs(high.conviction)).toBeGreaterThan(Math.abs(low.conviction));
  });

  it('krótszy DTE → wyższy conviction', async () => {
    const { service } = createService();
    const far = await service.score(makeAggregation({
      headlineContract: makeHeadline({ dte: 55 }),
    }));
    const near = await service.score(makeAggregation({
      headlineContract: makeHeadline({ dte: 5 }),
    }));
    expect(Math.abs(near.conviction)).toBeGreaterThan(Math.abs(far.conviction));
  });

  it('dalszy OTM → wyższy conviction', async () => {
    const { service } = createService();
    const atm = await service.score(makeAggregation({
      headlineContract: makeHeadline({ otmDistance: 0.01 }),
    }));
    const otm = await service.score(makeAggregation({
      headlineContract: makeHeadline({ otmDistance: 0.14 }),
    }));
    expect(Math.abs(otm.conviction)).toBeGreaterThan(Math.abs(atm.conviction));
  });
});
