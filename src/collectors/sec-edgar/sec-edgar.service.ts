import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { BaseCollectorService } from '../shared/base-collector.service';
import { SecFiling, InsiderTrade, Ticker, CollectionLog } from '../../entities';
import { DataSource } from '../../common/interfaces/data-source.enum';
import { EventType } from '../../events/event-types';
import { parseForm4Xml } from './form4-parser';

const EDGAR_BASE = 'https://data.sec.gov';

/** Timeout per fetch — bez tego wolna odpowiedź SEC wiesza cały cykl (FLAG #28). */
const SEC_FETCH_TIMEOUT_MS = 30_000;

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

      const filingTraceId = randomUUID();
      this.eventEmitter.emit(EventType.NEW_FILING, {
        filingId: filing.id,
        symbol,
        formType,
        traceId: filingTraceId,
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
          await this.parseAndSaveForm4(symbol, accessionNumber, xmlUrl, filingTraceId);
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
   *
   * TASK-03 (22.04.2026): multi-transaction Form 4 aggregation.
   * Jeden Form 4 może mieć N transakcji (np. ASX 22.04: 4 SELL od tego samego insidera
   * w jednym filingu = 530k shares / $247M). Wcześniej parser emitował N eventów →
   * throttle kasował 2-N → correlation widziała tylko pierwszą magnitude.
   *
   * Nowa logika: WSZYSTKIE rekordy InsiderTrade są zapisane do DB (historia zachowana,
   * dedupe przez accessionNumber_N), ALE event NEW_INSIDER_TRADE jest emitowany
   * per grupa (insiderName, transactionType) — jeden event z aggregate wartościami.
   *
   * Grupowanie tylko w obrębie tego samego filing (accessionNumber), żeby zachować
   * semantykę "1 filing = 1 decision point". Split executions across filings (rzadkie)
   * dalej są osobnymi eventami.
   */
  private async parseAndSaveForm4(
    symbol: string,
    accessionNumber: string,
    xmlUrl: string,
    parentTraceId?: string,
  ): Promise<void> {
    try {
      const xml = await this.fetchText(xmlUrl);
      const transactions = parseForm4Xml(xml);

      if (transactions.length === 0) {
        this.logger.debug(`Form 4 ${symbol} ${accessionNumber}: brak transakcji`);
        return;
      }

      // Save all rows (history preserved, dedupe by accessionNumber_N)
      const savedTrades: Array<{ entity: InsiderTrade; txn: typeof transactions[0] }> = [];
      for (let i = 0; i < transactions.length; i++) {
        const txn = transactions[i];
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
        savedTrades.push({ entity: trade, txn });

        this.logger.log(
          `Insider ${symbol}: ${txn.insiderName} ${txn.transactionType} ` +
            `${txn.shares} akcji @ $${txn.pricePerShare ?? '?'} = $${txn.totalValue.toLocaleString('en-US')}`,
        );
      }

      if (savedTrades.length === 0) return;

      // Group by (insiderName, transactionType). "BUY"+"SELL" od tego samego insidera
      // (np. exercise option + sell) to osobne grupy (różny sygnał ekonomiczny).
      // is10b51Plan też w kluczu — plan vs discretionary nie łącz, bo pipeline skipuje planowe.
      const groups = new Map<string, Array<typeof savedTrades[0]>>();
      for (const row of savedTrades) {
        const key = `${row.txn.insiderName}::${row.txn.transactionType}::${row.txn.is10b51Plan ? 1 : 0}`;
        const list = groups.get(key) ?? [];
        list.push(row);
        groups.set(key, list);
      }

      for (const group of groups.values()) {
        // Primary = pierwsza transakcja w grupie (najniższy index w filingu).
        const primary = group[0];
        const aggregateValue = group.reduce((s, r) => s + r.txn.totalValue, 0);
        const aggregateShares = group.reduce((s, r) => s + r.txn.shares, 0);

        const tradeTraceId = randomUUID();
        this.eventEmitter.emit(EventType.NEW_INSIDER_TRADE, {
          tradeId: primary.entity.id,
          symbol,
          // Backward compat: single-trade group wygląda identycznie jak przed TASK-03
          // (aggregate fields pominięte). Multi-trade group: totalValue/shares to aggregate,
          // dodatkowe aggregate* pola informują pipeline o grupowaniu.
          totalValue: aggregateValue,
          shares: aggregateShares,
          insiderName: primary.txn.insiderName,
          insiderRole: primary.txn.insiderRole,
          transactionType: primary.txn.transactionType,
          is10b51Plan: primary.txn.is10b51Plan,
          sharesOwnedAfter: group[group.length - 1].txn.sharesOwnedAfter,
          source: 'SEC_EDGAR',
          traceId: tradeTraceId,
          parentTraceId,
          ...(group.length > 1
            ? {
                aggregateCount: group.length,
                aggregateTradeIds: group.map(r => r.entity.id),
              }
            : {}),
        });

        if (group.length > 1) {
          this.logger.log(
            `Insider ${symbol} AGGREGATED: ${primary.txn.insiderName} ${primary.txn.transactionType} ` +
              `${group.length} transakcji = ${aggregateShares.toLocaleString('en-US')} akcji / ` +
              `$${aggregateValue.toLocaleString('en-US')}`,
          );
        }
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
    const res = await fetch(url, {
      headers: this.headers,
      signal: AbortSignal.timeout(SEC_FETCH_TIMEOUT_MS),
    });

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
      signal: AbortSignal.timeout(SEC_FETCH_TIMEOUT_MS),
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
