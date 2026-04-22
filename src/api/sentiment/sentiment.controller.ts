import { Controller, Get, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  RawMention,
  NewsArticle,
  SecFiling,
  InsiderTrade,
  PdufaCatalyst,
} from '../../entities';

/**
 * REST API danych zbieranych przez kolektory (legacy route name /sentiment).
 *
 * Sentiment-specific endpointy (/scores, /pipeline-logs, /:ticker) usunięte
 * razem z FinBERT pipeline (22.04.2026). Route path '/api/sentiment/*' zachowany
 * dla kompatybilności z frontendem (hardcoded fetche do /insider-trades i /pdufa).
 *
 * GET /api/sentiment/news            — ostatnie newsy (wszystkie tickery)
 * GET /api/sentiment/mentions        — ostatnie wzmianki social media
 * GET /api/sentiment/filings         — ostatnie filingi SEC
 * GET /api/sentiment/filings-gpt     — filingi SEC z analizą GPT (Claude Sonnet)
 * GET /api/sentiment/pdufa           — nadchodzące katalizatory PDUFA
 * GET /api/sentiment/insider-trades  — transakcje insiderów (Form 4)
 */
@Controller('sentiment')
export class SentimentController {
  constructor(
    @InjectRepository(RawMention)
    private readonly mentionRepo: Repository<RawMention>,
    @InjectRepository(NewsArticle)
    private readonly newsRepo: Repository<NewsArticle>,
    @InjectRepository(InsiderTrade)
    private readonly tradeRepo: Repository<InsiderTrade>,
    @InjectRepository(PdufaCatalyst)
    private readonly pdufaRepo: Repository<PdufaCatalyst>,
  ) {}

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

    const filings = await this.newsRepo.manager
      .getRepository(SecFiling)
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
      .getRepository(SecFiling)
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
}
