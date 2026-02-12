import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BaseCollectorService } from '../shared/base-collector.service';
import { SecFiling, InsiderTrade, Ticker, CollectionLog } from '../../entities';
import { DataSource } from '../../common/interfaces/data-source.enum';
import { EventType } from '../../events/event-types';

const EDGAR_BASE = 'https://data.sec.gov';
const EFTS_BASE = 'https://efts.sec.gov/LATEST';

/**
 * Kolektor danych z SEC EDGAR.
 * Zbiera: filingi (10-K, 10-Q, 8-K), transakcje insiderów (Form 4).
 * Darmowe API — wymaga tylko User-Agent z emailem.
 * Limit: 10 req/sec.
 */
@Injectable()
export class SecEdgarService extends BaseCollectorService {
  protected readonly logger = new Logger(SecEdgarService.name);
  private readonly userAgent: string;
  private readonly headers: Record<string, string>;

  constructor(
    @InjectRepository(CollectionLog)
    collectionLogRepo: Repository<CollectionLog>,
    @InjectRepository(SecFiling)
    private readonly filingRepo: Repository<SecFiling>,
    @InjectRepository(InsiderTrade)
    private readonly insiderTradeRepo: Repository<InsiderTrade>,
    @InjectRepository(Ticker)
    private readonly tickerRepo: Repository<Ticker>,
    private readonly config: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super(collectionLogRepo);
    this.userAgent = this.config.get<string>(
      'SEC_USER_AGENT',
      'StockPulse test@example.com',
    );
    this.headers = {
      'User-Agent': this.userAgent,
      Accept: 'application/json',
    };
  }

  getSourceName(): DataSource {
    return DataSource.SEC_EDGAR;
  }

  /**
   * Zbiera filingi i insider trades dla tickerów z CIK.
   */
  async collect(): Promise<number> {
    const tickers = await this.tickerRepo.find({ where: { isActive: true } });
    let totalNew = 0;

    for (const ticker of tickers) {
      if (!ticker.cik) continue; // Pomijamy tickery bez CIK

      try {
        const filingsCount = await this.collectFilings(ticker.symbol, ticker.cik);
        const insiderCount = await this.collectInsiderTrades(ticker.symbol, ticker.cik);
        totalNew += filingsCount + insiderCount;
        // Rate limit: 10 req/sec → 100ms przerwy
        await this.delay(200);
      } catch (error) {
        this.logger.warn(
          `Błąd EDGAR dla ${ticker.symbol}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    return totalNew;
  }

  /**
   * Pobiera ostatnie filingi spółki z submissions endpoint.
   */
  private async collectFilings(symbol: string, cik: string): Promise<number> {
    const paddedCik = cik.padStart(10, '0');
    const data = await this.fetchUrl(
      `${EDGAR_BASE}/submissions/CIK${paddedCik}.json`,
    );

    const recent = data.filings?.recent;
    if (!recent || recent.form.length === 0) return 0;

    let newCount = 0;
    // Przetwarzaj tylko ważne typy filingów
    const importantForms = ['10-K', '10-Q', '8-K', '4', '3', '5', '13F-HR', 'S-1', '14A'];
    const limit = Math.min(20, recent.form.length);

    for (let i = 0; i < limit; i++) {
      const formType = recent.form[i];
      if (!importantForms.includes(formType)) continue;

      const accessionNumber = recent.accessionNumber[i];

      const exists = await this.filingRepo.findOne({
        where: { accessionNumber },
      });
      if (exists) continue;

      const filing = this.filingRepo.create({
        symbol,
        cik: cik.padStart(10, '0'),
        formType,
        accessionNumber,
        description: recent.primaryDocDescription?.[i] || undefined,
        filingDate: new Date(recent.filingDate[i]),
        documentUrl: `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${accessionNumber.replace(/-/g, '')}`,
      });

      await this.filingRepo.save(filing);
      newCount++;

      this.eventEmitter.emit(EventType.NEW_FILING, {
        filingId: filing.id,
        symbol,
        formType,
      });
    }

    if (newCount > 0) {
      this.logger.log(`${symbol}: ${newCount} nowych filingów`);
    }

    return newCount;
  }

  /**
   * Szuka transakcji insiderów (Form 4) przez EFTS.
   */
  private async collectInsiderTrades(
    symbol: string,
    cik: string,
  ): Promise<number> {
    try {
      const daysAgo90 = this.getDateDaysAgo(90);
      const today = this.formatDate(new Date());
      const url = `${EFTS_BASE}/search-index?q=%22${symbol}%22&dateRange=custom&startdt=${daysAgo90}&enddt=${today}&forms=4&from=0&size=10`;

      const data = await this.fetchUrl(url);
      if (!data.hits?.hits?.length) return 0;

      let newCount = 0;

      for (const hit of data.hits.hits) {
        const src = hit._source;
        const accession = src.file_num || `efts_${symbol}_${src.file_date}_${hit._id}`;

        const exists = await this.insiderTradeRepo.findOne({
          where: { accessionNumber: accession },
        });
        if (exists) continue;

        const trade = this.insiderTradeRepo.create({
          symbol,
          insiderName: src.display_names?.join(', ') || 'Unknown',
          insiderRole: undefined,
          transactionType: 'UNKNOWN', // Form 4 wymaga parsowania XML dla szczegółów
          shares: 0,
          pricePerShare: undefined,
          totalValue: 0,
          transactionDate: new Date(src.file_date),
          accessionNumber: accession,
        });

        await this.insiderTradeRepo.save(trade);
        newCount++;

        this.eventEmitter.emit(EventType.NEW_INSIDER_TRADE, {
          tradeId: trade.id,
          symbol,
          source: 'SEC_EDGAR',
        });
      }

      return newCount;
    } catch {
      // EFTS search może być czasem niedostępny
      return 0;
    }
  }

  /**
   * Wrapper HTTP do SEC z obsługą rate limitu.
   */
  private async fetchUrl(url: string): Promise<any> {
    const res = await fetch(url, { headers: this.headers });

    if (res.status === 403) {
      throw new Error('SEC 403 — sprawdź User-Agent');
    }
    if (res.status === 429) {
      throw new Error('SEC rate limit (10 req/sec)');
    }
    if (!res.ok) {
      throw new Error(`SEC HTTP ${res.status}: ${res.statusText}`);
    }

    return res.json();
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  private getDateDaysAgo(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return this.formatDate(d);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
