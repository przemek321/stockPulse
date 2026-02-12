import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BaseCollectorService } from '../shared/base-collector.service';
import { RawMention, Ticker, CollectionLog } from '../../entities';
import { DataSource } from '../../common/interfaces/data-source.enum';
import { EventType } from '../../events/event-types';

/**
 * Kolektor danych z Reddit.
 * Wymaga OAuth2 (REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD).
 * Monitoruje 18 subredditów healthcare.
 *
 * UWAGA: Czeka na zatwierdzenie dostępu do API Reddit.
 */
@Injectable()
export class RedditService extends BaseCollectorService {
  protected readonly logger = new Logger(RedditService.name);
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  /** Lista subredditów do monitorowania */
  private readonly subreddits = [
    'wallstreetbets', 'stocks', 'investing', 'options',
    'stockmarket', 'healthcare', 'health_insurance',
    'pharmacy', 'medicine', 'nursing',
    'healthcareworkers', 'insurancepros',
    'Medicare', 'Medicaid', 'telehealth',
    'pharma', 'biotechstocks', 'healthIT',
  ];

  constructor(
    @InjectRepository(CollectionLog)
    collectionLogRepo: Repository<CollectionLog>,
    @InjectRepository(RawMention)
    private readonly mentionRepo: Repository<RawMention>,
    @InjectRepository(Ticker)
    private readonly tickerRepo: Repository<Ticker>,
    private readonly config: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super(collectionLogRepo);
  }

  getSourceName(): DataSource {
    return DataSource.REDDIT;
  }

  /**
   * Sprawdza czy konfiguracja Reddit jest kompletna.
   */
  private isConfigured(): boolean {
    return !!(
      this.config.get('REDDIT_CLIENT_ID') &&
      this.config.get('REDDIT_CLIENT_SECRET') &&
      this.config.get('REDDIT_USERNAME') &&
      this.config.get('REDDIT_PASSWORD')
    );
  }

  /**
   * Zbiera wzmianki z subredditów healthcare.
   */
  async collect(): Promise<number> {
    if (!this.isConfigured()) {
      this.logger.warn(
        'Reddit API nie skonfigurowane — brak REDDIT_* w .env. Pomijam zbieranie.',
      );
      return 0;
    }

    await this.ensureAccessToken();

    const tickers = await this.tickerRepo.find({ where: { isActive: true } });
    const tickerSymbols = tickers.map((t) => t.symbol);
    let totalNew = 0;

    for (const subreddit of this.subreddits) {
      try {
        const newCount = await this.collectFromSubreddit(
          subreddit,
          tickerSymbols,
        );
        totalNew += newCount;
        // Rate limit: 100 req/min
        await this.delay(1000);
      } catch (error) {
        this.logger.warn(
          `Błąd Reddit r/${subreddit}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    return totalNew;
  }

  /**
   * Pobiera posty z subreddita i szuka wzmianek tickerów.
   */
  private async collectFromSubreddit(
    subreddit: string,
    knownTickers: string[],
  ): Promise<number> {
    const data = await this.redditFetch(
      `https://oauth.reddit.com/r/${subreddit}/hot?limit=25`,
    );

    if (!data?.data?.children) return 0;

    let newCount = 0;

    for (const child of data.data.children) {
      const post = child.data;
      const externalId = `reddit_${post.id}`;

      // Sprawdź duplikaty
      const exists = await this.mentionRepo.findOne({
        where: { externalId },
      });
      if (exists) continue;

      // Wykryj tickery w tytule i treści
      const fullText = `${post.title} ${post.selftext || ''}`;
      const detected = this.extractTickers(fullText, knownTickers);
      if (detected.length === 0) continue; // Pomijamy posty bez tickerów

      const mention = this.mentionRepo.create({
        source: DataSource.REDDIT,
        externalId,
        author: post.author || 'unknown',
        body: `${post.title}\n\n${(post.selftext || '').substring(0, 2000)}`,
        url: `https://reddit.com${post.permalink}`,
        detectedTickers: detected,
        sourceSentiment: undefined, // Reddit nie ma wbudowanego sentymentu
        publishedAt: new Date(post.created_utc * 1000),
      });

      await this.mentionRepo.save(mention);
      newCount++;

      for (const symbol of detected) {
        this.eventEmitter.emit(EventType.NEW_MENTION, {
          mentionId: mention.id,
          symbol,
          source: DataSource.REDDIT,
        });
      }
    }

    if (newCount > 0) {
      this.logger.log(`r/${subreddit}: ${newCount} nowych wzmianek`);
    }

    return newCount;
  }

  /**
   * Ekstrakcja tickerów z tekstu ($SYMBOL lub znane symbole).
   */
  private extractTickers(text: string, knownTickers: string[]): string[] {
    const found = new Set<string>();

    // Szukaj cashtags: $UNH, $CVS etc.
    const cashtagRegex = /\$([A-Z]{1,5})\b/g;
    let match: RegExpExecArray | null;
    while ((match = cashtagRegex.exec(text)) !== null) {
      if (knownTickers.includes(match[1])) {
        found.add(match[1]);
      }
    }

    // Szukaj znanych tickerów jako samodzielnych słów
    for (const ticker of knownTickers) {
      const regex = new RegExp(`\\b${ticker}\\b`, 'g');
      if (regex.test(text)) {
        found.add(ticker);
      }
    }

    return Array.from(found);
  }

  /**
   * OAuth2 — pobierz access token z Reddit.
   */
  private async ensureAccessToken(): Promise<void> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) return;

    const clientId = this.config.get<string>('REDDIT_CLIENT_ID');
    const clientSecret = this.config.get<string>('REDDIT_CLIENT_SECRET');
    const username = this.config.get<string>('REDDIT_USERNAME');
    const password = this.config.get<string>('REDDIT_PASSWORD');

    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const res = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'StockPulse/1.0',
      },
      body: `grant_type=password&username=${username}&password=${password}`,
    });

    if (!res.ok) {
      throw new Error(`Reddit OAuth2 error: ${res.status}`);
    }

    const data = await res.json();
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
    this.logger.log('Reddit OAuth2 token odnowiony');
  }

  /**
   * Wrapper HTTP z tokenem OAuth2.
   */
  private async redditFetch(url: string): Promise<any> {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'User-Agent': 'StockPulse/1.0',
      },
    });

    if (res.status === 401) {
      this.accessToken = null;
      throw new Error('Reddit token wygasł');
    }
    if (res.status === 429) {
      throw new Error('Reddit rate limit (100 req/min)');
    }
    if (!res.ok) {
      throw new Error(`Reddit HTTP ${res.status}`);
    }

    return res.json();
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
