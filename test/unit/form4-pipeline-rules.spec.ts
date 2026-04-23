/**
 * Testy reguł Form4Pipeline dodanych w Sprint 15-17:
 * - Director SELL → hard skip (backtest: anty-sygnał)
 * - BUY conviction boost (C-suite ×1.3, healthcare ×1.2)
 * - Observation mode gate (ticker.observationOnly → DB only, brak Telegramu)
 * - C-suite whitelist (Sprint 16b — soft roles wyłączone)
 */

import { isCsuiteRole, isDirectorRole, Form4Pipeline } from '../../src/sec-filings/pipelines/form4.pipeline';

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

  // TASK-10 (23.04.2026): unifikacja regex — Chairwoman/Chairperson muszą dalej łapać,
  // bo stary broad regex `\bChair` (prefix match) w hasCsuite też je obejmował.
  // Expansion: /\bChair(man|woman|person)\b/i.
  it('Chairwoman → true (gender-neutral, TASK-10)', () => {
    expect(isCsuiteRole('Chairwoman')).toBe(true);
  });

  it('Chairperson → true (gender-neutral, TASK-10)', () => {
    expect(isCsuiteRole('Chairperson')).toBe(true);
  });

  it('Vice Chairwoman → true (TASK-10)', () => {
    expect(isCsuiteRole('Vice Chairwoman')).toBe(true);
  });

  it('Vice Chairperson → true (TASK-10)', () => {
    expect(isCsuiteRole('Vice Chairperson')).toBe(true);
  });

  it('Chairperson of the Board → true (TASK-10)', () => {
    expect(isCsuiteRole('Chairperson of the Board')).toBe(true);
  });

  it('Chairing the Committee → false (nie formalna rola)', () => {
    // Samo "Chair" bez suffixu (man|woman|person) nie matchuje — intencjonalnie,
    // "Chair" alone nie jest formalnym C-suite title w SEC filings.
    expect(isCsuiteRole('Chairing the Committee')).toBe(false);
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

describe('Form4Pipeline — isDirectorRole (TASK-02)', () => {
  it.each([
    ['Director', true],
    ['Independent Director', true],
    ['Chairman & CEO, Director', true],
    ['Director Emeritus', true],
    ['Managing Director', true],
    ['CEO', false],
    ['Chief Executive Officer', false],
    ['President', false],
    ['GM, ASE Inc. Chung-Li Branch', false],
    ['Vice President, Operations', false],
    ['10% Owner', false],
    ['', false],
  ])('isDirectorRole(%j) → %s', (role, expected) => {
    expect(isDirectorRole(role)).toBe(expected);
  });

  it('null → false', () => {
    expect(isDirectorRole(null)).toBe(false);
  });

  it('undefined → false', () => {
    expect(isDirectorRole(undefined)).toBe(false);
  });
});

describe('Form4Pipeline — SKIP_NON_ROLE_SELL hard skip (TASK-02, 22.04.2026)', () => {
  // Replikacja kroku 4b w decision tree (analogicznie do pattern w Director SELL skip testach).
  // Warunki: transactionType='SELL' AND !isCsuiteRole AND !isDirectorRole.
  // Step 4b odpala PO 10b5-1 check (krok 2) i pure Director SELL (krok 3), PRZED daily cap.
  const shouldSkipNonRoleSell = (
    role: string | null,
    txType: string,
    insiderName?: string,
  ): boolean => {
    return (
      txType === 'SELL' &&
      !isCsuiteRole(role, insiderName) &&
      !isDirectorRole(role)
    );
  };

  it('GM SELL (ASX case 22.04.2026 — Chen Tien-Szu $152M) → skip', () => {
    expect(shouldSkipNonRoleSell('GM, ASE Inc. Chung-Li Branch', 'SELL')).toBe(true);
  });

  it('Vice President SELL → skip', () => {
    expect(shouldSkipNonRoleSell('Vice President, Operations', 'SELL')).toBe(true);
  });

  it('Senior VP, Sales SELL → skip', () => {
    expect(shouldSkipNonRoleSell('Senior Vice President, Sales', 'SELL')).toBe(true);
  });

  it('Chief Marketing Officer SELL → skip (Sprint 16b wyłączony z whitelist)', () => {
    expect(shouldSkipNonRoleSell('Chief Marketing Officer', 'SELL')).toBe(true);
  });

  it('Chief Communications Officer SELL → skip (PR/IR)', () => {
    expect(shouldSkipNonRoleSell('Chief Communications Officer', 'SELL')).toBe(true);
  });

  it('10% Owner SELL → skip (żadna hipoteza H1-H6 nie testowała edge)', () => {
    expect(shouldSkipNonRoleSell('10% Owner', 'SELL')).toBe(true);
  });

  it('Generic Officer SELL → skip', () => {
    expect(shouldSkipNonRoleSell('Officer', 'SELL')).toBe(true);
  });

  it('CEO SELL → NIE skip (C-suite przechodzi do csuite_sell_no_edge w kroku 8)', () => {
    expect(shouldSkipNonRoleSell('Chief Executive Officer', 'SELL')).toBe(false);
  });

  it('CFO SELL → NIE skip', () => {
    expect(shouldSkipNonRoleSell('Chief Financial Officer', 'SELL')).toBe(false);
  });

  it('Director SELL → NIE skip (łapany wcześniej przez SKIP_DIRECTOR_SELL w kroku 3)', () => {
    expect(shouldSkipNonRoleSell('Director', 'SELL')).toBe(false);
  });

  it('Chairman & CEO, Director SELL → NIE skip (ma CEO → C-suite)', () => {
    expect(shouldSkipNonRoleSell('Chairman & CEO, Director', 'SELL')).toBe(false);
  });

  it('GM BUY → NIE skip (BUY zawsze przechodzi dalej)', () => {
    expect(shouldSkipNonRoleSell('GM, Some Branch', 'BUY')).toBe(false);
  });

  it('VP BUY → NIE skip (BUY przechodzi bez boost, healthcare sector może dodać ×1.2)', () => {
    expect(shouldSkipNonRoleSell('Vice President', 'BUY')).toBe(false);
  });

  it('null role + SELL → skip (brak roli = non-role)', () => {
    expect(shouldSkipNonRoleSell(null, 'SELL')).toBe(true);
  });

  it('null role + BUY → NIE skip', () => {
    expect(shouldSkipNonRoleSell(null, 'BUY')).toBe(false);
  });

  it('Match przez insiderName fallback (CEO w nazwisku) SELL → NIE skip', () => {
    expect(shouldSkipNonRoleSell(null, 'SELL', 'Jane Doe, CEO')).toBe(false);
  });
});

describe('Form4Pipeline — isPureDirector via isCsuiteRole (TASK-10, 23.04.2026)', () => {
  // TASK-10: inline regex `/\bCEO|CFO|COO|CTO|President|Chair|Chief\b/i` zastąpiony przez
  // isCsuiteRole() w step 3 decision tree. Skutki semantyczne:
  //   - Director + Vice President: stary regex matchował "President" → hasCsuite=true (bug),
  //     teraz negative lookbehind → hasCsuite=false → pure Director SELL → SKIP.
  //   - Director + Chief Marketing Officer: stary regex matchował "Chief" (catch-all) →
  //     hasCsuite=true (noise), teraz whitelist nie zawiera Marketing → hasCsuite=false →
  //     pure Director SELL → SKIP (Sprint 16b rozszerzenie do step 3).
  //   - Director + CEO/CFO/Chairman/CMO: dalej hasCsuite=true → NIE skip (bez zmiany).
  const isPureDirectorSell = (role: string | null) => {
    const r = role ?? '';
    const isDirector = isDirectorRole(r);
    const hasCsuite = isCsuiteRole(r);
    return isDirector && !hasCsuite;
  };

  // No change — C-suite priorytet (co-filing)
  it('Director + CEO co-filing → NIE pure Director', () => {
    expect(isPureDirectorSell('Chairman & CEO, Director')).toBe(false);
  });

  it('Director + CFO co-filing → NIE pure Director', () => {
    expect(isPureDirectorSell('CFO and Director')).toBe(false);
  });

  it('Director + Chief Medical Officer co-filing → NIE pure Director (healthcare critical)', () => {
    expect(isPureDirectorSell('Director, Chief Medical Officer')).toBe(false);
  });

  it('Director + Chairman → NIE pure Director', () => {
    expect(isPureDirectorSell('Chairman, Director')).toBe(false);
  });

  it('Director + President → NIE pure Director', () => {
    expect(isPureDirectorSell('President and Director')).toBe(false);
  });

  // Change — broad regex bug: "Vice President" matched via \bPresident\b
  it('Director + Vice President → pure Director (strict lookbehind, nowa semantyka)', () => {
    expect(isPureDirectorSell('Vice President and Director')).toBe(true);
  });

  it('Director + Senior Vice President → pure Director', () => {
    expect(isPureDirectorSell('Senior Vice President, Director')).toBe(true);
  });

  it('Director + Executive Vice President (bez finance/ops) → pure Director', () => {
    expect(isPureDirectorSell('Executive Vice President, Director')).toBe(true);
  });

  it('Director + EVP, Finance → NIE pure Director (EVP+finance whitelist match)', () => {
    expect(isPureDirectorSell('EVP, Finance, Director')).toBe(false);
  });

  // Change — broad regex bug: "\bChief\b" łapał wszystkie Chief X
  it('Director + Chief Marketing Officer → pure Director (Sprint 16b soft role excluded)', () => {
    expect(isPureDirectorSell('Chief Marketing Officer, Director')).toBe(true);
  });

  it('Director + Chief Communications Officer → pure Director', () => {
    expect(isPureDirectorSell('Chief Communications Officer & Director')).toBe(true);
  });

  it('Director + Chief People Officer → pure Director (HR)', () => {
    expect(isPureDirectorSell('Chief People Officer, Director')).toBe(true);
  });

  it('Director + Chief Sustainability Officer → pure Director', () => {
    expect(isPureDirectorSell('Chief Sustainability Officer, Director')).toBe(true);
  });

  // No change — pure Director
  it('pure Director (Independent Director) → pure Director', () => {
    expect(isPureDirectorSell('Independent Director')).toBe(true);
  });

  it('pure Director (Director) → pure Director', () => {
    expect(isPureDirectorSell('Director')).toBe(true);
  });

  // No change — non-Director
  it('CEO alone → NIE pure Director (not Director)', () => {
    expect(isPureDirectorSell('Chief Executive Officer')).toBe(false);
  });

  it('10% Owner → NIE pure Director (not Director)', () => {
    expect(isPureDirectorSell('10% Owner')).toBe(false);
  });

  it('GM, ASE Inc. Chung-Li Branch → NIE pure Director', () => {
    expect(isPureDirectorSell('GM, ASE Inc. Chung-Li Branch')).toBe(false);
  });

  it('null role → NIE pure Director', () => {
    expect(isPureDirectorSell(null)).toBe(false);
  });

  it('empty string → NIE pure Director', () => {
    expect(isPureDirectorSell('')).toBe(false);
  });
});

/**
 * FOLLOW-6 (23.04.2026): end-to-end regression guard dla ASX case (Sprint 18 trigger).
 *
 * Background: 22.04.2026 collector wciągnął Form 4 z ASX gdzie Chen Tien-Szu
 * "GM, ASE Inc. Chung-Li Branch" sprzedał akcje za $152M. Ten SELL przeszedł
 * przez Form4Pipeline → observation save (semi ticker observation route NIE
 * blokował korelacji) → CorrelationService → fałszywy CRITICAL alert
 * "INSIDER + Unusual Options" w portalu z conviction -0.70.
 *
 * TASK-02 (22.04.2026) dodało krok 4b SKIP_NON_ROLE_SELL PRZED daily cap +
 * observation gate. Izolowane testy reguł (SKIP_NON_ROLE_SELL block powyżej)
 * weryfikują pure-function decision logic, ale NIE dowodzą że kolejność
 * kroków w `onInsiderTrade` faktycznie blokuje wszystkie side-effects.
 *
 * Ten test jest acceptance/regression guard: jeśli ktoś przesunie observation
 * gate przed SKIP_NON_ROLE_SELL albo zmieni kolejność checks, ten test
 * wyłoży się natychmiast — bez niego regresja invisible aż do kolejnego
 * ASX-case'a w produkcji.
 */
describe('Form4Pipeline integration — ASX regression (FOLLOW-6, 23.04.2026)', () => {
  function buildPipelineWithMocks() {
    const mocks = {
      tradeRepo: { findOne: jest.fn(), save: jest.fn() },
      filingRepo: { findOne: jest.fn(), save: jest.fn() },
      tickerRepo: { findOne: jest.fn() },
      alertRepo: { save: jest.fn(), findOne: jest.fn() },
      ruleRepo: { findOne: jest.fn() },
      azureOpenai: { analyzeCustomPrompt: jest.fn() },
      telegram: { sendMarkdown: jest.fn() },
      formatter: { formatInsiderTradeAlert: jest.fn() },
      dailyCap: { canCallGpt: jest.fn() },
      correlation: { storeSignal: jest.fn(), schedulePatternCheck: jest.fn() },
      finnhub: { getQuote: jest.fn() },
      tickerProfile: { getSignalProfile: jest.fn() },
      deliveryGate: { canDeliverToTelegram: jest.fn() },
      dispatcher: { dispatch: jest.fn() },
    };
    const pipeline = new Form4Pipeline(
      mocks.tradeRepo as any,
      mocks.filingRepo as any,
      mocks.tickerRepo as any,
      mocks.alertRepo as any,
      mocks.ruleRepo as any,
      mocks.azureOpenai as any,
      mocks.telegram as any,
      mocks.formatter as any,
      mocks.dailyCap as any,
      mocks.correlation as any,
      mocks.finnhub as any,
      mocks.tickerProfile as any,
      mocks.deliveryGate as any,
      mocks.dispatcher as any,
    );
    return { pipeline, mocks };
  }

  it('ASX GM SELL $152M → SKIP_NON_ROLE_SELL bez żadnych side-effects', async () => {
    const { pipeline, mocks } = buildPipelineWithMocks();

    const result = await pipeline.onInsiderTrade({
      tradeId: 12345,
      symbol: 'ASX',
      insiderName: 'Chen Tien-Szu',
      insiderRole: 'GM, ASE Inc. Chung-Li Branch',
      transactionType: 'SELL',
      totalValue: 152_554_997,
      shares: 328_000,
      is10b51Plan: false,
      sharesOwnedAfter: 50_000,
      source: 'sec-edgar',
      traceId: 'asx-regression-trace',
    });

    expect(result.action).toBe('SKIP_NON_ROLE_SELL');
    expect(result.symbol).toBe('ASX');
    expect(result.traceId).toBe('asx-regression-trace');

    // Krok 4b SKIP_NON_ROLE_SELL musi być PRZED daily cap, GPT, correlation,
    // dispatcher, alert save, ticker fetch — nic z poniższych nie powinno
    // być wywołane. Każda regresja kolejności wyłoży któryś expect.
    expect(mocks.dailyCap.canCallGpt).not.toHaveBeenCalled();
    expect(mocks.tradeRepo.findOne).not.toHaveBeenCalled();
    expect(mocks.tradeRepo.save).not.toHaveBeenCalled();
    expect(mocks.filingRepo.findOne).not.toHaveBeenCalled();
    expect(mocks.filingRepo.save).not.toHaveBeenCalled();
    expect(mocks.tickerRepo.findOne).not.toHaveBeenCalled();
    expect(mocks.ruleRepo.findOne).not.toHaveBeenCalled();
    expect(mocks.azureOpenai.analyzeCustomPrompt).not.toHaveBeenCalled();
    expect(mocks.formatter.formatInsiderTradeAlert).not.toHaveBeenCalled();
    expect(mocks.telegram.sendMarkdown).not.toHaveBeenCalled();
    expect(mocks.correlation.storeSignal).not.toHaveBeenCalled();
    expect(mocks.correlation.schedulePatternCheck).not.toHaveBeenCalled();
    expect(mocks.deliveryGate.canDeliverToTelegram).not.toHaveBeenCalled();
    expect(mocks.dispatcher.dispatch).not.toHaveBeenCalled();
    expect(mocks.alertRepo.save).not.toHaveBeenCalled();
    expect(mocks.alertRepo.findOne).not.toHaveBeenCalled();
    expect(mocks.tickerProfile.getSignalProfile).not.toHaveBeenCalled();
    expect(mocks.finnhub.getQuote).not.toHaveBeenCalled();
  });
});
