import { Injectable, Logger, Inject, OnModuleDestroy, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Redis from 'ioredis';
import { createHash } from 'crypto';
import { CORRELATION_REDIS } from './redis.provider';
import { TelegramService } from '../alerts/telegram/telegram.service';
import { TelegramFormatterService } from '../alerts/telegram/telegram-formatter.service';
import { FinnhubService } from '../collectors/finnhub/finnhub.service';
import { Alert, AlertRule, Ticker } from '../entities';
import {
  StoredSignal,
  DetectedPattern,
  Direction,
  PatternType,
  PATTERN_LABELS,
  PATTERN_THROTTLE,
} from './types/correlation.types';
import { Logged } from '../common/decorators/logged.decorator';
import { AlertDeliveryGate } from '../alerts/alert-delivery-gate.service';
import { AlertDispatcherService } from '../alerts/alert-dispatcher.service';

/**
 * CorrelationService — wykrywa wzorce między sygnałami z różnych źródeł.
 *
 * Obserwuje sygnały ze wszystkich pipeline'ów i wykrywa wzorce
 * które są silniejsze niż suma części (np. insider sell + 8-K tego samego dnia).
 *
 * Sygnały przechowywane w Redis Sorted Sets z timestamp jako score.
 * Dwa okna: 48h (short) i 14 dni (insider).
 */

/** Okna czasowe (ms) */
const WINDOW_48H = 48 * 3600_000;
const WINDOW_24H = 24 * 3600_000;
const WINDOW_7D = 7 * 24 * 3600_000;
const WINDOW_72H = 72 * 3600_000;
/** Okno INSIDER_PLUS_OPTIONS: 120h (5 dni) — pokrywa weekend + 2 dni robocze na Form 4 filing */
const WINDOW_120H = 120 * 3600_000;
const WINDOW_14D = 14 * 24 * 3600_000;

/** Minimalny |conviction| sygnału do zapisania w Redis (obniżony z 0.15 — insider trades $100K mają conviction 0.1) */
const MIN_CONVICTION = 0.05;

/** Minimalny |conviction| do wyzwolenia correlated alertu (obniżony z 0.35 — realne sygnały rzadko przekraczały próg) */
const MIN_CORRELATED_CONVICTION = 0.20;

/** Minimalny |conviction| ostatniego sygnału w ESCALATING_SIGNAL */
const MIN_ESCALATING_LAST_CONVICTION = 0.25;

/** TASK-04: okno dedupu content-hash patternów.
 *  15 min — jeśli przez 15 min skład signals się nie zmienił, to powtórzone
 *  runPatternDetection wywołane przez debounce to szum (logi + CPU).
 *  Po 15 min świeży start (np. po restart / po cleanup TTL Redis).
 *  Per-ticker throttling już istnieje (PATTERN_THROTTLE, 2h dla OPTIONS / 24h dla CLUSTER)
 *  jako ostateczna bariera dla alert dispatch. */
const PATTERN_HASH_WINDOW_MS = 15 * 60_000;

/**
 * TASK-04: content-hash zbioru wykrytych patternów.
 *
 * Klucz = (type + sorted signal IDs) — dwa wywołania runPatternDetection
 * zwracają ten sam hash, jeśli:
 *   (a) wykryte są te same typy patternów,
 *   (b) w każdym patternie skład signals (po ID) jest identyczny.
 *
 * Hash change = nowy signal dołączył do jednego z patternów ALBO pojawił się
 * nowy typ patternu. Oba przypadki wart emitowania; stagnacja = szum.
 */
export function hashPatternSet(patterns: DetectedPattern[]): string {
  if (patterns.length === 0) return '';
  const normalized = patterns
    .map(p => ({
      type: p.type,
      signalIds: p.signals.map(s => s.id).sort(),
    }))
    .sort((a, b) => a.type.localeCompare(b.type));
  return createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex')
    .slice(0, 16);
}

/**
 * Decyzja: czy pominąć wyzwalanie alertów bo zbiór patternów nie zmienił się
 * od ostatniego runa. Czysta funkcja dla testowalności.
 */
export function shouldSkipDuplicatePatternDetection(
  newHash: string,
  cached: { hash: string; ts: number } | undefined,
  now: number,
  windowMs: number = PATTERN_HASH_WINDOW_MS,
): boolean {
  if (!cached) return false;
  if (now - cached.ts > windowMs) return false;
  return cached.hash === newHash;
}

@Injectable()
export class CorrelationService implements OnModuleDestroy {
  private readonly logger = new Logger(CorrelationService.name);

  /** Debounce per ticker — 10s opóźnienie przed pattern detection.
   *  Nie nadpisuje istniejącego timera — jeśli check jest zaplanowany, nowe sygnały
   *  zostaną uwzględnione bo pattern detection czyta z Redis (aktualny stan).
   */
  private readonly pendingChecks = new Map<string, { ts: number; timer: ReturnType<typeof setTimeout> }>();

  /** TASK-04: per-ticker cache ostatniego hash zbioru patternów.
   *  In-memory (nie Redis) — po restarcie pierwszy pattern zostanie emitowany niepotrzebnie,
   *  potem się zestabilizuje. Redis dodałby latency + klucz do zarządzania dla minimalnej
   *  korzyści (restart ~ raz/deploy, window 15 min = pomijalne re-fire).
   *  Cleanup opportunistyczny w runPatternDetection (stale entries >1h). */
  private readonly lastPatternHash = new Map<string, { hash: string; ts: number }>();

  onModuleDestroy(): void {
    for (const { timer } of this.pendingChecks.values()) {
      clearTimeout(timer);
    }
    this.pendingChecks.clear();
    this.lastPatternHash.clear();
  }

  constructor(
    @Inject(CORRELATION_REDIS) private readonly redis: Redis,
    private readonly telegram: TelegramService,
    private readonly formatter: TelegramFormatterService,
    @InjectRepository(Alert)
    private readonly alertRepo: Repository<Alert>,
    @InjectRepository(AlertRule)
    private readonly ruleRepo: Repository<AlertRule>,
    @InjectRepository(Ticker)
    private readonly tickerRepo: Repository<Ticker>,
    @Optional() private readonly finnhub?: FinnhubService,
    @Optional() private readonly deliveryGate?: AlertDeliveryGate,
    @Optional() private readonly dispatcher?: AlertDispatcherService,
  ) {}

  /**
   * Zapisuje sygnał do Redis po wysłaniu alertu.
   * Wywoływany z AlertEvaluator, Form4Pipeline, Form8kPipeline.
   */
  @Logged('correlation')
  async storeSignal(signal: StoredSignal): Promise<{ action: string; ticker: string }> {
    if (Math.abs(signal.conviction) < MIN_CONVICTION) {
      return { action: 'SKIP_LOW_CONVICTION', ticker: signal.ticker };
    }

    const redisKey = signal.source_category === 'form4'
      ? `signals:insider:${signal.ticker}`
      : `signals:short:${signal.ticker}`;

    // Options sygnały żyją 120h (5 dni) — pokrycie weekendu + Form 4 filing delay
    const ttlMs = signal.source_category === 'form4' ? WINDOW_14D : WINDOW_120H;

    try {
      const cutoffTime = Date.now() - ttlMs;
      await this.redis.zremrangebyscore(redisKey, 0, cutoffTime);
      await this.redis.zadd(redisKey, signal.timestamp, JSON.stringify(signal));
      await this.redis.zremrangebyrank(redisKey, 0, -51);
      const ttlSec = Math.ceil(ttlMs / 1000);
      await this.redis.expire(redisKey, ttlSec);
    } catch (err) {
      this.logger.error(`Redis storeSignal failed for ${signal.ticker}: ${err.message} — signal not correlated`);
      return { action: 'REDIS_ERROR', ticker: signal.ticker };
    }

    return { action: 'STORED', ticker: signal.ticker };
  }

  /**
   * Zaplanuj sprawdzenie wzorców z debounce 10s.
   * Nie nadpisuje istniejącego timera — pattern detection czyta z Redis,
   * więc nowe sygnały będą uwzględnione nawet jeśli timer był ustawiony wcześniej.
   * Cleanup: stale entries (>60s) usuwane przy każdym wywołaniu.
   */
  schedulePatternCheck(ticker: string): void {
    const now = Date.now();

    // Cleanup stale entries (>60s) — zapobiega memory leak
    if (this.pendingChecks.size > 50) {
      for (const [t, { ts, timer }] of this.pendingChecks) {
        if (now - ts > 60_000) {
          clearTimeout(timer);
          this.pendingChecks.delete(t);
        }
      }
    }

    // Jeśli check jest już zaplanowany i nie minął — skip (nie nadpisuj timera)
    const existing = this.pendingChecks.get(ticker);
    if (existing && now - existing.ts < 10_000) return;

    const timer = setTimeout(() => {
      this.pendingChecks.delete(ticker);
      this.runPatternDetection(ticker);
    }, 10_000);
    this.pendingChecks.set(ticker, { ts: now, timer });
  }

  /**
   * Uruchamia detekcję wzorców dla danego tickera.
   */
  @Logged('correlation')
  async runPatternDetection(ticker: string): Promise<{ ticker: string; signals: number; patterns: number; action: string }> {
    this.pendingChecks.delete(ticker);
    const now = Date.now();

    try {
      const shortSignals = await this.getSignalsInWindow(
        `signals:short:${ticker}`, now - WINDOW_120H, now,
      );
      const insiderSignals = await this.getSignalsInWindow(
        `signals:insider:${ticker}`, now - WINDOW_14D, now,
      );

      // Nie sprawdzaj wzorców gdy za mało sygnałów
      const allSignals = [...shortSignals, ...insiderSignals];
      if (allSignals.length < 2) {
        return { ticker, signals: allSignals.length, patterns: 0, action: 'TOO_FEW_SIGNALS' };
      }

      const patterns: DetectedPattern[] = [];

      // Sprint 11: tylko 3 wzorce z realnym edge'em (insider-centric)
      // Wyłączone: FILING_CONFIRMS_NEWS (bazuje na sentymencie), MULTI_SOURCE_CONVERGENCE
      // (wymaga social/news), ESCALATING_SIGNAL (kaskada sygnałów social bez edge'u)
      const p1 = this.detectInsiderPlus8K(shortSignals, insiderSignals, now);
      const p4 = this.detectInsiderCluster(insiderSignals, now);
      const p6 = this.detectInsiderPlusOptions(shortSignals, insiderSignals, now);

      for (const p of [p1, p4, p6]) {
        if (p) patterns.push(p);
      }

      if (patterns.length === 0) {
        return { ticker, signals: allSignals.length, patterns: 0, action: 'NO_PATTERNS' };
      }

      // TASK-04 (22.04.2026): content-hash dedup. HPE cascade 22.04: 7 runPatternDetection
      // calls w 6 min, każda iteracja wywoływała triggerCorrelatedAlert (redundantne wołanie
      // bo i tak trafiałoby DEDUP_SKIP na PATTERN_THROTTLE 2h). Fix: porównaj skład
      // patternów z ostatnim runem — jeśli identyczny w ciągu 15 min, zwróć early bez
      // wywołania triggerCorrelatedAlert. Opportunistic cleanup cache'u przy okazji.
      const newHash = hashPatternSet(patterns);
      const cached = this.lastPatternHash.get(ticker);
      if (shouldSkipDuplicatePatternDetection(newHash, cached, now)) {
        return {
          ticker,
          signals: allSignals.length,
          patterns: patterns.length,
          action: 'PATTERNS_DETECTED_DUPLICATE',
        };
      }
      this.lastPatternHash.set(ticker, { hash: newHash, ts: now });
      // Cleanup stale entries (>1h) gdy mapa urośnie
      if (this.lastPatternHash.size > 100) {
        for (const [t, entry] of this.lastPatternHash) {
          if (now - entry.ts > 3600_000) this.lastPatternHash.delete(t);
        }
      }

      for (const pattern of patterns) {
        await this.triggerCorrelatedAlert(ticker, pattern);
      }

      return {
        ticker,
        signals: allSignals.length,
        patterns: patterns.length,
        action: 'PATTERNS_DETECTED',
      };
    } catch (err) {
      this.logger.error(`Pattern detection error for ${ticker}: ${err.message}`);
      return { ticker, signals: 0, patterns: 0, action: 'ERROR' };
    }
  }

  // ── Detektory wzorców ──────────────────────────────────

  /** Pattern 1: Insider + 8-K w ciągu 24h */
  private detectInsiderPlus8K(
    shortSignals: StoredSignal[],
    insiderSignals: StoredSignal[],
    now: number,
  ): DetectedPattern | null {
    const window = now - WINDOW_24H;
    const form4 = insiderSignals.filter(s => s.source_category === 'form4' && s.timestamp > window);
    const filing8k = shortSignals.filter(s => s.source_category === '8k' && s.timestamp > window);

    if (form4.length === 0 || filing8k.length === 0) return null;

    const allSignals = [...form4, ...filing8k];
    const dir = this.getDominantDirection(allSignals);
    if (!dir) return null;

    return {
      type: 'INSIDER_PLUS_8K',
      signals: allSignals,
      correlated_conviction: this.aggregateConviction(allSignals),
      direction: dir,
      description: `Insider transaction + ${filing8k.length} 8-K filing(s) within 24h`,
    };
  }

  /** Pattern 2: News potwierdzone przez filing (news PRZED filingiem) */
  private detectFilingConfirmsNews(signals: StoredSignal[], now: number): DetectedPattern | null {
    const window = now - WINDOW_48H;
    const newsSignals = signals.filter(
      s => (s.source_category === 'news' || s.source_category === 'social') && s.timestamp > window,
    );
    const filingSignals = signals.filter(s => s.source_category === '8k' && s.timestamp > window);

    if (newsSignals.length === 0 || filingSignals.length === 0) return null;

    // News musi przyjść PRZED filingiem
    const earliestNews = Math.min(...newsSignals.map(s => s.timestamp));
    const earliestFiling = Math.min(...filingSignals.map(s => s.timestamp));
    if (earliestNews >= earliestFiling) return null;

    // Sprawdź czy catalyst_type się zgadza (ignoruj 'unknown' — news często nie ma catalyst_type)
    const newsCatalysts = new Set(newsSignals.map(s => s.catalyst_type).filter(c => c && c !== 'unknown'));
    const filingCatalysts = new Set(filingSignals.map(s => s.catalyst_type).filter(c => c && c !== 'unknown'));
    // Jeśli jedna strona ma tylko 'unknown' — przepuść (brak danych ≠ brak korelacji)
    const bothHaveKnownTypes = newsCatalysts.size > 0 && filingCatalysts.size > 0;
    if (bothHaveKnownTypes) {
      const sharedCatalyst = [...newsCatalysts].some(c => filingCatalysts.has(c));
      if (!sharedCatalyst) return null;
    }

    const allSignals = [...newsSignals, ...filingSignals];
    const dir = this.getDominantDirection(allSignals);
    if (!dir) return null;

    const lagMinutes = Math.round((earliestFiling - earliestNews) / 60_000);
    return {
      type: 'FILING_CONFIRMS_NEWS',
      signals: allSignals,
      correlated_conviction: this.aggregateConviction(allSignals),
      direction: dir,
      description: `News preceded official 8-K by ${lagMinutes} minutes`,
    };
  }

  /** Pattern 3: 3+ różne kategorie źródeł potwierdzają ten sam kierunek w 24h */
  private detectMultiSourceConvergence(signals: StoredSignal[], now: number): DetectedPattern | null {
    const window = now - WINDOW_24H;
    const recent = signals.filter(s => s.timestamp > window);

    // Najsilniejszy sygnał per kategoria
    const byCategory = new Map<string, StoredSignal>();
    for (const sig of recent) {
      const existing = byCategory.get(sig.source_category);
      if (!existing || Math.abs(sig.conviction) > Math.abs(existing.conviction)) {
        byCategory.set(sig.source_category, sig);
      }
    }

    if (byCategory.size < 3) return null;

    const best = [...byCategory.values()];
    const dir = this.getDominantDirection(best);
    if (!dir) return null;

    const confirming = best.filter(s => s.direction === dir);
    if (confirming.length < 3) return null;

    return {
      type: 'MULTI_SOURCE_CONVERGENCE',
      signals: confirming,
      correlated_conviction: this.aggregateConviction(confirming),
      direction: dir,
      description: `${confirming.length} independent source types confirm ${dir} signal`,
    };
  }

  /** Pattern 4: 2+ insider transactions w ciągu 7 dni */
  private detectInsiderCluster(signals: StoredSignal[], now: number): DetectedPattern | null {
    const window = now - WINDOW_7D;
    const recent = signals.filter(s => s.source_category === 'form4' && s.timestamp > window);

    if (recent.length < 2) return null;

    const dir = this.getDominantDirection(recent);
    if (!dir) return null;

    const confirming = recent.filter(s => s.direction === dir);
    if (confirming.length < 2) return null;

    return {
      type: 'INSIDER_CLUSTER',
      signals: confirming,
      correlated_conviction: this.aggregateConviction(confirming),
      direction: dir,
      description: `${confirming.length} insider transactions in 7 days, all ${dir}`,
    };
  }

  /** Pattern 5: Rosnąca conviction przez 3+ sygnały w 72h */
  private detectEscalatingSignal(signals: StoredSignal[], now: number): DetectedPattern | null {
    const window = now - WINDOW_72H;
    const recent = signals
      .filter(s => s.timestamp > window)
      .sort((a, b) => a.timestamp - b.timestamp);

    if (recent.length < 3) return null;

    const dir = this.getDominantDirection(recent);
    if (!dir) return null;

    const directionSign = dir === 'positive' ? 1 : -1;

    // Sprawdź eskalację na ostatnich 3 sygnałach
    const last3 = recent.slice(-3);

    // Moja poprawka: minimalny próg conviction na ostatnim sygnale
    if (Math.abs(last3[2].conviction) < MIN_ESCALATING_LAST_CONVICTION) return null;

    const isEscalating =
      Math.abs(last3[1].conviction) > Math.abs(last3[0].conviction) &&
      Math.abs(last3[2].conviction) > Math.abs(last3[1].conviction);

    if (!isEscalating) return null;
    if (!last3.every(s => s.direction === dir)) return null;

    return {
      type: 'ESCALATING_SIGNAL',
      signals: last3,
      correlated_conviction: Math.max(-1.0, Math.min(1.0, last3[2].conviction * 1.3)),
      direction: dir,
      description: `Conviction escalating over 3 signals: ${last3.map(s => s.conviction.toFixed(2)).join(' → ')}`,
    };
  }

  /**
   * Pattern 6: Insider + Unusual Options — Form 4 + options flow w ciągu 120h (5 dni).
   * Okno 120h pokrywa weekend + 2 dni robocze na Form 4 filing delay.
   * Najsilniejszy cross-signal: pieniądze insiderów + pieniądze smart money na rynku opcji.
   */
  private detectInsiderPlusOptions(
    shortSignals: StoredSignal[],
    insiderSignals: StoredSignal[],
    now: number,
  ): DetectedPattern | null {
    const window = now - WINDOW_120H;
    const form4 = insiderSignals.filter(
      s => s.source_category === 'form4' && s.timestamp > window,
    );
    const options = shortSignals.filter(
      s => s.source_category === 'options' && s.timestamp > window,
    );

    if (form4.length === 0 || options.length === 0) return null;

    const allSignals = [...form4, ...options];
    const dir = this.getDominantDirection(allSignals);
    if (!dir) return null;

    return {
      type: 'INSIDER_PLUS_OPTIONS',
      signals: allSignals,
      correlated_conviction: this.aggregateConviction(allSignals),
      direction: dir,
      description: `Insider ${form4[0]?.direction === 'negative' ? 'SELL' : 'BUY'} + ${options.length} unusual options flow(s) within 5d`,
    };
  }

  // ── Agregacja i helpers ──────────────────────────────────

  /** Agreguje conviction: bazowy = najsilniejszy, boost +20% per dodatkowe źródło */
  private aggregateConviction(signals: StoredSignal[]): number {
    if (signals.length === 0) return 0;

    // Najsilniejszy per kategoria
    const byCategory = new Map<string, StoredSignal>();
    for (const sig of signals) {
      const existing = byCategory.get(sig.source_category);
      if (!existing || Math.abs(sig.conviction) > Math.abs(existing.conviction)) {
        byCategory.set(sig.source_category, sig);
      }
    }

    const best = [...byCategory.values()];
    const strongest = best.reduce((a, b) =>
      Math.abs(a.conviction) > Math.abs(b.conviction) ? a : b,
    );

    const sameDirection = best.filter(s => s.direction === strongest.direction);
    const boost = 1 + 0.2 * (sameDirection.length - 1);

    const sign = strongest.direction === 'positive' ? 1 : -1;
    return Math.min(1.0, Math.abs(strongest.conviction) * boost) * sign;
  }

  /** Wyznacza dominujący kierunek (wymaga 66% przewagi) */
  private getDominantDirection(signals: StoredSignal[]): Direction | null {
    const pos = signals.filter(s => s.direction === 'positive').length;
    const neg = signals.filter(s => s.direction === 'negative').length;
    if (pos >= signals.length * 0.66) return 'positive';
    if (neg >= signals.length * 0.66) return 'negative';
    return null;
  }

  /** Pobiera sygnały z Redis w oknie czasowym */
  private async getSignalsInWindow(
    key: string,
    from: number,
    to: number,
  ): Promise<StoredSignal[]> {
    const raw = await this.redis.zrangebyscore(key, from, to);
    return raw.map(r => {
      try {
        return JSON.parse(r) as StoredSignal;
      } catch {
        return null;
      }
    }).filter(Boolean) as StoredSignal[];
  }

  // ── Alert z deduplikacją ──────────────────────────────────

  /**
   * Wysyła alert correlated pattern z deduplikacją w Redis.
   *
   * TASK-04 (22.04.2026): @Logged('correlation') dodany żeby zamknąć observability gap.
   * Audyt 22.04 pokazał, że decyzje DEDUP_SKIP / SKIP_LOW_CONVICTION / dispatch wyniki
   * były niewidoczne w system_logs — tylko runPatternDetection był logowany. Teraz każde
   * wywołanie (pattern-level decision) trafia do system_logs z traceId + decisionReason.
   */
  @Logged('correlation')
  private async triggerCorrelatedAlert(
    ticker: string,
    pattern: DetectedPattern,
  ): Promise<{ action: string; ticker: string; patternType: PatternType }> {
    if (Math.abs(pattern.correlated_conviction) < MIN_CORRELATED_CONVICTION) {
      return { action: 'SKIP_LOW_CONVICTION', ticker, patternType: pattern.type };
    }

    // Observation mode: ticker z observationOnly=true → DB only, brak Telegramu
    const tickerEntity = await this.tickerRepo.findOne({ where: { symbol: ticker } });
    const isTickerObservation = tickerEntity?.observationOnly === true;

    // Sprint 15 (backtest): INSIDER_CLUSTER SELL → observation mode
    // Backtest: sell clusters hit rate 42.8%, p=0.204, brak edge.
    // BUY clusters (d=0.47, p=0.009) nadal alertują normalnie.
    const isClusterSellObservation =
      pattern.type === 'INSIDER_CLUSTER' && pattern.direction === 'negative';

    // Deduplikacja: sprawdź czy ten wzorzec nie był już alertowany
    const dedupKey = `fired:${ticker}:${pattern.type}`;
    const alreadyFired = await this.redis.get(dedupKey);
    if (alreadyFired) return { action: 'DEDUP_SKIP', ticker, patternType: pattern.type };

    const priority = Math.abs(pattern.correlated_conviction) >= 0.6
      ? 'CRITICAL'
      : 'HIGH';

    const message = this.formatter.formatCorrelatedAlert({
      symbol: ticker,
      patternType: pattern.type,
      patternLabel: PATTERN_LABELS[pattern.type],
      direction: pattern.direction,
      correlatedConviction: pattern.correlated_conviction,
      description: pattern.description,
      signals: pattern.signals.map(s => ({
        sourceCategory: s.source_category,
        catalystType: s.catalyst_type,
        conviction: s.conviction,
      })),
      priority,
    });

    // TASK-01: centralized dispatch via AlertDispatcherService.
    // Sprint 15: INSIDER_CLUSTER SELL → observation (backtest p=0.204 zero edge).
    // Sprint 17: semi supply chain tickery (observationOnly=true) → observation.
    const dispatchResult = this.dispatcher
      ? await this.dispatcher.dispatch({
          ticker,
          ruleName: 'Correlated Signal',
          message,
          isObservationTicker: isTickerObservation,
          isClusterSellObservation,
        })
      : { delivered: false, suppressedBy: 'dispatcher_unavailable', action: 'ALERT_DB_ONLY_DISPATCHER_UNAVAILABLE', ticker, ruleName: 'Correlated Signal', channel: 'db_only' as const };

    const delivered = dispatchResult.delivered;
    const nonDeliveryReason = dispatchResult.suppressedBy;

    // Sprint 11: pobierz cenę w momencie alertu (fix priceAtAlert=NULL)
    let priceAtAlert: number | undefined;
    try {
      if (this.finnhub) {
        priceAtAlert = (await this.finnhub.getQuote(ticker)) ?? undefined;
      }
    } catch { /* noop — cena niedostępna po sesji */ }

    // Zapisz throttle do Redis
    const throttleSec = PATTERN_THROTTLE[pattern.type];
    await this.redis.set(dedupKey, '1', 'EX', throttleSec);

    // Zapisz do tabeli alerts
    await this.alertRepo.save(
      this.alertRepo.create({
        symbol: ticker,
        ruleName: 'Correlated Signal',
        priority,
        channel: 'TELEGRAM',
        message,
        delivered,
        nonDeliveryReason,
        catalystType: pattern.type,
        alertDirection: pattern.direction,
        priceAtAlert,
      }),
    );

    this.logger.log(
      `Correlated alert: ${ticker} ${pattern.type} — ` +
        `conviction=${pattern.correlated_conviction.toFixed(2)} ${pattern.direction}`,
    );

    return { action: dispatchResult.action, ticker, patternType: pattern.type };
  }
}
