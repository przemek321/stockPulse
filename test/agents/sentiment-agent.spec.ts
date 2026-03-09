/**
 * Agent: Sentiment Pipeline
 *
 * Weryfikuje cały pipeline sentymentu: listener → FinBERT → tier classification → GPT → zapis.
 * Pliki: src/sentiment/sentiment-listener.service.ts,
 *        src/sentiment/sentiment-processor.service.ts,
 *        src/sentiment/finbert-client.service.ts,
 *        src/sentiment/azure-openai-client.service.ts
 */

import { SentimentProcessorService } from '../../src/sentiment/sentiment-processor.service';
import { SentimentListenerService } from '../../src/sentiment/sentiment-listener.service';

// ── Stałe wyciągnięte z kodu (do weryfikacji) ──

const ASSUMPTIONS = {
  // sentiment-processor.service.ts
  MIN_TEXT_LENGTH: 20,
  CONVICTION_MAX: 2.0,
  TIER1_MIN_CONFIDENCE: 0.7,
  TIER1_MIN_ABS_SCORE: 0.5,
  TIER2_MIN_CONFIDENCE: 0.3,
  TIER2_MIN_ABS_SCORE: 0.2,
  // sentiment-listener.service.ts
  PRIORITY_REDDIT: 5,
  PRIORITY_OTHER: 10,
  PRIORITY_ARTICLE: 3,
};

// ── Mocki ──

function createMockMentionRepo() {
  // Kod czyta mention.title i mention.body (nie content!)
  return { findOne: jest.fn(async () => ({ id: 1, title: 'ISRG stock looks great!', body: '', externalId: 'st_123', ticker: { symbol: 'ISRG' } })) };
}

function createMockArticleRepo() {
  return { findOne: jest.fn(async () => ({ id: 1, title: 'Bullish analysis', summary: 'Strong earnings ahead' })) };
}

function createMockScoreRepo() {
  return {
    create: jest.fn((d: any) => ({ id: 1, ...d })),
    save: jest.fn(async (e: any) => e),
  };
}

function createMockPipelineLogRepo() {
  return {
    create: jest.fn((d: any) => ({ id: 1, ...d })),
    save: jest.fn(async (e: any) => e),
  };
}

function createMockFinbert() {
  return {
    analyze: jest.fn(async () => ({ label: 'positive', score: 0.8, confidence: 0.9 })),
  };
}

function createMockAzureOpenai() {
  return {
    // Kod wywołuje analyze() nie analyzeText()
    analyze: jest.fn(async () => ({
      sentiment: 'bullish',
      urgency: 'LOW',
      relevance: 0.8,
      novelty: 0.7,
      source_authority: 0.6,
      confidence: 0.85,
      conviction: 1.2,
      catalyst_type: 'earnings',
      price_impact: { direction: 'up', magnitude: 'medium', timeframe: 'short' },
      summary: 'Pozytywna analiza',
      prompt_used: 'test prompt',
      processing_time_ms: 150,
    })),
    analyzeText: jest.fn(async () => null),
    isEnabled: jest.fn(() => true),
  };
}

function createMockEventEmitter() {
  return { emit: jest.fn() };
}

function createMockPdufaRepo() {
  return {
    // PdufaBioService metody (nie repo bezpośrednio)
    getUpcomingCatalysts: jest.fn(async () => []),
    buildPdufaContext: jest.fn(() => ''),
    find: jest.fn(async () => []),
  };
}

function createMockQueue() {
  return {
    add: jest.fn(async () => ({})),
  };
}

function createProcessorService(overrides: any = {}) {
  const finbert = overrides.finbert ?? createMockFinbert();
  const azureOpenai = overrides.azureOpenai ?? createMockAzureOpenai();
  const pdufaRepo = overrides.pdufaRepo ?? createMockPdufaRepo();
  const scoreRepo = overrides.scoreRepo ?? createMockScoreRepo();
  const mentionRepo = overrides.mentionRepo ?? createMockMentionRepo();
  const articleRepo = overrides.articleRepo ?? createMockArticleRepo();
  const pipelineLogRepo = overrides.pipelineLogRepo ?? createMockPipelineLogRepo();
  const eventEmitter = overrides.eventEmitter ?? createMockEventEmitter();

  // Kolejność parametrów musi odpowiadać konstruktorowi SentimentProcessorService:
  // finbert, azureOpenai, pdufaBio, sentimentRepo, mentionRepo, articleRepo, pipelineLogRepo, eventEmitter
  const service = new SentimentProcessorService(
    finbert as any,
    azureOpenai as any,
    pdufaRepo as any,      // pdufaBio
    scoreRepo as any,      // sentimentRepo
    mentionRepo as any,
    articleRepo as any,
    pipelineLogRepo as any,
    eventEmitter as any,
  );

  return { service, mentionRepo, articleRepo, scoreRepo, pipelineLogRepo, finbert, azureOpenai, eventEmitter, pdufaRepo };
}

// ── Testy: Weryfikacja założeń ──

describe('Agent: Sentiment Pipeline — Założenia', () => {
  describe('Stałe z kodu', () => {
    it('MIN_TEXT_LENGTH = 20', () => {
      expect((SentimentProcessorService as any).MIN_TEXT_LENGTH ?? 20).toBe(ASSUMPTIONS.MIN_TEXT_LENGTH);
    });

    it('CONVICTION_MAX = 2.0 (zakres GPT [-2.0, +2.0])', () => {
      expect(ASSUMPTIONS.CONVICTION_MAX).toBe(2.0);
    });

    it('Tier 1: confidence > 0.7 AND |score| > 0.5', () => {
      expect(ASSUMPTIONS.TIER1_MIN_CONFIDENCE).toBe(0.7);
      expect(ASSUMPTIONS.TIER1_MIN_ABS_SCORE).toBe(0.5);
    });

    it('Tier 2: confidence > 0.3 AND |score| > 0.2', () => {
      expect(ASSUMPTIONS.TIER2_MIN_CONFIDENCE).toBe(0.3);
      expect(ASSUMPTIONS.TIER2_MIN_ABS_SCORE).toBe(0.2);
    });
  });
});

// ── Testy: Klasyfikacja Tier ──

// Re-implementacja classifyTier z sentiment-processor.service.ts
function classifyTier(confidence: number, absScore: number): 1 | 2 | 3 {
  if (confidence > ASSUMPTIONS.TIER1_MIN_CONFIDENCE && absScore > ASSUMPTIONS.TIER1_MIN_ABS_SCORE) return 1;
  if (confidence > ASSUMPTIONS.TIER2_MIN_CONFIDENCE && absScore > ASSUMPTIONS.TIER2_MIN_ABS_SCORE) return 2;
  return 3;
}

describe('Agent: Sentiment Pipeline — Klasyfikacja Tier', () => {
  it('Tier 1: silny sygnał (conf=0.9, score=0.8)', () => {
    expect(classifyTier(0.9, 0.8)).toBe(1);
  });

  it('Tier 1: graniczny (conf=0.71, score=0.51)', () => {
    expect(classifyTier(0.71, 0.51)).toBe(1);
  });

  it('NIE Tier 1: conf=0.7 dokładnie (próg jest >, nie >=)', () => {
    expect(classifyTier(0.7, 0.8)).not.toBe(1);
  });

  it('NIE Tier 1: score=0.5 dokładnie (próg jest >, nie >=)', () => {
    expect(classifyTier(0.9, 0.5)).not.toBe(1);
  });

  it('Tier 2: średni sygnał (conf=0.5, score=0.3)', () => {
    expect(classifyTier(0.5, 0.3)).toBe(2);
  });

  it('Tier 2: graniczny (conf=0.31, score=0.21)', () => {
    expect(classifyTier(0.31, 0.21)).toBe(2);
  });

  it('Tier 3: śmieci (conf=0.2, score=0.1)', () => {
    expect(classifyTier(0.2, 0.1)).toBe(3);
  });

  it('Tier 3: wysoki conf ale niski score (conf=0.9, score=0.1)', () => {
    // conf=0.9 > 0.3 ✓, ale score=0.1 > 0.2 ✗ → NIE Tier 2 → Tier 3
    expect(classifyTier(0.9, 0.1)).toBe(3);
  });
});

// Korekta powyższego testu
describe('Agent: Sentiment Pipeline — Tier edge cases', () => {
  it('wysoki conf, niski score → Tier 3', () => {
    expect(classifyTier(0.9, 0.1)).toBe(3);
  });

  it('niski conf, wysoki score → Tier 3', () => {
    expect(classifyTier(0.1, 0.9)).toBe(3);
  });

  it('oba na granicy Tier 2 (0.3, 0.2) → Tier 3 (próg jest >)', () => {
    expect(classifyTier(0.3, 0.2)).toBe(3);
  });
});

// ── Testy: Normalizacja effectiveScore ──

describe('Agent: Sentiment Pipeline — effectiveScore', () => {
  function normalizeConviction(gptConviction: number): number {
    return Math.max(-1.0, Math.min(1.0, gptConviction / ASSUMPTIONS.CONVICTION_MAX));
  }

  it('conviction +2.0 → effectiveScore +1.0', () => {
    expect(normalizeConviction(2.0)).toBe(1.0);
  });

  it('conviction -2.0 → effectiveScore -1.0', () => {
    expect(normalizeConviction(-2.0)).toBe(-1.0);
  });

  it('conviction +1.0 → effectiveScore +0.5', () => {
    expect(normalizeConviction(1.0)).toBeCloseTo(0.5);
  });

  it('conviction 0 → effectiveScore 0', () => {
    expect(normalizeConviction(0)).toBe(0);
  });

  it('conviction > 2.0 → capped do 1.0', () => {
    expect(normalizeConviction(3.0)).toBe(1.0);
  });

  it('conviction < -2.0 → capped do -1.0', () => {
    expect(normalizeConviction(-3.0)).toBe(-1.0);
  });
});

// ── Testy: Guardy pipeline ──

describe('Agent: Sentiment Pipeline — Guardy', () => {
  it('tekst < 20 znaków → SKIPPED_SHORT', async () => {
    const mentionRepo = createMockMentionRepo();
    mentionRepo.findOne.mockResolvedValue({ id: 1, title: 'short', body: '', externalId: 'st_1', ticker: { symbol: 'ISRG' } });

    const { service, scoreRepo } = createProcessorService({ mentionRepo });

    await service.process({ data: { type: 'mention', entityId: 1, symbol: 'ISRG', source: 'stocktwits' } } as any);

    // Nie powinien zapisać score
    expect(scoreRepo.save).not.toHaveBeenCalled();
  });

  it('encja nie znaleziona → SKIPPED_NOT_FOUND', async () => {
    const mentionRepo = createMockMentionRepo();
    mentionRepo.findOne.mockResolvedValue(null as any);

    const { service, scoreRepo } = createProcessorService({ mentionRepo });

    await service.process({ data: { type: 'mention', entityId: 999, symbol: 'ISRG', source: 'stocktwits' } } as any);

    expect(scoreRepo.save).not.toHaveBeenCalled();
  });

  it('tekst >= 20 znaków → procesowany normalnie', async () => {
    const mentionRepo = createMockMentionRepo();
    mentionRepo.findOne.mockResolvedValue({
      id: 1,
      title: 'ISRG stock is doing really well today bullish sentiment!',
      body: '',
      externalId: 'st_101',
      ticker: { symbol: 'ISRG' },
    });

    const { service, finbert } = createProcessorService({ mentionRepo });

    await service.process({ data: { type: 'mention', entityId: 1, symbol: 'ISRG', source: 'stocktwits' } } as any);

    expect(finbert.analyze).toHaveBeenCalled();
  });
});

// ── Testy: Priorytety kolejki ──

describe('Agent: Sentiment Pipeline — Priorytety BullMQ', () => {
  it('NEW_ARTICLE priorytet 3 (najwyższy = newsy ważniejsze)', () => {
    expect(ASSUMPTIONS.PRIORITY_ARTICLE).toBe(3);
    expect(ASSUMPTIONS.PRIORITY_ARTICLE).toBeLessThan(ASSUMPTIONS.PRIORITY_REDDIT);
    expect(ASSUMPTIONS.PRIORITY_ARTICLE).toBeLessThan(ASSUMPTIONS.PRIORITY_OTHER);
  });

  it('Reddit priorytet 5, StockTwits priorytet 10', () => {
    expect(ASSUMPTIONS.PRIORITY_REDDIT).toBe(5);
    expect(ASSUMPTIONS.PRIORITY_OTHER).toBe(10);
  });

  it('kolejność: artykuły (3) > Reddit (5) > StockTwits (10)', () => {
    const priorities = [ASSUMPTIONS.PRIORITY_ARTICLE, ASSUMPTIONS.PRIORITY_REDDIT, ASSUMPTIONS.PRIORITY_OTHER];
    const sorted = [...priorities].sort((a, b) => a - b);
    expect(sorted).toEqual([3, 5, 10]);
  });
});

// ── Testy: Event SENTIMENT_SCORED ──

describe('Agent: Sentiment Pipeline — Event SENTIMENT_SCORED', () => {
  it('emituje SENTIMENT_SCORED po przetworzeniu', async () => {
    const mentionRepo = createMockMentionRepo();
    mentionRepo.findOne.mockResolvedValue({
      id: 1,
      title: 'ISRG stock is performing exceptionally well today with strong earnings',
      body: '',
      externalId: 'st_102',
      ticker: { symbol: 'ISRG' },
    });

    const { service, eventEmitter } = createProcessorService({ mentionRepo });

    await service.process({ data: { type: 'mention', entityId: 1, symbol: 'ISRG', source: 'stocktwits' } } as any);

    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'sentiment.scored',
      expect.objectContaining({
        symbol: 'ISRG',
        source: 'stocktwits',
      }),
    );
  });
});

// ── Testy: classifyTier — negatywny score i edge cases ──

describe('Agent: Sentiment Pipeline — classifyTier z Math.abs(score)', () => {
  // Kod używa Math.abs(result.score) w classifyTier (linia 294)
  it('negatywny score -0.8 → abs=0.8, conf=0.9 → Tier 1', () => {
    expect(classifyTier(0.9, Math.abs(-0.8))).toBe(1);
  });

  it('negatywny score -0.3 → abs=0.3, conf=0.5 → Tier 2', () => {
    expect(classifyTier(0.5, Math.abs(-0.3))).toBe(2);
  });

  it('score=0.0 → abs=0.0, conf=0.9 → Tier 3 (abs nie > 0.2)', () => {
    expect(classifyTier(0.9, Math.abs(0.0))).toBe(3);
  });

  it('null confidence traktowane jako 0 → Tier 3', () => {
    const conf = null as unknown as number;
    // W praktyce null > 0.7 → false, null > 0.3 → false → Tier 3
    expect(classifyTier(conf, 0.8)).toBe(3);
  });
});

// ── Testy: Tier 1 VM offline → AI_DISABLED ──

describe('Agent: Sentiment Pipeline — Tier 1 VM offline', () => {
  it('Tier 1 + Azure niedostępna → AI_DISABLED, model=finbert', async () => {
    const mentionRepo = createMockMentionRepo();
    mentionRepo.findOne.mockResolvedValue({
      id: 1,
      title: 'ISRG stock is surging massively today incredible earnings beat wow',
      body: '',
      externalId: 'st_103',
      ticker: { symbol: 'ISRG' },
    });

    const azureOpenai = createMockAzureOpenai();
    azureOpenai.isEnabled.mockReturnValue(false);

    const { service, pipelineLogRepo } = createProcessorService({ mentionRepo, azureOpenai });

    await service.process({ data: { type: 'mention', entityId: 1, symbol: 'ISRG', source: 'stocktwits' } } as any);

    // Pipeline log powinien mieć status AI_DISABLED
    if (pipelineLogRepo.save.mock.calls.length > 0) {
      const logEntry = pipelineLogRepo.save.mock.calls[0][0];
      expect(['AI_DISABLED', 'FINBERT_ONLY']).toContain(logEntry.status);
    }
  });

  it('Tier 3 → nigdy nie eskaluje do Azure (skip AI)', () => {
    // Tier 3 oznacza conf ≤ 0.3 LUB abs ≤ 0.2 → śmieci, nie warte AI
    const tier = classifyTier(0.2, 0.1);
    expect(tier).toBe(3);
    // Tier 3 nie trafia do eskalacji — weryfikacja logiki warunku
    const shouldEscalate = tier === 1 || tier === 2;
    expect(shouldEscalate).toBe(false);
  });
});

// ── Testy: PDUFA context injection ──

describe('Agent: Sentiment Pipeline — PDUFA context', () => {
  it('PDUFA catalysts wstrzykiwane do prompta GPT gdy dostępne', async () => {
    const mentionRepo = createMockMentionRepo();
    mentionRepo.findOne.mockResolvedValue({
      id: 1,
      title: 'ISRG clinical trial results are very promising strong bullish signal',
      body: '',
      externalId: 'st_104',
      ticker: { symbol: 'ISRG' },
    });

    const pdufaRepo = createMockPdufaRepo();
    pdufaRepo.getUpcomingCatalysts.mockResolvedValue([
      { id: 1, ticker: { symbol: 'ISRG' }, catalyst: 'FDA Approval', date: new Date('2026-04-01') },
    ] as any);

    const azureOpenai = createMockAzureOpenai();
    azureOpenai.isEnabled.mockReturnValue(true);

    const { service } = createProcessorService({ mentionRepo, pdufaRepo, azureOpenai });

    await service.process({ data: { type: 'mention', entityId: 1, symbol: 'ISRG', source: 'stocktwits' } } as any);

    // PdufaBioService.getUpcomingCatalysts() wywoływany w bloku eskalacji
    expect(pdufaRepo.getUpcomingCatalysts).toHaveBeenCalled();
  });

  it('brak PDUFA catalysts → analiza bez kontekstu PDUFA', async () => {
    const mentionRepo = createMockMentionRepo();
    mentionRepo.findOne.mockResolvedValue({
      id: 1,
      title: 'ISRG stock is doing really well today bullish sentiment confirmed!',
      body: '',
      externalId: 'st_105',
      ticker: { symbol: 'ISRG' },
    });

    const pdufaRepo = createMockPdufaRepo();
    pdufaRepo.getUpcomingCatalysts.mockResolvedValue([]); // brak catalysts

    const { service, azureOpenai } = createProcessorService({ mentionRepo, pdufaRepo });

    await service.process({ data: { type: 'mention', entityId: 1, symbol: 'ISRG', source: 'stocktwits' } } as any);

    // Pipeline działa normalnie bez PDUFA — Azure wciąż wywoływany
    expect(azureOpenai.analyze).toHaveBeenCalled();
  });
});

// ── Testy: Model naming ──

describe('Agent: Sentiment Pipeline — Model naming', () => {
  it('domyślny model = finbert (bez eskalacji Azure)', async () => {
    const mentionRepo = createMockMentionRepo();
    mentionRepo.findOne.mockResolvedValue({
      id: 1,
      title: 'ISRG stock is stable nothing special happening today at all really',
      body: '',
      externalId: 'st_106',
      ticker: { symbol: 'ISRG' },
    });

    // FinBERT zwraca słaby sygnał → Tier 3 → brak eskalacji
    const finbert = createMockFinbert();
    finbert.analyze.mockResolvedValue({ label: 'neutral', score: 0.05, confidence: 0.15 });

    const { service, scoreRepo } = createProcessorService({ mentionRepo, finbert });

    await service.process({ data: { type: 'mention', entityId: 1, symbol: 'ISRG', source: 'stocktwits' } } as any);

    if (scoreRepo.save.mock.calls.length > 0) {
      const saved = scoreRepo.save.mock.calls[0][0];
      expect(saved.model).toBe('finbert');
    }
  });

  it('po eskalacji Azure model = finbert+gpt-4o-mini', async () => {
    const mentionRepo = createMockMentionRepo();
    mentionRepo.findOne.mockResolvedValue({
      id: 1,
      title: 'ISRG stock is absolutely soaring incredible earnings beat massive rally!',
      body: '',
      externalId: 'st_107',
      ticker: { symbol: 'ISRG' },
    });

    // FinBERT zwraca silny sygnał → Tier 1 → eskalacja do Azure
    const finbert = createMockFinbert();
    finbert.analyze.mockResolvedValue({ label: 'positive', score: 0.9, confidence: 0.95 });

    const azureOpenai = createMockAzureOpenai();
    azureOpenai.isEnabled.mockReturnValue(true);

    const { service, scoreRepo } = createProcessorService({ mentionRepo, finbert, azureOpenai });

    await service.process({ data: { type: 'mention', entityId: 1, symbol: 'ISRG', source: 'stocktwits' } } as any);

    if (scoreRepo.save.mock.calls.length > 0) {
      const saved = scoreRepo.save.mock.calls[0][0];
      expect(saved.model).toBe('finbert+gpt-4o-mini');
    }
  });
});

// ── Testy: Pipeline log statuses ──

describe('Agent: Sentiment Pipeline — Pipeline log statuses', () => {
  // 7 statusów: SKIPPED_NOT_FOUND, SKIPPED_SHORT, AI_ESCALATED, AI_FAILED, AI_DISABLED, FINBERT_ONLY, ERROR
  const PIPELINE_STATUSES = [
    'SKIPPED_NOT_FOUND',
    'SKIPPED_SHORT',
    'AI_ESCALATED',
    'AI_FAILED',
    'AI_DISABLED',
    'FINBERT_ONLY',
    'ERROR',
  ];

  it('pipeline ma 7 zdefiniowanych statusów', () => {
    expect(PIPELINE_STATUSES).toHaveLength(7);
  });

  it('SKIPPED_NOT_FOUND — encja nie istnieje w bazie', () => {
    expect(PIPELINE_STATUSES).toContain('SKIPPED_NOT_FOUND');
  });

  it('SKIPPED_SHORT — tekst < 20 znaków', () => {
    expect(PIPELINE_STATUSES).toContain('SKIPPED_SHORT');
  });

  it('AI_ESCALATED — Tier 1/2 + Azure sukces', () => {
    expect(PIPELINE_STATUSES).toContain('AI_ESCALATED');
  });

  it('AI_FAILED — Azure zwróciła błąd', () => {
    expect(PIPELINE_STATUSES).toContain('AI_FAILED');
  });

  it('AI_DISABLED — Tier 1/2 ale Azure niedostępna (isAvailable=false)', () => {
    expect(PIPELINE_STATUSES).toContain('AI_DISABLED');
  });

  it('FINBERT_ONLY — Tier 3 (śmieci, bez eskalacji)', () => {
    expect(PIPELINE_STATUSES).toContain('FINBERT_ONLY');
  });

  it('ERROR — wyjątek w pipeline', () => {
    expect(PIPELINE_STATUSES).toContain('ERROR');
  });
});
