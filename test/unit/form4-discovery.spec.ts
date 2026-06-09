import {
  Form4DiscoveryService,
  parseGetCurrentAtom,
  parseDailyIndexForm4,
  isHealthcareSic,
  prefilterForm4Buy,
  DISCOVERY_MIN_BUY_VALUE,
  DISCOVERY_MIN_MCAP_MLN,
  DISCOVERY_MAX_REGISTRATIONS_PER_DAY,
} from '../../src/collectors/form4-discovery/form4-discovery.service';
import { Form4Transaction } from '../../src/collectors/sec-edgar/form4-parser';

/**
 * Pakiet 2 (10.06.2026) — event-driven discovery Form 4 sector-wide.
 *
 * Kontrakt:
 *   1. parseGetCurrentAtom: tylko wpisy (Issuer), dedup po accession.
 *   2. parseDailyIndexForm4: tylko form type dokładnie '4'.
 *   3. prefilterForm4Buy: discretionary BUY >= $500K od C-suite/Director;
 *      czyści 10% ownerzy odrzucani; agregacja per insider (TASK-03).
 *   4. processAccession: SIC gate przed XML fetch (oszczędność ~92% fetchy),
 *      istniejący ticker → skip, mcap/ADV gate, cap 5 rejestracji/dzień,
 *      rejestracja przez kanoniczną ścieżkę parseAndSaveForm4.
 */

// ── Pure functions ────────────────────────────────────────────────

describe('parseGetCurrentAtom (Pakiet 2)', () => {
  const atomSample = `<?xml version="1.0" encoding="ISO-8859-1" ?>
<feed xmlns="http://www.w3.org/2005/Atom">
<entry>
<title>4 - Rain Enhancement Technologies Holdco, Inc. (0002028293) (Issuer)</title>
<summary type="html"> &lt;b&gt;Filed:&lt;/b&gt; 2026-06-09 &lt;b&gt;AccNo:&lt;/b&gt; 0001213900-26-066921 &lt;b&gt;Size:&lt;/b&gt; 8 KB</summary>
<id>urn:tag:sec.gov,2008:accession-number=0001213900-26-066921</id>
</entry>
<entry>
<title>4 - You Harry L. (0001432602) (Reporting)</title>
<id>urn:tag:sec.gov,2008:accession-number=0001213900-26-066921</id>
</entry>
<entry>
<title>4 - Axos Financial, Inc. (0001299709) (Issuer)</title>
<id>urn:tag:sec.gov,2008:accession-number=0001778031-26-000009</id>
</entry>
<entry>
<title>4 - Constantine Thomas M (0001778031) (Reporting)</title>
<id>urn:tag:sec.gov,2008:accession-number=0001778031-26-000009</id>
</entry>
</feed>`;

  it('bierze tylko wpisy (Issuer) i dedupuje po accession', () => {
    const entries = parseGetCurrentAtom(atomSample);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      accession: '0001213900-26-066921',
      issuerCik: '0002028293',
      issuerName: 'Rain Enhancement Technologies Holdco, Inc.',
      filedDate: '2026-06-09',
    });
    expect(entries[1].issuerCik).toBe('0001299709');
  });

  it('pusty/nieoczekiwany XML → pusta lista (PARSER_EMPTY w serwisie)', () => {
    expect(parseGetCurrentAtom('<html>maintenance</html>')).toHaveLength(0);
  });

  it('WYKLUCZA 4/A (amendment może być korektą filingu sprzed miesięcy — stęchły sygnał)', () => {
    const xml = `<entry><title>4/A - Some Corp (0001234567) (Issuer)</title>
<id>urn:tag:sec.gov,2008:accession-number=0001234567-26-000001</id></entry>`;
    expect(parseGetCurrentAtom(xml)).toHaveLength(0);
  });

  it('wyciąga filedDate z summary (Filed: YYYY-MM-DD, HTML-escaped)', () => {
    const entries = parseGetCurrentAtom(atomSample);
    expect(entries[0].filedDate).toBe('2026-06-09');
  });
});

describe('parseDailyIndexForm4 (Pakiet 2)', () => {
  const idxSample = [
    'Form Type   Company Name   CIK   Date Filed  File Name',
    '---------------------------------------------------------',
    '10-K        Big Corp                       123456    20260608    edgar/data/123456/0001111111-26-000001.txt',
    '4           UroGen Pharma Ltd.             1668243   20260608    edgar/data/1668243/0001437749-26-019964.txt',
    '4/A         Other Corp                     999999    20260608    edgar/data/999999/0002222222-26-000002.txt',
    '424B5       Shelf Corp                     888888    20260608    edgar/data/888888/0003333333-26-000003.txt',
    '4           Axos Financial, Inc.           1299709   20260608    edgar/data/1299709/0001778031-26-000009.txt',
  ].join('\n');

  it('wyciąga tylko form type dokładnie 4 (bez 4/A i 424B5) + dateFiled', () => {
    const rows = parseDailyIndexForm4(idxSample);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      cik: '0001668243',
      accession: '0001437749-26-019964',
      dateFiled: '2026-06-08',
    });
    expect(rows[1].accession).toBe('0001778031-26-000009');
  });

  it('dual-row reality: NIE dedupuje po accession — wiersz emitenta i ownera zostają', () => {
    // P1 z weryfikacji: ten sam accession z CIK emitenta ORAZ CIK osoby;
    // rozstrzyga processAccession (CIK osoby ma puste sic+tickers → bez markSeen)
    const dualIdx = [
      '4           Kosaraju Sridhar               1651325   20260608    edgar/data/1651325/0001610717-26-000191.txt',
      '4           10x Genomics, Inc.             1770787   20260608    edgar/data/1770787/0001610717-26-000191.txt',
    ].join('\n');
    const rows = parseDailyIndexForm4(dualIdx);
    expect(rows).toHaveLength(2);
    expect(rows[0].accession).toBe(rows[1].accession);
    expect(rows[0].cik).not.toBe(rows[1].cik);
  });
});

describe('isHealthcareSic (Pakiet 2)', () => {
  it('pharma/HMO/research → true', () => {
    expect(isHealthcareSic('2834')).toBe(true); // URGN pharma preparations
    expect(isHealthcareSic(6324)).toBe(true);   // UNH-class HMO
    expect(isHealthcareSic('8731')).toBe(true); // biological research
    expect(isHealthcareSic('3841')).toBe(true); // surgical devices
  });

  it('semiconductors/banki/null → false', () => {
    expect(isHealthcareSic('3674')).toBe(false); // semis (MU-class)
    expect(isHealthcareSic('6022')).toBe(false); // banki (BAC-class — 607 control BUY noise)
    expect(isHealthcareSic(null)).toBe(false);
    expect(isHealthcareSic(undefined)).toBe(false);
  });
});

// ── prefilterForm4Buy ─────────────────────────────────────────────

function txn(overrides: Partial<Form4Transaction>): Form4Transaction {
  return {
    insiderName: 'Smith John',
    insiderRole: 'Chief Executive Officer',
    transactionType: 'BUY',
    shares: 10_000,
    pricePerShare: 60,
    totalValue: 600_000,
    transactionDate: new Date('2026-06-09'),
    is10b51Plan: false,
    sharesOwnedAfter: 100_000,
    ...overrides,
  };
}

describe('prefilterForm4Buy (Pakiet 2)', () => {
  it('CEO discretionary BUY $600K → pass', () => {
    const r = prefilterForm4Buy([txn({})]);
    expect(r.pass).toBe(true);
    expect(r.buyValue).toBe(600_000);
  });

  it('Director BUY $501K → pass (rola Director wystarcza)', () => {
    const r = prefilterForm4Buy([txn({ insiderRole: 'Director', totalValue: 501_000 })]);
    expect(r.pass).toBe(true);
  });

  it('CEO BUY $499K → below_value_threshold', () => {
    const r = prefilterForm4Buy([txn({ totalValue: 499_000 })]);
    expect(r.pass).toBe(false);
    expect(r.reason).toBe('below_value_threshold');
  });

  it('czysty 10% Owner BUY $5M → no_exec_role_buy (86% szumu all-market)', () => {
    const r = prefilterForm4Buy([
      txn({ insiderName: 'Big Fund LP', insiderRole: '10% Owner', totalValue: 5_000_000 }),
    ]);
    expect(r.pass).toBe(false);
    expect(r.reason).toBe('no_exec_role_buy');
  });

  it('plan 10b5-1 BUY $1M → no_discretionary_buy (doc-level aff10b5One, fix P1-00)', () => {
    const r = prefilterForm4Buy([txn({ totalValue: 1_000_000, is10b51Plan: true })]);
    expect(r.pass).toBe(false);
    expect(r.reason).toBe('no_discretionary_buy');
  });

  it('SELL only → no_discretionary_buy', () => {
    const r = prefilterForm4Buy([txn({ transactionType: 'SELL' })]);
    expect(r.pass).toBe(false);
  });

  it('split fills CEO 3×$200K = $600K aggregate → pass (semantyka TASK-03)', () => {
    const r = prefilterForm4Buy([
      txn({ totalValue: 200_000 }),
      txn({ totalValue: 200_000 }),
      txn({ totalValue: 200_000 }),
    ]);
    expect(r.pass).toBe(true);
    expect(r.buyValue).toBe(600_000);
  });

  it('Harvard hole (weryfikacja 10.06): entity 10% Owner z "PRESIDENT" w NAZWIE → odrzucony', () => {
    // isCsuiteRole z drugim argumentem name matchowałby /\bPresident\b/ na nazwie
    // entity — prefilter woła role-only. Realny wzorzec: uczelnie/fundusze jako
    // 10% ownerzy biotechów.
    const r = prefilterForm4Buy([
      txn({
        insiderName: 'PRESIDENT AND FELLOWS OF HARVARD COLLEGE',
        insiderRole: '10% Owner',
        totalValue: 1_000_000,
      }),
    ]);
    expect(r.pass).toBe(false);
    expect(r.reason).toBe('no_exec_role_buy');
  });

  it('CSO CAPITAL LP (wzorzec C-suite w nazwie funduszu) → odrzucony', () => {
    const r = prefilterForm4Buy([
      txn({ insiderName: 'CSO CAPITAL LP', insiderRole: '10% Owner', totalValue: 2_000_000 }),
    ]);
    expect(r.pass).toBe(false);
  });

  it('mieszany filing: 10% Owner $5M + Director $600K → pass na Directorze', () => {
    const r = prefilterForm4Buy([
      txn({ insiderName: 'Big Fund LP', insiderRole: '10% Owner', totalValue: 5_000_000 }),
      txn({ insiderName: 'Jones Mary', insiderRole: 'Director', totalValue: 600_000 }),
    ]);
    expect(r.pass).toBe(true);
    expect(r.insiderName).toBe('Jones Mary');
  });

  it('stałe: $500K / $250M mcap / 5 rejestracji per dzień', () => {
    expect(DISCOVERY_MIN_BUY_VALUE).toBe(500_000);
    expect(DISCOVERY_MIN_MCAP_MLN).toBe(250);
    expect(DISCOVERY_MAX_REGISTRATIONS_PER_DAY).toBe(5);
  });
});

// ── Integracja serwisu (mocked fetch/repos/finnhub/redis) ─────────

const VALID_FORM4_XML = `<?xml version="1.0"?>
<ownershipDocument>
  <reportingOwner>
    <reportingOwnerId><rptOwnerName>Smith John</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><officerTitle>Chief Executive Officer</officerTitle></reportingOwnerRelationship>
  </reportingOwner>
  <aff10b5One>0</aff10b5One>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <transactionDate><value>2026-06-09</value></transactionDate>
      <transactionCoding><transactionCode>P</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>20000</value></transactionShares>
        <transactionPricePerShare><value>40</value></transactionPricePerShare>
      </transactionAmounts>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
</ownershipDocument>`;

function buildService(opts: {
  sic?: string;
  ticker?: string | null;
  exchange?: string;
  existingTicker?: boolean;
  mcapMln?: number | null;
  avgVolMln?: number | null;
  price?: number | null;
  registeredToday?: number;
  xml?: string;
}) {
  const redisStore = new Map<string, string>();
  const mocks = {
    tickerRepo: {
      findOne: jest.fn().mockResolvedValue(opts.existingTicker ? { symbol: opts.ticker } : null),
      create: jest.fn((x: any) => x),
      save: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(opts.registeredToday ?? 0),
      })),
    },
    filingRepo: {
      create: jest.fn((x: any) => x),
      save: jest.fn(async (x: any) => { x.id = 991; return x; }),
      findOne: jest.fn().mockResolvedValue(null),
    },
    secEdgar: { parseAndSaveForm4: jest.fn().mockResolvedValue(1) },
    finnhub: {
      getCompanyProfile: jest.fn().mockResolvedValue(
        opts.mcapMln === null ? null : { marketCapMln: opts.mcapMln ?? 1370, exchange: 'NASDAQ', name: 'Test Co' },
      ),
      get10DayAvgVolumeMlnShares: jest.fn().mockResolvedValue(opts.avgVolMln ?? 0.6),
      getQuote: jest.fn().mockResolvedValue(opts.price ?? 40),
    },
    config: { get: jest.fn((_k: string, def?: string) => def ?? 'StockPulse test test@test.pl') },
    eventEmitter: { emit: jest.fn() },
    redis: {
      get: jest.fn(async (k: string) => redisStore.get(k) ?? null),
      set: jest.fn(async (k: string, v: string) => { redisStore.set(k, v); return 'OK'; }),
      exists: jest.fn(async (k: string) => (redisStore.has(k) ? 1 : 0)),
      incr: jest.fn(async (k: string) => {
        const v = Number(redisStore.get(k) ?? 0) + 1; redisStore.set(k, String(v)); return v;
      }),
      expire: jest.fn(async () => 1),
    },
    redisStore,
  };

  const submissionsJson = JSON.stringify({
    sic: opts.sic ?? '2834',
    sicDescription: 'Pharmaceutical Preparations',
    tickers: opts.ticker === null ? [] : [opts.ticker ?? 'TSTX'],
    exchanges: opts.ticker === null ? [] : [opts.exchange ?? 'Nasdaq'],
    name: 'Test Pharma Inc.',
  });
  const indexJson = JSON.stringify({ directory: { item: [{ name: 'form4.xml' }] } });

  global.fetch = jest.fn(async (url: any) => {
    const u = String(url);
    let body = '';
    if (u.includes('data.sec.gov/submissions')) body = submissionsJson;
    else if (u.endsWith('/index.json')) body = indexJson;
    else if (u.endsWith('form4.xml')) body = opts.xml ?? VALID_FORM4_XML;
    else throw new Error(`unexpected fetch ${u}`);
    return { ok: true, status: 200, text: async () => body } as any;
  }) as any;

  const svc = new Form4DiscoveryService(
    mocks.tickerRepo as any,
    mocks.filingRepo as any,
    mocks.secEdgar as any,
    mocks.finnhub as any,
    mocks.config as any,
    mocks.eventEmitter as any,
    mocks.redis as any,
  );
  return { svc, mocks };
}

describe('Form4DiscoveryService.processAccession (Pakiet 2)', () => {
  const ACC = '0001437749-26-019964';
  const CIK = '0001668243';

  it('happy path: healthcare CEO BUY $800K + mcap OK → rejestracja + kanoniczny persist', async () => {
    const { svc, mocks } = buildService({ sic: '2834', ticker: 'TSTX' });

    const registered = await (svc as any).processAccession(ACC, CIK, new AbortController().signal);

    expect(registered).toBe(true);
    expect(mocks.tickerRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'TSTX',
        sector: 'healthcare_discovery',
        observationOnly: true,
        priority: 'LOW',
      }),
    );
    expect(mocks.secEdgar.parseAndSaveForm4).toHaveBeenCalledWith(
      'TSTX', ACC, expect.stringContaining('form4.xml'), expect.any(String),
      expect.stringContaining('<ownershipDocument>'), // preloaded XML — bez 2. fetchu
    );
    expect(mocks.eventEmitter.emit).toHaveBeenCalled(); // NEW_FILING
    expect(mocks.redisStore.has(`seen:${ACC}`)).toBe(true);
  });

  it('non-healthcare SIC (semis 3674) → skip PRZED fetchem XML', async () => {
    const { svc, mocks } = buildService({ sic: '3674', ticker: 'MUUU' });

    const registered = await (svc as any).processAccession(ACC, CIK, new AbortController().signal);

    expect(registered).toBe(false);
    expect(mocks.tickerRepo.save).not.toHaveBeenCalled();
    // tylko submissions fetch — zero index.json/xml
    const urls = (global.fetch as jest.Mock).mock.calls.map((c) => String(c[0]));
    expect(urls.every((u) => u.includes('data.sec.gov/submissions'))).toBe(true);
    expect(mocks.redisStore.has(`seen:${ACC}`)).toBe(true);
  });

  it('ticker już w uniwersum (też soft-deleted) → skip bez rejestracji', async () => {
    const { svc, mocks } = buildService({ sic: '2834', ticker: 'PODD', existingTicker: true });

    const registered = await (svc as any).processAccession(ACC, CIK, new AbortController().signal);

    expect(registered).toBe(false);
    expect(mocks.tickerRepo.save).not.toHaveBeenCalled();
  });

  it('mcap $90M < $250M → odrzucony po pre-filtrze', async () => {
    const { svc, mocks } = buildService({ sic: '2834', ticker: 'TINY', mcapMln: 90 });

    const registered = await (svc as any).processAccession(ACC, CIK, new AbortController().signal);

    expect(registered).toBe(false);
    expect(mocks.tickerRepo.save).not.toHaveBeenCalled();
    expect(mocks.redisStore.has(`seen:${ACC}`)).toBe(true);
  });

  it('ADV poniżej $1M (0.01M szt × $40 = $400K) → odrzucony', async () => {
    const { svc, mocks } = buildService({ sic: '2834', ticker: 'ILLQ', avgVolMln: 0.01 });

    const registered = await (svc as any).processAccession(ACC, CIK, new AbortController().signal);

    expect(registered).toBe(false);
    expect(mocks.tickerRepo.save).not.toHaveBeenCalled();
  });

  it('cap 5 rejestracji/dzień (data ET) → ODROCZONY bez markSeen (nie utracony)', async () => {
    const { svc, mocks } = buildService({ sic: '2834', ticker: 'SIXT' });
    const etDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    mocks.redisStore.set(`regcount:${etDate}`, '5');

    const registered = await (svc as any).processAccession(ACC, CIK, new AbortController().signal);

    expect(registered).toBe(false);
    expect(mocks.tickerRepo.save).not.toHaveBeenCalled();
    // ODROCZONY: bez markSeen — retry następnego dnia gdy cap się zwolni
    expect(mocks.redisStore.has(`seen:${ACC}`)).toBe(false);
  });

  it('rejestracja inkrementuje licznik regcount:{dataET}', async () => {
    const { svc, mocks } = buildService({ sic: '2834', ticker: 'TSTX' });
    const etDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

    await (svc as any).processAccession(ACC, CIK, new AbortController().signal);

    expect(mocks.redisStore.get(`regcount:${etDate}`)).toBe('1');
  });

  it('person-CIK row (reconciliation dual-row, P1): puste sic+tickers → BEZ markSeen', async () => {
    // CIK reporting-ownera (osoby) ma w submissions sic='' i tickers=[] —
    // accession musi zostać nietknięty, żeby wiersz EMITENTA go przetworzył
    const { svc, mocks } = buildService({ sic: '', ticker: null });

    const registered = await (svc as any).processAccession(ACC, CIK, new AbortController().signal);

    expect(registered).toBe(false);
    expect(mocks.redisStore.has(`seen:${ACC}`)).toBe(false);
    expect(mocks.tickerRepo.save).not.toHaveBeenCalled();
  });

  it('OTC exchange → markSeen skip (spec: exchange-listed only)', async () => {
    const { svc, mocks } = buildService({ sic: '2834', ticker: 'OTCX', exchange: 'OTC Markets' });

    const registered = await (svc as any).processAccession(ACC, CIK, new AbortController().signal);

    expect(registered).toBe(false);
    expect(mocks.redisStore.has(`seen:${ACC}`)).toBe(true);
  });

  it('Finnhub transient (profile null) → BEZ markSeen (retry, nie permanent loss)', async () => {
    const { svc, mocks } = buildService({ sic: '2834', ticker: 'FNHB', mcapMln: null });

    const registered = await (svc as any).processAccession(ACC, CIK, new AbortController().signal);

    expect(registered).toBe(false);
    expect(mocks.redisStore.has(`seen:${ACC}`)).toBe(false);
    expect(mocks.tickerRepo.save).not.toHaveBeenCalled();
  });

  it('parseAndSaveForm4 zwraca 0 (DB error) → 1 inline retry, potem ERROR + markSeen (retry przez cykl zablokowany krokiem 2)', async () => {
    const { svc, mocks } = buildService({ sic: '2834', ticker: 'DBER' });
    mocks.secEdgar.parseAndSaveForm4.mockResolvedValue(0);

    const registered = await (svc as any).processAccession(ACC, CIK, new AbortController().signal);

    expect(registered).toBe(true); // ticker faktycznie zarejestrowany
    expect(mocks.secEdgar.parseAndSaveForm4).toHaveBeenCalledTimes(2); // inline retry
    expect(mocks.redisStore.has(`seen:${ACC}`)).toBe(true);
  });

  it('filing bez kwalifikującego BUY (SELL only) → seen, bez Finnhub calls', async () => {
    const sellXml = VALID_FORM4_XML.replace(
      '<transactionCode>P</transactionCode>',
      '<transactionCode>S</transactionCode>',
    );
    const { svc, mocks } = buildService({ sic: '2834', ticker: 'SLLR', xml: sellXml });

    const registered = await (svc as any).processAccession(ACC, CIK, new AbortController().signal);

    expect(registered).toBe(false);
    expect(mocks.finnhub.getCompanyProfile).not.toHaveBeenCalled();
    expect(mocks.redisStore.has(`seen:${ACC}`)).toBe(true);
  });

  it('błąd HTTP submissions → BEZ markSeen (retry w następnym cyklu)', async () => {
    const { svc, mocks } = buildService({ sic: '2834', ticker: 'RTRY' });
    (global.fetch as jest.Mock).mockImplementation(async () => {
      throw new Error('ECONNRESET');
    });

    const registered = await (svc as any).processAccession(ACC, CIK, new AbortController().signal);

    expect(registered).toBe(false);
    expect(mocks.redisStore.has(`seen:${ACC}`)).toBe(false);
  });

  it('cache SIC: drugi filing tego samego CIK nie fetchuje submissions ponownie', async () => {
    const { svc } = buildService({ sic: '3674', ticker: 'MUUU' });
    const sig = new AbortController().signal;

    await (svc as any).processAccession(ACC, CIK, sig);
    const fetchesAfterFirst = (global.fetch as jest.Mock).mock.calls.length;
    await (svc as any).processAccession('0001437749-26-019965', CIK, sig);

    expect((global.fetch as jest.Mock).mock.calls.length).toBe(fetchesAfterFirst);
  });
});

// ── Cykle: poll + reconciliation (luka z weryfikacji 10.06) ────────

describe('Form4DiscoveryService.runDiscoveryCycle / runReconciliation (Pakiet 2)', () => {
  const ATOM_OK = `<feed><entry>
<title>4 - Test Pharma Inc. (0001668243) (Issuer)</title>
<summary type="html"> &lt;b&gt;Filed:&lt;/b&gt; 2026-06-10 &lt;b&gt;AccNo:&lt;/b&gt; 0001437749-26-019964</summary>
<id>urn:tag:sec.gov,2008:accession-number=0001437749-26-019964</id>
</entry></feed>`;

  function withAtomFetch(svcMocks: ReturnType<typeof buildService>, atomBody: string) {
    const inner = global.fetch as jest.Mock;
    global.fetch = jest.fn(async (url: any) => {
      const u = String(url);
      if (u.includes('action=getcurrent')) {
        return { ok: true, status: 200, text: async () => atomBody } as any;
      }
      return inner(url);
    }) as any;
    return svcMocks;
  }

  it('poll end-to-end: atom → kandydat → rejestracja (entries/fresh/registered w wyniku)', async () => {
    const built = withAtomFetch(buildService({ sic: '2834', ticker: 'TSTX' }), ATOM_OK);

    const result = await built.svc.runDiscoveryCycle();

    expect(result).toMatchObject({ collector: 'FORM4_DISCOVERY', entries: 1, fresh: 1, registered: 1 });
    expect(built.mocks.tickerRepo.save).toHaveBeenCalled();
  });

  it('poll: atom bez wpisów Issuer → action=PARSER_EMPTY (wzorzec TASK-06)', async () => {
    const built = withAtomFetch(buildService({}), '<html>EDGAR maintenance</html>');

    const result = await built.svc.runDiscoveryCycle();

    expect(result.action).toBe('PARSER_EMPTY');
    expect(result.registered).toBe(0);
  });

  it('poll: accession już seen → fresh=0, zero przetwarzania', async () => {
    const built = withAtomFetch(buildService({ sic: '2834', ticker: 'TSTX' }), ATOM_OK);
    built.mocks.redisStore.set('seen:0001437749-26-019964', '1');

    const result = await built.svc.runDiscoveryCycle();

    expect(result.fresh).toBe(0);
    expect(built.mocks.tickerRepo.save).not.toHaveBeenCalled();
  });

  it('reconciliation dual-row (P1 fix): wiersz OSOBY przed emitentem → emitent NADAL przetworzony', async () => {
    // Realny wzorzec z form.20260608.idx: alfabetycznie "Kosaraju" < "10x"? Nie —
    // tu modelujemy gorszy przypadek: osoba PIERWSZA. CIK osoby (9991651325→sub bez
    // sic/tickers) nie może markSeen-ować accession.
    const built = buildService({ sic: '2834', ticker: 'TSTX' });
    const idx = [
      '4           Kosaraju Sridhar               1651325   20260610    edgar/data/1651325/0001437749-26-019964.txt',
      '4           Test Pharma Inc.               1668243   20260610    edgar/data/1668243/0001437749-26-019964.txt',
    ].join('\n');
    const personSubmissions = JSON.stringify({ sic: '', sicDescription: null, tickers: [], exchanges: [], name: 'Kosaraju Sridhar' });
    const issuerSubmissions = JSON.stringify({ sic: '2834', sicDescription: 'Pharma', tickers: ['TSTX'], exchanges: ['Nasdaq'], name: 'Test Pharma Inc.' });
    const indexJson = JSON.stringify({ directory: { item: [{ name: 'form4.xml' }] } });
    global.fetch = jest.fn(async (url: any) => {
      const u = String(url);
      let body = '';
      if (u.includes('daily-index')) body = idx;
      else if (u.includes('CIK0001651325')) body = personSubmissions;
      else if (u.includes('CIK0001668243')) body = issuerSubmissions;
      else if (u.endsWith('/index.json')) body = indexJson;
      else if (u.endsWith('form4.xml')) body = VALID_FORM4_XML;
      else throw new Error(`unexpected ${u}`);
      return { ok: true, status: 200, text: async () => body } as any;
    }) as any;

    const result = await built.svc.runReconciliation();

    // Oba wiersze fresh; osoba zwraca false bez markSeen, emitent rejestruje
    expect(result.registered).toBe(1);
    expect(built.mocks.tickerRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: 'TSTX', sector: 'healthcare_discovery' }),
    );
  });

  it('reconciliation: brak daily-index (dziś i wczoraj) → NO_DAILY_INDEX bez crash', async () => {
    const built = buildService({});
    global.fetch = jest.fn(async () => ({ ok: false, status: 404, text: async () => '' })) as any;

    const result = await built.svc.runReconciliation();

    expect(result.action).toBe('NO_DAILY_INDEX');
  });
});
