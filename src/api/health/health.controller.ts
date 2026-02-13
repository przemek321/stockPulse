import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StocktwitsService } from '../../collectors/stocktwits/stocktwits.service';
import { FinnhubService } from '../../collectors/finnhub/finnhub.service';
import { SecEdgarService } from '../../collectors/sec-edgar/sec-edgar.service';
import { RedditService } from '../../collectors/reddit/reddit.service';
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
} from '../../entities';

/** Interwały kolektorów w minutach — musi odpowiadać schedulerom BullMQ */
const COLLECTOR_INTERVALS: Record<string, number> = {
  STOCKTWITS: 5,
  FINNHUB: 10,
  SEC_EDGAR: 30,
  REDDIT: 10,
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
  ) {}

  @Get()
  async getHealth() {
    const [stHealth, fhHealth, secHealth, rdHealth] = await Promise.all([
      this.stocktwits.getHealthStatus(),
      this.finnhub.getHealthStatus(),
      this.secEdgar.getHealthStatus(),
      this.reddit.getHealthStatus(),
    ]);

    const collectors = [stHealth, fhHealth, secHealth, rdHealth];
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
      tickers, mentions, news, filings, trades, scores, alerts, rules, logs,
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
        ],
      },
      collectors: collectorStats,
    };
  }
}
