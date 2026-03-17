import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, FindOptionsWhere } from 'typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { Alert, AlertRule, Ticker } from '../entities';
import { EventType } from '../events/event-types';
import { TelegramService } from './telegram/telegram.service';
import { TelegramFormatterService } from './telegram/telegram-formatter.service';
import { SignalDirection } from '../common/types';
import { CorrelationService } from '../correlation/correlation.service';
import { SourceCategory, StoredSignal } from '../correlation/types/correlation.types';
import { Logged } from '../common/decorators/logged.decorator';
import { FinnhubService } from '../collectors/finnhub/finnhub.service';

/**
 * Ewaluator reguł alertów.
 * Nasłuchuje na eventy (new_mention, new_filing, new_insider_trade)
 * i sprawdza czy pasują do aktywnych reguł.
 * Implementuje throttling — minimalna przerwa między alertami tego samego typu per ticker.
 */
/** Okno agregacji insider trades — zbiera transakcje per ticker i wysyła zbiorczy alert */
const INSIDER_AGGREGATION_WINDOW_MS = 5 * 60 * 1000; // 5 minut

/**
 * Max alertów Telegram per ticker per dzień (UTC).
 * Raport 2026-03-17: HIMS 46 alertów/tydzień (~6.5/dzień) — nie do użycia.
 * Limit obcina najgorszy spam, zachowując realne sygnały.
 * Silent rules (Sentiment Crash, Strong FinBERT) nie liczą się do limitu.
 */
const MAX_TELEGRAM_ALERTS_PER_SYMBOL_PER_DAY = 5;

/**
 * Reguły "silent" — zapisywane do bazy, ale NIE wysyłane na Telegram.
 * Raport 2026-03-17: Sentiment Crash + Strong FinBERT = 80 alertów/tydzień (44%), zero edge.
 * Dane zachowane w DB do analizy, ale Telegram nie jest zasypywany szumem.
 */
const SILENT_RULES: ReadonlySet<string> = new Set([
  'Sentiment Crash',
  'Strong FinBERT Signal',
]);

interface InsiderBatch {
  symbol: string;
  trades: {
    insiderName: string;
    insiderRole?: string | null;
    transactionType: string;
    totalValue: number;
    shares: number;
  }[];
  timer: ReturnType<typeof setTimeout>;
}

@Injectable()
export class AlertEvaluatorService implements OnModuleDestroy {
  private readonly logger = new Logger(AlertEvaluatorService.name);

  /** Bufor agregacji insider trades per ticker */
  private readonly insiderBatches = new Map<string, InsiderBatch>();

  /** Cache reguł alertów — TTL 5 min, unika powtarzanych zapytań do DB */
  private rulesCache: Map<string, AlertRule | null> = new Map();
  private rulesCacheExpiry = 0;
  private static readonly RULES_CACHE_TTL_MS = 5 * 60 * 1000;

  /** Czyści timery insider batches przy shutdownie */
  onModuleDestroy(): void {
    for (const [symbol, batch] of this.insiderBatches) {
      clearTimeout(batch.timer);
      this.logger.debug(`Wyczyszczono timer insider batch: ${symbol}`);
    }
    this.insiderBatches.clear();
  }

  constructor(
    @InjectRepository(Alert)
    private readonly alertRepo: Repository<Alert>,
    @InjectRepository(AlertRule)
    private readonly ruleRepo: Repository<AlertRule>,
    @InjectRepository(Ticker)
    private readonly tickerRepo: Repository<Ticker>,
    private readonly telegram: TelegramService,
    private readonly formatter: TelegramFormatterService,
    private readonly finnhub: FinnhubService,
    @Optional() private readonly correlation?: CorrelationService,
  ) {}

  /**
   * Reaguje na event nowej transakcji insiderskiej.
   * Generuje alert "Insider Trade Large" gdy totalValue > $100K.
   * Ignoruje Finnhub MSPR (totalValue=0) i małe transakcje.
   */
  @OnEvent(EventType.NEW_INSIDER_TRADE)
  @Logged('alerts')
  async onInsiderTrade(payload: {
    tradeId: number;
    symbol: string;
    totalValue?: number;
    insiderName?: string;
    insiderRole?: string | null;
    transactionType?: string;
    shares?: number;
    source?: string;
  }): Promise<{ action: string; symbol: string }> {
    // Próg $100K — filtruje MSPR (totalValue=0), małe transakcje i stare EFTS placeholdery
    if (!payload.totalValue || payload.totalValue < 100_000) {
      return { action: 'SKIP_LOW_VALUE', symbol: payload.symbol };
    }

    // Filtruj rutynowe transakcje — tylko BUY i SELL to prawdziwe sygnały handlowe
    const ALERTABLE_TYPES = ['BUY', 'SELL'];
    if (!payload.transactionType || !ALERTABLE_TYPES.includes(payload.transactionType)) {
      this.logger.debug(
        `Pominięto insider trade ${payload.symbol} — typ ${payload.transactionType} (nie BUY/SELL)`,
      );
      return { action: 'SKIP_NOT_ALERTABLE', symbol: payload.symbol };
    }

    this.logger.debug(
      `Insider trade >$100K: ${payload.symbol} ${payload.insiderName} ` +
        `${payload.transactionType} $${payload.totalValue.toLocaleString('en-US')}`,
    );

    // Agregacja: zbierz trades per ticker w oknie 5 min, wyślij zbiorczy alert
    const existing = this.insiderBatches.get(payload.symbol);
    const trade = {
      insiderName: payload.insiderName ?? 'Unknown',
      insiderRole: payload.insiderRole,
      transactionType: payload.transactionType ?? 'UNKNOWN',
      totalValue: payload.totalValue,
      shares: payload.shares ?? 0,
    };

    if (existing) {
      // Dodaj do istniejącego batcha — timer już biegnie
      existing.trades.push(trade);
      this.logger.debug(
        `Insider batch ${payload.symbol}: ${existing.trades.length} transakcji w oknie`,
      );
      return { action: 'BATCHED', symbol: payload.symbol };
    } else {
      // Nowy batch — ustaw timer na flush po 5 min
      const batch: InsiderBatch = {
        symbol: payload.symbol,
        trades: [trade],
        timer: setTimeout(
          () => this.flushInsiderBatch(payload.symbol),
          INSIDER_AGGREGATION_WINDOW_MS,
        ),
      };
      this.insiderBatches.set(payload.symbol, batch);
      return { action: 'BATCH_STARTED', symbol: payload.symbol };
    }
  }

  /**
   * Wysyła zbiorczy alert insider trade po zakończeniu okna agregacji.
   * Grupuje transakcje: "3 insider trades for $ISRG totaling $3.5M"
   */
  private async flushInsiderBatch(symbol: string): Promise<void> {
    const batch = this.insiderBatches.get(symbol);
    if (!batch || batch.trades.length === 0) {
      this.insiderBatches.delete(symbol);
      return;
    }

    this.insiderBatches.delete(symbol);

    const rule = await this.getRule('Insider Trade Large');
    if (!rule) return;

    const isThrottled = await this.isThrottled(
      rule.name,
      symbol,
      rule.throttleMinutes,
    );
    if (isThrottled) return;

    const ticker = await this.tickerRepo.findOne({
      where: { symbol },
    });

    const totalValue = batch.trades.reduce((s, t) => s + t.totalValue, 0);
    const totalShares = batch.trades.reduce((s, t) => s + t.shares, 0);

    let message: string;

    if (batch.trades.length === 1) {
      // Pojedynczy trade — standardowy format
      const t = batch.trades[0];
      message = this.formatter.formatInsiderTradeAlert({
        symbol,
        companyName: ticker?.name ?? symbol,
        insiderName: t.insiderName,
        insiderRole: t.insiderRole ?? undefined,
        transactionType: t.transactionType,
        totalValue: t.totalValue,
        shares: t.shares,
        priority: rule.priority,
      });
    } else {
      // Wiele trades — zbiorczy format
      message = this.formatter.formatInsiderBatchAlert({
        symbol,
        companyName: ticker?.name ?? symbol,
        tradeCount: batch.trades.length,
        totalValue,
        totalShares,
        trades: batch.trades,
        priority: rule.priority,
      });
    }

    // Nie rejestruj sygnału korelacji z AlertEvaluator — Form4Pipeline robi to
    // z GPT-enriched conviction i poprawnym catalyst_type.
    // Dual signal (AlertEval value-based + Form4Pipeline GPT-based) zaśmiecał
    // INSIDER_CLUSTER mieszanymi conviction values (bug z raportu 2026-03-17).
    await this.sendAlert(symbol, rule, message);
  }

  /**
   * Reaguje na event nowego filingu SEC.
   * Generuje alert dla ważnych filingów (8-K, Form 4).
   */
  @OnEvent(EventType.NEW_FILING)
  @Logged('alerts')
  async onFiling(payload: {
    filingId: number;
    symbol: string;
    formType: string;
  }): Promise<{ action: string; symbol: string; formType: string }> {
    this.logger.debug(
      `Filing event: ${payload.symbol} — ${payload.formType}`,
    );

    // Tylko 8-K generuje alert z filingów.
    // Form 4 jest obsługiwany przez onInsiderTrade — nie duplikujemy.
    if (payload.formType !== '8-K') {
      return { action: 'SKIP_NOT_8K', symbol: payload.symbol, formType: payload.formType };
    }

    const ruleName = '8-K Material Event';
    const rule = await this.getRule(ruleName);
    if (!rule) {
      return { action: 'SKIP_NO_RULE', symbol: payload.symbol, formType: payload.formType };
    }

    const isThrottled = await this.isThrottled(
      rule.name,
      payload.symbol,
      rule.throttleMinutes,
    );
    if (isThrottled) {
      return { action: 'THROTTLED', symbol: payload.symbol, formType: payload.formType };
    }

    const ticker = await this.tickerRepo.findOne({
      where: { symbol: payload.symbol },
    });

    const message = this.formatter.formatFilingAlert({
      symbol: payload.symbol,
      companyName: ticker?.name ?? payload.symbol,
      formType: payload.formType,
      priority: rule.priority,
    });

    await this.sendAlert(payload.symbol, rule, message, undefined, {
      sourceCategory: '8k',
      conviction: 0.5, // bazowy conviction dla 8-K bez analizy GPT
      direction: 'negative', // 8-K material events domyślnie negatywne
    });
    return { action: 'ALERT_SENT', symbol: payload.symbol, formType: payload.formType };
  }

  /**
   * Reaguje na wynik analizy sentymentu.
   * Sprawdza 5 niezależnych reguł (mogą odpalić jednocześnie):
   * 1. Sentiment Crash: effectiveScore < -0.5 AND confidence > 0.7
   * 2. Bullish Signal Override: FinBERT < -0.5, GPT mówi BULLISH (effectiveScore > 0.1)
   * 3. Bearish Signal Override: FinBERT > 0.5, GPT mówi BEARISH (effectiveScore < -0.1)
   * 4. High Conviction Signal: |conviction| > 0.7 (raw, nieznormalizowany)
   * 5. Strong FinBERT Signal: model=finbert AND |score| > 0.7 AND confidence > 0.8
   * 6. Urgent AI Signal: urgency=HIGH AND relevance >= 0.7 AND |conviction| >= 0.3
   */
  @OnEvent(EventType.SENTIMENT_SCORED)
  @Logged('alerts')
  async onSentimentScored(payload: {
    scoreId: number;
    symbol: string;
    score: number;
    confidence: number;
    label: string;
    source: string;
    model: string;
    conviction: number | null;
    gptConviction: number | null;
    effectiveScore: number | null;
    enrichedAnalysis: Record<string, any> | null;
  }): Promise<{
    symbol: string;
    checks: {
      sentimentCrash: string;
      signalOverride: string;
      highConviction: string;
      strongFinbert: string;
      urgentSignal: string;
    };
  }> {
    const [crash, override, conviction, finbert, urgent] = await Promise.all([
      this.checkSentimentCrash(payload),
      this.checkSignalOverride(payload),
      this.checkHighConviction(payload),
      this.checkStrongFinbert(payload),
      this.checkUrgentSignal(payload),
    ]);
    return {
      symbol: payload.symbol,
      checks: {
        sentimentCrash: crash,
        signalOverride: override,
        highConviction: conviction,
        strongFinbert: finbert,
        urgentSignal: urgent,
      },
    };
  }

  /**
   * Sprawdza regułę "Sentiment Crash" — silny negatywny sygnał.
   * Używa effectiveScore (= znormalizowany GPT conviction LUB FinBERT score).
   * Stara logika supresji AI usunięta — effectiveScore przejmuje tę odpowiedzialność:
   * jeśli GPT mówi bullish/neutral, effectiveScore > -0.5, więc Crash nie odpali.
   */
  private async checkSentimentCrash(payload: {
    symbol: string;
    score: number;
    confidence: number;
    source: string;
    model: string;
    effectiveScore: number | null;
    enrichedAnalysis: Record<string, any> | null;
  }): Promise<string> {
    const scoreForEval = payload.effectiveScore ?? payload.score;

    if (scoreForEval >= -0.5) return `SKIP: effectiveScore ${scoreForEval.toFixed(3)} >= -0.5`;
    if (payload.confidence < 0.7) return `SKIP: confidence ${payload.confidence.toFixed(2)} < 0.7`;

    this.logger.debug(
      `Negatywny sentyment: ${payload.symbol} effectiveScore=${scoreForEval} finbert=${payload.score} (${payload.model})`,
    );

    const ruleName = 'Sentiment Crash';
    const rule = await this.getRule(ruleName);
    if (!rule) return 'SKIP: reguła nieaktywna';

    const catalyst = payload.enrichedAnalysis?.catalyst_type;

    const isThrottled = await this.isThrottled(
      rule.name,
      payload.symbol,
      rule.throttleMinutes,
      catalyst,
    );
    if (isThrottled) return `THROTTLED: ${ruleName}`;

    const message = this.formatter.formatSentimentAlert({
      symbol: payload.symbol,
      companyName: payload.symbol,
      priority: rule.priority,
      ruleName,
      sentimentScore: scoreForEval,
      details: `Model: ${payload.model}, Źródło: ${payload.source}, Confidence: ${payload.confidence.toFixed(2)}`,
      enrichedAnalysis: payload.enrichedAnalysis,
    });

    await this.sendAlert(payload.symbol, rule, message, catalyst, {
      sourceCategory: this.mapSourceCategory(payload.source),
      conviction: Math.abs(scoreForEval),
      direction: 'negative',
    });
    return `ALERT_SENT: ${ruleName}`;
  }

  /**
   * Sprawdza reguły "Bullish/Bearish Signal Override" — GPT koryguje FinBERT.
   * Bullish Override: FinBERT < -0.5, GPT mówi BULLISH (effectiveScore > 0.1)
   * Bearish Override: FinBERT > 0.5, GPT mówi BEARISH (effectiveScore < -0.1)
   */
  private async checkSignalOverride(payload: {
    symbol: string;
    score: number;
    confidence: number;
    source: string;
    gptConviction: number | null;
    effectiveScore: number | null;
    enrichedAnalysis: Record<string, any> | null;
  }): Promise<string> {
    if (payload.gptConviction == null || payload.effectiveScore == null)
      return 'SKIP: brak gptConviction lub effectiveScore';

    const finbertScore = payload.score;
    const effectiveScore = payload.effectiveScore;

    let direction: SignalDirection | null = null;

    // Bullish Override: FinBERT widzi intensywny negatywny tekst, GPT koryguje na BULLISH
    if (finbertScore < -0.5 && effectiveScore > 0.1) {
      direction = 'BULLISH';
    }

    // Bearish Override: FinBERT widzi pozytywny tekst, GPT koryguje na BEARISH
    if (finbertScore > 0.5 && effectiveScore < -0.1) {
      direction = 'BEARISH';
    }

    if (!direction)
      return `SKIP: brak override (finbert=${finbertScore.toFixed(3)}, effective=${effectiveScore.toFixed(3)})`;

    const ruleName = `${direction === 'BULLISH' ? 'Bullish' : 'Bearish'} Signal Override`;
    this.logger.debug(
      `${ruleName}: ${payload.symbol} finbert=${finbertScore} effectiveScore=${effectiveScore} gptConviction=${payload.gptConviction}`,
    );

    const rule = await this.getRule(ruleName);
    if (!rule) return `SKIP: reguła ${ruleName} nieaktywna`;

    const catalyst = payload.enrichedAnalysis?.catalyst_type;

    const isThrottled = await this.isThrottled(
      rule.name,
      payload.symbol,
      rule.throttleMinutes,
      catalyst,
    );
    if (isThrottled) return `THROTTLED: ${ruleName}`;

    const ticker = await this.tickerRepo.findOne({
      where: { symbol: payload.symbol },
    });

    const message = this.formatter.formatSignalOverrideAlert({
      symbol: payload.symbol,
      companyName: ticker?.name ?? payload.symbol,
      finbertScore,
      gptConviction: payload.gptConviction,
      effectiveScore,
      direction,
      catalystType: catalyst ?? 'unknown',
      summary: payload.enrichedAnalysis?.summary ?? '',
      priority: rule.priority,
    });

    await this.sendAlert(payload.symbol, rule, message, catalyst, {
      sourceCategory: this.mapSourceCategory(payload.source),
      conviction: Math.abs(effectiveScore),
      direction: direction === 'BULLISH' ? 'positive' : 'negative',
    });
    return `ALERT_SENT: ${ruleName}`;
  }

  /**
   * Sprawdza regułę "High Conviction Signal" — |conviction| > 0.7.
   * Wymaga enrichedAnalysis (wynik 2-etapowej analizy AI).
   * UWAGA: używa raw gptConviction (skala [-2, +2]), NIE effectiveScore.
   * Próg obniżony z 1.5 na 0.7 — historycznie max conviction = 1.008,
   * więc stary próg 1.5 był nieosiągalny (0 wyzwoleń ever).
   */
  private async checkHighConviction(payload: {
    symbol: string;
    score: number;
    confidence: number;
    source: string;
    conviction: number | null;
    enrichedAnalysis: Record<string, any> | null;
  }): Promise<string> {
    if (payload.conviction == null)
      return 'SKIP: conviction null';
    if (Math.abs(payload.conviction) < 0.7)
      return `SKIP: |conviction| ${Math.abs(payload.conviction).toFixed(3)} < 0.7`;

    this.logger.debug(
      `High conviction: ${payload.symbol} conviction=${payload.conviction}`,
    );

    const ruleName = 'High Conviction Signal';
    const rule = await this.getRule(ruleName);
    if (!rule) return 'SKIP: reguła nieaktywna';

    const catalyst = payload.enrichedAnalysis?.catalyst_type;

    const isThrottled = await this.isThrottled(
      rule.name,
      payload.symbol,
      rule.throttleMinutes,
      catalyst,
    );
    if (isThrottled) return `THROTTLED: ${ruleName}`;

    const message = this.formatter.formatConvictionAlert({
      symbol: payload.symbol,
      priority: rule.priority,
      conviction: payload.conviction,
      finbertScore: payload.score,
      finbertConfidence: payload.confidence,
      source: payload.source,
      enrichedAnalysis: payload.enrichedAnalysis ?? {},
    });

    await this.sendAlert(payload.symbol, rule, message, catalyst, {
      sourceCategory: this.mapSourceCategory(payload.source),
      conviction: Math.min(Math.abs(payload.conviction) / 2.0, 1.0), // normalizacja [-2,+2] → [0,1]
      direction: payload.conviction > 0 ? 'positive' : 'negative',
    });
    return `ALERT_SENT: ${ruleName}`;
  }

  /**
   * Sprawdza regułę "Strong FinBERT Signal" — fallback gdy VM offline.
   * Silny sygnał FinBERT (|score| > 0.7, conf > 0.8) bez potwierdzenia AI.
   */
  private async checkStrongFinbert(payload: {
    symbol: string;
    score: number;
    confidence: number;
    source: string;
    model: string;
    conviction: number | null;
  }): Promise<string> {
    // Tylko sygnały bez analizy AI (VM offline lub nie eskalowany)
    if (payload.conviction != null) return 'SKIP: conviction != null (ma analizę AI)';
    if (payload.model !== 'finbert') return `SKIP: model=${payload.model} (nie finbert)`;
    if (Math.abs(payload.score) <= 0.7)
      return `SKIP: |score| ${Math.abs(payload.score).toFixed(3)} <= 0.7`;
    if (payload.confidence <= 0.8)
      return `SKIP: confidence ${payload.confidence.toFixed(2)} <= 0.8`;

    this.logger.debug(
      `Strong FinBERT (unconfirmed): ${payload.symbol} score=${payload.score} conf=${payload.confidence}`,
    );

    const ruleName = 'Strong FinBERT Signal';
    const rule = await this.getRule(ruleName);
    if (!rule) return 'SKIP: reguła nieaktywna';

    const isThrottled = await this.isThrottled(
      rule.name,
      payload.symbol,
      rule.throttleMinutes,
    );
    if (isThrottled) return `THROTTLED: ${ruleName}`;

    const message = this.formatter.formatStrongFinbertAlert({
      symbol: payload.symbol,
      priority: rule.priority,
      score: payload.score,
      confidence: payload.confidence,
      source: payload.source,
    });

    await this.sendAlert(payload.symbol, rule, message, undefined, {
      sourceCategory: this.mapSourceCategory(payload.source),
      conviction: Math.abs(payload.score),
      direction: payload.score > 0 ? 'positive' : 'negative',
    });
    return `ALERT_SENT: ${ruleName}`;
  }

  /**
   * Sprawdza regułę "Urgent AI Signal" — urgency=HIGH z wysoką relevance.
   * Łapie sygnały (np. FDA approval), które mają niski conviction
   * przez source_authority degradację (np. StockTwits = 0.15).
   * Używa osobnej reguły z 60-min throttle per (rule, symbol, catalyst).
   */
  private async checkUrgentSignal(payload: {
    symbol: string;
    score: number;
    confidence: number;
    source: string;
    conviction: number | null;
    enrichedAnalysis: Record<string, any> | null;
  }): Promise<string> {
    const ea = payload.enrichedAnalysis;
    if (!ea) return 'SKIP: brak enrichedAnalysis';
    if (payload.conviction == null) return 'SKIP: conviction null';

    if (ea.urgency !== 'HIGH')
      return `SKIP: urgency=${ea.urgency ?? 'null'} (nie HIGH)`;
    if ((ea.relevance ?? 0) < 0.7)
      return `SKIP: relevance ${(ea.relevance ?? 0).toFixed(2)} < 0.7`;
    if ((ea.confidence ?? 0) < 0.6)
      return `SKIP: confidence ${(ea.confidence ?? 0).toFixed(2)} < 0.6`;
    if (Math.abs(payload.conviction) < 0.3)
      return `SKIP: |conviction| ${Math.abs(payload.conviction).toFixed(3)} < 0.3`;

    this.logger.debug(
      `Urgent signal: ${payload.symbol} urgency=${ea.urgency} relevance=${ea.relevance} conviction=${payload.conviction}`,
    );

    const ruleName = 'Urgent AI Signal';
    const rule = await this.getRule(ruleName);
    if (!rule) return 'SKIP: reguła nieaktywna';

    const catalyst = ea.catalyst_type;

    const isThrottled = await this.isThrottled(
      rule.name,
      payload.symbol,
      rule.throttleMinutes,
      catalyst,
    );
    if (isThrottled) return `THROTTLED: ${ruleName}`;

    const message = this.formatter.formatUrgentAiAlert({
      symbol: payload.symbol,
      priority: rule.priority,
      conviction: payload.conviction,
      finbertScore: payload.score,
      finbertConfidence: payload.confidence,
      source: payload.source,
      enrichedAnalysis: ea,
    });

    await this.sendAlert(payload.symbol, rule, message, catalyst, {
      sourceCategory: this.mapSourceCategory(payload.source),
      conviction: Math.min(Math.abs(payload.conviction) / 2.0, 1.0),
      direction: payload.conviction > 0 ? 'positive' : 'negative',
    });
    return `ALERT_SENT: ${ruleName}`;
  }

  /**
   * Wysyła alert i zapisuje go w historii.
   * Po wysłaniu rejestruje sygnał w CorrelationService do detekcji wzorców.
   */
  private async sendAlert(
    symbol: string,
    rule: AlertRule,
    message: string,
    catalystType?: string,
    correlationData?: {
      sourceCategory: SourceCategory;
      conviction: number;
      direction: 'positive' | 'negative' | 'neutral';
    },
  ): Promise<void> {
    // Silent rules: zapisz do DB, ale nie wysyłaj na Telegram (szum bez edge)
    const isSilent = SILENT_RULES.has(rule.name);

    // Per-symbol daily limit: max N alertów Telegram per ticker per dzień (UTC)
    let dailyLimitHit = false;
    if (!isSilent) {
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      const todayAlerts = await this.alertRepo.count({
        where: {
          symbol,
          delivered: true,
          sentAt: MoreThan(todayStart),
        },
      });
      if (todayAlerts >= MAX_TELEGRAM_ALERTS_PER_SYMBOL_PER_DAY) {
        dailyLimitHit = true;
        this.logger.debug(
          `Daily limit hit: ${symbol} ma ${todayAlerts} alertów dziś, pomijam Telegram`,
        );
      }
    }

    const delivered = (isSilent || dailyLimitHit)
      ? false
      : await this.telegram.sendMarkdown(message);

    // Price Outcome Tracker — pobierz cenę PRZED zapisem (1 zapis zamiast 2)
    let priceAtAlert: number | null = null;
    try {
      priceAtAlert = await this.finnhub.getQuote(symbol);
      if (priceAtAlert) {
        this.logger.debug(`PriceOutcome: ${symbol} priceAtAlert=$${priceAtAlert}`);
      }
    } catch (err) {
      this.logger.warn(`PriceOutcome getQuote error: ${err.message}`);
    }

    const alert = this.alertRepo.create({
      symbol,
      ruleName: rule.name,
      priority: rule.priority,
      channel: 'TELEGRAM',
      message,
      delivered,
      catalystType: catalystType ?? null,
      alertDirection: correlationData?.direction === 'neutral' ? null : (correlationData?.direction ?? null),
      priceAtAlert,
    });

    await this.alertRepo.save(alert);

    this.logger.log(
      `Alert wysłany: ${rule.name} dla ${symbol} (delivered: ${delivered})`,
    );

    // Rejestruj sygnał w CorrelationService
    if (this.correlation && correlationData) {
      try {
        const signal: StoredSignal = {
          id: `${rule.name}-${symbol}-${Date.now()}`,
          ticker: symbol,
          source_category: correlationData.sourceCategory,
          conviction: correlationData.conviction,
          direction: correlationData.direction === 'neutral'
            ? (correlationData.conviction >= 0 ? 'positive' : 'negative')
            : correlationData.direction,
          catalyst_type: catalystType ?? 'unknown',
          timestamp: Date.now(),
        };
        await this.correlation.storeSignal(signal);
        this.correlation.schedulePatternCheck(symbol);
      } catch (err) {
        this.logger.warn(`Correlation storeSignal error: ${err.message}`);
      }
    }
  }

  /** Mapuje nazwę źródła na kategorię dla CorrelationService */
  private mapSourceCategory(source: string): SourceCategory {
    switch (source?.toLowerCase()) {
      case 'stocktwits':
      case 'reddit':
        return 'social';
      case 'finnhub':
        return 'news';
      default:
        return 'news';
    }
  }

  /**
   * Pobiera regułę alertu z cache (TTL 5 min) lub z DB.
   * Redukuje liczbę zapytań — reguły zmieniają się rzadko.
   */
  private async getRule(name: string): Promise<AlertRule | null> {
    const now = Date.now();
    if (now > this.rulesCacheExpiry) {
      this.rulesCache.clear();
      this.rulesCacheExpiry = now + AlertEvaluatorService.RULES_CACHE_TTL_MS;
    }

    if (this.rulesCache.has(name)) {
      return this.rulesCache.get(name)!;
    }

    const rule = await this.ruleRepo.findOne({
      where: { name, isActive: true },
    });
    this.rulesCache.set(name, rule);
    return rule;
  }

  /**
   * Sprawdza czy alert tego typu per ticker jest wstrzymany (throttling).
   * Jeśli catalystType podany → throttle per (rule, symbol, catalyst).
   * Jeśli nie → per (rule, symbol) jak dotąd.
   */
  private async isThrottled(
    ruleName: string,
    symbol: string,
    throttleMinutes: number,
    catalystType?: string,
  ): Promise<boolean> {
    // Minimalny throttle 1 min — zapobiega spamowi przy batch importach
    const effectiveMinutes = Math.max(throttleMinutes, 1);
    const cutoff = new Date(Date.now() - effectiveMinutes * 60 * 1000);

    const where: FindOptionsWhere<Alert> = {
      ruleName,
      symbol,
      sentAt: MoreThan(cutoff),
    };
    if (catalystType) {
      where.catalystType = catalystType;
    }

    const count = await this.alertRepo.count({ where });

    return count > 0;
  }
}
