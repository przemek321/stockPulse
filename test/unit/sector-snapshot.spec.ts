import { captureAlertSnapshot } from '../../src/price-outcome/sector-snapshot.helper';

/**
 * Testy helpera `captureAlertSnapshot`.
 * Single source of truth dla 3 parallel quotes (ticker + XBI + IBB).
 * Patrz `doc/FOLLOWUP-XBI-ADJUSTMENT.md`.
 */

class FakeFinnhubService {
  quotes: Record<string, number | null> = {};
  errorFor: Set<string> = new Set();
  callCount = 0;
  callOrder: string[] = [];

  async getQuote(symbol: string): Promise<number | null> {
    this.callCount++;
    this.callOrder.push(symbol);
    if (this.errorFor.has(symbol)) {
      throw new Error(`mock error for ${symbol}`);
    }
    return this.quotes[symbol] ?? null;
  }
}

describe('captureAlertSnapshot', () => {
  it('zwraca all-null gdy finnhub jest null', async () => {
    const result = await captureAlertSnapshot(null, 'BIIB');
    expect(result).toEqual({
      priceAtAlert: null,
      xbiAtAlert: null,
      ibbAtAlert: null,
    });
  });

  it('zwraca all-null gdy finnhub jest undefined', async () => {
    const result = await captureAlertSnapshot(undefined, 'BIIB');
    expect(result).toEqual({
      priceAtAlert: null,
      xbiAtAlert: null,
      ibbAtAlert: null,
    });
  });

  it('happy path: wszystkie 3 fetches succeed', async () => {
    const finnhub = new FakeFinnhubService();
    finnhub.quotes = { BIIB: 204.53, XBI: 80.12, IBB: 120.45 };

    const result = await captureAlertSnapshot(finnhub as any, 'BIIB');

    expect(result.priceAtAlert).toBe(204.53);
    expect(result.xbiAtAlert).toBe(80.12);
    expect(result.ibbAtAlert).toBe(120.45);
    expect(finnhub.callCount).toBe(3);
    expect(new Set(finnhub.callOrder)).toEqual(new Set(['BIIB', 'XBI', 'IBB']));
  });

  it('parallel execution — sortowanie callOrder nie deterministyczne, ale wszystkie 3 startują', async () => {
    const finnhub = new FakeFinnhubService();
    finnhub.quotes = { MRNA: 150, XBI: 80, IBB: 120 };
    await captureAlertSnapshot(finnhub as any, 'MRNA');
    expect(finnhub.callOrder).toHaveLength(3);
  });

  it('jeden fetch failure NIE blokuje innych (XBI throws, ticker + IBB OK)', async () => {
    const finnhub = new FakeFinnhubService();
    finnhub.quotes = { GILD: 80.5, IBB: 120.0 };
    finnhub.errorFor.add('XBI');

    const result = await captureAlertSnapshot(finnhub as any, 'GILD');

    expect(result.priceAtAlert).toBe(80.5);
    expect(result.xbiAtAlert).toBeNull();
    expect(result.ibbAtAlert).toBe(120.0);
  });

  it('ticker fetch error → priceAtAlert null, XBI/IBB nadal capture', async () => {
    const finnhub = new FakeFinnhubService();
    finnhub.quotes = { XBI: 80, IBB: 120 };
    finnhub.errorFor.add('UNKNOWN');

    const result = await captureAlertSnapshot(finnhub as any, 'UNKNOWN');

    expect(result.priceAtAlert).toBeNull();
    expect(result.xbiAtAlert).toBe(80);
    expect(result.ibbAtAlert).toBe(120);
  });

  it('wszystkie 3 fetches fail → all null (graceful, nie throws)', async () => {
    const finnhub = new FakeFinnhubService();
    finnhub.errorFor.add('BIIB');
    finnhub.errorFor.add('XBI');
    finnhub.errorFor.add('IBB');

    const result = await captureAlertSnapshot(finnhub as any, 'BIIB');

    expect(result.priceAtAlert).toBeNull();
    expect(result.xbiAtAlert).toBeNull();
    expect(result.ibbAtAlert).toBeNull();
  });

  it('Finnhub zwraca null (giełda zamknięta, free tier rate limit) → fields=null', async () => {
    const finnhub = new FakeFinnhubService();
    finnhub.quotes = { BIIB: null, XBI: 80, IBB: null };

    const result = await captureAlertSnapshot(finnhub as any, 'BIIB');

    expect(result.priceAtAlert).toBeNull();
    expect(result.xbiAtAlert).toBe(80);
    expect(result.ibbAtAlert).toBeNull();
  });

  it('różne tickery używają tych samych XBI/IBB symboli (single source)', async () => {
    const finnhub = new FakeFinnhubService();
    finnhub.quotes = { BIIB: 200, MRNA: 150, XBI: 80, IBB: 120 };

    const r1 = await captureAlertSnapshot(finnhub as any, 'BIIB');
    const r2 = await captureAlertSnapshot(finnhub as any, 'MRNA');

    expect(r1.xbiAtAlert).toBe(r2.xbiAtAlert);
    expect(r1.ibbAtAlert).toBe(r2.ibbAtAlert);
    expect(r1.priceAtAlert).not.toBe(r2.priceAtAlert);
  });
});
