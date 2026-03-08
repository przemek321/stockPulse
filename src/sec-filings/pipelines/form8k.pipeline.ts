import { Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { EventType } from '../../events/event-types';
import { SecFiling, Ticker, Alert, AlertRule } from '../../entities';
import { AzureOpenaiClientService } from '../../sentiment/azure-openai-client.service';
import { TelegramService } from '../../alerts/telegram/telegram.service';
import { TelegramFormatterService } from '../../alerts/telegram/telegram-formatter.service';
import { DailyCapService } from '../services/daily-cap.service';
import {
  detectItems,
  extractItemText,
  selectPromptBuilder,
  isBankruptcyItem,
  stripHtml,
} from '../parsers/form8k.parser';
import { parseGptResponse, SecFilingAnalysis } from '../types/sec-filing-analysis';
import { scoreToAlertPriority, mapToRuleName } from '../scoring/price-impact.scorer';
import { CorrelationService } from '../../correlation/correlation.service';
import { StoredSignal } from '../../correlation/types/correlation.types';
import { Logged } from '../../common/decorators/logged.decorator';

/**
 * Pipeline analizy GPT dla filingów 8-K.
 *
 * Nasłuchuje event NEW_FILING (równolegle z AlertEvaluatorService).
 * Pobiera tekst filingu z SEC EDGAR, routuje do per-Item prompta,
 * wysyła do GPT, waliduje odpowiedź i generuje alert.
 *
 * Specjalna logika: Item 1.03 (Bankruptcy) → natychmiastowy alert CRITICAL bez GPT.
 */
@Injectable()
export class Form8kPipeline {
  private readonly logger = new Logger(Form8kPipeline.name);
  private readonly userAgent: string;

  constructor(
    @InjectRepository(SecFiling)
    private readonly filingRepo: Repository<SecFiling>,
    @InjectRepository(Ticker)
    private readonly tickerRepo: Repository<Ticker>,
    @InjectRepository(Alert)
    private readonly alertRepo: Repository<Alert>,
    @InjectRepository(AlertRule)
    private readonly ruleRepo: Repository<AlertRule>,
    private readonly azureOpenai: AzureOpenaiClientService,
    private readonly telegram: TelegramService,
    private readonly formatter: TelegramFormatterService,
    private readonly dailyCap: DailyCapService,
    private readonly config: ConfigService,
    @Optional() private readonly correlation?: CorrelationService,
  ) {
    this.userAgent = this.config.get<string>(
      'SEC_USER_AGENT',
      'StockPulse test@example.com',
    );
  }

  @Logged('sec-filings')
  @OnEvent(EventType.NEW_FILING)
  async onFiling(payload: {
    filingId: number;
    symbol: string;
    formType: string;
  }): Promise<void> {
    // Tylko 8-K
    if (payload.formType !== '8-K') return;

    try {
      // Sprawdź daily cap
      if (!(await this.dailyCap.canCallGpt(payload.symbol))) return;

      // Pobierz filing z bazy
      const filing = await this.filingRepo.findOne({ where: { id: payload.filingId } });
      if (!filing || !filing.documentUrl) return;

      // Jeśli już przeanalizowany GPT — pomiń
      if (filing.gptAnalysis) return;

      // Pobierz tekst filingu z SEC EDGAR
      const filingText = await this.fetchFilingText(filing.documentUrl);
      if (!filingText || filingText.length < 100) {
        this.logger.debug(`8-K ${payload.symbol}: tekst za krótki (${filingText?.length ?? 0} znaków)`);
        return;
      }

      // Wykryj Items w 8-K
      const items = detectItems(filingText);
      if (items.length === 0) {
        this.logger.debug(`8-K ${payload.symbol}: brak rozpoznanych Items`);
        return;
      }

      // Sprawdź Item 1.03 (Bankruptcy) — natychmiastowy alert bez GPT
      const hasBankruptcy = items.some(isBankruptcyItem);
      if (hasBankruptcy) {
        await this.handleBankruptcy(payload.symbol, filing);
        // Kontynuuj analizę pozostałych Items (8-K może mieć wiele Items)
      }

      // Weź najważniejszy Item (nie-bankruptcy) do analizy GPT
      const mainItem = items.find(i => !isBankruptcyItem(i));
      if (!mainItem) return; // Tylko bankruptcy — już obsłużone

      const promptBuilder = selectPromptBuilder(mainItem);
      if (!promptBuilder) return;

      // Pobierz ticker info
      const ticker = await this.tickerRepo.findOne({ where: { symbol: payload.symbol } });
      const companyName = ticker?.name ?? payload.symbol;

      // Wyciągnij tekst sekcji i zbuduj prompt
      const itemText = extractItemText(filingText, mainItem);
      const prompt = promptBuilder(payload.symbol, companyName, itemText, mainItem);

      // Wyślij do GPT
      const rawResponse = await this.azureOpenai.analyzeCustomPrompt(prompt);
      if (!rawResponse) return; // VM niedostępna — graceful degradation

      await this.dailyCap.recordGptCall(payload.symbol);

      // Waliduj JSON z GPT (Zod) — retry 1x
      let analysis: SecFilingAnalysis;
      try {
        analysis = parseGptResponse(
          typeof rawResponse === 'string' ? rawResponse : JSON.stringify(rawResponse),
        );
      } catch (err) {
        this.logger.warn(
          `8-K GPT invalid JSON (1st attempt) for ${payload.symbol}: ${err.message}`,
        );
        try {
          analysis = parseGptResponse(JSON.stringify(rawResponse));
        } catch {
          this.logger.error(
            `8-K GPT invalid JSON (2nd attempt) for ${payload.symbol} — pomijam`,
          );
          return;
        }
      }

      // Zapisz wynik do bazy
      filing.gptAnalysis = analysis as any;
      filing.priceImpactDirection = analysis.price_impact.direction;
      await this.filingRepo.save(filing);

      // Oblicz priorytet alertu
      const priority = scoreToAlertPriority(analysis, '8-K');
      if (!priority) {
        this.logger.debug(`8-K GPT: ${payload.symbol} Item ${mainItem} — brak alertu (low priority)`);
        return;
      }

      // Sprawdź regułę i throttling
      const ruleName = mapToRuleName(analysis, '8-K');
      const rule = await this.ruleRepo.findOne({
        where: { name: ruleName, isActive: true },
      });
      if (!rule) return;

      const isThrottled = await this.checkThrottled(
        rule.name, payload.symbol, rule.throttleMinutes, analysis.catalyst_type,
      );
      if (isThrottled) return;

      // Wyślij alert Telegram
      const message = this.formatter.formatForm8kGptAlert({
        symbol: payload.symbol,
        companyName,
        itemNumber: mainItem,
        analysis,
        priority,
      });

      const delivered = await this.telegram.sendMarkdown(message);

      await this.alertRepo.save(
        this.alertRepo.create({
          symbol: payload.symbol,
          ruleName: rule.name,
          priority,
          channel: 'TELEGRAM',
          message,
          delivered,
          catalystType: analysis.catalyst_type,
        }),
      );

      this.logger.log(
        `8-K GPT alert: ${payload.symbol} Item ${mainItem} — ` +
          `${analysis.price_impact.direction}/${analysis.price_impact.magnitude} ` +
          `conviction=${analysis.conviction.toFixed(2)}`,
      );

      // Rejestruj sygnał w CorrelationService
      if (this.correlation) {
        try {
          const signal: StoredSignal = {
            id: `8k-gpt-${payload.symbol}-${mainItem}-${Date.now()}`,
            ticker: payload.symbol,
            source_category: '8k',
            conviction: analysis.conviction,
            direction: analysis.conviction >= 0 ? 'positive' : 'negative',
            catalyst_type: analysis.catalyst_type,
            timestamp: Date.now(),
          };
          await this.correlation.storeSignal(signal);
          this.correlation.schedulePatternCheck(payload.symbol);
        } catch (err) {
          this.logger.warn(`Correlation storeSignal error: ${err.message}`);
        }
      }
    } catch (err) {
      this.logger.error(`8-K Pipeline error ${payload.symbol}: ${err.message}`);
    }
  }

  /**
   * Obsługa Item 1.03 — Bankruptcy. Natychmiastowy alert CRITICAL bez GPT.
   */
  private async handleBankruptcy(symbol: string, filing: SecFiling): Promise<void> {
    const ruleName = '8-K Bankruptcy';
    const rule = await this.ruleRepo.findOne({
      where: { name: ruleName, isActive: true },
    });
    if (!rule) return;

    // Bankruptcy: throttleMinutes = 0, każda instancja alertuje
    const message = this.formatter.formatBankruptcyAlert({
      symbol,
      companyName: symbol,
      filingDate: filing.filingDate?.toISOString?.() ?? '',
      documentUrl: filing.documentUrl,
    });

    const delivered = await this.telegram.sendMarkdown(message);

    await this.alertRepo.save(
      this.alertRepo.create({
        symbol,
        ruleName: rule.name,
        priority: 'CRITICAL',
        channel: 'TELEGRAM',
        message,
        delivered,
        catalystType: 'bankruptcy',
      }),
    );

    this.logger.log(`BANKRUPTCY alert: ${symbol} — 8-K Item 1.03`);

    // Rejestruj bankruptcy jako silny negatywny sygnał
    if (this.correlation) {
      try {
        const signal: StoredSignal = {
          id: `8k-bankruptcy-${symbol}-${Date.now()}`,
          ticker: symbol,
          source_category: '8k',
          conviction: -1.0,
          direction: 'negative',
          catalyst_type: 'bankruptcy',
          timestamp: Date.now(),
        };
        await this.correlation.storeSignal(signal);
        this.correlation.schedulePatternCheck(symbol);
      } catch (err) {
        this.logger.warn(`Correlation storeSignal error: ${err.message}`);
      }
    }
  }

  /**
   * Pobiera tekst filingu 8-K z SEC EDGAR.
   * Filing index → znajdź główny dokument (.htm) → pobierz i oczyść z HTML.
   */
  private async fetchFilingText(documentUrl: string): Promise<string | null> {
    try {
      // Pobierz indeks plików filingu
      const indexRes = await fetch(`${documentUrl}/index.json`, {
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!indexRes.ok) {
        // Fallback: spróbuj pobrać bezpośrednio główny dokument
        return this.fetchDirectDocument(documentUrl);
      }

      const indexData = await indexRes.json();
      const items = indexData?.directory?.item;
      if (!Array.isArray(items)) return this.fetchDirectDocument(documentUrl);

      // Znajdź główny dokument 8-K (nie XBRL, nie exhibit)
      const mainDoc = items.find((item: any) => {
        const name = item.name?.toLowerCase() ?? '';
        return (
          (name.endsWith('.htm') || name.endsWith('.html') || name.endsWith('.txt')) &&
          !name.startsWith('r1') && !name.startsWith('r2') &&
          !name.includes('exhibit') && !name.includes('ex-') &&
          !name.includes('xbrl')
        );
      });

      if (!mainDoc) return this.fetchDirectDocument(documentUrl);

      // Pobierz dokument
      const docRes = await fetch(`${documentUrl}/${mainDoc.name}`, {
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'text/html, text/plain',
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (!docRes.ok) return null;
      const html = await docRes.text();
      return stripHtml(html);
    } catch (err) {
      this.logger.warn(`Błąd pobierania tekstu 8-K: ${err.message}`);
      return null;
    }
  }

  /**
   * Fallback: próbuj pobrać pierwszy .htm z dokumentu bezpośrednio.
   */
  private async fetchDirectDocument(documentUrl: string): Promise<string | null> {
    try {
      const res = await fetch(documentUrl, {
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'text/html, text/plain',
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return null;
      const html = await res.text();
      return stripHtml(html);
    } catch {
      return null;
    }
  }

  private async checkThrottled(
    ruleName: string,
    symbol: string,
    throttleMinutes: number,
    catalystType?: string,
  ): Promise<boolean> {
    const cutoff = new Date(Date.now() - Math.max(throttleMinutes, 1) * 60_000);
    const where: any = { ruleName, symbol, sentAt: MoreThan(cutoff) };
    if (catalystType) where.catalystType = catalystType;
    return !!(await this.alertRepo.findOne({ where }));
  }
}
