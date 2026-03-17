import { Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { EventType } from '../../events/event-types';
import { InsiderTrade, Ticker, Alert, AlertRule, SecFiling } from '../../entities';
import { AzureOpenaiClientService } from '../../sentiment/azure-openai-client.service';
import { TelegramService } from '../../alerts/telegram/telegram.service';
import { TelegramFormatterService } from '../../alerts/telegram/telegram-formatter.service';
import { DailyCapService } from '../services/daily-cap.service';
import { buildForm4Prompt, Form4PromptData } from '../prompts/form4.prompt';
import { parseGptResponse, SecFilingAnalysis } from '../types/sec-filing-analysis';
import { scoreToAlertPriority, mapToRuleName } from '../scoring/price-impact.scorer';
import { CorrelationService } from '../../correlation/correlation.service';
import { StoredSignal } from '../../correlation/types/correlation.types';
import { Logged } from '../../common/decorators/logged.decorator';

/**
 * Pipeline analizy GPT dla transakcji insiderskich (Form 4).
 *
 * Nasłuchuje event NEW_INSIDER_TRADE (równolegle z AlertEvaluatorService).
 * Buduje prompt z kontekstem (rola, 10b5-1, historia 30 dni) i wysyła do GPT.
 * GPT zwraca strukturalną ocenę wpływu na cenę → alert Telegram.
 */
@Injectable()
export class Form4Pipeline {
  private readonly logger = new Logger(Form4Pipeline.name);

  constructor(
    @InjectRepository(InsiderTrade)
    private readonly tradeRepo: Repository<InsiderTrade>,
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
    @Optional() private readonly correlation?: CorrelationService,
  ) {}

  @OnEvent(EventType.NEW_INSIDER_TRADE)
  @Logged('sec-filings')
  async onInsiderTrade(payload: {
    tradeId: number;
    symbol: string;
    totalValue?: number;
    insiderName?: string;
    insiderRole?: string | null;
    transactionType?: string;
    shares?: number;
    is10b51Plan?: boolean;
    sharesOwnedAfter?: number | null;
    source?: string;
  }): Promise<{ action: string; symbol: string }> {
    // Filtruj: spójność z AlertEvaluatorService — tylko BUY/SELL > $100K
    if (!payload.totalValue || payload.totalValue < 100_000) {
      return { action: 'SKIP_LOW_VALUE', symbol: payload.symbol };
    }
    const ALERTABLE = ['BUY', 'SELL'];
    if (payload.transactionType && !ALERTABLE.includes(payload.transactionType)) {
      return { action: 'SKIP_NOT_ALERTABLE', symbol: payload.symbol };
    }

    // Sprawdź daily cap
    if (!(await this.dailyCap.canCallGpt(payload.symbol))) {
      return { action: 'SKIP_DAILY_CAP', symbol: payload.symbol };
    }

    try {
      // Pobierz trade z bazy (potrzebujemy pełne dane)
      const trade = await this.tradeRepo.findOne({ where: { id: payload.tradeId } });
      if (!trade) return { action: 'SKIP_NOT_FOUND', symbol: payload.symbol };

      // Pobierz ticker info
      const ticker = await this.tickerRepo.findOne({ where: { symbol: payload.symbol } });
      const companyName = ticker?.name ?? payload.symbol;

      // Pobierz historię transakcji (30 dni) tego samego tickera
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600_000);
      const recentTrades = await this.tradeRepo.find({
        where: {
          symbol: payload.symbol,
          transactionDate: MoreThan(thirtyDaysAgo),
        },
        order: { transactionDate: 'DESC' },
        take: 20,
      });

      // Buduj dane do promptu
      const parsed: Form4PromptData = {
        insiderName: trade.insiderName,
        insiderRole: trade.insiderRole,
        transactionType: trade.transactionType,
        shares: Number(trade.shares),
        pricePerShare: trade.pricePerShare ? Number(trade.pricePerShare) : null,
        totalValue: Number(trade.totalValue),
        sharesOwnedAfter: trade.sharesOwnedAfter ? Number(trade.sharesOwnedAfter) : null,
        is10b51Plan: trade.is10b51Plan ?? false,
        transactionDate: trade.transactionDate?.toISOString?.() ?? '',
      };

      const recentFilings: Form4PromptData[] = recentTrades
        .filter(t => t.id !== trade.id)
        .map(t => ({
          insiderName: t.insiderName,
          insiderRole: t.insiderRole,
          transactionType: t.transactionType,
          shares: Number(t.shares),
          pricePerShare: t.pricePerShare ? Number(t.pricePerShare) : null,
          totalValue: Number(t.totalValue),
          sharesOwnedAfter: t.sharesOwnedAfter ? Number(t.sharesOwnedAfter) : null,
          is10b51Plan: t.is10b51Plan ?? false,
          transactionDate: t.transactionDate?.toISOString?.() ?? '',
        }));

      // Buduj prompt i wyślij do GPT
      const prompt = buildForm4Prompt(payload.symbol, companyName, parsed, recentFilings);
      const rawResponse = await this.azureOpenai.analyzeCustomPrompt(prompt);
      if (!rawResponse) return { action: 'SKIP_VM_OFFLINE', symbol: payload.symbol };

      // Waliduj JSON z GPT (Zod) — retry 1x przy błędzie
      let analysis: SecFilingAnalysis;
      try {
        analysis = parseGptResponse(
          typeof rawResponse === 'string' ? rawResponse : JSON.stringify(rawResponse),
        );
      } catch (err) {
        this.logger.warn(
          `Form4 GPT invalid JSON (1st attempt) for ${payload.symbol}: ${err.message}`,
        );
        // Retry: jeśli rawResponse jest obiektem, może jest poprawny ale nie przeszedł strict validation
        try {
          analysis = parseGptResponse(JSON.stringify(rawResponse));
        } catch {
          this.logger.error(
            `Form4 GPT invalid JSON (2nd attempt) for ${payload.symbol} — pomijam`,
          );
          return { action: 'SKIP_INVALID_JSON', symbol: payload.symbol };
        }
      }

      // Safety net: jeśli GPT zwrócił conviction z odwróconym znakiem (np. SELL +0.90),
      // skoryguj na podstawie price_impact.direction (GPT zawsze ustawia direction poprawnie)
      const directionFromGpt = analysis.price_impact.direction;
      if (directionFromGpt === 'negative' && analysis.conviction > 0) {
        this.logger.warn(
          `Form4 conviction sign fix: ${payload.symbol} ${parsed.transactionType} ` +
            `conviction ${analysis.conviction} → ${-analysis.conviction} (direction=negative)`,
        );
        analysis.conviction = -analysis.conviction;
      } else if (directionFromGpt === 'positive' && analysis.conviction < 0) {
        this.logger.warn(
          `Form4 conviction sign fix: ${payload.symbol} ${parsed.transactionType} ` +
            `conviction ${analysis.conviction} → ${-analysis.conviction} (direction=positive)`,
        );
        analysis.conviction = -analysis.conviction;
      }

      // Zapisz wynik do bazy — szukaj filingu Form 4 po bazowym accession number
      // (trade ma accessionNumber = `${accession}_${idx}`, filing ma samo `${accession}`)
      if (trade.accessionNumber) {
        const baseAccession = trade.accessionNumber.replace(/_\d+$/, '');
        const filing = await this.filingRepo.findOne({
          where: { accessionNumber: baseAccession },
        });
        if (filing && !filing.gptAnalysis) {
          filing.gptAnalysis = analysis as any;
          filing.priceImpactDirection = analysis.price_impact.direction;
          await this.filingRepo.save(filing);
        }
      }

      // Oblicz priorytet alertu
      const priority = scoreToAlertPriority(analysis, 'Form4');
      if (!priority) {
        this.logger.debug(`Form4 GPT: ${payload.symbol} — brak alertu (low priority)`);
        return { action: 'SKIP_LOW_PRIORITY', symbol: payload.symbol };
      }

      // Sprawdź regułę i throttling
      const ruleName = mapToRuleName(analysis, 'Form4');
      const rule = await this.ruleRepo.findOne({
        where: { name: ruleName, isActive: true },
      });
      if (!rule) return { action: 'SKIP_NO_RULE', symbol: payload.symbol };

      const isThrottled = await this.checkThrottled(
        rule.name, payload.symbol, rule.throttleMinutes, analysis.catalyst_type,
      );
      if (isThrottled) return { action: 'THROTTLED', symbol: payload.symbol };

      // Wyślij alert Telegram
      const message = this.formatter.formatForm4GptAlert({
        symbol: payload.symbol,
        companyName,
        insiderName: parsed.insiderName,
        insiderRole: parsed.insiderRole,
        transactionType: parsed.transactionType,
        totalValue: parsed.totalValue,
        shares: parsed.shares,
        is10b51Plan: parsed.is10b51Plan,
        sharesOwnedAfter: parsed.sharesOwnedAfter,
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
        `Form4 GPT alert: ${payload.symbol} ${parsed.insiderName} — ` +
          `${analysis.price_impact.direction}/${analysis.price_impact.magnitude} ` +
          `conviction=${analysis.conviction.toFixed(2)}`,
      );

      // Rejestruj sygnał w CorrelationService
      // Normalizacja conviction z [-2.0, +2.0] (GPT) → [-1.0, +1.0] (CorrelationService)
      if (this.correlation) {
        try {
          const normalizedConviction = Math.max(-1.0, Math.min(1.0, analysis.conviction / 2.0));
          const signal: StoredSignal = {
            id: `form4-gpt-${payload.symbol}-${Date.now()}`,
            ticker: payload.symbol,
            source_category: 'form4',
            conviction: normalizedConviction,
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

      return { action: 'ALERT_SENT', symbol: payload.symbol };
    } catch (err) {
      this.logger.error(`Form4 Pipeline error ${payload.symbol}: ${err.message}`);
      return { action: 'ERROR', symbol: payload.symbol };
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
