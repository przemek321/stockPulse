import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BaseCollectorService } from '../shared/base-collector.service';
import {
  NewsArticle,
  InsiderTrade,
  Ticker,
  CollectionLog,
} from '../../entities';
import { DataSource } from '../../common/interfaces/data-source.enum';
import { EventType } from '../../events/event-types';

const BASE_URL = 'https://finnhub.io/api/v1';

/**
 * Kolektor danych z Finnhub API.
 * Zbiera: newsy, insider sentiment (MSPR), transakcje insiderów.
 * Free tier: 60 req/min.
 */
@Injectable()
export class FinnhubService extends BaseCollectorService {
  protected readonly logger = new Logger(FinnhubService.name);
  private readonly apiKey: string;

  constructor(
    @InjectRepository(CollectionLog)
    collectionLogRepo: Repository<CollectionLog>,
    @InjectRepository(NewsArticle)
    private readonly newsRepo: Repository<NewsArticle>,
    @InjectRepository(InsiderTrade)
    private readonly insiderTradeRepo: Repository<InsiderTrade>,
    @InjectRepository(Ticker)
    private readonly tickerRepo: Repository<Ticker>,
    private readonly config: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super(collectionLogRepo);
    this.apiKey = this.config.get<string>('FINNHUB_API_KEY', '');
  }

  getSourceName(): DataSource {
    return DataSource.FINNHUB;
  }

  /**
   * Zbiera newsy i dane insiderów dla wszystkich tickerów.
   */
  async collect(): Promise<number> {
    if (!this.apiKey) {
      throw new Error('Brak FINNHUB_API_KEY w konfiguracji');
    }

    const tickers = await this.tickerRepo.find({ where: { isActive: true } });
    let totalNew = 0;

    for (const ticker of tickers) {
      try {
        const newsCount = await this.collectNews(ticker.symbol);
        const insiderCount = await this.collectInsiderTrades(ticker.symbol);
        totalNew += newsCount + insiderCount;
        // Rate limit: 60 req/min → ~1 req/sec
        await this.delay(1500);
      } catch (error) {
        this.logger.warn(
          `Błąd Finnhub dla ${ticker.symbol}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    return totalNew;
  }

  /**
   * Pobiera newsy spółki z ostatnich 7 dni.
   */
  private async collectNews(symbol: string): Promise<number> {
    const today = new Date();
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const from = this.formatDate(weekAgo);
    const to = this.formatDate(today);

    const articles = await this.fetchApi('/company-news', { symbol, from, to });
    if (!Array.isArray(articles) || articles.length === 0) return 0;

    let newCount = 0;

    for (const article of articles) {
      // Sprawdź duplikat po URL
      const exists = await this.newsRepo.findOne({
        where: { url: article.url },
      });
      if (exists) continue;

      const newsEntity = this.newsRepo.create({
        symbol,
        source: article.source || 'finnhub',
        headline: article.headline,
        summary: article.summary || undefined,
        url: article.url,
        category: article.category || undefined,
        publishedAt: new Date(article.datetime * 1000),
      });

      await this.newsRepo.save(newsEntity);
      newCount++;

      this.eventEmitter.emit(EventType.NEW_ARTICLE, {
        articleId: newsEntity.id,
        symbol,
        source: DataSource.FINNHUB,
      });
    }

    if (newCount > 0) {
      this.logger.log(`${symbol}: ${newCount} nowych artykułów`);
    }

    return newCount;
  }

  /**
   * Pobiera insider sentiment (MSPR) i zapisuje jako InsiderTrade.
   */
  private async collectInsiderTrades(symbol: string): Promise<number> {
    const today = new Date();
    const from = `${today.getFullYear()}-01-01`;
    const to = this.formatDate(today);

    try {
      const data = await this.fetchApi('/stock/insider-sentiment', {
        symbol,
        from,
        to,
      });

      if (!data.data || data.data.length === 0) return 0;

      let newCount = 0;
      for (const entry of data.data) {
        const transactionDate = new Date(
          entry.year,
          entry.month - 1,
          1,
        );
        const accession = `mspr_${symbol}_${entry.year}_${entry.month}`;

        const exists = await this.insiderTradeRepo.findOne({
          where: { accessionNumber: accession },
        });
        if (exists) continue;

        const trade = this.insiderTradeRepo.create({
          symbol,
          insiderName: 'Aggregate MSPR',
          insiderRole: undefined,
          transactionType: entry.mspr > 0 ? 'BUY' : 'SELL',
          shares: Math.abs(entry.change || 0),
          pricePerShare: undefined,
          totalValue: 0,
          transactionDate,
          accessionNumber: accession,
        });

        await this.insiderTradeRepo.save(trade);
        newCount++;

        this.eventEmitter.emit(EventType.NEW_INSIDER_TRADE, {
          tradeId: trade.id,
          symbol,
          mspr: entry.mspr,
        });
      }

      return newCount;
    } catch {
      // Insider sentiment może być niedostępny na free tier
      return 0;
    }
  }

  /**
   * Wrapper HTTP do Finnhub API z tokenem.
   */
  private async fetchApi(
    endpoint: string,
    params: Record<string, string> = {},
  ): Promise<any> {
    const searchParams = new URLSearchParams({
      ...params,
      token: this.apiKey,
    });
    const url = `${BASE_URL}${endpoint}?${searchParams}`;
    const res = await fetch(url);

    if (res.status === 429) {
      throw new Error('Finnhub rate limit (60 req/min)');
    }
    if (!res.ok) {
      throw new Error(`Finnhub HTTP ${res.status}: ${res.statusText}`);
    }

    return res.json();
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Pobiera aktualną cenę akcji z Finnhub /quote.
   * Zwraca null gdy API niedostępne lub rynek zamknięty (cena = 0).
   */
  async getQuote(symbol: string): Promise<number | null> {
    try {
      const data = await this.fetchApi('/quote', { symbol });
      return data?.c > 0 ? data.c : null;
    } catch (err) {
      this.logger.warn(`getQuote(${symbol}) error: ${err.message}`);
      return null;
    }
  }
}
