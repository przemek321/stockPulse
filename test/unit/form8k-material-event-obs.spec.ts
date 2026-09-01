import { Form8kPipeline } from '../../src/sec-filings/pipelines/form8k.pipeline';
import { AlertDispatcherService } from '../../src/alerts/alert-dispatcher.service';

/**
 * Werdykt 01.09.2026 (doc/WERDYKT-EDGE-2026-09-01.md §1.7): reguła
 * '8-K Material Event GPT' forward 1/7 hit (BEAR 0/3, BULL 1/4) → observation
 * w obu kierunkach do N>=10.
 *
 * Kontrakt:
 *   1. Bearish miękkie 8-K (Item 7.01, catalyst 'regulatory') → isMaterialEventObs
 *      + nonDeliveryReason 'material_event_obs', zero storeSignal.
 *   2. Bullish miękkie 8-K → bullish gate (P1-02) ma pierwszeństwo: reason
 *      'bullish_8k_no_edge' (ciągłość klasy dla przeglądu 07.09), flaga obs też true.
 *   3. Item 2.02 (rule '8-K Earnings Miss') → isMaterialEventObs=false (nietknięte).
 *   4. Dispatcher: priorytet bullish > material_event_obs > direction_conflict;
 *      brak pinga Telegram (ping tylko dla 'observation').
 */

function gptResponse(opts: { direction: string; conviction: number; catalyst: string }) {
  return JSON.stringify({
    price_impact: {
      direction: opts.direction,
      magnitude: 'high',
      confidence: 0.8,
      time_horizon: 'short_term',
    },
    conviction: opts.conviction,
    summary: 'Analiza 8-K',
    conclusion: 'Wniosek z konkretnymi liczbami.',
    key_facts: ['Przejęcie za $1.2B gotówką', 'Dług netto wzrośnie do $4.5B'],
    catalyst_type: opts.catalyst,
    requires_immediate_attention: false,
  });
}

function buildMocks(opts: { filingText: string; gpt: string }) {
  const filing: any = {
    id: 400,
    symbol: 'UHS',
    formType: '8-K',
    documentUrl: 'https://www.sec.gov/Archives/edgar/data/352915/000035291526000040/uhs-20260817.htm',
    filingDate: new Date('2026-08-17'),
    gptAnalysis: null,
    priceImpactDirection: null,
  };

  const mocks = {
    filingRepo: { findOne: jest.fn().mockResolvedValue(filing), save: jest.fn() },
    tickerRepo: {
      findOne: jest.fn().mockResolvedValue({
        symbol: 'UHS',
        name: 'Universal Health Services',
        observationOnly: false,
        sector: 'healthcare',
      }),
    },
    alertRepo: {
      save: jest.fn(),
      create: jest.fn((x: any) => x),
      findOne: jest.fn().mockResolvedValue(null),
    },
    // Reguła = to, o co pipeline pyta (mapToRuleName) — nie stała nazwa jak w bullish spec
    ruleRepo: {
      findOne: jest.fn(async (q: any) => ({ name: q.where.name, isActive: true, throttleMinutes: 60 })),
    },
    azureOpenai: { analyzeCustomPrompt: jest.fn().mockResolvedValue(opts.gpt) },
    telegram: { sendMarkdown: jest.fn() },
    formatter: { formatForm8kGptAlert: jest.fn().mockReturnValue('msg') },
    dailyCap: { canCallGpt: jest.fn().mockResolvedValue(true) },
    config: { get: jest.fn((_k: string, def?: string) => def ?? '') },
    correlation: { storeSignal: jest.fn(), schedulePatternCheck: jest.fn() },
    finnhub: { getQuote: jest.fn().mockResolvedValue(170.5) },
    tickerProfile: { getSignalProfile: jest.fn().mockResolvedValue(null) },
    deliveryGate: { canDeliverToTelegram: jest.fn() },
    dispatcher: {
      dispatch: jest.fn().mockImplementation(async (p: any) => {
        // Odwzorowanie priorytetu z AlertDispatcherService
        const suppressedBy = p.isConsensusGap
          ? (p.consensusGapReason ?? 'consensus_gap')
          : p.isBullish8kGate
            ? (p.bullish8kReason ?? 'bullish_8k_no_edge')
            : p.isMaterialEventObs
              ? 'material_event_obs'
              : null;
        return {
          action: suppressedBy ? `ALERT_DB_ONLY_${suppressedBy.toUpperCase()}` : 'ALERT_SENT_TELEGRAM',
          ticker: p.ticker,
          ruleName: p.ruleName,
          channel: suppressedBy ? 'db_only' : 'telegram',
          delivered: !suppressedBy,
          suppressedBy,
        };
      }),
    },
    consensusService: undefined,
  };

  const pipeline = new Form8kPipeline(
    mocks.filingRepo as any,
    mocks.tickerRepo as any,
    mocks.alertRepo as any,
    mocks.ruleRepo as any,
    mocks.azureOpenai as any,
    mocks.telegram as any,
    mocks.formatter as any,
    mocks.dailyCap as any,
    mocks.config as any,
    mocks.correlation as any,
    mocks.finnhub as any,
    mocks.tickerProfile as any,
    mocks.deliveryGate as any,
    mocks.dispatcher as any,
    mocks.consensusService as any,
  );

  jest.spyOn(pipeline as any, 'fetchFilingText').mockResolvedValue(opts.filingText);
  jest.spyOn(pipeline as any, 'fetchExhibit991').mockResolvedValue(null);

  return { pipeline, mocks };
}

const ITEM_701_TEXT =
  'Item 7.01 Regulation FD Disclosure. Universal Health Services announced the acquisition of Talkspace. ' +
  'Lorem ipsum '.repeat(30);
const ITEM_202_TEXT =
  'Item 2.02 Results of Operations and Financial Condition. Company reported quarterly results. ' +
  'Lorem ipsum '.repeat(30);

describe('Form8k material-event obs — integracja onFiling (werdykt 01.09.2026)', () => {
  const payload = { filingId: 400, symbol: 'UHS', formType: '8-K' } as any;

  it('UHS replay: bearish Item 7.01 (M&A) → material_event_obs, DB only, zero storeSignal', async () => {
    const { pipeline, mocks } = buildMocks({
      filingText: ITEM_701_TEXT,
      gpt: gptResponse({ direction: 'negative', conviction: -1.0, catalyst: 'ma' }),
    });

    await pipeline.onFiling(payload);

    expect(mocks.dispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        ruleName: '8-K Material Event GPT',
        isMaterialEventObs: true,
        isBullish8kGate: false,
      }),
    );
    expect(mocks.alertRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ delivered: false, nonDeliveryReason: 'material_event_obs' }),
    );
    expect(mocks.correlation.storeSignal).not.toHaveBeenCalled();
    expect(mocks.telegram.sendMarkdown).not.toHaveBeenCalled();
  });

  it('bullish Item 7.01 → bullish gate ma pierwszeństwo (bullish_8k_no_edge), flaga obs też ustawiona', async () => {
    const { pipeline, mocks } = buildMocks({
      filingText: ITEM_701_TEXT,
      gpt: gptResponse({ direction: 'positive', conviction: 1.2, catalyst: 'regulatory' }),
    });

    await pipeline.onFiling(payload);

    expect(mocks.dispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ isBullish8kGate: true, isMaterialEventObs: true }),
    );
    expect(mocks.alertRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ delivered: false, nonDeliveryReason: 'bullish_8k_no_edge' }),
    );
  });

  it('Item 2.02 (rule 8-K Earnings Miss) → isMaterialEventObs=false — nietknięte', async () => {
    const { pipeline, mocks } = buildMocks({
      filingText: ITEM_202_TEXT,
      gpt: gptResponse({ direction: 'negative', conviction: -1.0, catalyst: 'earnings' }),
    });

    await pipeline.onFiling(payload);

    expect(mocks.dispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ ruleName: '8-K Earnings Miss', isMaterialEventObs: false }),
    );
  });
});

describe('AlertDispatcherService — material_event_obs w priorytecie suppression', () => {
  class FakeTelegram {
    sent: string[] = [];
    async sendMarkdown(m: string) { this.sent.push(m); return true; }
  }
  class FakeGate {
    async canDeliverToTelegram() { return { allowed: true, count: 0, limit: 5 }; }
  }
  const base = { ticker: 'UHS', ruleName: '8-K Material Event GPT', message: 'msg' };

  it('samodzielnie → material_event_obs, db_only, brak pinga Telegram', async () => {
    const tg = new FakeTelegram();
    const d = new AlertDispatcherService(tg as any, new FakeGate() as any);
    const r = await d.dispatch({ ...base, isMaterialEventObs: true });
    expect(r.suppressedBy).toBe('material_event_obs');
    expect(r.action).toBe('ALERT_DB_ONLY_MATERIAL_EVENT_OBS');
    expect(r.delivered).toBe(false);
    expect(tg.sent).toHaveLength(0);
  });

  it('bullish gate wygrywa nad material_event_obs; material_event_obs wygrywa nad direction_conflict', async () => {
    const d = new AlertDispatcherService(new FakeTelegram() as any, new FakeGate() as any);
    const a = await d.dispatch({ ...base, isBullish8kGate: true, isMaterialEventObs: true });
    expect(a.suppressedBy).toBe('bullish_8k_no_edge');
    const b = await d.dispatch({ ...base, isMaterialEventObs: true, isDirectionConflict: true });
    expect(b.suppressedBy).toBe('material_event_obs');
  });
});
