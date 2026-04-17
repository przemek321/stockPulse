import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, MoreThanOrEqual, FindOptionsWhere } from 'typeorm';
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
import { AlertDeliveryGate } from './alert-delivery-gate.service';

/**
 * Ewaluator reguł alertów.
 * Nasłuchuje na eventy (new_mention, new_filing, new_insider_trade)
 * i sprawdza czy pasują do aktywnych reguł.
 * Implementuje throttling — minimalna przerwa między alertami tego samego typu per ticker.
 */
// Sprint 11: INSIDER_AGGREGATION_WINDOW_MS usunięty — insider trades obsługiwane przez Form4Pipeline

/**
 * Reguły "silent" — zapisywane do bazy, ale NIE wysyłane na Telegram.
 * Raport 2026-03-17: Sentiment Crash + Strong FinBERT = 80 alertów/tydzień (44%), zero edge.
 * Dane zachowane w DB do analizy, ale Telegram nie jest zasypywany szumem.
 */
const SILENT_RULES: ReadonlySet<string> = new Set([
  'Sentiment Crash',
  'Strong FinBERT Signal',
]);

// Sprint 11: InsiderBatch interface usunięty — insider trades obsługiwane przez Form4Pipeline

@Injectable()
export class AlertEvaluatorService {
  private readonly logger = new Logger(AlertEvaluatorService.name);

  /** Cache reguł alertów — TTL 5 min, unika powtarzanych zapytań do DB */
  private rulesCache: Map<string, AlertRule | null> = new Map();
  private rulesCacheExpiry = 0;
  private static readonly RULES_CACHE_TTL_MS = 5 * 60 * 1000;

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
    private readonly deliveryGate: AlertDeliveryGate,
    @Optional() private readonly correlation?: CorrelationService,
  ) {}

  // Sprint 11: onInsiderTrade() handler usunięty (Sprint 16b).
  // Insider trades obsługuje wyłącznie Form4Pipeline (GPT-enriched conviction).
  // Reguła "Insider Trade Large" pozostaje w DB jako disabled (audit trail).

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
    // Form 4 jest obsługiwany przez Form4Pipeline — nie duplikujemy.
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

    const alertAction = await this.sendAlert(payload.symbol, rule, message, undefined, {
      sourceCategory: '8k',
      conviction: 0.5, // bazowy conviction dla 8-K bez analizy GPT
      direction: 'negative', // 8-K material events domyślnie negatywne
    });
    return { action: alertAction, symbol: payload.symbol, formType: payload.formType };
  }

  /**
   * Reaguje na wynik analizy sentymentu.
   *
   * Sprint 11: WYŁĄCZONY — sentiment pipeline nie emituje SENTIMENT_SCORED
   * (SentimentListenerService ma skomentowane @OnEvent).
   * Wszystkie 6 reguł sentymentowych ma isActive=false w bazie (seed z healthcare-universe.json).
   * Handler zachowany na wypadek ponownego włączenia pipeline'u.
   *
   * Reguły (wszystkie nieaktywne):
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
    // Sprint 11: Sentiment pipeline wyłączony — ten handler nie powinien być wywoływany.
    // Gdyby jednak SENTIMENT_SCORED został wyemitowany, reguły mają isActive=false
    // w bazie, więc getRule() zwróci null i alerty nie wyjdą.
    // Early return zapobiega zbędnym zapytaniom do DB.
    this.logger.debug(
      `onSentimentScored: ${payload.symbol} — POMINIĘTY (Sprint 11, reguły sentymentowe wyłączone)`,
    );
    return {
      symbol: payload.symbol,
      checks: {
        sentimentCrash: 'SKIP: Sprint 11 — reguły sentymentowe wyłączone',
        signalOverride: 'SKIP: Sprint 11 — reguły sentymentowe wyłączone',
        highConviction: 'SKIP: Sprint 11 — reguły sentymentowe wyłączone',
        strongFinbert: 'SKIP: Sprint 11 — reguły sentymentowe wyłączone',
        urgentSignal: 'SKIP: Sprint 11 — reguły sentymentowe wyłączone',
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

    const sentAction = await this.sendAlert(payload.symbol, rule, message, catalyst, {
      sourceCategory: this.mapSourceCategory(payload.source),
      conviction: Math.abs(scoreForEval),
      direction: 'negative',
    });
    return `${sentAction}: ${ruleName}`;
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

    const sentAction = await this.sendAlert(payload.symbol, rule, message, catalyst, {
      sourceCategory: this.mapSourceCategory(payload.source),
      conviction: Math.abs(effectiveScore),
      direction: direction === 'BULLISH' ? 'positive' : 'negative',
    });
    return `${sentAction}: ${ruleName}`;
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

    const sentAction = await this.sendAlert(payload.symbol, rule, message, catalyst, {
      sourceCategory: this.mapSourceCategory(payload.source),
      conviction: Math.min(Math.abs(payload.conviction) / 2.0, 1.0), // normalizacja [-2,+2] → [0,1]
      direction: payload.conviction > 0 ? 'positive' : 'negative',
    });
    return `${sentAction}: ${ruleName}`;
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

    const sentAction = await this.sendAlert(payload.symbol, rule, message, undefined, {
      sourceCategory: this.mapSourceCategory(payload.source),
      conviction: Math.abs(payload.score),
      direction: payload.score > 0 ? 'positive' : 'negative',
    });
    return `${sentAction}: ${ruleName}`;
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

    const sentAction = await this.sendAlert(payload.symbol, rule, message, catalyst, {
      sourceCategory: this.mapSourceCategory(payload.source),
      conviction: Math.min(Math.abs(payload.conviction) / 2.0, 1.0),
      direction: payload.conviction > 0 ? 'positive' : 'negative',
    });
    return `${sentAction}: ${ruleName}`;
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
  ): Promise<string> {
    // Observation mode: ticker z observationOnly=true → DB only, brak Telegramu
    const ticker = await this.tickerRepo.findOne({ where: { symbol } });
    const isObservation = ticker?.observationOnly === true;

    // Silent rules: zapisz do DB, ale nie wysyłaj na Telegram (szum bez edge)
    const isSilent = SILENT_RULES.has(rule.name);

    // Sprint 16 FLAG #10: shared AlertDeliveryGate zamiast lokalnego checku
    let dailyLimitHit = false;
    if (!isSilent && !isObservation) {
      const gateCheck = await this.deliveryGate.canDeliverToTelegram(symbol);
      if (!gateCheck.allowed) {
        dailyLimitHit = true;
      }
    }

    // Ustal powód niedostarczenia (jeśli jest)
    let nonDeliveryReason: string | null = null;
    if (isObservation) nonDeliveryReason = 'observation';
    else if (isSilent) nonDeliveryReason = 'silent_hour';
    else if (dailyLimitHit) nonDeliveryReason = 'daily_limit';

    const delivered = (isSilent || dailyLimitHit || isObservation)
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
      nonDeliveryReason,
      catalystType: catalystType ?? null,
      alertDirection: correlationData?.direction === 'neutral' ? null : (correlationData?.direction ?? null),
      priceAtAlert,
    });

    await this.alertRepo.save(alert);

    // Granularny action dla observability
    let alertAction: string;
    if (isObservation) alertAction = 'ALERT_DB_ONLY_OBSERVATION';
    else if (isSilent) alertAction = 'ALERT_DB_ONLY_SILENT_RULE';
    else if (dailyLimitHit) alertAction = 'ALERT_DB_ONLY_DAILY_LIMIT';
    else if (delivered) alertAction = 'ALERT_SENT_TELEGRAM';
    else alertAction = 'ALERT_TELEGRAM_FAILED';

    this.logger.log(
      `Alert ${alertAction}: ${rule.name} dla ${symbol}`,
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

    return alertAction;
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
