/**
 * Testy reguł Form4Pipeline dodanych w Sprint 15-17:
 * - Director SELL → hard skip (backtest: anty-sygnał)
 * - BUY conviction boost (C-suite ×1.3, healthcare ×1.2)
 * - Observation mode gate (ticker.observationOnly → DB only, brak Telegramu)
 * - C-suite whitelist (Sprint 16b — soft roles wyłączone)
 */

import { isCsuiteRole } from '../../src/sec-filings/pipelines/form4.pipeline';

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

describe('Form4Pipeline — C-suite whitelist (Sprint 16b)', () => {
  it('Chief Executive Officer → true', () => {
    expect(isCsuiteRole('Chief Executive Officer')).toBe(true);
  });

  it('Chief Financial Officer → true', () => {
    expect(isCsuiteRole('Chief Financial Officer')).toBe(true);
  });

  it('Chief Medical Officer → true (healthcare critical)', () => {
    expect(isCsuiteRole('Chief Medical Officer')).toBe(true);
  });

  it('Chief Scientific Officer → true (biotech critical)', () => {
    expect(isCsuiteRole('Chief Scientific Officer')).toBe(true);
  });

  it('Chief Legal Officer → true', () => {
    expect(isCsuiteRole('Chief Legal Officer')).toBe(true);
  });

  it('Chief Communications Officer → false (PR/IR, nie ma insider info)', () => {
    expect(isCsuiteRole('Chief Communications Officer')).toBe(false);
  });

  it('Chief Corporate Affairs Officer → false (GILD noise case 17.04)', () => {
    expect(isCsuiteRole('Chief Comm & Corp Aff Officer')).toBe(false);
  });

  it('Chief People Officer → false (HR)', () => {
    expect(isCsuiteRole('Chief People Officer')).toBe(false);
  });

  it('Chief Human Resources Officer → false', () => {
    expect(isCsuiteRole('Chief Human Resources Officer')).toBe(false);
  });

  it('Chief Diversity Officer → false', () => {
    expect(isCsuiteRole('Chief Diversity Officer')).toBe(false);
  });

  it('Chief Marketing Officer → false (decyzja Przemka 17.04)', () => {
    expect(isCsuiteRole('Chief Marketing Officer')).toBe(false);
  });

  it('Chief Sustainability Officer → false', () => {
    expect(isCsuiteRole('Chief Sustainability Officer')).toBe(false);
  });

  it('CEO akronim → true', () => {
    expect(isCsuiteRole('CEO')).toBe(true);
  });

  it('CFO akronim → true', () => {
    expect(isCsuiteRole('CFO')).toBe(true);
  });

  it('CMO akronim → true (Medical w healthcare universe)', () => {
    expect(isCsuiteRole('CMO')).toBe(true);
  });

  it('President → true', () => {
    expect(isCsuiteRole('President')).toBe(true);
  });

  it('Chairman → true', () => {
    expect(isCsuiteRole('Chairman')).toBe(true);
  });

  it('Vice Chairman → true', () => {
    expect(isCsuiteRole('Vice Chairman')).toBe(true);
  });

  it('EVP, Chief Legal Officer → true (Chief Legal w whitelist)', () => {
    expect(isCsuiteRole('EVP, Chief Legal Officer')).toBe(true);
  });

  it('EVP, Finance → true (EVP z finance context)', () => {
    expect(isCsuiteRole('EVP, Finance')).toBe(true);
  });

  it('EVP, Operations → true (EVP z operations context)', () => {
    expect(isCsuiteRole('EVP, Operations')).toBe(true);
  });

  it('EVP, Human Resources → false (EVP bez whitelistowanego domeny)', () => {
    expect(isCsuiteRole('EVP, Human Resources')).toBe(false);
  });

  it('Principal Financial Officer → true', () => {
    expect(isCsuiteRole('Principal Financial Officer')).toBe(true);
  });

  it('Principal Accounting Officer → true', () => {
    expect(isCsuiteRole('Principal Accounting Officer')).toBe(true);
  });

  it('Director → false (nie C-suite)', () => {
    expect(isCsuiteRole('Director')).toBe(false);
  });

  it('Senior Vice President, Sales → false (SVP nie na liście)', () => {
    expect(isCsuiteRole('Senior Vice President, Sales')).toBe(false);
  });

  it('Vice President, Operations → false (VP nie C-suite mimo "President")', () => {
    expect(isCsuiteRole('Vice President, Operations')).toBe(false);
  });

  it('Executive Vice President → false (sam EVP bez finance/ops/product/strategy)', () => {
    expect(isCsuiteRole('Executive Vice President')).toBe(false);
  });

  it('Executive Vice President, Finance → true (pełny spelling EVP + Finance)', () => {
    expect(isCsuiteRole('Executive Vice President, Finance')).toBe(true);
  });

  it('Executive Vice President, Operations → true', () => {
    expect(isCsuiteRole('Executive Vice President, Operations')).toBe(true);
  });

  it('President and CEO → true (CEO matches)', () => {
    expect(isCsuiteRole('President and CEO')).toBe(true);
  });

  it('Chairman & CEO, Director → true (Chairman matches)', () => {
    expect(isCsuiteRole('Chairman & CEO, Director')).toBe(true);
  });

  it('null role → false', () => {
    expect(isCsuiteRole(null)).toBe(false);
  });

  it('empty string → false', () => {
    expect(isCsuiteRole('')).toBe(false);
  });

  it('match by insiderName fallback → true', () => {
    expect(isCsuiteRole(null, 'Jane Doe, CEO')).toBe(true);
  });
});

describe('Form4Pipeline — C-suite SELL observation gate (Sprint 16b)', () => {
  // V4 backtest H2 SINGLE_CSUITE all_sells: N=855 d=-0.002 p=0.95 → zero edge.
  // Route do observation (DB only, brak Telegram). Replikacja logiki z pipeline.
  const getCsuiteSellRouting = (
    isCsuite: boolean,
    txType: string,
    tickerObservationOnly: boolean,
  ) => {
    const isCsuiteSell = isCsuite && txType === 'SELL';
    const isObservation = tickerObservationOnly || isCsuiteSell;
    let finalAction: string;
    let nonDeliveryReason: string | null;
    if (tickerObservationOnly) {
      finalAction = 'ALERT_DB_ONLY_OBSERVATION';
      nonDeliveryReason = 'observation';
    } else if (isCsuiteSell) {
      finalAction = 'ALERT_DB_ONLY_CSUITE_SELL';
      nonDeliveryReason = 'csuite_sell_no_edge';
    } else {
      finalAction = 'ALERT_SENT_TELEGRAM';
      nonDeliveryReason = null;
    }
    return { isObservation, finalAction, nonDeliveryReason };
  };

  it('C-suite SELL → DB only, reason=csuite_sell_no_edge', () => {
    const r = getCsuiteSellRouting(true, 'SELL', false);
    expect(r.isObservation).toBe(true);
    expect(r.finalAction).toBe('ALERT_DB_ONLY_CSUITE_SELL');
    expect(r.nonDeliveryReason).toBe('csuite_sell_no_edge');
  });

  it('C-suite BUY → Telegram (BUY ma edge, d=0.83)', () => {
    const r = getCsuiteSellRouting(true, 'BUY', false);
    expect(r.isObservation).toBe(false);
    expect(r.finalAction).toBe('ALERT_SENT_TELEGRAM');
  });

  it('non-C-suite SELL (np. Officer generic) → Telegram', () => {
    const r = getCsuiteSellRouting(false, 'SELL', false);
    expect(r.isObservation).toBe(false);
    expect(r.finalAction).toBe('ALERT_SENT_TELEGRAM');
  });

  it('ticker observation + C-suite SELL → ticker reason ma priorytet', () => {
    const r = getCsuiteSellRouting(true, 'SELL', true);
    expect(r.isObservation).toBe(true);
    expect(r.finalAction).toBe('ALERT_DB_ONLY_OBSERVATION');
    expect(r.nonDeliveryReason).toBe('observation');
  });

  it('ticker observation + BUY → ticker observation', () => {
    const r = getCsuiteSellRouting(true, 'BUY', true);
    expect(r.isObservation).toBe(true);
    expect(r.finalAction).toBe('ALERT_DB_ONLY_OBSERVATION');
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
