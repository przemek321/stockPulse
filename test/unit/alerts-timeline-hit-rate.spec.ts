import { AlertsController, computeHitRate } from '../../src/api/alerts/alerts.controller';

/**
 * Signal Timeline — trafność na horyzontach 1d / 3d / 7d (25.11.2026).
 *
 * `computeHitRate` to czysta funkcja; `getTimeline` testujemy z atrapą DataSource
 * (bez NestJS TestingModule) — sprawdzamy kontrakt `summary` i kształt zapytania.
 */

describe('computeHitRate — hit rate jednego horyzontu', () => {
  it('pusta lista → brak oceny (null, n=0)', () => {
    expect(computeHitRate([])).toEqual({ hitRate: null, evaluated: 0 });
  });

  it('same null (sloty niewypełnione) → null, a nie 0%', () => {
    expect(computeHitRate([null, null, null])).toEqual({ hitRate: null, evaluated: 0 });
  });

  it('mianownik = tylko ocenione; null nie liczy się jako pudło', () => {
    expect(computeHitRate([true, false, null, true])).toEqual({ hitRate: 67, evaluated: 3 });
  });

  it('same pudła → 0% przy n>0 (odróżnialne od braku oceny)', () => {
    expect(computeHitRate([false, false])).toEqual({ hitRate: 0, evaluated: 2 });
  });

  it('zaokrąglenie do całości', () => {
    expect(computeHitRate([true, false, false])).toEqual({ hitRate: 33, evaluated: 3 });
    expect(computeHitRate([true, true, true, false, false, false, false, false])).toEqual({ hitRate: 38, evaluated: 8 });
  });
});

/** Wiersz w kształcie zwracanym przez pg (numeric jako string). */
function makeRow(overrides: Record<string, unknown>) {
  return {
    id: 1,
    symbol: 'TEST',
    ruleName: 'Form 4 Insider BUY',
    priority: 'HIGH',
    alertDirection: 'positive',
    catalystType: null,
    message: 'test',
    priceAtAlert: '100.0000',
    price1h: null,
    price4h: null,
    price1d: null,
    price3d: null,
    price7d: null,
    sentAt: new Date('2026-11-02T15:00:00Z'),
    delivered: false,
    nonDeliveryReason: 'observation',
    conviction: null,
    priceDeltaFromPrevPct: null,
    hoursSincePrev: null,
    sameDirectionAsPrev: null,
    directionCorrect1d: null,
    directionCorrect3d: null,
    directionCorrect7d: null,
    ...overrides,
  };
}

function makeController(rows: unknown[]) {
  const query = jest.fn().mockResolvedValue(rows);
  const controller = new AlertsController(
    null as never, null as never, null as never, null as never,
    { query } as never,
    null as never,
  );
  return { controller, query };
}

describe('AlertsController.getTimeline — summary 1d/3d/7d', () => {
  it('per ticker: osobny mianownik dla każdego horyzontu, price7d jako number', async () => {
    const { controller, query } = makeController([
      // świeży alert: jest tylko 1d
      makeRow({ id: 3, price1d: '101.0000', directionCorrect1d: true }),
      // pełny: 1d pudło, 3d i 7d trafione
      makeRow({ id: 2, price1d: '99.0000', price3d: '102.0000', price7d: '105.5000',
        directionCorrect1d: false, directionCorrect3d: true, directionCorrect7d: true }),
      // pełny: wszystko pudło
      makeRow({ id: 1, price1d: '98.0000', price3d: '97.0000', price7d: '96.0000',
        directionCorrect1d: false, directionCorrect3d: false, directionCorrect7d: false }),
    ]);

    const res = await controller.getTimeline('test', '90', '50');

    expect(res.summary).toMatchObject({
      totalAlerts: 3,
      hitRate1d: 33, evaluated1d: 3,
      hitRate3d: 50, evaluated3d: 2,
      hitRate7d: 50, evaluated7d: 2,
    });
    expect(res.alerts[0].price7d).toBeNull();
    expect(res.alerts[1].price7d).toBe(105.5);
    expect(res.alerts[1].directionCorrect7d).toBe(true);

    // Zapytanie: wszystkie trzy flagi + slot 7d, LAG po całej historii (filtr days na zewnątrz podzapytania).
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual(['TEST', 90, 50]);
    for (const alias of ['directionCorrect1d', 'directionCorrect3d', 'directionCorrect7d']) {
      expect(sql).toContain(`AS "${alias}"`);
    }
    expect(sql).toContain('price7d');
    expect(sql).toMatch(/\) t\s+WHERE t\."sentAt" > NOW\(\) - INTERVAL '1 day' \* \$2/);
  });

  it('brak ocenionych → hitRate null i evaluated 0 (front pokazuje „—")', async () => {
    const { controller } = makeController([makeRow({})]);
    const res = await controller.getTimeline('TEST');
    expect(res.summary).toMatchObject({
      hitRate1d: null, hitRate3d: null, hitRate7d: null,
      evaluated1d: 0, evaluated3d: 0, evaluated7d: 0,
    });
  });

  it('widok „wszystkie": te same flagi i price7d w wierszach, summary = null, sufit limitu 500', async () => {
    const { controller, query } = makeController([
      makeRow({ price7d: '110.0000', directionCorrect7d: true }),
    ]);
    const res = await controller.getTimeline(undefined, '90', '9999');

    expect(res.summary).toBeNull();
    expect(res.alerts[0].price7d).toBe(110);
    expect(res.alerts[0].directionCorrect7d).toBe(true);

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([90, 500]);
    for (const alias of ['directionCorrect1d', 'directionCorrect3d', 'directionCorrect7d']) {
      expect(sql).toContain(`AS "${alias}"`);
    }
  });
});
