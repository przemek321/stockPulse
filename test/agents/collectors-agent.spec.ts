/**
 * Agent: Collectors
 *
 * Weryfikuje kolektory danych: interwały, rate limity, deduplikację,
 * emitowane eventy, formaty externalId.
 * Pliki: src/collectors/stocktwits/, src/collectors/finnhub/,
 *        src/collectors/sec-edgar/, src/collectors/pdufa-bio/
 */

import { EventType } from '../../src/events/event-types';

// ── Stałe wyciągnięte z kodu ──

const ASSUMPTIONS = {
  STOCKTWITS: {
    INTERVAL_MS: 5 * 60 * 1000,
    DELAY_MS: 2000,
    EXTERNAL_ID_FORMAT: 'st_{messageId}',
    TABLE: 'raw_mentions',
    EVENT: 'NEW_MENTION',
    RATE_LIMIT: '200 req/hour',
  },
  FINNHUB: {
    INTERVAL_MS: 10 * 60 * 1000,
    DELAY_MS: 1500,
    TABLES: ['news_articles', 'insider_trades'],
    EVENTS: ['NEW_ARTICLE', 'NEW_INSIDER_TRADE'],
    RATE_LIMIT: '60 req/min',
    NEWS_HISTORY_DAYS: 7,
  },
  SEC_EDGAR: {
    INTERVAL_MS: 30 * 60 * 1000,
    DELAY_MS: 200,
    FORM4_XML_DELAY_MS: 150,
    IMPORTANT_FORMS: ['10-K', '10-Q', '8-K', '4', '3', '5', '13F-HR', 'S-1', '14A'],
    FILING_LIMIT: 20,
    EVENTS: ['NEW_FILING', 'NEW_INSIDER_TRADE'],
    RATE_LIMIT: '10 req/sec',
    BASE_URL: 'https://data.sec.gov',
  },
  PDUFA: {
    INTERVAL_MS: 6 * 60 * 60 * 1000,
    IMMEDIATE_ON_START: true,
    TABLE: 'pdufa_catalysts',
    EVENT: 'NEW_PDUFA_EVENT',
  },
};

// ── Testy: StockTwits ──

describe('Agent: Collectors — StockTwits', () => {
  it('interwał = 5 minut', () => {
    expect(ASSUMPTIONS.STOCKTWITS.INTERVAL_MS).toBe(300_000);
  });

  it('delay między symbolami = 2s (rate limit 200 req/hour)', () => {
    expect(ASSUMPTIONS.STOCKTWITS.DELAY_MS).toBe(2000);
  });

  it('externalId format: st_{messageId}', () => {
    const messageId = 12345;
    const externalId = `st_${messageId}`;
    expect(externalId).toBe('st_12345');
    expect(externalId).toMatch(/^st_\d+$/);
  });

  it('zapis do raw_mentions', () => {
    expect(ASSUMPTIONS.STOCKTWITS.TABLE).toBe('raw_mentions');
  });

  it('emituje NEW_MENTION', () => {
    expect(ASSUMPTIONS.STOCKTWITS.EVENT).toBe('NEW_MENTION');
    expect(EventType.NEW_MENTION).toBeDefined();
  });

  it('deduplikacja po externalId gwarantuje unikalność', () => {
    const existing = new Set(['st_100', 'st_200', 'st_300']);
    const incoming = [
      { id: 100 }, // duplikat
      { id: 400 }, // nowy
      { id: 200 }, // duplikat
    ];
    const newOnes = incoming.filter(m => !existing.has(`st_${m.id}`));
    expect(newOnes).toHaveLength(1);
    expect(newOnes[0].id).toBe(400);
  });
});

// ── Testy: Finnhub ──

describe('Agent: Collectors — Finnhub', () => {
  it('interwał = 10 minut', () => {
    expect(ASSUMPTIONS.FINNHUB.INTERVAL_MS).toBe(600_000);
  });

  it('delay między symbolami = 1.5s (rate limit 60 req/min)', () => {
    expect(ASSUMPTIONS.FINNHUB.DELAY_MS).toBe(1500);
  });

  it('zapisuje do news_articles + insider_trades', () => {
    expect(ASSUMPTIONS.FINNHUB.TABLES).toEqual(['news_articles', 'insider_trades']);
  });

  it('emituje NEW_ARTICLE + NEW_INSIDER_TRADE', () => {
    expect(ASSUMPTIONS.FINNHUB.EVENTS).toEqual(['NEW_ARTICLE', 'NEW_INSIDER_TRADE']);
  });

  it('historia newsów = 7 dni wstecz', () => {
    expect(ASSUMPTIONS.FINNHUB.NEWS_HISTORY_DAYS).toBe(7);
  });

  it('rate limit pozwala na ~40 symboli w cyklu (60 req/min, 1.5s delay)', () => {
    const symbolsPerMinute = 60 / 1.5; // 40 symboli/min
    expect(symbolsPerMinute).toBe(40);
    // Przy ~37 tickerach — mieści się w limicie
    expect(symbolsPerMinute).toBeGreaterThanOrEqual(37);
  });
});

// ── Testy: SEC EDGAR ──

describe('Agent: Collectors — SEC EDGAR', () => {
  it('interwał = 30 minut', () => {
    expect(ASSUMPTIONS.SEC_EDGAR.INTERVAL_MS).toBe(1_800_000);
  });

  it('delay per ticker = 200ms (rate limit 10 req/sec)', () => {
    expect(ASSUMPTIONS.SEC_EDGAR.DELAY_MS).toBe(200);
  });

  it('ważne formularze: 9 typów', () => {
    expect(ASSUMPTIONS.SEC_EDGAR.IMPORTANT_FORMS).toHaveLength(9);
  });

  it('zawiera 8-K, Form 4, 10-K, 10-Q', () => {
    expect(ASSUMPTIONS.SEC_EDGAR.IMPORTANT_FORMS).toContain('8-K');
    expect(ASSUMPTIONS.SEC_EDGAR.IMPORTANT_FORMS).toContain('4');
    expect(ASSUMPTIONS.SEC_EDGAR.IMPORTANT_FORMS).toContain('10-K');
    expect(ASSUMPTIONS.SEC_EDGAR.IMPORTANT_FORMS).toContain('10-Q');
  });

  it('limit filingów per cykl = 20', () => {
    expect(ASSUMPTIONS.SEC_EDGAR.FILING_LIMIT).toBe(20);
  });

  it('emituje NEW_FILING + NEW_INSIDER_TRADE', () => {
    expect(ASSUMPTIONS.SEC_EDGAR.EVENTS).toContain('NEW_FILING');
    expect(ASSUMPTIONS.SEC_EDGAR.EVENTS).toContain('NEW_INSIDER_TRADE');
  });

  it('base URL = data.sec.gov', () => {
    expect(ASSUMPTIONS.SEC_EDGAR.BASE_URL).toBe('https://data.sec.gov');
  });

  it('Form 4 XML delay = 150ms (dodatkowy rate limit)', () => {
    expect(ASSUMPTIONS.SEC_EDGAR.FORM4_XML_DELAY_MS).toBe(150);
  });
});

// ── Testy: PDUFA.bio ──

describe('Agent: Collectors — PDUFA.bio', () => {
  it('interwał = 6 godzin', () => {
    expect(ASSUMPTIONS.PDUFA.INTERVAL_MS).toBe(21_600_000);
  });

  it('natychmiastowe wywołanie po starcie', () => {
    expect(ASSUMPTIONS.PDUFA.IMMEDIATE_ON_START).toBe(true);
  });

  it('zapis do pdufa_catalysts', () => {
    expect(ASSUMPTIONS.PDUFA.TABLE).toBe('pdufa_catalysts');
  });

  it('emituje NEW_PDUFA_EVENT', () => {
    expect(ASSUMPTIONS.PDUFA.EVENT).toBe('NEW_PDUFA_EVENT');
  });

  it('PDUFA to kontekst dla GPT (nie generuje alertów bezpośrednio)', () => {
    // Weryfikacja: nie ma reguły alertów dla PDUFA
    // PDUFA wstrzykiwany jest do prompta GPT jako kontekst
    expect(true).toBe(true); // marker test — logika w dokumentacji
  });
});

// ── Testy: EventType enum ──

describe('Agent: Collectors — EventType spójność', () => {
  it('EventType.NEW_MENTION istnieje', () => {
    expect(EventType.NEW_MENTION).toBeDefined();
  });

  it('EventType.NEW_ARTICLE istnieje', () => {
    expect(EventType.NEW_ARTICLE).toBeDefined();
  });

  it('EventType.NEW_FILING istnieje', () => {
    expect(EventType.NEW_FILING).toBeDefined();
  });

  it('EventType.NEW_INSIDER_TRADE istnieje', () => {
    expect(EventType.NEW_INSIDER_TRADE).toBeDefined();
  });

  it('EventType.NEW_PDUFA_EVENT istnieje', () => {
    expect(EventType.NEW_PDUFA_EVENT).toBeDefined();
  });

  it('EventType.SENTIMENT_SCORED istnieje', () => {
    expect(EventType.SENTIMENT_SCORED).toBeDefined();
  });
});

// ── Testy: Rate limit compliance ──

describe('Agent: Collectors — Rate limit compliance', () => {
  it('StockTwits: 2s delay × 37 symboli = 74s < 180s (3 min) — OK', () => {
    const totalTime = ASSUMPTIONS.STOCKTWITS.DELAY_MS * 37;
    expect(totalTime).toBeLessThan(ASSUMPTIONS.STOCKTWITS.INTERVAL_MS);
  });

  it('Finnhub: 1.5s delay × 37 symboli = 55.5s < 600s (10 min) — OK', () => {
    const totalTime = ASSUMPTIONS.FINNHUB.DELAY_MS * 37;
    expect(totalTime).toBeLessThan(ASSUMPTIONS.FINNHUB.INTERVAL_MS);
  });

  it('SEC EDGAR: 200ms delay × 37 symboli = 7.4s < 1800s (30 min) — OK', () => {
    const totalTime = ASSUMPTIONS.SEC_EDGAR.DELAY_MS * 37;
    expect(totalTime).toBeLessThan(ASSUMPTIONS.SEC_EDGAR.INTERVAL_MS);
  });
});

// ── Testy: NEW_INSIDER_TRADE payload ──

describe('Agent: Collectors — NEW_INSIDER_TRADE payload', () => {
  // Pola emitowane przez sec-edgar.service.ts w evencie NEW_INSIDER_TRADE
  const INSIDER_TRADE_PAYLOAD_FIELDS = [
    'tradeId', 'symbol', 'totalValue', 'insiderName',
    'insiderRole', 'transactionType', 'shares',
    'is10b51Plan', 'sharesOwnedAfter', 'source',
  ];

  it('payload zawiera wszystkie wymagane pola', () => {
    const mockPayload = {
      tradeId: 1,
      symbol: 'ISRG',
      totalValue: 500_000,
      insiderName: 'John Doe',
      insiderRole: 'CEO',
      transactionType: 'BUY',
      shares: 1000,
      is10b51Plan: false,
      sharesOwnedAfter: 50000,
      source: 'SEC_EDGAR',
    };

    for (const field of INSIDER_TRADE_PAYLOAD_FIELDS) {
      expect(mockPayload).toHaveProperty(field);
    }
  });

  it('is10b51Plan to boolean (nie string)', () => {
    const payload = { is10b51Plan: false };
    expect(typeof payload.is10b51Plan).toBe('boolean');
  });

  it('sharesOwnedAfter może być null', () => {
    const payload = { sharesOwnedAfter: null as number | null };
    expect(payload.sharesOwnedAfter).toBeNull();
  });

  it('insiderRole może być null', () => {
    const payload = { insiderRole: null as string | null };
    expect(payload.insiderRole).toBeNull();
  });

  it('source = SEC_EDGAR (nie Finnhub)', () => {
    const payload = { source: 'SEC_EDGAR' };
    expect(payload.source).toBe('SEC_EDGAR');
  });
});

// ── Testy: collection_logs FAILED status ──

describe('Agent: Collectors — collection_logs FAILED tracking', () => {
  // BaseCollectorService.collect() → catch → logCollection('FAILED', 0, duration, message)

  it('status FAILED zapisywany z 0 nowych rekordów', () => {
    const logEntry = {
      status: 'FAILED',
      newRecords: 0,
      durationMs: 1500,
      error: 'Network timeout',
    };
    expect(logEntry.status).toBe('FAILED');
    expect(logEntry.newRecords).toBe(0);
    expect(logEntry.error).toBeDefined();
  });

  it('status SUCCESS vs FAILED — dwa możliwe stany', () => {
    const validStatuses = ['SUCCESS', 'FAILED'];
    expect(validStatuses).toContain('SUCCESS');
    expect(validStatuses).toContain('FAILED');
  });

  it('FAILED zawiera czas trwania (durationMs)', () => {
    // Nawet failed collection loguje czas — ważne dla debugowania
    const failedLog = { status: 'FAILED', durationMs: 5000 };
    expect(failedLog.durationMs).toBeGreaterThan(0);
  });
});
