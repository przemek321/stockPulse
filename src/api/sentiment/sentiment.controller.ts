import { Controller, Get, Param, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  SentimentScore,
  RawMention,
  NewsArticle,
  SecFiling,
} from '../../entities';

/**
 * REST API sentymentu i danych zbieranych przez kolektory.
 * GET /api/sentiment/scores   — wyniki analizy sentymentu (wszystkie tickery)
 * GET /api/sentiment/news     — ostatnie newsy (wszystkie tickery)
 * GET /api/sentiment/mentions — ostatnie wzmianki social media
 * GET /api/sentiment/filings  — ostatnie filingi SEC
 * GET /api/sentiment/:ticker  — dane sentymentu per ticker
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
  ) {}

  /** Wszystkie wyniki sentymentu (najnowsze). */
  @Get('scores')
  async getScores(@Query('limit') limit?: string) {
    const take = Math.min(parseInt(limit || '100', 10), 500);
    const scores = await this.scoreRepo.find({
      order: { timestamp: 'DESC' },
      take,
    });
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
