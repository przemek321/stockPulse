import { Controller, Get, Param, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  SentimentScore,
  RawMention,
  NewsArticle,
  SecFiling,
  InsiderTrade,
  PdufaCatalyst,
  AiPipelineLog,
} from '../../entities';

/**
 * REST API sentymentu i danych zbieranych przez kolektory.
 * GET /api/sentiment/scores          — wyniki analizy sentymentu (wszystkie tickery)
 * GET /api/sentiment/news            — ostatnie newsy (wszystkie tickery)
 * GET /api/sentiment/mentions        — ostatnie wzmianki social media
 * GET /api/sentiment/filings         — ostatnie filingi SEC
 * GET /api/sentiment/insider-trades  — transakcje insiderów (Form 4)
 * GET /api/sentiment/:ticker         — dane sentymentu per ticker
 */
@Controller('sentiment')
export class SentimentController {
  constructor(
    @InjectRepository(SentimentScore)
    private readonly scoreRepo: Repository<SentimentScore>,
    @InjectRepository(RawMention)
    private readonly mentionRepo: Repository<RawMention>,
    @InjectRepository(NewsArticle)
    private readonly newsRepo: Repository<NewsArticle>,
    @InjectRepository(InsiderTrade)
    private readonly tradeRepo: Repository<InsiderTrade>,
    @InjectRepository(PdufaCatalyst)
    private readonly pdufaRepo: Repository<PdufaCatalyst>,
    @InjectRepository(AiPipelineLog)
    private readonly pipelineLogRepo: Repository<AiPipelineLog>,
  ) {}

  /** Wszystkie wyniki sentymentu (najnowsze). ?ai_only=true → tylko z analizą AI */
  @Get('scores')
  async getScores(
    @Query('limit') limit?: string,
    @Query('ai_only') aiOnly?: string,
  ) {
    const take = Math.min(parseInt(limit || '100', 10), 500);

    const qb = this.scoreRepo
      .createQueryBuilder('s')
      .orderBy('s.timestamp', 'DESC')
      .take(take);

    if (aiOnly === 'true') {
      qb.where('s.enrichedAnalysis IS NOT NULL');
    }

    const scores = await qb.getMany();
    return { count: scores.length, scores };
  }

  /** Ostatnie newsy ze wszystkich tickerów. */
  @Get('news')
  async getNews(@Query('limit') limit?: string) {
    const take = Math.min(parseInt(limit || '100', 10), 500);
    const articles = await this.newsRepo.find({
      order: { publishedAt: 'DESC' },
      take,
    });
    return { count: articles.length, articles };
  }

  /** Ostatnie wzmianki social media. */
  @Get('mentions')
  async getMentions(@Query('limit') limit?: string) {
    const take = Math.min(parseInt(limit || '100', 10), 500);
    const mentions = await this.mentionRepo.find({
      order: { publishedAt: 'DESC' },
      take,
    });
    return { count: mentions.length, mentions };
  }

  /** Ostatnie filingi SEC. */
  @Get('filings')
  async getFilings(@Query('limit') limit?: string) {
    const take = Math.min(parseInt(limit || '100', 10), 500);

    // SecFiling nie jest zarejestrowany w tym module — używamy queryBuildera
    const filings = await this.newsRepo.manager
      .getRepository('SecFiling')
      .find({
        order: { filingDate: 'DESC' },
        take,
      });
    return { count: filings.length, filings };
  }

  /** Filingi SEC z analizą GPT (gptAnalysis IS NOT NULL). */
  @Get('filings-gpt')
  async getFilingsGpt(@Query('limit') limit?: string) {
    const take = Math.min(parseInt(limit || '100', 10), 500);

    const filings = await this.newsRepo.manager
      .getRepository('SecFiling')
      .createQueryBuilder('f')
      .where('f.gptAnalysis IS NOT NULL')
      .orderBy('f.filingDate', 'DESC')
      .take(take)
      .getMany();
    return { count: filings.length, filings };
  }

  /** Nadchodzące katalizatory PDUFA (daty decyzji FDA). ?upcoming_only=true → tylko pending */
  @Get('pdufa')
  async getPdufaCatalysts(
    @Query('limit') limit?: string,
    @Query('upcoming_only') upcomingOnly?: string,
  ) {
    const take = Math.min(parseInt(limit || '100', 10), 500);

    const qb = this.pdufaRepo
      .createQueryBuilder('p')
      .orderBy('p.pdufaDate', 'ASC')
      .take(take);

    if (upcomingOnly === 'true') {
      qb.where('p.outcome IS NULL');
      qb.andWhere('p.pdufaDate >= :now', {
        now: new Date().toISOString().split('T')[0],
      });
    }

    const catalysts = await qb.getMany();
    return { count: catalysts.length, catalysts };
  }

  /** Logi pipeline AI — pełna historia egzekucji analizy sentymentu. */
  @Get('pipeline-logs')
  async getPipelineLogs(
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('symbol') symbol?: string,
  ) {
    const take = Math.min(parseInt(limit || '100', 10), 500);

    const qb = this.pipelineLogRepo
      .createQueryBuilder('log')
      .orderBy('log.created_at', 'DESC')
      .take(take);

    if (status) {
      qb.andWhere('log.status = :status', { status });
    }
    if (symbol) {
      qb.andWhere('log.symbol = :symbol', { symbol: symbol.toUpperCase() });
    }

    const logs = await qb.getMany();
    return { count: logs.length, logs };
  }

  /** Transakcje insiderów z Form 4 (SEC EDGAR). */
  @Get('insider-trades')
  async getInsiderTrades(@Query('limit') limit?: string) {
    const take = Math.min(parseInt(limit || '100', 10), 500);
    const trades = await this.tradeRepo.find({
      order: { transactionDate: 'DESC' },
      take,
    });
    return { count: trades.length, trades };
  }

  /**
   * Dane sentymentu dla jednego tickera.
   * ?limit=50 — ile wyników (domyślnie 50).
   */
  @Get(':ticker')
  async getSentiment(
    @Param('ticker') ticker: string,
    @Query('limit') limit?: string,
  ) {
    const symbol = ticker.toUpperCase();
    const take = Math.min(parseInt(limit || '50', 10), 200);

    const [scores, mentions, news] = await Promise.all([
      this.scoreRepo.find({
        where: { symbol },
        order: { timestamp: 'DESC' },
        take,
      }),
      // detectedTickers to jsonb array — używamy operatora @> (contains)
      this.mentionRepo
        .createQueryBuilder('m')
        .where(`m."detectedTickers" @> :tickers`, {
          tickers: JSON.stringify([symbol]),
        })
        .orderBy('m."collectedAt"', 'DESC')
        .limit(take)
        .getMany(),
      this.newsRepo.find({
        where: { symbol },
        order: { publishedAt: 'DESC' },
        take: Math.min(take, 20),
      }),
    ]);

    return {
      symbol,
      scores: { count: scores.length, data: scores },
      mentions: { count: mentions.length, data: mentions },
      news: { count: news.length, data: news },
    };
  }
}
