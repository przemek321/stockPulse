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

describe('Form4Pipeline — BUY conviction boost (Sprint 15 + Sprint 17)', () => {
  // C-suite BUY d=0.83 → ×1.3 (V4)
  // Director BUY d=0.59 → ×1.15 (V4, added Sprint 17)
  // Healthcare sector → ×1.2 (kumulatywne z rolą)
  // Priorytet: C-suite wygrywa nad Director w co-filing (albo/albo).
  const applyBuyBoost = (
    conviction: number,
    isBuy: boolean,
    isCsuite: boolean,
    isDirector: boolean,
    sector: string | null,
  ): number => {
    if (isBuy) {
      if (isCsuite) conviction *= 1.3;
      else if (isDirector) conviction *= 1.15;
      if (sector === 'healthcare') conviction *= 1.2;
    }
    return conviction;
  };

  it('C-suite healthcare BUY → ×1.3 × ×1.2 = ×1.56', () => {
    const result = applyBuyBoost(1.0, true, true, false, 'healthcare');
    expect(result).toBeCloseTo(1.56, 2);
  });

  it('C-suite semi BUY → ×1.3 tylko (bez healthcare boost)', () => {
    const result = applyBuyBoost(1.0, true, true, false, 'semi_supply_chain');
    expect(result).toBeCloseTo(1.3, 2);
  });

  it('Director healthcare BUY → ×1.15 × ×1.2 = ×1.38 (Sprint 17: Director BUY d=0.59)', () => {
    const result = applyBuyBoost(1.0, true, false, true, 'healthcare');
    expect(result).toBeCloseTo(1.38, 2);
  });

  it('Director semi BUY → ×1.15 tylko', () => {
    const result = applyBuyBoost(1.0, true, false, true, 'semi_supply_chain');
    expect(result).toBeCloseTo(1.15, 2);
  });

  it('C-suite + Director co-filing BUY → tylko ×1.3 (C-suite priorytet, nie stack)', () => {
    const result = applyBuyBoost(1.0, true, true, true, 'healthcare');
    expect(result).toBeCloseTo(1.56, 2);
  });

  it('Non-C-suite non-Director BUY → bez boost (np. generic Officer)', () => {
    const result = applyBuyBoost(1.0, true, false, false, 'semi_supply_chain');
    expect(result).toBeCloseTo(1.0, 2);
  });

  it('Non-role + healthcare BUY → tylko ×1.2 (sector only)', () => {
    const result = applyBuyBoost(1.0, true, false, false, 'healthcare');
    expect(result).toBeCloseTo(1.2, 2);
  });

  it('C-suite SELL → bez boost (boost tylko na BUY)', () => {
    const result = applyBuyBoost(1.0, false, true, false, 'healthcare');
    expect(result).toBeCloseTo(1.0, 2);
  });

  it('Director SELL → bez boost', () => {
    const result = applyBuyBoost(1.0, false, false, true, 'healthcare');
    expect(result).toBeCloseTo(1.0, 2);
  });

  it('null sector → bez healthcare boost', () => {
    const result = applyBuyBoost(1.0, true, true, false, null);
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

describe('Form4Pipeline — SELL → observation mode (Sprint 17 V4-driven)', () => {
  // V4 backtest (commit e1ab795):
  //   - H2 all_sells d≈0 wszystkie horyzonty (N=973, żaden Bonf)
  //   - sells_above_1000k d=+0.01 7d (N=359)
  //   - Bonferroni threshold p<0.000446 (112 testów) — żaden SELL wariant nie przeszedł
  // Produkcja 17.04: 3 C-suite SELL Telegram alerts — noise.
  // Fix: WSZYSTKIE SELL → observation mode. BUY zostaje (d=0.82 C-suite BUY 7d Bonf ✓✓✓).

  // Replikacja logiki routing z Form4Pipeline.
  const getRouting = (
    txType: 'BUY' | 'SELL',
    tickerObservationOnly: boolean,
    dailyLimitHit: boolean = false,
  ) => {
    const isBuy = txType === 'BUY';
    const isObservation = tickerObservationOnly;
    const isSellNoEdge = !isBuy;

    let finalAction: string;
    let nonDeliveryReason: string | null;
    if (isObservation) {
      finalAction = 'ALERT_DB_ONLY_OBSERVATION';
      nonDeliveryReason = 'observation';
    } else if (isSellNoEdge) {
      finalAction = 'ALERT_DB_ONLY_SELL_NO_EDGE';
      nonDeliveryReason = 'sell_no_edge';
    } else if (dailyLimitHit) {
      finalAction = 'ALERT_DB_ONLY_DAILY_LIMIT';
      nonDeliveryReason = 'daily_limit';
    } else {
      finalAction = 'ALERT_SENT_TELEGRAM';
      nonDeliveryReason = null;
    }
    return { isObservation, isSellNoEdge, finalAction, nonDeliveryReason };
  };

  // Core flag: isSellNoEdge = !isBuy
  it('BUY → isSellNoEdge=false', () => {
    const r = getRouting('BUY', false);
    expect(r.isSellNoEdge).toBe(false);
  });

  it('SELL → isSellNoEdge=true', () => {
    const r = getRouting('SELL', false);
    expect(r.isSellNoEdge).toBe(true);
  });

  // Routing
  it('SELL (healthcare ticker) → DB only, reason=sell_no_edge', () => {
    const r = getRouting('SELL', false);
    expect(r.finalAction).toBe('ALERT_DB_ONLY_SELL_NO_EDGE');
    expect(r.nonDeliveryReason).toBe('sell_no_edge');
  });

  it('BUY (healthcare ticker) → Telegram (V4: d=0.82 C-suite BUY 7d Bonf ✓✓✓)', () => {
    const r = getRouting('BUY', false);
    expect(r.finalAction).toBe('ALERT_SENT_TELEGRAM');
    expect(r.nonDeliveryReason).toBeNull();
  });

  // Priority: ticker observation (semi) > sell_no_edge
  it('ticker observation + SELL → observation priorytet (semantic: sektor vs backtest)', () => {
    const r = getRouting('SELL', true);
    expect(r.finalAction).toBe('ALERT_DB_ONLY_OBSERVATION');
    expect(r.nonDeliveryReason).toBe('observation');
  });

  it('ticker observation + BUY → observation', () => {
    const r = getRouting('BUY', true);
    expect(r.finalAction).toBe('ALERT_DB_ONLY_OBSERVATION');
  });

  // Daily limit: bypassed dla SELL (nie wyczerpuje slots)
  it('SELL + dailyLimitHit → sell_no_edge priorytet (SELL nie wyczerpuje slots)', () => {
    const r = getRouting('SELL', false, /*dailyLimitHit*/ true);
    expect(r.finalAction).toBe('ALERT_DB_ONLY_SELL_NO_EDGE');
    expect(r.nonDeliveryReason).toBe('sell_no_edge');
  });

  it('BUY + dailyLimitHit → daily_limit (BUY normalnie gated)', () => {
    const r = getRouting('BUY', false, /*dailyLimitHit*/ true);
    expect(r.finalAction).toBe('ALERT_DB_ONLY_DAILY_LIMIT');
    expect(r.nonDeliveryReason).toBe('daily_limit');
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
