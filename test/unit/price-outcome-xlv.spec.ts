import { PriceOutcomeService } from '../../src/price-outcome/price-outcome.service';

/**
 * XLV (01.11.2026) — instrumentacja z pre-rejestracji werdyktu #1 (01.09): sloty xlv1d/3d/7d wypełniane
 * tylko dla alertów, które mają xlvAtAlert (alerty sprzed wdrożenia zostają null — alpha vs XLV niepoliczalna).
 */
jest.mock('../../src/common/utils/market-hours.util', () => {
  const actual = jest.requireActual('../../src/common/utils/market-hours.util');
  return { ...actual, isNyseOpen: () => true, getEffectiveStartTime: (d: Date) => d };
});

const DAY = 24 * 3600_000;

function alert(id: number, sentAgoDays: number, xlvAtAlert: number | null): any {
  return {
    id, symbol: 'HUM', sentAt: new Date(Date.now() - sentAgoDays * DAY), priceAtAlert: 250,
    price1h: 251, price4h: 252, price1d: null, price3d: null, price7d: null, priceOutcomeDone: false,
    xbiAtAlert: 80, xbi1d: null, xbi3d: null, xbi7d: null,
    ibbAtAlert: 120, ibb1d: null, ibb3d: null, ibb7d: null,
    xlvAtAlert, xlv1d: null, xlv3d: null, xlv7d: null,
  };
}

function build(alerts: any[]) {
  const quotes: Record<string, number> = { HUM: 260, XBI: 82, IBB: 121, XLV: 147 };
  const finnhub = { getQuote: jest.fn((s: string) => Promise.resolve(quotes[s] ?? null)) };
  const repo = { find: jest.fn(() => Promise.resolve(alerts)), save: jest.fn((a: any) => Promise.resolve(a)) };
  const service = new PriceOutcomeService(repo as any, finnhub as any);
  return { service, finnhub, repo };
}

describe('PriceOutcomeService — sloty XLV (01.11.2026)', () => {
  it('alert z xlvAtAlert po 8 dniach → xlv1d/3d/7d wypełnione obok XBI/IBB', async () => {
    const a = alert(1, 8, 145);
    const { service, finnhub } = build([a]);
    await service.fillPriceOutcomes();
    expect(finnhub.getQuote).toHaveBeenCalledWith('XLV');
    expect([a.xlv1d, a.xlv3d, a.xlv7d]).toEqual([147, 147, 147]);
    expect([a.xbi7d, a.ibb7d, a.price7d]).toEqual([82, 121, 260]);
  });

  it('alert sprzed wdrożenia (xlvAtAlert=null) → sloty XLV zostają null, XBI/IBB bez zmian', async () => {
    const a = alert(2, 8, null);
    const { service } = build([a]);
    await service.fillPriceOutcomes();
    expect([a.xlv1d, a.xlv3d, a.xlv7d]).toEqual([null, null, null]);
    expect(a.xbi7d).toBe(82);
  });

  it('po 2 dniach → tylko xlv1d (3d/7d jeszcze nie due)', async () => {
    const a = alert(3, 2, 145);
    const { service } = build([a]);
    await service.fillPriceOutcomes();
    expect([a.xlv1d, a.xlv3d, a.xlv7d]).toEqual([147, null, null]);
  });
});
