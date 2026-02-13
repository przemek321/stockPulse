import { DataSource as OrmDataSource, In, Not, IsNull } from 'typeorm';
import { SentimentScore } from '../../entities/sentiment-score.entity';
import { RawMention } from '../../entities/raw-mention.entity';
import { NewsArticle } from '../../entities/news-article.entity';
import { DataSource } from '../../common/interfaces/data-source.enum';

/**
 * Backfill sentymentu — przetwarza historyczne wzmianki i artykuły FinBERT-em.
 *
 * Uruchomienie:
 *   npm run backfill:sentiment                         # z hosta (wymaga FinBERT na localhost:8000)
 *   docker exec stockpulse-app npm run backfill:sentiment  # z kontenera (FinBERT na http://finbert:8000)
 *
 * Skrypt jest idempotentny — pomija rekordy, które już mają wpis w sentiment_scores.
 */

/** Minimalna długość tekstu (zgodna z sentiment-processor.service.ts) */
const MIN_TEXT_LENGTH = 20;

/** Rozmiar batcha wysyłanego do FinBERT */
const BATCH_SIZE = 16;

/** Opóźnienie między batchami (ms) — żeby nie przeciążyć GPU */
const BATCH_DELAY_MS = 200;

/** Wynik z FinBERT sidecar */
interface FinbertResult {
  label: 'positive' | 'negative' | 'neutral';
  score: number;
  confidence: number;
  probabilities: Record<string, number>;
  processing_time_ms: number;
}

async function backfillSentiment() {
  require('dotenv').config();

  const finbertUrl =
    process.env.FINBERT_SIDECAR_URL || 'http://finbert:8000';
  const timeoutMs = parseInt(
    process.env.FINBERT_REQUEST_TIMEOUT_MS || '30000',
    10,
  );

  // ── Połączenie z bazą ──────────────────────────────────────
  const dataSource = new OrmDataSource({
    type: 'postgres',
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'stockpulse',
    username: process.env.POSTGRES_USER || 'stockpulse',
    password: process.env.POSTGRES_PASSWORD || 'stockpulse_dev_2026',
    entities: [SentimentScore, RawMention, NewsArticle],
    synchronize: false,
  });

  await dataSource.initialize();
  console.log('✓ Połączono z PostgreSQL');

  // ── Sprawdź czy FinBERT jest dostępny ──────────────────────
  try {
    const healthRes = await fetch(`${finbertUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    const health = await healthRes.json();
    if (!health.model_loaded) {
      console.error('✗ FinBERT model nie jest załadowany');
      process.exit(1);
    }
    console.log(
      `✓ FinBERT dostępny (${health.device}, model: ${health.model_name})`,
    );
  } catch (err) {
    console.error(`✗ Nie można połączyć z FinBERT (${finbertUrl}):`, err);
    process.exit(1);
  }

  const scoreRepo = dataSource.getRepository(SentimentScore);
  const mentionRepo = dataSource.getRepository(RawMention);
  const articleRepo = dataSource.getRepository(NewsArticle);

  // ── Znajdź externalId, które już mają sentyment ───────────
  const existingScores = await scoreRepo.find({
    select: ['externalId'],
    where: { model: 'finbert' },
  });
  const existingIds = new Set(existingScores.map((s) => s.externalId));
  console.log(`  Istniejące wyniki sentymentu: ${existingIds.size}`);

  // ── Przygotuj wzmianki do backfill ─────────────────────────
  const allMentions = await mentionRepo.find();
  const mentionsToProcess = allMentions.filter((m) => {
    if (existingIds.has(m.externalId)) return false;
    const text = [m.title, m.body].filter(Boolean).join('. ').trim();
    return text.length >= MIN_TEXT_LENGTH;
  });

  console.log(
    `\n── Wzmianki ──────────────────────────────`,
  );
  console.log(`  Wszystkie:     ${allMentions.length}`);
  console.log(`  Do przetworzenia: ${mentionsToProcess.length}`);
  console.log(
    `  Pominięte (za krótkie / już przetworzone): ${allMentions.length - mentionsToProcess.length}`,
  );

  // ── Przygotuj artykuły do backfill ─────────────────────────
  const allArticles = await articleRepo.find();
  const articlesToProcess = allArticles.filter((a) => {
    if (existingIds.has(a.url)) return false;
    const text = [a.headline, a.summary].filter(Boolean).join('. ').trim();
    return text.length >= MIN_TEXT_LENGTH;
  });

  console.log(
    `\n── Artykuły ──────────────────────────────`,
  );
  console.log(`  Wszystkie:     ${allArticles.length}`);
  console.log(`  Do przetworzenia: ${articlesToProcess.length}`);
  console.log(
    `  Pominięte (za krótkie / już przetworzone): ${allArticles.length - articlesToProcess.length}`,
  );

  const totalItems = mentionsToProcess.length + articlesToProcess.length;
  if (totalItems === 0) {
    console.log('\n✓ Brak danych do backfill — wszystko już przetworzone');
    await dataSource.destroy();
    return;
  }

  console.log(`\n── Start backfill: ${totalItems} rekordów ──`);

  let processed = 0;
  let errors = 0;
  const startTime = Date.now();

  // ── Helper: batch analyze + save ───────────────────────────
  async function processBatch(
    items: Array<{
      text: string;
      symbol: string;
      source: DataSource;
      externalId: string;
      entityType: 'mention' | 'article';
      entityId: number;
    }>,
  ) {
    const texts = items.map((i) => i.text.substring(0, 500));

    let results: FinbertResult[];
    try {
      const response = await fetch(`${finbertUrl}/api/sentiment/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      results = data.results;
    } catch (err) {
      console.error(`  ✗ Batch error: ${err}`);
      errors += items.length;
      return;
    }

    // Zapisz wyniki do bazy
    const scores: Partial<SentimentScore>[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const result = results[i];
      if (!result) continue;

      scores.push({
        symbol: item.symbol,
        score: result.score,
        confidence: result.confidence,
        source: item.source,
        model: 'finbert',
        rawText: item.text.substring(0, 500),
        externalId: item.externalId,
      });

      // Aktualizuj sentimentScore w artykule
      if (item.entityType === 'article') {
        await articleRepo.update(item.entityId, {
          sentimentScore: result.score,
        });
      }
    }

    if (scores.length > 0) {
      await scoreRepo.save(scores as SentimentScore[]);
    }

    processed += scores.length;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const pct = ((processed / totalItems) * 100).toFixed(1);
    console.log(
      `  [${elapsed}s] ${processed}/${totalItems} (${pct}%) — batch ${scores.length} rekordów`,
    );
  }

  // ── Przetwórz wzmianki ─────────────────────────────────────
  console.log('\n── Przetwarzanie wzmianek... ──');

  let batch: Array<{
    text: string;
    symbol: string;
    source: DataSource;
    externalId: string;
    entityType: 'mention' | 'article';
    entityId: number;
  }> = [];

  for (const mention of mentionsToProcess) {
    const text = [mention.title, mention.body]
      .filter(Boolean)
      .join('. ')
      .trim();
    const symbol =
      mention.detectedTickers?.[0] || 'UNKNOWN';

    batch.push({
      text,
      symbol,
      source: mention.source,
      externalId: mention.externalId,
      entityType: 'mention',
      entityId: mention.id,
    });

    if (batch.length >= BATCH_SIZE) {
      await processBatch(batch);
      batch = [];
      await sleep(BATCH_DELAY_MS);
    }
  }
  if (batch.length > 0) {
    await processBatch(batch);
    batch = [];
  }

  // ── Przetwórz artykuły ─────────────────────────────────────
  console.log('\n── Przetwarzanie artykułów... ──');

  for (const article of articlesToProcess) {
    const text = [article.headline, article.summary]
      .filter(Boolean)
      .join('. ')
      .trim();

    batch.push({
      text,
      symbol: article.symbol,
      source: DataSource.FINNHUB,
      externalId: article.url,
      entityType: 'article',
      entityId: article.id,
    });

    if (batch.length >= BATCH_SIZE) {
      await processBatch(batch);
      batch = [];
      await sleep(BATCH_DELAY_MS);
    }
  }
  if (batch.length > 0) {
    await processBatch(batch);
  }

  // ── Podsumowanie ───────────────────────────────────────────
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalScores = await scoreRepo.count();

  console.log(`\n─── Backfill zakończony ───`);
  console.log(`  Przetworzono:    ${processed}`);
  console.log(`  Błędy:           ${errors}`);
  console.log(`  Czas:            ${totalTime}s`);
  console.log(`  Łącznie wyników sentymentu w bazie: ${totalScores}`);

  await dataSource.destroy();
  console.log('✓ Rozłączono z PostgreSQL');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

backfillSentiment().catch((err) => {
  console.error('Backfill nie powiódł się:', err);
  process.exit(1);
});
