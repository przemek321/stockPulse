/**
 * S19-FIX-03: integration test — Form4Pipeline + Form8kPipeline observation
 * gate skip PRZED GPT call.
 *
 * Trigger: Sprint 17 dodał 14 semi tickers w observation mode (AMAT/ASML/MU/etc.)
 * Wszystkie 5 promptów SEC (form4 + 4× form8k) ma hardcoded "SECTOR: Healthcare"
 * + healthcare-specific instructions ("MLR above 90% for managed care = severe
 * bearish"). Dla semi tickers prompt podaje GPT błędną semantykę sektora,
 * conviction jest niewalidowany, a `correlation.storeSignal` leciał bezwarunkowo
 * — brudne dane w Redis Sorted Set, INSIDER_PLUS_8K mógł zbudować pattern
 * na niewalidowanym signal.
 *
 * Fix: gate `ticker.observationOnly === true` PRZED GPT call w obu pipeline'ach
 * → action='SKIP_OBSERVATION_TICKER', zero side-effects (HTTP fetch w Form8k,
 * GPT call, alertRepo.save, correlation.storeSignal, dispatcher.dispatch).
 */

import { Form4Pipeline } from '../../src/sec-filings/pipelines/form4.pipeline';
import { Form8kPipeline } from '../../src/sec-filings/pipelines/form8k.pipeline';

jest.mock('../../src/sec-filings/parsers/form8k.parser', () => ({
  detectItems: jest.fn(() => ['2.02']),
  extractItemText: jest.fn(() => 'mock'),
  selectPromptBuilder: jest.fn(() => () => 'mock prompt'),
  isBankruptcyItem: jest.fn(() => false),
  stripHtml: jest.fn((html: string) => html),
}));

describe('Form8kPipeline — observation ticker skip (S19-FIX-03)', () => {
  function buildMocks(observationOnly: boolean) {
    const filing: any = {
      id: 100,
      symbol: 'AMAT',
      formType: '8-K',
      documentUrl: 'https://example.com/amat-fake',
      filingDate: new Date('2026-04-29'),
      gptAnalysis: null,
      priceImpactDirection: null,
    };

    const mocks = {
      filingRepo: {
        findOne: jest.fn().mockResolvedValue(filing),
        save: jest.fn(),
      },
      tickerRepo: {
        findOne: jest.fn().mockResolvedValue({
          symbol: 'AMAT',
          name: 'Applied Materials',
          observationOnly,
          sector: 'semi_supply_chain',
        }),
      },
      alertRepo: { save: jest.fn(), create: jest.fn(), findOne: jest.fn() },
      ruleRepo: { findOne: jest.fn() },
      azureOpenai: { analyzeCustomPrompt: jest.fn() },
      telegram: { sendMarkdown: jest.fn() },
      formatter: { formatForm8kGptAlert: jest.fn() },
      dailyCap: { canCallGpt: jest.fn() },
      config: { get: jest.fn((_k: string, def?: string) => def ?? '') },
      correlation: { storeSignal: jest.fn(), schedulePatternCheck: jest.fn() },
      finnhub: { getQuote: jest.fn() },
      tickerProfile: { getSignalProfile: jest.fn() },
      deliveryGate: { canDeliverToTelegram: jest.fn() },
      dispatcher: { dispatch: jest.fn() },
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
    );

    const fetchSpy = jest.spyOn(pipeline as any, 'fetchFilingText').mockResolvedValue('a'.repeat(500));
    return { pipeline, mocks, filing, fetchSpy };
  }

  it('observation ticker AMAT (semi) → SKIP_OBSERVATION_TICKER bez GPT/HTTP/correlation', async () => {
    const { pipeline, mocks, fetchSpy } = buildMocks(true);

    const result = await pipeline.onFiling({
      filingId: 100,
      symbol: 'AMAT',
      formType: '8-K',
      traceId: 'amat-obs-trace',
    });

    expect(result.action).toBe('SKIP_OBSERVATION_TICKER');
    expect(result.symbol).toBe('AMAT');
    expect(result.traceId).toBe('amat-obs-trace');

    // Skip jest PRZED HTTP fetch + GPT + dispatcher + correlation.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.azureOpenai.analyzeCustomPrompt).not.toHaveBeenCalled();
    expect(mocks.correlation.storeSignal).not.toHaveBeenCalled();
    expect(mocks.correlation.schedulePatternCheck).not.toHaveBeenCalled();
    expect(mocks.dispatcher.dispatch).not.toHaveBeenCalled();
    expect(mocks.alertRepo.save).not.toHaveBeenCalled();
    expect(mocks.filingRepo.save).not.toHaveBeenCalled();
    expect(mocks.dailyCap.canCallGpt).not.toHaveBeenCalled();
  });

  it('non-observation ticker (HUM healthcare) → przechodzi do GPT pipeline (sanity)', async () => {
    const { pipeline, mocks, fetchSpy } = buildMocks(false);
    mocks.dailyCap.canCallGpt.mockResolvedValue(false); // wczesny abort po skip-observation

    const result = await pipeline.onFiling({
      filingId: 100,
      symbol: 'AMAT',
      formType: '8-K',
    });

    // observationOnly=false → guard nie wyłapie, fetchFilingText powinien wywołać
    expect(result.action).not.toBe('SKIP_OBSERVATION_TICKER');
    expect(fetchSpy).toHaveBeenCalled();
  });
});

describe('Form4Pipeline — observation ticker skip (S19-FIX-03)', () => {
  function buildMocks(observationOnly: boolean) {
    const trade = {
      id: 500,
      symbol: 'MU',
      insiderName: 'John Doe',
      insiderRole: 'Chief Financial Officer',
      transactionType: 'BUY',
      shares: 10000,
      pricePerShare: 100,
      totalValue: 1_000_000,
      sharesOwnedAfter: 50000,
      is10b51Plan: false,
      transactionDate: new Date('2026-04-29'),
    };

    const mocks = {
      tradeRepo: { findOne: jest.fn().mockResolvedValue(trade), save: jest.fn(), find: jest.fn().mockResolvedValue([]) },
      filingRepo: { findOne: jest.fn(), save: jest.fn() },
      tickerRepo: {
        findOne: jest.fn().mockResolvedValue({
          symbol: 'MU',
          name: 'Micron Technology',
          observationOnly,
          sector: 'semi_supply_chain',
        }),
      },
      alertRepo: { save: jest.fn(), create: jest.fn(), findOne: jest.fn() },
      ruleRepo: { findOne: jest.fn() },
      azureOpenai: { analyzeCustomPrompt: jest.fn() },
      telegram: { sendMarkdown: jest.fn() },
      formatter: { formatInsiderTradeAlert: jest.fn() },
      dailyCap: { canCallGpt: jest.fn().mockResolvedValue(true) },
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

  it('observation ticker MU (semi) C-suite BUY → SKIP_OBSERVATION_TICKER bez GPT/correlation', async () => {
    const { pipeline, mocks } = buildMocks(true);

    const result = await pipeline.onInsiderTrade({
      tradeId: 500,
      symbol: 'MU',
      insiderName: 'John Doe',
      insiderRole: 'Chief Financial Officer',
      transactionType: 'BUY',
      totalValue: 1_000_000,
      shares: 10000,
      is10b51Plan: false,
      sharesOwnedAfter: 50000,
      source: 'sec-edgar',
      traceId: 'mu-obs-trace',
    });

    expect(result.action).toBe('SKIP_OBSERVATION_TICKER');
    expect(result.symbol).toBe('MU');

    // Krytyczne: storeSignal NIE wywołane (semi nie zanieczyszcza Redis Sorted Set)
    expect(mocks.correlation.storeSignal).not.toHaveBeenCalled();
    expect(mocks.correlation.schedulePatternCheck).not.toHaveBeenCalled();

    // Brak GPT i całego downstream (observation gate jest po dailyCap+tradeRepo,
    // ale przed GPT, prompt build, dispatcher i correlation)
    expect(mocks.azureOpenai.analyzeCustomPrompt).not.toHaveBeenCalled();
    expect(mocks.dispatcher.dispatch).not.toHaveBeenCalled();
    expect(mocks.alertRepo.save).not.toHaveBeenCalled();
    // Note: dailyCap.canCallGpt MOŻE być wywołane przed observation gate
    // (Form4Pipeline order: dailyCap @ 208, tickerRepo @ 218 — patrz pipeline ordering).
    // To OK — dailyCap to lokalna Redis check, brak side-effect na conviction/correlation.
  });

  it('non-observation ticker → przechodzi do tradeRepo + tickerRepo (sanity)', async () => {
    const { pipeline, mocks } = buildMocks(false);

    const result = await pipeline.onInsiderTrade({
      tradeId: 500,
      symbol: 'MU',
      insiderName: 'John Doe',
      insiderRole: 'Chief Financial Officer',
      transactionType: 'BUY',
      totalValue: 1_000_000,
      shares: 10000,
      is10b51Plan: false,
      sharesOwnedAfter: 50000,
      source: 'sec-edgar',
    });

    // observationOnly=false → guard nie wyłapie, pipeline wszedł głębiej
    expect(result.action).not.toBe('SKIP_OBSERVATION_TICKER');
    // tickerRepo dowodzi że gate się odpalił i nie zablokował (false branch)
    expect(mocks.tickerRepo.findOne).toHaveBeenCalledWith({ where: { symbol: 'MU' } });
  });
});
