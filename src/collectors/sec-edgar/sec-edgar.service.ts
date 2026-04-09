import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BaseCollectorService } from '../shared/base-collector.service';
import { SecFiling, InsiderTrade, Ticker, CollectionLog } from '../../entities';
import { DataSource } from '../../common/interfaces/data-source.enum';
import { EventType } from '../../events/event-types';
import { parseForm4Xml } from './form4-parser';

const EDGAR_BASE = 'https://data.sec.gov';

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
        totalNew += filingsCount;
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
    // Przetwarzaj ważne typy filingów z ostatnich 7 dni
    // Skanuj więcej pozycji (100) bo SEC zwraca wszystkie typy (DEF 14A, SC TO-C, 6-K...)
    // i Form 4 / 8-K mogą być daleko na liście
    const importantForms = ['10-K', '10-Q', '8-K', '4', '3', '5', '13F-HR', 'S-1', '14A'];
    const limit = Math.min(100, recent.form.length);
    const cutoffDate = new Date(Date.now() - 7 * 24 * 3600_000).toISOString().split('T')[0];

    for (let i = 0; i < limit; i++) {
      // Stop gdy filingi starsze niż 7 dni (posortowane od najnowszych)
      if (recent.filingDate[i] < cutoffDate) break;

      const formType = recent.form[i];
      if (!importantForms.includes(formType)) continue;

      const accessionNumber = recent.accessionNumber[i];

      const exists = await this.filingRepo.findOne({
        where: { accessionNumber },
      });
      if (exists) continue;

      const accessionDir = accessionNumber.replace(/-/g, '');
      const baseDir = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${accessionDir}`;
      const primaryDoc = recent.primaryDocument?.[i];
      // Form 4: documentUrl = baseDir (parser sam buduje XML URL z primaryDoc)
      // 8-K/inne: documentUrl = pełny URL do .htm (fetchFilingText potrzebuje)
      const documentUrl = (formType === '4' || !primaryDoc)
        ? baseDir
        : `${baseDir}/${primaryDoc}`;

      const filing = this.filingRepo.create({
        symbol,
        cik: cik.padStart(10, '0'),
        formType,
        accessionNumber,
        description: recent.primaryDocDescription?.[i] || undefined,
        filingDate: new Date(recent.filingDate[i]),
        documentUrl,
      });

      await this.filingRepo.save(filing);
      newCount++;

      this.eventEmitter.emit(EventType.NEW_FILING, {
        filingId: filing.id,
        symbol,
        formType,
      });

      // Form 4 → pobierz XML i utwórz InsiderTrade z prawdziwymi danymi
      if (formType === '4') {
        const primaryDoc = recent.primaryDocument?.[i];
        if (primaryDoc) {
          // primaryDocument zwraca "xslF345X05/edgardoc.xml" (XSLT → HTML)
          // Raw XML to sama nazwa pliku bez XSLT prefix
          const rawXmlFile = primaryDoc.includes('/')
            ? primaryDoc.split('/').pop()
            : primaryDoc;
          const xmlUrl = `${documentUrl}/${rawXmlFile}`;
          await this.parseAndSaveForm4(symbol, accessionNumber, xmlUrl);
          await this.delay(150); // Rate limit SEC
        }
      }
    }

    if (newCount > 0) {
      this.logger.log(`${symbol}: ${newCount} nowych filingów`);
    }

    return newCount;
  }

  /**
   * Pobiera i parsuje Form 4 XML, tworzy rekordy InsiderTrade z prawdziwymi danymi.
   * Błędy nie przerywają kolekcji filingów — logowane i pomijane.
   */
  private async parseAndSaveForm4(
    symbol: string,
    accessionNumber: string,
    xmlUrl: string,
  ): Promise<void> {
    try {
      const xml = await this.fetchText(xmlUrl);
      const transactions = parseForm4Xml(xml);

      if (transactions.length === 0) {
        this.logger.debug(`Form 4 ${symbol} ${accessionNumber}: brak transakcji`);
        return;
      }

      for (let i = 0; i < transactions.length; i++) {
        const txn = transactions[i];
        // Deduplikacja: accession + index transakcji w filingu
        const txnAccession = `${accessionNumber}_${i}`;

        const exists = await this.insiderTradeRepo.findOne({
          where: { accessionNumber: txnAccession },
        });
        if (exists) continue;

        const trade = this.insiderTradeRepo.create({
          symbol,
          insiderName: txn.insiderName,
          insiderRole: txn.insiderRole ?? undefined,
          transactionType: txn.transactionType,
          shares: txn.shares,
          pricePerShare: txn.pricePerShare ?? undefined,
          totalValue: txn.totalValue,
          transactionDate: txn.transactionDate,
          accessionNumber: txnAccession,
          is10b51Plan: txn.is10b51Plan,
          sharesOwnedAfter: txn.sharesOwnedAfter ?? undefined,
        });

        await this.insiderTradeRepo.save(trade);

        this.eventEmitter.emit(EventType.NEW_INSIDER_TRADE, {
          tradeId: trade.id,
          symbol,
          totalValue: txn.totalValue,
          insiderName: txn.insiderName,
          insiderRole: txn.insiderRole,
          transactionType: txn.transactionType,
          shares: txn.shares,
          is10b51Plan: txn.is10b51Plan,
          sharesOwnedAfter: txn.sharesOwnedAfter,
          source: 'SEC_EDGAR',
        });

        this.logger.log(
          `Insider ${symbol}: ${txn.insiderName} ${txn.transactionType} ` +
            `${txn.shares} akcji @ $${txn.pricePerShare ?? '?'} = $${txn.totalValue.toLocaleString('en-US')}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Błąd parsowania Form 4 XML ${symbol} ${accessionNumber}: ${error instanceof Error ? error.message : error}`,
      );
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

  /**
   * Pobiera treść tekstową (XML) z SEC.
   */
  private async fetchText(url: string): Promise<string> {
    const res = await fetch(url, {
      headers: { ...this.headers, Accept: 'text/xml, application/xml' },
    });

    if (!res.ok) {
      throw new Error(`SEC HTTP ${res.status}: ${res.statusText}`);
    }

    return res.text();
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
