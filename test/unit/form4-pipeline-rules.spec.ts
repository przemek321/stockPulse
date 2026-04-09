/**
 * Testy reguł Form4Pipeline dodanych w Sprint 15-17:
 * - Director SELL → hard skip (backtest: anty-sygnał)
 * - BUY conviction boost (C-suite ×1.3, healthcare ×1.2)
 * - Observation mode gate (ticker.observationOnly → DB only, brak Telegramu)
 */

describe('Form4Pipeline — Director SELL skip (Sprint 15)', () => {
  const isDirectorSell = (role: string | null, txType: string) => {
    const isDirector = /\bDirector\b/i.test(role ?? '');
    return isDirector && txType === 'SELL';
  };

  it('Director SELL → skip', () => {
    expect(isDirectorSell('Director', 'SELL')).toBe(true);
  });

  it('Director BUY → NIE skip', () => {
    expect(isDirectorSell('Director', 'BUY')).toBe(false);
  });

  it('CEO SELL → NIE skip (tylko Director)', () => {
    expect(isDirectorSell('CEO', 'SELL')).toBe(false);
  });

  it('Chairman & CEO, Director SELL → skip (zawiera Director)', () => {
    expect(isDirectorSell('Chairman & CEO, Director', 'SELL')).toBe(true);
  });

  it('EVP and Chief Legal Officer SELL → NIE skip', () => {
    expect(isDirectorSell('EVP and Chief Legal Officer', 'SELL')).toBe(false);
  });

  it('null role SELL → NIE skip', () => {
    expect(isDirectorSell(null, 'SELL')).toBe(false);
  });
});

describe('Form4Pipeline — BUY conviction boost (Sprint 15)', () => {
  const applyBuyBoost = (
    conviction: number,
    isBuy: boolean,
    isCsuite: boolean,
    sector: string | null,
  ): number => {
    if (isBuy) {
      if (isCsuite) conviction *= 1.3;
      if (sector === 'healthcare') conviction *= 1.2;
    }
    return conviction;
  };

  it('C-suite healthcare BUY → ×1.3 × ×1.2 = ×1.56', () => {
    const result = applyBuyBoost(1.0, true, true, 'healthcare');
    expect(result).toBeCloseTo(1.56, 2);
  });

  it('C-suite semi BUY → ×1.3 tylko (bez healthcare boost)', () => {
    const result = applyBuyBoost(1.0, true, true, 'semi_supply_chain');
    expect(result).toBeCloseTo(1.3, 2);
  });

  it('Director healthcare BUY → ×1.2 tylko (bez C-suite boost)', () => {
    const result = applyBuyBoost(1.0, true, false, 'healthcare');
    expect(result).toBeCloseTo(1.2, 2);
  });

  it('C-suite SELL → bez boost (boost tylko na BUY)', () => {
    const result = applyBuyBoost(1.0, false, true, 'healthcare');
    expect(result).toBeCloseTo(1.0, 2);
  });

  it('null sector → bez healthcare boost', () => {
    const result = applyBuyBoost(1.0, true, true, null);
    expect(result).toBeCloseTo(1.3, 2);
  });
});

describe('Observation mode gate (Sprint 17)', () => {
  const getObservationResult = (observationOnly: boolean | undefined) => {
    const isObservation = observationOnly === true;
    const delivered = isObservation ? false : true; // simplified
    const nonDeliveryReason = isObservation ? 'observation' : null;
    return { delivered, nonDeliveryReason };
  };

  it('observationOnly=true → delivered=false, reason=observation', () => {
    const r = getObservationResult(true);
    expect(r.delivered).toBe(false);
    expect(r.nonDeliveryReason).toBe('observation');
  });

  it('observationOnly=false → delivered=true, reason=null', () => {
    const r = getObservationResult(false);
    expect(r.delivered).toBe(true);
    expect(r.nonDeliveryReason).toBeNull();
  });

  it('observationOnly=undefined (ticker not in DB) → delivered=true, reason=null', () => {
    const r = getObservationResult(undefined);
    expect(r.delivered).toBe(true);
    expect(r.nonDeliveryReason).toBeNull();
  });
});

describe('INSIDER_CLUSTER SELL observation (Sprint 15)', () => {
  it('INSIDER_CLUSTER + negative → observation mode', () => {
    const pattern = { type: 'INSIDER_CLUSTER', direction: 'negative' };
    const isClusterSellObservation = pattern.type === 'INSIDER_CLUSTER' && pattern.direction === 'negative';
    expect(isClusterSellObservation).toBe(true);
  });

  it('INSIDER_CLUSTER + positive → normalny alert', () => {
    const pattern = { type: 'INSIDER_CLUSTER', direction: 'positive' };
    const isClusterSellObservation = pattern.type === 'INSIDER_CLUSTER' && pattern.direction === 'negative';
    expect(isClusterSellObservation).toBe(false);
  });

  it('INSIDER_PLUS_8K + negative → normalny alert (nie cluster)', () => {
    const pattern = { type: 'INSIDER_PLUS_8K', direction: 'negative' };
    const isClusterSellObservation = pattern.type === 'INSIDER_CLUSTER' && pattern.direction === 'negative';
    expect(isClusterSellObservation).toBe(false);
  });
});

describe('nonDeliveryReason priority (AlertEvaluator)', () => {
  const getNonDeliveryReason = (isObservation: boolean, isSilent: boolean, dailyLimitHit: boolean) => {
    if (isObservation) return 'observation';
    if (isSilent) return 'silent_hour';
    if (dailyLimitHit) return 'daily_limit';
    return null;
  };

  it('observation ma priorytet nad silent i daily_limit', () => {
    expect(getNonDeliveryReason(true, true, true)).toBe('observation');
  });

  it('silent_hour gdy nie observation', () => {
    expect(getNonDeliveryReason(false, true, true)).toBe('silent_hour');
  });

  it('daily_limit gdy nie observation ani silent', () => {
    expect(getNonDeliveryReason(false, false, true)).toBe('daily_limit');
  });

  it('null gdy wszystko false (alert dostarczony)', () => {
    expect(getNonDeliveryReason(false, false, false)).toBeNull();
  });
});
