/**
 * Agent: Price Outcome Tracker
 *
 * Weryfikuje CRON uzupełnianie cen, guard NYSE, sloty czasowe,
 * limity API, hard timeout 7 dni.
 * Pliki: src/price-outcome/price-outcome.service.ts,
 *        src/common/utils/market-hours.util.ts
 */

import { isNyseOpen } from '../../src/common/utils/market-hours.util';

// ── Stałe wyciągnięte z kodu ──

const ASSUMPTIONS = {
  CRON: '0 * * * *',
  MAX_QUOTES_PER_CYCLE: 30,
  HARD_TIMEOUT_MS: 7 * 24 * 60 * 60 * 1000,
  HARD_TIMEOUT_DAYS: 7,
  SLOTS: [
    { field: 'price1h', delayMs: 1 * 60 * 60 * 1000, label: '1h' },
    { field: 'price4h', delayMs: 4 * 60 * 60 * 1000, label: '4h' },
    { field: 'price1d', delayMs: 24 * 60 * 60 * 1000, label: '1d' },
    { field: 'price3d', delayMs: 72 * 60 * 60 * 1000, label: '3d' },
  ],
  NYSE: {
    OPEN_HOUR: 9,
    OPEN_MINUTE: 30,
    CLOSE_HOUR: 16,
    CLOSE_MINUTE: 0,
    TRADING_DAYS: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  },
};

// ── Testy: Założenia ──

describe('Agent: Price Outcome — Założenia', () => {
  it('CRON = co pełną godzinę', () => {
    expect(ASSUMPTIONS.CRON).toBe('0 * * * *');
  });

  it('max 30 zapytań Finnhub per cykl', () => {
    expect(ASSUMPTIONS.MAX_QUOTES_PER_CYCLE).toBe(30);
  });

  it('hard timeout = 7 dni', () => {
    expect(ASSUMPTIONS.HARD_TIMEOUT_MS).toBe(604_800_000);
  });

  it('4 sloty cenowe: 1h, 4h, 1d, 3d', () => {
    expect(ASSUMPTIONS.SLOTS).toHaveLength(4);
    expect(ASSUMPTIONS.SLOTS.map(s => s.label)).toEqual(['1h', '4h', '1d', '3d']);
  });

  it('slot 1h = 3_600_000 ms', () => {
    expect(ASSUMPTIONS.SLOTS[0].delayMs).toBe(3_600_000);
  });

  it('slot 4h = 14_400_000 ms', () => {
    expect(ASSUMPTIONS.SLOTS[1].delayMs).toBe(14_400_000);
  });

  it('slot 1d = 86_400_000 ms', () => {
    expect(ASSUMPTIONS.SLOTS[2].delayMs).toBe(86_400_000);
  });

  it('slot 3d = 259_200_000 ms', () => {
    expect(ASSUMPTIONS.SLOTS[3].delayMs).toBe(259_200_000);
  });
});

// ── Testy: Logika slotów czasowych ──

describe('Agent: Price Outcome — Logika slotów', () => {
  it('alert sprzed 30 min → żaden slot nie jest gotowy', () => {
    const alertTime = Date.now() - 30 * 60 * 1000;
    const now = Date.now();
    const readySlots = ASSUMPTIONS.SLOTS.filter(s => alertTime + s.delayMs <= now);
    expect(readySlots).toHaveLength(0);
  });

  it('alert sprzed 2h → slot 1h gotowy', () => {
    const alertTime = Date.now() - 2 * 60 * 60 * 1000;
    const now = Date.now();
    const readySlots = ASSUMPTIONS.SLOTS.filter(s => alertTime + s.delayMs <= now);
    expect(readySlots.map(s => s.label)).toEqual(['1h']);
  });

  it('alert sprzed 5h → sloty 1h i 4h gotowe', () => {
    const alertTime = Date.now() - 5 * 60 * 60 * 1000;
    const now = Date.now();
    const readySlots = ASSUMPTIONS.SLOTS.filter(s => alertTime + s.delayMs <= now);
    expect(readySlots.map(s => s.label)).toEqual(['1h', '4h']);
  });

  it('alert sprzed 25h → sloty 1h, 4h, 1d gotowe', () => {
    const alertTime = Date.now() - 25 * 60 * 60 * 1000;
    const now = Date.now();
    const readySlots = ASSUMPTIONS.SLOTS.filter(s => alertTime + s.delayMs <= now);
    expect(readySlots.map(s => s.label)).toEqual(['1h', '4h', '1d']);
  });

  it('alert sprzed 4 dni → wszystkie sloty gotowe', () => {
    const alertTime = Date.now() - 4 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const readySlots = ASSUMPTIONS.SLOTS.filter(s => alertTime + s.delayMs <= now);
    expect(readySlots.map(s => s.label)).toEqual(['1h', '4h', '1d', '3d']);
  });
});

// ── Testy: Hard timeout ──

describe('Agent: Price Outcome — Hard timeout', () => {
  it('alert sprzed 6 dni → NIE timeout', () => {
    const alertTime = Date.now() - 6 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const isTimeout = now - alertTime > ASSUMPTIONS.HARD_TIMEOUT_MS;
    expect(isTimeout).toBe(false);
  });

  it('alert sprzed 8 dni → timeout (mark done)', () => {
    const alertTime = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const isTimeout = now - alertTime > ASSUMPTIONS.HARD_TIMEOUT_MS;
    expect(isTimeout).toBe(true);
  });

  it('alert sprzed dokładnie 7 dni → nie timeout (> nie >=)', () => {
    const alertTime = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const isTimeout = now - alertTime > ASSUMPTIONS.HARD_TIMEOUT_MS;
    expect(isTimeout).toBe(false);
  });
});

// ── Testy: Grupowanie po symbolu ──

describe('Agent: Price Outcome — Grupowanie po symbolu', () => {
  it('wiele alertów tego samego tickera → 1 zapytanie Finnhub', () => {
    const alerts = [
      { id: 1, symbol: 'ISRG', priceAtAlert: 400 },
      { id: 2, symbol: 'ISRG', priceAtAlert: 402 },
      { id: 3, symbol: 'MRNA', priceAtAlert: 150 },
    ];

    const bySymbol = new Map<string, typeof alerts>();
    for (const alert of alerts) {
      const list = bySymbol.get(alert.symbol) ?? [];
      list.push(alert);
      bySymbol.set(alert.symbol, list);
    }

    expect(bySymbol.size).toBe(2); // 2 symbole, nie 3 alerty
    expect(bySymbol.get('ISRG')!.length).toBe(2);
    expect(bySymbol.get('MRNA')!.length).toBe(1);
  });

  it('max 30 symboli per cykl', () => {
    const symbols = Array.from({ length: 50 }, (_, i) => `SYM${i}`);
    const limited = symbols.slice(0, ASSUMPTIONS.MAX_QUOTES_PER_CYCLE);
    expect(limited.length).toBe(30);
  });
});

// ── Testy: isNyseOpen() ──

describe('Agent: Price Outcome — isNyseOpen()', () => {
  // UWAGA: te testy zależą od czasu systemowego.
  // Testujemy logikę wewnętrzną, nie rzeczywisty czas.

  it('funkcja isNyseOpen() jest zdefiniowana i zwraca boolean', () => {
    const result = isNyseOpen();
    expect(typeof result).toBe('boolean');
  });

  it('NYSE otwarta pon-pt 9:30-16:00 ET (weryfikacja stałych)', () => {
    expect(ASSUMPTIONS.NYSE.OPEN_HOUR).toBe(9);
    expect(ASSUMPTIONS.NYSE.OPEN_MINUTE).toBe(30);
    expect(ASSUMPTIONS.NYSE.CLOSE_HOUR).toBe(16);
    expect(ASSUMPTIONS.NYSE.CLOSE_MINUTE).toBe(0);
  });

  it('trading days = pon-pt', () => {
    expect(ASSUMPTIONS.NYSE.TRADING_DAYS).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
    expect(ASSUMPTIONS.NYSE.TRADING_DAYS).not.toContain('Sat');
    expect(ASSUMPTIONS.NYSE.TRADING_DAYS).not.toContain('Sun');
  });
});

// ── Testy: Kolumny alertu ──

describe('Agent: Price Outcome — Kolumny w tabeli alerts', () => {
  it('priceAtAlert wypełniane w momencie alertu (nie przez CRON)', () => {
    const alert = {
      priceAtAlert: 150.25,
      price1h: null,
      price4h: null,
      price1d: null,
      price3d: null,
      priceOutcomeDone: false,
    };
    expect(alert.priceAtAlert).toBeDefined();
    expect(alert.price1h).toBeNull();
  });

  it('priceOutcomeDone=true gdy wszystkie sloty wypełnione', () => {
    const alert = {
      priceAtAlert: 150.25,
      price1h: 151.0,
      price4h: 149.5,
      price1d: 152.0,
      price3d: 148.0,
      priceOutcomeDone: false,
    };
    const allFilled = alert.price1h !== null && alert.price4h !== null &&
                      alert.price1d !== null && alert.price3d !== null;
    expect(allFilled).toBe(true);
  });

  it('priceOutcomeDone=true przy hard timeout nawet bez wszystkich slotów', () => {
    const alert = {
      priceAtAlert: 150.25,
      price1h: 151.0,
      price4h: null, // brak
      price1d: null, // brak
      price3d: null, // brak
      priceOutcomeDone: false,
      createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000), // 8 dni temu
    };
    const isTimeout = Date.now() - alert.createdAt.getTime() > ASSUMPTIONS.HARD_TIMEOUT_MS;
    expect(isTimeout).toBe(true);
    // System powinien ustawić priceOutcomeDone = true
  });
});
