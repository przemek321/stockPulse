import { Controller, Get, Param, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SentimentScore, RawMention, NewsArticle } from '../../entities';

/**
 * GET /api/sentiment/:ticker — dane sentymentu per ticker.
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

  /**
   * Ostatnie wyniki sentymentu dla tickera.
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
      this.mentionRepo
        .createQueryBuilder('m')
        .where(':symbol = ANY(m.detectedTickers)', { symbol })
        .orderBy('m.collectedAt', 'DESC')
        .take(take)
        .getMany(),
      this.newsRepo.find({
        where: { symbol },
        order: { publishedAt: 'DESC' },
        take: Math.min(take, 20),
      }),
    ]);

    return {
      symbol,
      scores: {
        count: scores.length,
        data: scores,
      },
      mentions: {
        count: mentions.length,
        data: mentions,
      },
      news: {
        count: news.length,
        data: news,
      },
    };
  }
}
