import {
  computeSectorAlpha,
  pctChange,
  computeAlphaForSlot,
} from '../../src/price-outcome/sector-alpha';

/**
 * Testy pure function `computeSectorAlpha` + helpers.
 *
 * Trigger: BIIB 14.05.2026 outcome interpretation ambiguity.
 * Patrz `doc/FOLLOWUP-XBI-ADJUSTMENT.md` dla pełnego rationale.
 */

describe('computeSectorAlpha', () => {
  it('zwraca alpha = ticker - benchmark dla beta=1.0 default', () => {
    expect(computeSectorAlpha(-5.5, -4.0)).toBeCloseTo(-1.5, 5);
    expect(computeSectorAlpha(+5.0, +2.0)).toBeCloseTo(+3.0, 5);
  });

  it('BIIB 14.05 case: -5.5% w okno XBI -4% → alpha ≈ -1.5% (noise)', () => {
    const alpha = computeSectorAlpha(-5.5, -4.0);
    expect(alpha).toBeCloseTo(-1.5, 5);
    expect(Math.abs(alpha)).toBeLessThan(2);
  });

  it('BIIB 14.05 case alt: -5.5% w okno XBI flat → alpha = -5.5% (real signal)', () => {
    const alpha = computeSectorAlpha(-5.5, 0.0);
    expect(alpha).toBeCloseTo(-5.5, 5);
  });

  it('beta=2.0 skaluje benchmark exposure (high-beta biotech)', () => {
    expect(computeSectorAlpha(-10, -4, 2.0)).toBeCloseTo(-2, 5);
    expect(computeSectorAlpha(+8, +3, 2.0)).toBeCloseTo(+2, 5);
  });

  it('beta=0.5 dla defensive ticker (lower exposure to sector)', () => {
    expect(computeSectorAlpha(-3, -4, 0.5)).toBeCloseTo(-1, 5);
  });

  it('zerowe inputs → 0 alpha', () => {
    expect(computeSectorAlpha(0, 0)).toBe(0);
    expect(computeSectorAlpha(0, 5)).toBe(-5);
    expect(computeSectorAlpha(5, 0)).toBe(5);
  });
});

describe('pctChange', () => {
  it('+10% gdy 100 → 110', () => {
    expect(pctChange(100, 110)).toBeCloseTo(10, 5);
  });

  it('-5% gdy 200 → 190', () => {
    expect(pctChange(200, 190)).toBeCloseTo(-5, 5);
  });

  it('null gdy priceAtAlert null', () => {
    expect(pctChange(null, 100)).toBeNull();
  });

  it('null gdy priceLater null', () => {
    expect(pctChange(100, null)).toBeNull();
  });

  it('null gdy cena ujemna lub zerowa (bad data)', () => {
    expect(pctChange(0, 100)).toBeNull();
    expect(pctChange(100, 0)).toBeNull();
    expect(pctChange(-5, 100)).toBeNull();
    expect(pctChange(100, -5)).toBeNull();
  });
});

describe('computeAlphaForSlot', () => {
  it('happy path: raw + xbi alpha + ibb alpha wszystkie obecne', () => {
    const r = computeAlphaForSlot({
      priceAtAlert: 100,
      priceLater: 95,        // ticker -5%
      xbiAtAlert: 80,
      xbiLater: 78,          // XBI -2.5%
      ibbAtAlert: 120,
      ibbLater: 117,         // IBB -2.5%
    });
    expect(r.rawPct).toBeCloseTo(-5, 4);
    expect(r.xbiAlphaPct).toBeCloseTo(-2.5, 4);
    expect(r.ibbAlphaPct).toBeCloseTo(-2.5, 4);
  });

  it('legacy alert bez XBI/IBB snapshot → tylko raw, alpha=null', () => {
    const r = computeAlphaForSlot({
      priceAtAlert: 100,
      priceLater: 110,
      xbiAtAlert: null,
      xbiLater: null,
      ibbAtAlert: null,
      ibbLater: null,
    });
    expect(r.rawPct).toBeCloseTo(10, 4);
    expect(r.xbiAlphaPct).toBeNull();
    expect(r.ibbAlphaPct).toBeNull();
  });

  it('częściowy snapshot: tylko XBI dostępny → ibbAlpha=null', () => {
    const r = computeAlphaForSlot({
      priceAtAlert: 100,
      priceLater: 105,
      xbiAtAlert: 80,
      xbiLater: 81,
      ibbAtAlert: null,
      ibbLater: null,
    });
    expect(r.rawPct).toBeCloseTo(5, 4);
    expect(r.xbiAlphaPct).toBeCloseTo(5 - 1.25, 4);
    expect(r.ibbAlphaPct).toBeNull();
  });

  it('brak priceLater → wszystkie null (slot jeszcze nie wypełniony)', () => {
    const r = computeAlphaForSlot({
      priceAtAlert: 100,
      priceLater: null,
      xbiAtAlert: 80,
      xbiLater: 81,
      ibbAtAlert: 120,
      ibbLater: 121,
    });
    expect(r.rawPct).toBeNull();
    expect(r.xbiAlphaPct).toBeNull();
    expect(r.ibbAlphaPct).toBeNull();
  });

  it('beta=1.5 skaluje benchmark dla wysokobeta tickera', () => {
    const r = computeAlphaForSlot({
      priceAtAlert: 100,
      priceLater: 90,   // -10%
      xbiAtAlert: 80,
      xbiLater: 76,     // XBI -5%
      ibbAtAlert: 120,
      ibbLater: 114,    // IBB -5%
      beta: 1.5,
    });
    expect(r.rawPct).toBeCloseTo(-10, 4);
    expect(r.xbiAlphaPct).toBeCloseTo(-10 - 1.5 * -5, 4); // -10 + 7.5 = -2.5
    expect(r.ibbAlphaPct).toBeCloseTo(-2.5, 4);
  });

  it('BIIB scenariusz: real signal vs noise rozróżnienie', () => {
    // Scenariusz A: sector regime dominuje
    const sectorDominant = computeAlphaForSlot({
      priceAtAlert: 100,
      priceLater: 94.5,    // BIIB -5.5%
      xbiAtAlert: 80,
      xbiLater: 76.8,      // XBI -4%
      ibbAtAlert: 120,
      ibbLater: 115.2,     // IBB -4%
    });
    expect(sectorDominant.xbiAlphaPct).toBeCloseTo(-1.5, 1);

    // Scenariusz B: real signal
    const realSignal = computeAlphaForSlot({
      priceAtAlert: 100,
      priceLater: 94.5,    // BIIB -5.5%
      xbiAtAlert: 80,
      xbiLater: 80,        // XBI flat
      ibbAtAlert: 120,
      ibbLater: 120,
    });
    expect(realSignal.xbiAlphaPct).toBeCloseTo(-5.5, 1);

    // Decyzja: jeśli |xbiAlpha| < 2 → noise zone, |xbiAlpha| >= 2 → real signal
    expect(Math.abs(sectorDominant.xbiAlphaPct!)).toBeLessThan(2);
    expect(Math.abs(realSignal.xbiAlphaPct!)).toBeGreaterThanOrEqual(2);
  });
});
