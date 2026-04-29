/**
 * S19-FIX-01: end-to-end regression guard dla HUM 29.04.2026 case.
 *
 * Trigger: 29.04.2026 10:35 — Humana 8-K Item 2.02 (earnings). GPT (Claude
 * Sonnet) zhalucynował:
 *   - conviction: -1.6
 *   - magnitude: high, confidence: 0.82
 *   - requires_immediate_attention: true
 *   - 2 z 4 key_facts: "EPS niedostępne", "brak szczegółowych danych liczbowych"
 *
 * Wynik: CRITICAL na Telegram (alert id 2381). Faktycznie HUM affirmed FY2026
 * Adjusted guidance + beat EPS $10.31 vs $9.97 konsensus. False positive na
 * halucynacji LLM, bo pipeline nie miał guardu na "GPT sam zadeklarował brak
 * danych" + skrajne conviction.
 *
 * Ten test replay'uje HUM scenario end-to-end z mockami i sprawdza że:
 *   1. Telegram NIE jest wołany
 *   2. Alert idzie do DB z nonDeliveryReason='gpt_missing_data'
 *   3. Conviction capped do |0.3|
 *   4. correlation.storeSignal NIE jest wołany (halucynacja nie zasila Redis)
 *   5. dispatcher.dispatch dostał isGptMissingData=true
 */

import * as fs from 'fs';
import * as path from 'path';
import { Form8kPipeline } from '../../src/sec-filings/pipelines/form8k.pipeline';

jest.mock('../../src/sec-filings/parsers/form8k.parser', () => ({
  detectItems: jest.fn(() => ['2.02']),
  extractItemText: jest.fn(() => 'mocked 8-K item 2.02 text'),
  selectPromptBuilder: jest.fn(() => () => 'mocked prompt'),
  isBankruptcyItem: jest.fn(() => false),
  stripHtml: jest.fn((html: string) => html),
}));

const fixture = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '../fixtures/regression/HUM-2026-04-29.json'),
    'utf8',
  ),
);

describe('Form8kPipeline integration — HUM 29.04.2026 missing-data regression (S19-FIX-01)', () => {
  function buildPipelineWithMocks() {
    const filing: any = {
      id: fixture.filing.id,
      symbol: fixture.filing.symbol,
      formType: fixture.filing.formType,
      documentUrl: fixture.filing.documentUrl,
      filingDate: new Date(fixture.filing.filingDate),
      gptAnalysis: null,
      priceImpactDirection: null,
    };

    const mocks = {
      filingRepo: {
        findOne: jest.fn().mockResolvedValue(filing),
        save: jest.fn().mockImplementation(async (f: any) => f),
      },
      tickerRepo: {
        findOne: jest.fn().mockResolvedValue({ symbol: 'HUM', name: 'Humana', observationOnly: false }),
      },
      alertRepo: {
        save: jest.fn().mockImplementation(async (a: any) => ({ id: 9999, ...a })),
        create: jest.fn((a: any) => a),
        findOne: jest.fn().mockResolvedValue(null),
      },
      ruleRepo: {
        findOne: jest.fn().mockResolvedValue({ name: '8-K Earnings Miss', isActive: true, throttleMinutes: 60 }),
      },
      azureOpenai: {
        analyzeCustomPrompt: jest.fn().mockResolvedValue(JSON.stringify(fixture.gptAnalysis)),
      },
      telegram: { sendMarkdown: jest.fn().mockResolvedValue(true) },
      formatter: { formatForm8kGptAlert: jest.fn(() => 'formatted message') },
      dailyCap: { canCallGpt: jest.fn().mockResolvedValue(true) },
      config: { get: jest.fn((_key: string, def?: string) => def ?? '') },
      correlation: { storeSignal: jest.fn(), schedulePatternCheck: jest.fn() },
      finnhub: { getQuote: jest.fn().mockResolvedValue(229.72) },
      tickerProfile: { getSignalProfile: jest.fn().mockResolvedValue(null) },
      deliveryGate: { canDeliverToTelegram: jest.fn().mockResolvedValue({ allowed: true, count: 0, limit: 5 }) },
      dispatcher: {
        dispatch: jest.fn().mockImplementation(async (params: any) => {
          if (params.isGptMissingData) {
            return {
              action: 'ALERT_DB_ONLY_GPT_MISSING_DATA',
              ticker: params.ticker,
              ruleName: params.ruleName,
              traceId: params.traceId,
              channel: 'db_only',
              delivered: false,
              suppressedBy: 'gpt_missing_data',
            };
          }
          return {
            action: 'ALERT_SENT_TELEGRAM',
            ticker: params.ticker,
            ruleName: params.ruleName,
            traceId: params.traceId,
            channel: 'telegram',
            delivered: true,
            suppressedBy: null,
          };
        }),
      },
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

    // fetchFilingText jest private + zewnętrzne fetch — spy + override
    jest
      .spyOn(pipeline as any, 'fetchFilingText')
      .mockResolvedValue('a'.repeat(500));

    return { pipeline, mocks, filing };
  }

  it('HUM zhalucynowany earnings miss → DB only z gpt_missing_data, brak Telegrama, capped conviction', async () => {
    const { pipeline, mocks, filing } = buildPipelineWithMocks();

    const result = await pipeline.onFiling({
      filingId: 1822,
      symbol: 'HUM',
      formType: '8-K',
      traceId: 'hum-missing-data-trace',
    });

    expect(result.action).toBe('ALERT_DB_ONLY_GPT_MISSING_DATA');
    expect(result.symbol).toBe('HUM');

    // Telegram NIE wołany bezpośrednio — dispatcher decyzja db_only
    expect(mocks.telegram.sendMarkdown).not.toHaveBeenCalled();

    // Dispatcher dostał isGptMissingData=true
    expect(mocks.dispatcher.dispatch).toHaveBeenCalledTimes(1);
    const dispatchCall = mocks.dispatcher.dispatch.mock.calls[0][0];
    expect(dispatchCall.isGptMissingData).toBe(true);
    expect(dispatchCall.ticker).toBe('HUM');
    expect(dispatchCall.traceId).toBe('hum-missing-data-trace');

    // Alert zapisany do DB z reason
    expect(mocks.alertRepo.save).toHaveBeenCalledTimes(1);
    const saveArg = mocks.alertRepo.create.mock.calls[0][0];
    expect(saveArg.symbol).toBe('HUM');
    expect(saveArg.delivered).toBe(false);
    expect(saveArg.nonDeliveryReason).toBe('gpt_missing_data');
    expect(saveArg.priority).toBe('MEDIUM');
    expect(saveArg.priceAtAlert).toBe(229.72);

    // Filing zapisany z capped conviction (z -1.6 do -0.3)
    expect(mocks.filingRepo.save).toHaveBeenCalledTimes(1);
    expect(filing.gptAnalysis).not.toBeNull();
    expect(filing.gptAnalysis.conviction).toBe(-0.3);
    expect(filing.priceImpactDirection).toBe('negative');

    // Correlation NIE zasilany (defensywnie — halucynacja nie idzie do Redis)
    expect(mocks.correlation.storeSignal).not.toHaveBeenCalled();
    expect(mocks.correlation.schedulePatternCheck).not.toHaveBeenCalled();
  });

  it('Sanity check: gdyby missing-data guard nie istniał, GPT z fixture HUM zwróciłby score=CRITICAL', () => {
    // Reproducer: oryginalne wartości z GPT (przed cap) score do CRITICAL
    const { scoreToAlertPriority } = require('../../src/sec-filings/scoring/price-impact.scorer');
    const priority = scoreToAlertPriority(fixture.gptAnalysis, '8-K');
    expect(priority).toBe('CRITICAL');
  });
});
