import { mapAlertToOutcome } from '../../src/api/alerts/alerts.controller';
import { Alert } from '../../src/entities';

/**
 * Integration test dla mapper `/api/alerts/outcomes` (P1 #5 code review 28.05.2026).
 *
 * Pokrywa kontrakt API + semantykę `directionCorrect` (RAW backwards compat)
 * vs `directionCorrectAlpha` (XBI alpha preferred, IBB fallback).
 */

function makeAlert(overrides: Partial<Alert>): Alert {
  const base: Partial<Alert> = {
    id: 1,
    symbol: 'TEST',
    ruleName: '8-K Material Event GPT',
    priority: 'HIGH',
    channel: 'TELEGRAM',
    message: 'test',
    delivered: true,
    nonDeliveryReason: null,
    catalystType: 'earnings',
    alertDirection: 'positive',
    priceAtAlert: 100 as any,
    price1h: null,
    price4h: null,
    price1d: null,
    price3d: null,
    priceOutcomeDone: false,
    xbiAtAlert: null,
    xbi1d: null,
    xbi3d: null,
    ibbAtAlert: null,
    ibb1d: null,
    ibb3d: null,
    archived: false,
    sentAt: new Date('2026-05-19T20:35:00Z'),
  };
  return { ...base, ...overrides } as Alert;
}

describe('mapAlertToOutcome — kontrakt /api/alerts/outcomes', () => {
  it('legacy alert bez XBI snapshot: directionCorrect = raw, alpha = null', () => {
    const alert = makeAlert({
      priceAtAlert: 100 as any,
      price1d: 110 as any, // +10% raw
      alertDirection: 'positive',
      xbiAtAlert: null,
      xbi1d: null,
      ibbAtAlert: null,
      ibb1d: null,
    });
    const out = mapAlertToOutcome(alert);

    expect(out.delta1d).toBeCloseTo(10, 1);
    expect(out.directionCorrect).toBe(true); // raw +10% positive zgadza się
    expect(out.directionCorrectAlpha).toBeNull(); // brak snapshot → null
    expect(out.xbiAlpha1d).toBeNull();
    expect(out.ibbAlpha1d).toBeNull();
  });

  it('alpha zgodna z raw (positive): oba directionCorrect = true', () => {
    const alert = makeAlert({
      priceAtAlert: 100 as any,
      price1d: 105 as any, // +5% raw
      alertDirection: 'positive',
      xbiAtAlert: 80 as any,
      xbi1d: 81 as any, // XBI +1.25%
      ibbAtAlert: 120 as any,
      ibb1d: 121 as any, // IBB +0.83%
    });
    const out = mapAlertToOutcome(alert);

    expect(out.delta1d).toBeCloseTo(5, 1);
    expect(out.xbiAlpha1d).toBeCloseTo(5 - 1.25, 1); // +3.75
    expect(out.directionCorrect).toBe(true);
    expect(out.directionCorrectAlpha).toBe(true); // alpha +3.75 > 0
  });

  it('alpha SPRZECZNA z raw (HIMS-style): directionCorrect=true RAW, directionCorrectAlpha=false', () => {
    // Scenariusz: positive direction, raw +0.5% (lekki wzrost) ale rynek/sektor
    // +2% → alpha = 0.5 - 2 = -1.5% (negative). Sektor wciągnął ticker w górę,
    // ale relativnie ticker był słaby. directionCorrect zachowuje raw, alpha
    // pokazuje rzeczywisty edge.
    const alert = makeAlert({
      priceAtAlert: 100 as any,
      price1d: 100.5 as any, // +0.5% raw
      alertDirection: 'positive',
      xbiAtAlert: 80 as any,
      xbi1d: 81.6 as any, // XBI +2%
      ibbAtAlert: 120 as any,
      ibb1d: 122.4 as any, // IBB +2%
    });
    const out = mapAlertToOutcome(alert);

    expect(out.delta1d).toBeCloseTo(0.5, 1);
    expect(out.xbiAlpha1d).toBeCloseTo(-1.5, 1);
    expect(out.directionCorrect).toBe(true); // raw +0.5 > 0 (backwards compat zachowany)
    expect(out.directionCorrectAlpha).toBe(false); // alpha -1.5 < 0, positive direction nie potwierdzona
  });

  it('alpha sprzeczna z raw NEGATIVE direction: oba flaga rozbieżne', () => {
    // Negative direction alert (np. SELL signal), raw -3% ✓, ale sektor -5% →
    // alpha = -3 - (-5) = +2 (ticker UPDATED przeciw direction).
    const alert = makeAlert({
      priceAtAlert: 100 as any,
      price1d: 97 as any, // -3% raw
      alertDirection: 'negative',
      xbiAtAlert: 80 as any,
      xbi1d: 76 as any, // XBI -5%
      ibbAtAlert: 120 as any,
      ibb1d: 114 as any, // IBB -5%
    });
    const out = mapAlertToOutcome(alert);

    expect(out.delta1d).toBeCloseTo(-3, 1);
    expect(out.xbiAlpha1d).toBeCloseTo(2, 1);
    expect(out.directionCorrect).toBe(true); // raw -3 < 0, negative direction ✓
    expect(out.directionCorrectAlpha).toBe(false); // alpha +2 > 0, negative direction NIE potwierdzona
  });

  it('alpha sprzeczna OK z raw NEGATIVE (sector dominated): alpha potwierdza signal', () => {
    // Negative direction, raw -5% bear ✓, ale sektor flat → alpha = -5
    // (real bearish signal, nie szum sektora).
    const alert = makeAlert({
      priceAtAlert: 100 as any,
      price1d: 95 as any, // -5% raw
      alertDirection: 'negative',
      xbiAtAlert: 80 as any,
      xbi1d: 80 as any, // XBI flat
      ibbAtAlert: 120 as any,
      ibb1d: 120 as any, // IBB flat
    });
    const out = mapAlertToOutcome(alert);

    expect(out.delta1d).toBeCloseTo(-5, 1);
    expect(out.xbiAlpha1d).toBeCloseTo(-5, 1);
    expect(out.directionCorrect).toBe(true); // raw -5 < 0 ✓
    expect(out.directionCorrectAlpha).toBe(true); // alpha -5 < 0 ✓ (real signal)
  });

  it('IBB fallback gdy XBI snapshot brakuje (partial snapshot)', () => {
    const alert = makeAlert({
      priceAtAlert: 100 as any,
      price1d: 110 as any, // +10%
      alertDirection: 'positive',
      xbiAtAlert: null,
      xbi1d: null, // XBI brak → xbiAlpha=null
      ibbAtAlert: 120 as any,
      ibb1d: 123 as any, // IBB +2.5%
    });
    const out = mapAlertToOutcome(alert);

    expect(out.xbiAlpha1d).toBeNull();
    expect(out.ibbAlpha1d).toBeCloseTo(10 - 2.5, 1); // +7.5
    expect(out.directionCorrectAlpha).toBe(true); // IBB alpha +7.5 > 0
  });

  it('slot price1d nie wypełniony: directionCorrect=null, alpha=null', () => {
    const alert = makeAlert({
      priceAtAlert: 100 as any,
      price1d: null,
      alertDirection: 'positive',
      xbiAtAlert: 80 as any,
      ibbAtAlert: 120 as any,
    });
    const out = mapAlertToOutcome(alert);

    expect(out.delta1d).toBeNull();
    expect(out.xbiAlpha1d).toBeNull();
    expect(out.directionCorrect).toBeNull();
    expect(out.directionCorrectAlpha).toBeNull();
  });

  it('alert bez alertDirection: oba directionCorrect=null', () => {
    const alert = makeAlert({
      priceAtAlert: 100 as any,
      price1d: 110 as any,
      alertDirection: null,
      xbiAtAlert: 80 as any,
      xbi1d: 81 as any,
      ibbAtAlert: 120 as any,
      ibb1d: 121 as any,
    });
    const out = mapAlertToOutcome(alert);

    expect(out.delta1d).toBeCloseTo(10, 1);
    expect(out.directionCorrect).toBeNull();
    expect(out.directionCorrectAlpha).toBeNull();
  });

  it('shape: kontrakt response zawiera wszystkie wymagane pola', () => {
    const out = mapAlertToOutcome(makeAlert({ priceAtAlert: 100 as any }));
    expect(Object.keys(out).sort()).toEqual(
      [
        'alertDirection', 'catalystType', 'delivered', 'delta1d', 'delta1h',
        'delta3d', 'delta4h', 'directionCorrect', 'directionCorrectAlpha',
        'ibbAlpha1d', 'ibbAlpha3d', 'ibbAtAlert', 'id', 'nonDeliveryReason',
        'price1d', 'price1h', 'price3d', 'price4h', 'priceAtAlert',
        'priceOutcomeDone', 'priority', 'ruleName', 'sentAt', 'symbol',
        'xbiAlpha1d', 'xbiAlpha3d', 'xbiAtAlert',
      ].sort(),
    );
  });

  it('delivered=false z nonDeliveryReason: pola propagowane (TASK-05)', () => {
    const alert = makeAlert({
      delivered: false,
      nonDeliveryReason: 'sell_no_edge',
    });
    const out = mapAlertToOutcome(alert);
    expect(out.delivered).toBe(false);
    expect(out.nonDeliveryReason).toBe('sell_no_edge');
  });

  it('priceOutcomeDone=true propagowane', () => {
    const out = mapAlertToOutcome(makeAlert({ priceOutcomeDone: true }));
    expect(out.priceOutcomeDone).toBe(true);
  });
});
