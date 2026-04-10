import { Controller, Get, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, MoreThanOrEqual } from 'typeorm';
import { StocktwitsService } from '../../collectors/stocktwits/stocktwits.service';
import { FinnhubService } from '../../collectors/finnhub/finnhub.service';
import { SecEdgarService } from '../../collectors/sec-edgar/sec-edgar.service';
import { RedditService } from '../../collectors/reddit/reddit.service';
import { PdufaBioService } from '../../collectors/pdufa-bio/pdufa-bio.service';
import { TelegramService } from '../../alerts/telegram/telegram.service';
import { SystemStatsService } from './system-stats.service';
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
    private readonly systemStats: SystemStatsService,
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
    // Sprint 11: STOCKTWITS, FINNHUB, REDDIT są wyłączone (placeholder/no edge).
    // Health check liczy tylko aktywne kolektory.
    const disabledSources = new Set(['STOCKTWITS', 'FINNHUB', 'REDDIT']);
    const activeCollectors = collectors.filter((c) => !disabledSources.has(c.source));
    const allHealthy = activeCollectors.every((c) => c.isHealthy);

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
   * Raport tygodniowy — 9 zapytań SQL (pipeline, alerty, price outcomes, hit rate).
   * Parametr ?days=7 (domyślnie 7) kontroluje zakres czasowy.
   */
  @Get('weekly-report')
  async getWeeklyReport(@Query('days') daysParam?: string) {
    const days = Math.max(1, Math.min(parseInt(daysParam || '7', 10) || 7, 90));
    const interval = `${days} days`;

    const [
      pipelineStats,
      sourceDistribution,
      topConvictions,
      pdufaImpact,
      alertsSent,
      pdufaStatus,
      priceOutcomes,
      hitRateByRule,
      hitRateByCatalyst,
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

      // 6. Status scrapera PDUFA + lista upcoming tickerów
      this.dataSource.query(`
        SELECT COUNT(*) as total_events,
          COUNT(*) FILTER (WHERE outcome IS NOT NULL) as resolved,
          COUNT(*) FILTER (WHERE outcome IS NULL AND pdufa_date > NOW()) as upcoming,
          COALESCE(
            (SELECT json_agg(json_build_object(
              'symbol', symbol, 'drug', drug_name,
              'date', pdufa_date, 'area', therapeutic_area
            ) ORDER BY pdufa_date)
            FROM pdufa_catalysts
            WHERE outcome IS NULL AND pdufa_date > NOW()),
            '[]'::json
          ) as upcoming_events
        FROM pdufa_catalysts
      `),

      // 7. Price outcomes — alerty z wypełnionymi cenami z okresu
      this.dataSource.query(`
        SELECT
          "ruleName" as rule_name,
          symbol,
          priority,
          "catalystType" as catalyst_type,
          "alertDirection" as alert_direction,
          "priceAtAlert" as price_at_alert,
          "price1h", "price4h", "price1d", "price3d",
          CASE WHEN "priceAtAlert" > 0 AND "price1h" IS NOT NULL
            THEN ROUND((("price1h" - "priceAtAlert") / "priceAtAlert" * 100)::numeric, 2)
          END as delta_1h_pct,
          CASE WHEN "priceAtAlert" > 0 AND "price1d" IS NOT NULL
            THEN ROUND((("price1d" - "priceAtAlert") / "priceAtAlert" * 100)::numeric, 2)
          END as delta_1d_pct,
          CASE WHEN "priceAtAlert" > 0 AND "price3d" IS NOT NULL
            THEN ROUND((("price3d" - "priceAtAlert") / "priceAtAlert" * 100)::numeric, 2)
          END as delta_3d_pct,
          CASE
            WHEN "alertDirection" IS NULL THEN NULL
            WHEN "alertDirection" = 'positive' AND "price1d" > "priceAtAlert" THEN true
            WHEN "alertDirection" = 'negative' AND "price1d" < "priceAtAlert" THEN true
            WHEN "price1d" IS NULL THEN NULL
            ELSE false
          END as direction_correct_1d,
          CASE
            WHEN "alertDirection" IS NULL THEN NULL
            WHEN "alertDirection" = 'positive' AND "price3d" > "priceAtAlert" THEN true
            WHEN "alertDirection" = 'negative' AND "price3d" < "priceAtAlert" THEN true
            WHEN "price3d" IS NULL THEN NULL
            ELSE false
          END as direction_correct_3d,
          "sentAt" as sent_at
        FROM alerts
        WHERE "sentAt" > NOW() - INTERVAL '${interval}'
          AND "priceAtAlert" IS NOT NULL
        ORDER BY "sentAt" DESC
      `),

      // 8. Hit rate per rule_name (1d + 3d)
      this.dataSource.query(`
        SELECT
          "ruleName" as rule_name,
          COUNT(*) as total_alerts,
          COUNT(*) FILTER (WHERE "alertDirection" IS NOT NULL AND "price1d" IS NOT NULL) as evaluated_1d,
          COUNT(*) FILTER (
            WHERE "alertDirection" IS NOT NULL AND "price1d" IS NOT NULL
            AND (
              ("alertDirection" = 'positive' AND "price1d" > "priceAtAlert")
              OR ("alertDirection" = 'negative' AND "price1d" < "priceAtAlert")
            )
          ) as correct_1d,
          COUNT(*) FILTER (WHERE "alertDirection" IS NOT NULL AND "price3d" IS NOT NULL) as evaluated_3d,
          COUNT(*) FILTER (
            WHERE "alertDirection" IS NOT NULL AND "price3d" IS NOT NULL
            AND (
              ("alertDirection" = 'positive' AND "price3d" > "priceAtAlert")
              OR ("alertDirection" = 'negative' AND "price3d" < "priceAtAlert")
            )
          ) as correct_3d,
          CASE
            WHEN COUNT(*) FILTER (WHERE "alertDirection" IS NOT NULL AND "price1d" IS NOT NULL) > 0
            THEN ROUND(
              COUNT(*) FILTER (
                WHERE "alertDirection" IS NOT NULL AND "price1d" IS NOT NULL
                AND (
                  ("alertDirection" = 'positive' AND "price1d" > "priceAtAlert")
                  OR ("alertDirection" = 'negative' AND "price1d" < "priceAtAlert")
                )
              )::numeric
              / COUNT(*) FILTER (WHERE "alertDirection" IS NOT NULL AND "price1d" IS NOT NULL) * 100
            , 1)
          END as hit_rate_1d_pct,
          CASE
            WHEN COUNT(*) FILTER (WHERE "alertDirection" IS NOT NULL AND "price3d" IS NOT NULL) > 0
            THEN ROUND(
              COUNT(*) FILTER (
                WHERE "alertDirection" IS NOT NULL AND "price3d" IS NOT NULL
                AND (
                  ("alertDirection" = 'positive' AND "price3d" > "priceAtAlert")
                  OR ("alertDirection" = 'negative' AND "price3d" < "priceAtAlert")
                )
              )::numeric
              / COUNT(*) FILTER (WHERE "alertDirection" IS NOT NULL AND "price3d" IS NOT NULL) * 100
            , 1)
          END as hit_rate_3d_pct
        FROM alerts
        WHERE "sentAt" > NOW() - INTERVAL '${interval}'
          AND "priceAtAlert" IS NOT NULL
        GROUP BY "ruleName"
        ORDER BY total_alerts DESC
      `),

      // 9. Hit rate per catalyst_type (1d + 3d)
      this.dataSource.query(`
        SELECT
          COALESCE("catalystType", 'unknown') as catalyst_type,
          COUNT(*) as total_alerts,
          COUNT(*) FILTER (WHERE "alertDirection" IS NOT NULL AND "price1d" IS NOT NULL) as evaluated_1d,
          COUNT(*) FILTER (
            WHERE "alertDirection" IS NOT NULL AND "price1d" IS NOT NULL
            AND (
              ("alertDirection" = 'positive' AND "price1d" > "priceAtAlert")
              OR ("alertDirection" = 'negative' AND "price1d" < "priceAtAlert")
            )
          ) as correct_1d,
          COUNT(*) FILTER (WHERE "alertDirection" IS NOT NULL AND "price3d" IS NOT NULL) as evaluated_3d,
          COUNT(*) FILTER (
            WHERE "alertDirection" IS NOT NULL AND "price3d" IS NOT NULL
            AND (
              ("alertDirection" = 'positive' AND "price3d" > "priceAtAlert")
              OR ("alertDirection" = 'negative' AND "price3d" < "priceAtAlert")
            )
          ) as correct_3d,
          CASE
            WHEN COUNT(*) FILTER (WHERE "alertDirection" IS NOT NULL AND "price1d" IS NOT NULL) > 0
            THEN ROUND(
              COUNT(*) FILTER (
                WHERE "alertDirection" IS NOT NULL AND "price1d" IS NOT NULL
                AND (
                  ("alertDirection" = 'positive' AND "price1d" > "priceAtAlert")
                  OR ("alertDirection" = 'negative' AND "price1d" < "priceAtAlert")
                )
              )::numeric
              / COUNT(*) FILTER (WHERE "alertDirection" IS NOT NULL AND "price1d" IS NOT NULL) * 100
            , 1)
          END as hit_rate_1d_pct,
          CASE
            WHEN COUNT(*) FILTER (WHERE "alertDirection" IS NOT NULL AND "price3d" IS NOT NULL) > 0
            THEN ROUND(
              COUNT(*) FILTER (
                WHERE "alertDirection" IS NOT NULL AND "price3d" IS NOT NULL
                AND (
                  ("alertDirection" = 'positive' AND "price3d" > "priceAtAlert")
                  OR ("alertDirection" = 'negative' AND "price3d" < "priceAtAlert")
                )
              )::numeric
              / COUNT(*) FILTER (WHERE "alertDirection" IS NOT NULL AND "price3d" IS NOT NULL) * 100
            , 1)
          END as hit_rate_3d_pct
        FROM alerts
        WHERE "sentAt" > NOW() - INTERVAL '${interval}'
          AND "priceAtAlert" IS NOT NULL
        GROUP BY COALESCE("catalystType", 'unknown')
        ORDER BY total_alerts DESC
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
        priceOutcomes,
        hitRateByRule,
        hitRateByCatalyst,
      },
    };
  }

  /**
   * Szybki przegląd zdrowia systemu — błędy kolektorów, ostatnie awarie,
   * statystyki pipeline'u. Dla panelu "Status Systemu" na dashboardzie.
   */
  @Get('system-overview')
  async getSystemOverview() {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Ostatnie logi kolektorów (per kolektor: last 5 runs)
    // Options Flow loguje jako POLYGON w collection_logs (DataSource.POLYGON)
    const activeCollectors = ['SEC_EDGAR', 'PDUFA_BIO', 'POLYGON'];
    const disabledCollectors = ['STOCKTWITS', 'FINNHUB', 'REDDIT'];

    const collectorHealthPromises = activeCollectors.map(async (source) => {
      const logs = await this.logRepo.find({
        where: { collector: source as any },
        order: { startedAt: 'DESC' },
        take: 10,
      });

      const recentErrors = logs.filter(l => l.status === 'FAILED' || l.status === 'PARTIAL');
      const lastSuccess = logs.find(l => l.status === 'SUCCESS');
      const errorsLast24h = recentErrors.filter(l => l.startedAt >= last24h);

      return {
        source,
        status: errorsLast24h.length === 0 ? 'OK' : errorsLast24h.length >= 3 ? 'CRITICAL' : 'WARNING',
        lastRunAt: logs[0]?.startedAt?.toISOString() || null,
        lastStatus: logs[0]?.status || null,
        lastError: recentErrors[0]?.errorMessage || null,
        lastErrorAt: recentErrors[0]?.startedAt?.toISOString() || null,
        lastSuccessAt: lastSuccess?.startedAt?.toISOString() || null,
        errorsLast24h: errorsLast24h.length,
        lastDurationMs: logs[0]?.durationMs ?? null,
        lastItemsCollected: logs[0]?.itemsCollected ?? 0,
      };
    });

    // Błędy systemowe (system_logs) z ostatnich 24h
    const systemErrors = await this.dataSource.query(`
      SELECT module, class_name, function_name, error_message, duration_ms, created_at
      FROM system_logs
      WHERE status = 'error' AND created_at >= $1
      ORDER BY created_at DESC
      LIMIT 20
    `, [last24h]);

    // Statystyki alertów (7d)
    const alertStats = await this.dataSource.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE delivered = true) as delivered,
        COUNT(*) FILTER (WHERE delivered = false) as silent,
        COUNT(DISTINCT symbol) as tickers,
        COUNT(*) FILTER (WHERE "sentAt" >= $1) as last_24h
      FROM alerts
      WHERE "sentAt" >= $2
    `, [last24h, last7d]);

    // Pipeline GPT — ile wywołań / błędów w 24h
    const pipelineStats = await this.dataSource.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'AI_ESCALATED') as escalated,
        COUNT(*) FILTER (WHERE status = 'AI_FAILED') as failed,
        COUNT(*) FILTER (WHERE status = 'FINBERT_ONLY') as finbert_only
      FROM ai_pipeline_logs
      WHERE created_at >= $1
    `, [last24h]);

    // BullMQ failed jobs — via collection_logs FAILED w 7d
    const failedJobs7d = await this.logRepo.count({
      where: {
        status: 'FAILED' as any,
        startedAt: MoreThanOrEqual(last7d),
      },
    });

    const collectorHealth = await Promise.all(collectorHealthPromises);

    return {
      timestamp: now.toISOString(),
      overall: collectorHealth.every(c => c.status === 'OK') && systemErrors.length === 0
        ? 'HEALTHY'
        : collectorHealth.some(c => c.status === 'CRITICAL')
          ? 'CRITICAL'
          : 'WARNING',
      collectors: {
        active: collectorHealth,
        disabled: disabledCollectors,
      },
      systemErrors: systemErrors.map((e: any) => ({
        module: e.module,
        className: e.class_name,
        function: e.function_name,
        error: e.error_message?.substring(0, 200),
        durationMs: e.duration_ms,
        at: e.created_at,
      })),
      alerts: alertStats[0] ? {
        total7d: parseInt(alertStats[0].total),
        delivered7d: parseInt(alertStats[0].delivered),
        silent7d: parseInt(alertStats[0].silent),
        tickers7d: parseInt(alertStats[0].tickers),
        last24h: parseInt(alertStats[0].last_24h),
      } : null,
      pipeline: pipelineStats[0] ? {
        total24h: parseInt(pipelineStats[0].total),
        escalated24h: parseInt(pipelineStats[0].escalated),
        failed24h: parseInt(pipelineStats[0].failed),
        finbertOnly24h: parseInt(pipelineStats[0].finbert_only),
      } : null,
      failedJobs7d,
    };
  }

  /**
   * Statystyki systemowe hosta (temperatura, RAM, CPU, GPU).
   * Dostępne tylko na Jetson Orin NX (bind mount /proc i /sys).
   * Na dev zwraca { available: false }.
   */
  @Get('system-stats')
  async getSystemStats() {
    return this.systemStats.getStats();
  }
}
