import { Controller, Get, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { StocktwitsService } from '../../collectors/stocktwits/stocktwits.service';
import { FinnhubService } from '../../collectors/finnhub/finnhub.service';
import { SecEdgarService } from '../../collectors/sec-edgar/sec-edgar.service';
import { RedditService } from '../../collectors/reddit/reddit.service';
import { PdufaBioService } from '../../collectors/pdufa-bio/pdufa-bio.service';
import { TelegramService } from '../../alerts/telegram/telegram.service';
import {
  Ticker,
  RawMention,
  NewsArticle,
  SecFiling,
  InsiderTrade,
  SentimentScore,
  Alert,
  AlertRule,
  CollectionLog,
  PdufaCatalyst,
} from '../../entities';

/** Interwały kolektorów w minutach — musi odpowiadać schedulerom BullMQ */
const COLLECTOR_INTERVALS: Record<string, number> = {
  STOCKTWITS: 5,
  FINNHUB: 10,
  SEC_EDGAR: 30,
  REDDIT: 10,
  PDUFA_BIO: 360, // 6 godzin
};

/**
 * GET /api/health      — status zdrowia systemu i kolektorów.
 * GET /api/health/stats — totale per tabela + interwały + countdown.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly stocktwits: StocktwitsService,
    private readonly finnhub: FinnhubService,
    private readonly secEdgar: SecEdgarService,
    private readonly reddit: RedditService,
    private readonly pdufaBio: PdufaBioService,
    private readonly telegram: TelegramService,
    @InjectRepository(Ticker) private readonly tickerRepo: Repository<Ticker>,
    @InjectRepository(RawMention) private readonly mentionRepo: Repository<RawMention>,
    @InjectRepository(NewsArticle) private readonly newsRepo: Repository<NewsArticle>,
    @InjectRepository(SecFiling) private readonly filingRepo: Repository<SecFiling>,
    @InjectRepository(InsiderTrade) private readonly tradeRepo: Repository<InsiderTrade>,
    @InjectRepository(SentimentScore) private readonly scoreRepo: Repository<SentimentScore>,
    @InjectRepository(Alert) private readonly alertRepo: Repository<Alert>,
    @InjectRepository(AlertRule) private readonly ruleRepo: Repository<AlertRule>,
    @InjectRepository(CollectionLog) private readonly logRepo: Repository<CollectionLog>,
    @InjectRepository(PdufaCatalyst) private readonly pdufaRepo: Repository<PdufaCatalyst>,
    private readonly dataSource: DataSource,
  ) {}

  @Get()
  async getHealth() {
    const [stHealth, fhHealth, secHealth, rdHealth, pdufaHealth] = await Promise.all([
      this.stocktwits.getHealthStatus(),
      this.finnhub.getHealthStatus(),
      this.secEdgar.getHealthStatus(),
      this.reddit.getHealthStatus(),
      this.pdufaBio.getHealthStatus(),
    ]);

    const collectors = [stHealth, fhHealth, secHealth, rdHealth, pdufaHealth];
    const allHealthy = collectors.every((c) => c.isHealthy);

    return {
      status: allHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      telegram: {
        configured: this.telegram.isConfigured(),
      },
      collectors,
    };
  }

  /**
   * Szczegółowe statystyki: totale per tabela, interwały kolektorów,
   * czas do następnego pobrania, wielkość bazy.
   */
  @Get('stats')
  async getStats() {
    const now = new Date();

    // Totale per tabela (równoległe zapytania)
    const [
      tickers, mentions, news, filings, trades, scores, alerts, rules, logs, pdufaEvents,
    ] = await Promise.all([
      this.tickerRepo.count(),
      this.mentionRepo.count(),
      this.newsRepo.count(),
      this.filingRepo.count(),
      this.tradeRepo.count(),
      this.scoreRepo.count(),
      this.alertRepo.count(),
      this.ruleRepo.count(),
      this.logRepo.count(),
      this.pdufaRepo.count(),
    ]);

    // Ostatnie logi kolektorów + obliczenie countdown
    const collectorStats = await Promise.all(
      Object.entries(COLLECTOR_INTERVALS).map(async ([source, intervalMin]) => {
        const lastLog = await this.logRepo.findOne({
          where: { collector: source as any },
          order: { startedAt: 'DESC' },
        });

        let nextRunAt: string | null = null;
        let secondsUntilNext: number | null = null;

        if (lastLog?.startedAt) {
          const nextRun = new Date(
            lastLog.startedAt.getTime() + intervalMin * 60 * 1000,
          );
          nextRunAt = nextRun.toISOString();
          secondsUntilNext = Math.max(
            0,
            Math.round((nextRun.getTime() - now.getTime()) / 1000),
          );
        }

        return {
          source,
          intervalMinutes: intervalMin,
          lastRunAt: lastLog?.startedAt?.toISOString() || null,
          lastStatus: lastLog?.status || null,
          lastItemsCollected: lastLog?.itemsCollected ?? 0,
          lastDurationMs: lastLog?.durationMs ?? 0,
          nextRunAt,
          secondsUntilNext,
        };
      }),
    );

    // Wielkość bazy
    const dbSize = await this.tickerRepo.query(
      `SELECT pg_size_pretty(pg_database_size(current_database())) as size`,
    );

    return {
      timestamp: now.toISOString(),
      database: {
        size: dbSize[0]?.size || 'unknown',
        tables: [
          { name: 'tickers', count: tickers },
          { name: 'raw_mentions', count: mentions },
          { name: 'news_articles', count: news },
          { name: 'sec_filings', count: filings },
          { name: 'insider_trades', count: trades },
          { name: 'sentiment_scores', count: scores },
          { name: 'alerts', count: alerts },
          { name: 'alert_rules', count: rules },
          { name: 'collection_logs', count: logs },
          { name: 'pdufa_catalysts', count: pdufaEvents },
        ],
      },
      collectors: collectorStats,
    };
  }

  /**
   * Raport tygodniowy — 6 zapytań SQL z doc/stockpulse-weekly-review-queries.md.
   * Parametr ?days=7 (domyślnie 7) kontroluje zakres czasowy.
   */
  @Get('weekly-report')
  async getWeeklyReport(@Query('days') daysParam?: string) {
    const days = parseInt(daysParam || '7', 10) || 7;
    const interval = `${days} days`;

    const [
      pipelineStats,
      sourceDistribution,
      topConvictions,
      pdufaImpact,
      alertsSent,
      pdufaStatus,
    ] = await Promise.all([
      // 1. Statystyki pipeline (status × tier)
      this.dataSource.query(`
        SELECT
          status, tier, COUNT(*) as count,
          ROUND(AVG(finbert_duration_ms)) as avg_finbert_ms,
          ROUND(AVG(azure_duration_ms)) as avg_azure_ms
        FROM ai_pipeline_logs
        WHERE created_at > NOW() - INTERVAL '${interval}'
        GROUP BY status, tier
        ORDER BY count DESC
      `),

      // 2. Rozkład źródeł danych
      this.dataSource.query(`
        SELECT source, COUNT(*) as count
        FROM ai_pipeline_logs
        WHERE created_at > NOW() - INTERVAL '${interval}'
        GROUP BY source
        ORDER BY count DESC
      `),

      // 3. Top 20 conviction scores
      this.dataSource.query(`
        SELECT
          symbol, score, confidence, model,
          "enrichedAnalysis"->>'conviction' as conviction,
          "enrichedAnalysis"->>'catalyst_type' as catalyst,
          "enrichedAnalysis"->>'relevance' as relevance,
          "enrichedAnalysis"->>'sentiment' as ai_sentiment,
          "enrichedAnalysis"->>'summary' as summary,
          "rawText",
          timestamp
        FROM sentiment_scores
        WHERE "enrichedAnalysis" IS NOT NULL
          AND timestamp > NOW() - INTERVAL '${interval}'
        ORDER BY ABS(("enrichedAnalysis"->>'conviction')::numeric) DESC
        LIMIT 20
      `),

      // 4. PDUFA context impact
      this.dataSource.query(`
        SELECT
          symbol,
          pdufa_context IS NOT NULL as had_pdufa,
          ROUND(AVG(ABS((response_payload->>'relevance')::numeric)), 3) as avg_relevance,
          ROUND(AVG(ABS((response_payload->>'conviction')::numeric)), 3) as avg_conviction,
          COUNT(*) as count
        FROM ai_pipeline_logs
        WHERE status = 'AI_ESCALATED'
          AND created_at > NOW() - INTERVAL '${interval}'
        GROUP BY symbol, had_pdufa
        ORDER BY symbol, had_pdufa
      `),

      // 5. Alerty wysłane na Telegram
      this.dataSource.query(`
        SELECT
          "ruleName" as rule_name, symbol, priority, "catalystType" as catalyst_type,
          message, "sentAt" as sent_at
        FROM alerts
        WHERE "sentAt" > NOW() - INTERVAL '${interval}'
        ORDER BY "sentAt" DESC
      `),

      // 6. Status scrapera PDUFA
      this.dataSource.query(`
        SELECT COUNT(*) as total_events,
          COUNT(*) FILTER (WHERE outcome IS NOT NULL) as resolved,
          COUNT(*) FILTER (WHERE outcome IS NULL AND pdufa_date > NOW()) as upcoming
        FROM pdufa_catalysts
      `),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      periodDays: days,
      sections: {
        pipelineStats,
        sourceDistribution,
        topConvictions,
        pdufaImpact,
        alertsSent,
        pdufaStatus: pdufaStatus[0] || {},
      },
    };
  }
}
