import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BaseCollectorService } from '../shared/base-collector.service';
import { RawMention, CollectionLog, Ticker } from '../../entities';
import { DataSource } from '../../common/interfaces/data-source.enum';
import { EventType } from '../../events/event-types';

const BASE_URL = 'https://api.stocktwits.com/api/2';

/**
 * Kolektor danych ze StockTwits.
 * Publiczne endpointy — bez autoryzacji, ~200 req/hour.
 * Pobiera stream wiadomości per ticker z wbudowanym sentymentem.
 */
@Injectable()
export class StocktwitsService extends BaseCollectorService {
  protected readonly logger = new Logger(StocktwitsService.name);

  constructor(
    @InjectRepository(CollectionLog)
    collectionLogRepo: Repository<CollectionLog>,
    @InjectRepository(RawMention)
    private readonly mentionRepo: Repository<RawMention>,
    @InjectRepository(Ticker)
    private readonly tickerRepo: Repository<Ticker>,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super(collectionLogRepo);
  }

  getSourceName(): DataSource {
    return DataSource.STOCKTWITS;
  }

  /**
   * Zbiera wzmianki ze StockTwits dla wszystkich monitorowanych tickerów.
   * Zwraca liczbę nowych wzmianek zapisanych do bazy.
   */
  async collect(): Promise<number> {
    const tickers = await this.tickerRepo.find({ where: { isActive: true } });
    let totalNew = 0;

    for (const ticker of tickers) {
      try {
        const newCount = await this.collectForSymbol(ticker.symbol);
        totalNew += newCount;
        // Rate limit: ~200 req/h = ~3 req/min → 20s przerwy między symbolami
        await this.delay(2000);
      } catch (error) {
        this.logger.warn(
          `Błąd StockTwits dla ${ticker.symbol}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    return totalNew;
  }

  /**
   * Pobiera stream wiadomości dla jednego symbolu.
   */
  private async collectForSymbol(symbol: string): Promise<number> {
    const data = await this.fetchApi(`/streams/symbol/${symbol}.json`);
    if (!data.messages || data.messages.length === 0) {
      return 0;
    }

    let newCount = 0;

    for (const msg of data.messages) {
      const externalId = `st_${msg.id}`;

      // Sprawdź czy wiadomość już istnieje
      const exists = await this.mentionRepo.findOne({
        where: { externalId },
      });
      if (exists) continue;

      const sentiment = msg.entities?.sentiment?.basic || undefined;
      const mention = this.mentionRepo.create({
        source: DataSource.STOCKTWITS,
        externalId,
        author: msg.user?.username || 'unknown',
        body: msg.body,
        url: `https://stocktwits.com/symbol/${symbol}`,
        detectedTickers: [symbol],
        sourceSentiment: sentiment, // Bullish, Bearish, undefined
        publishedAt: new Date(msg.created_at),
      });

      await this.mentionRepo.save(mention);
      newCount++;

      // Emit event dla dalszego przetwarzania
      this.eventEmitter.emit(EventType.NEW_MENTION, {
        mentionId: mention.id,
        symbol,
        source: DataSource.STOCKTWITS,
      });
    }

    if (newCount > 0) {
      this.logger.log(`${symbol}: ${newCount} nowych wzmianek`);
    }

    return newCount;
  }

  /**
   * Wrapper HTTP do API StockTwits z obsługą rate limitu.
   */
  private async fetchApi(endpoint: string): Promise<any> {
    const url = `${BASE_URL}${endpoint}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'StockPulse/1.0' },
    });

    if (res.status === 429) {
      throw new Error('StockTwits rate limit (~200 req/hour)');
    }
    if (!res.ok) {
      throw new Error(`StockTwits HTTP ${res.status}: ${res.statusText}`);
    }

    return res.json();
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
