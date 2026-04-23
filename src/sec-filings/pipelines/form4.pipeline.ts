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
import { FinnhubService } from '../../collectors/finnhub/finnhub.service';
import { TickerProfileService } from '../../ticker-profile/ticker-profile.service';
import { AlertDeliveryGate } from '../../alerts/alert-delivery-gate.service';
import { AlertDispatcherService, buildDispatcherUnavailableFallback } from '../../alerts/alert-dispatcher.service';
import { Logged } from '../../common/decorators/logged.decorator';

/**
 * C-suite whitelist dla boost decyzji (Form4Pipeline + testy jednostkowe).
 * Sprint 16b: zastąpiło broad /\bChief\b/i które matchowało soft roles
 * (Chief Communications/People/Diversity/Marketing/Sustainability Officer —
 * PR/IR/HR bez insider info o finansach firmy).
 *
 * Włączone: Executive/Financial/Operating/Technology/Information/Medical/
 * Scientific/Legal/Accounting Officers, akronimy (CEO/CFO/COO/CTO/CIO/CMO/
 * CSO/CLO), President/Chairman/Vice Chairman, EVP z Finance/Operations/
 * Product/Strategy context, Principal Financial/Accounting Officers.
 *
 * CMO: tu = Chief Medical Officer (krytyczny dla healthcare universe).
 * Chief Marketing Officer explicit wyłączony — decyzja Przemka 17.04.
 */
export const C_SUITE_PATTERNS: readonly RegExp[] = [
  /\bChief\s+(Executive|Financial|Operating|Technology|Information|Medical|Scientific|Legal|Accounting)\s+Officer\b/i,
  /\b(CEO|CFO|COO|CTO|CIO|CMO|CSO|CLO)\b/i,
  // "President" z negative lookbehind — wyklucza "Vice President" / "Senior Vice President" / "Executive Vice President"
  /(?<!Vice\s)(?<!Senior\s)\bPresident\b/i,
  // Chair(man|woman|person) — gender-neutral warianty; stary broad regex `\bChair` w hasCsuite
  // też je łapał, więc ekspansja zamyka TASK-10 bez regresji dla Chairwoman/Chairperson of the Board.
  /\bChair(man|woman|person)\b/i,
  /\bVice\s+Chair(man|woman|person)\b/i,
  /\b(?:EVP|Executive\s+Vice\s+President)[\s,]+.*?(Finance|Operations?|Product|Strategy)\b/i,
  /\bPrincipal\s+(Financial|Accounting)\s+Officer\b/i,
];

export function isCsuiteRole(role: string | null | undefined, name?: string): boolean {
  const target = role ?? '';
  return C_SUITE_PATTERNS.some(p => p.test(target) || (name ? p.test(name) : false));
}

/**
 * Director check dla TASK-02 hard skip gate (non-role SELL).
 * Wychwytuje każdą rolę zawierającą słowo "Director" (Director, Independent Director,
 * Chairman of the Board & Director, Director Emeritus etc.).
 *
 * Nota: "pure Director" w kroku 3 decision tree = Director bez C-suite w tym samym
 * filingu (co-filing Director+CEO NIE jest pure Director — C-suite priorytet).
 * isDirectorRole() samo nie rozróżnia pure vs mixed; ta logika zostaje inline
 * w onInsiderTrade: `isPureDirector = isDirectorRole(role) && !isCsuiteRole(role)`.
 * Od TASK-10 (23.04.2026) używamy tej samej isCsuiteRole whitelist dla obu gate'ów
 * (krok 3 pure Director SELL + krok 4 non-role SELL + krok 7 BUY boost).
 */
export function isDirectorRole(role: string | null | undefined): boolean {
  const target = role ?? '';
  return /\bDirector\b/i.test(target);
}

/**
 * Pipeline analizy GPT dla transakcji insiderskich (Form 4).
 *
 * Nasłuchuje event NEW_INSIDER_TRADE (jedyny listener po Sprint 16b #3 — AlertEvaluator.onInsiderTrade usunięty).
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
    @Optional() private readonly finnhub?: FinnhubService,
    @Optional() private readonly tickerProfile?: TickerProfileService,
    @Optional() private readonly deliveryGate?: AlertDeliveryGate,
    @Optional() private readonly dispatcher?: AlertDispatcherService,
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
    traceId?: string;
    parentTraceId?: string;
    /** TASK-03: multi-transaction Form 4 grouping. Primary trade (najniższy id w filingu)
     *  dostaje aggregate z całej grupy (insiderName, transactionType, is10b51Plan).
     *  totalValue/shares w payloadzie to już suma. aggregateTradeIds to wszystkie siblings
     *  z tego filing'u włącznie z primary. */
    aggregateCount?: number;
    aggregateTradeIds?: number[];
  }): Promise<{ action: string; symbol: string; traceId?: string }> {
    // Decision tree (post Sprint 18 TASK-02 + TASK-03, 2026-04-22):
    //
    // TASK-03 (aggregation): gdy collector wykryje multi-transaction Form 4 (N fills tego
    // samego insidera, tego samego typu BUY/SELL w jednym filingu), emituje JEDEN event
    // z primary tradeId + aggregateCount + aggregateTradeIds + zsumowanym totalValue/shares.
    // Pipeline używa tych aggregate values w GPT prompt i telegram message. Siblings są
    // zapisane w DB (historia), ale nie generują osobnych eventów.
    //
    //   1. transactionType in {BUY, SELL} & totalValue >= $100K? else SKIP_*
    //   2. is10b51Plan?                                          → SKIP_10B51_PLAN
    //   3. Pure Director + SELL?                                 → SKIP_DIRECTOR_SELL
    //                                                              (Sprint 15 backtest: anty-sygnał)
    //   4. SELL AND !C-suite AND !Director?                      → SKIP_NON_ROLE_SELL  [TASK-02]
    //                                                              V4 C-suite SELL d≈0 → non-role
    //                                                              SELL tym bardziej. PRZED daily
    //                                                              cap + observation gate: oszczędza
    //                                                              GPT call, blokuje fałszywy
    //                                                              correlation alert przez observation
    //                                                              path (ASX 22.04: GM $152M SELL
    //                                                              → INSIDER_PLUS_OPTIONS fałszywy
    //                                                              CRITICAL w portalu).
    //   5. Daily cap (max 20 GPT/ticker/day)?                    → SKIP_DAILY_CAP
    //   6. GPT analysis + priority scoring
    //   7. Rule boosts (C-suite BUY ×1.3, Dir BUY ×1.15, healthcare BUY ×1.2)
    //   8. AlertDispatcherService.dispatch() (TASK-01):
    //        observation > sell_no_edge > csuite_sell > cluster_sell > silent > daily_limit
    //   9. CorrelationService.storeSignal() + schedulePatternCheck()

    // Filtruj: tylko BUY/SELL > $100K
    if (!payload.totalValue || payload.totalValue < 100_000) {
      return { action: 'SKIP_LOW_VALUE', symbol: payload.symbol, traceId: payload.traceId };
    }
    const ALERTABLE = ['BUY', 'SELL'];
    if (payload.transactionType && !ALERTABLE.includes(payload.transactionType)) {
      return { action: 'SKIP_NOT_ALERTABLE', symbol: payload.symbol, traceId: payload.traceId };
    }

    // Sprint 11: wyfiltruj planowe transakcje 10b5-1 (szum, nie realny sygnał insiderski)
    if (payload.is10b51Plan === true) {
      this.logger.debug(`Form4: ${payload.symbol} ${payload.insiderName} — SKIP 10b5-1 plan`);
      return { action: 'SKIP_10B51_PLAN', symbol: payload.symbol, traceId: payload.traceId };
    }

    // Sprint 15 (backtest): Director SELL = anty-sygnał (68% cena rośnie po SELL).
    // Sprint 16 FLAG #30 fix: pure Director only — co-filing Director+CEO nie jest skipowany
    // (C-suite decision-making obecne, nie traktujemy jako anti-signal).
    // TASK-10 (23.04.2026): stary broad regex `/\bCEO|CFO|COO|CTO|President|Chair|Chief\b/i`
    // zastąpiony przez isCsuiteRole() — ta sama whitelist co linia 325 i kroku 4 SELL (kroki
    // decision tree 3/4/7 używają identycznej definicji C-suite). Broad regex łapał
    // Chief Marketing/Communications/Sustainability Officer (soft roles Sprint 16b excluded)
    // oraz "Vice President" (nie ma negative lookbehind) — tu traktujemy ich co-filing jako
    // pure Director SELL, bo C-suite *decision-making* musi być realny (whitelist-backed).
    const role = payload.insiderRole ?? '';
    const isDirector = isDirectorRole(role);
    const hasCsuite = isCsuiteRole(role);
    const isPureDirector = isDirector && !hasCsuite;
    if (isPureDirector && payload.transactionType === 'SELL') {
      this.logger.debug(`Form4: ${payload.symbol} ${payload.insiderName} — SKIP pure Director SELL (anty-sygnał)`);
      return { action: 'SKIP_DIRECTOR_SELL', symbol: payload.symbol, traceId: payload.traceId };
    }

    // TASK-02 (22.04.2026): hard skip dla non-C-suite, non-Director SELL.
    // V4 backtest H2 SINGLE_CSUITE all_sells N=855 d=-0.002 p=0.95 (zero edge dla C-suite SELL).
    // Non-C-suite SELL (VP, GM, Officer-without-Chief-prefix) ma mniej insider info niż C-suite,
    // więc tym bardziej nie ma edge'u. Hard skip PRZED daily cap i observation gate:
    //  - oszczędza GPT call (daily cap max 20/ticker/day),
    //  - blokuje fałszywy correlation alert generowany przez ścieżkę observation
    //    (ASX 22.04: GM "ASE Inc. Chung-Li Branch" SELL $152M → observation save →
    //     correlation INSIDER_PLUS_OPTIONS → fałszywy CRITICAL -0.70 w portalu).
    // 10% Owner też trafia tu (żadna hipoteza H1-H6 nie testowała — zostaje w skip).
    if (
      payload.transactionType === 'SELL' &&
      !isCsuiteRole(role, payload.insiderName) &&
      !isDirector
    ) {
      this.logger.debug(
        `Form4: ${payload.symbol} ${payload.insiderName} (${role || 'brak roli'}) — SKIP_NON_ROLE_SELL`,
      );
      return { action: 'SKIP_NON_ROLE_SELL', symbol: payload.symbol, traceId: payload.traceId };
    }

    // Sprawdź daily cap
    if (!(await this.dailyCap.canCallGpt(payload.symbol))) {
      return { action: 'SKIP_DAILY_CAP', symbol: payload.symbol, traceId: payload.traceId };
    }

    try {
      // Pobierz trade z bazy (potrzebujemy pełne dane)
      const trade = await this.tradeRepo.findOne({ where: { id: payload.tradeId } });
      if (!trade) return { action: 'SKIP_NOT_FOUND', symbol: payload.symbol, traceId: payload.traceId };

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

      // TASK-03: dla multi-transaction Form 4 używamy aggregate values z payloadu
      // (collector już zsumował grupę). Single-trade filings: aggregate fields pominięte
      // w payloadzie → używamy wartości primary trade (backward compat).
      const isAggregate = (payload.aggregateCount ?? 1) > 1;
      const siblingIds = new Set<number>(payload.aggregateTradeIds ?? [trade.id]);
      const effectiveShares = isAggregate ? (payload.shares ?? Number(trade.shares)) : Number(trade.shares);
      const effectiveValue = isAggregate ? (payload.totalValue ?? Number(trade.totalValue)) : Number(trade.totalValue);
      // Dla aggregate pricePerShare = avg ważone wolumenem; dla single = oryginalna cena.
      const effectivePricePerShare = isAggregate && effectiveShares > 0
        ? effectiveValue / effectiveShares
        : (trade.pricePerShare ? Number(trade.pricePerShare) : null);

      // Buduj dane do promptu
      const parsed: Form4PromptData = {
        insiderName: trade.insiderName,
        insiderRole: trade.insiderRole,
        transactionType: trade.transactionType,
        shares: effectiveShares,
        pricePerShare: effectivePricePerShare,
        totalValue: effectiveValue,
        sharesOwnedAfter: trade.sharesOwnedAfter ? Number(trade.sharesOwnedAfter) : null,
        is10b51Plan: trade.is10b51Plan ?? false,
        transactionDate: trade.transactionDate?.toISOString?.() ?? '',
        aggregateCount: payload.aggregateCount,
      };

      // Historia: wykluczamy siblings z tego samego filing'u (są już zsumowane w parsed)
      const recentFilings: Form4PromptData[] = recentTrades
        .filter(t => !siblingIds.has(t.id))
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

      // Pobierz profil historyczny tickera (kontekst kalibrujący conviction)
      const signalProfile = await this.tickerProfile?.getSignalProfile(payload.symbol) ?? null;

      // Buduj prompt i wyślij do Claude
      const prompt = buildForm4Prompt(payload.symbol, companyName, parsed, recentFilings, signalProfile);
      const rawResponse = await this.azureOpenai.analyzeCustomPrompt(prompt);
      if (!rawResponse) return { action: 'SKIP_VM_OFFLINE', symbol: payload.symbol, traceId: payload.traceId };

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
          return { action: 'SKIP_INVALID_JSON', symbol: payload.symbol, traceId: payload.traceId };
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
        if (!filing) {
          this.logger.warn(`Form4: filing not found for accession ${baseAccession} — GPT analysis not persisted`);
        } else if (!filing.gptAnalysis) {
          filing.gptAnalysis = analysis as any;
          filing.priceImpactDirection = analysis.price_impact.direction;
          await this.filingRepo.save(filing);
        }
      }

      const isCsuite = isCsuiteRole(parsed.insiderRole, parsed.insiderName);
      const isBuy = parsed.transactionType === 'BUY';

      // BUY conviction boosty — backtest-backed (Sprint 15 + V4 calibration):
      // C-suite BUY:  d=0.83 (V4) — primary boost ×1.3
      // Director BUY: d=0.59 (V4) — secondary boost ×1.15 (added Sprint 17)
      // Healthcare BUY: d=0.58 — sector boost ×1.2 (kumulatywne z rolą)
      // Priorytet: C-suite > Director (albo/albo, nie stack w co-filing bo Dir już objęty przez hasCsuite check).
      if (isBuy) {
        if (isCsuite) {
          analysis.conviction *= 1.3;
          this.logger.debug(`Form4 BUY boost: ${payload.symbol} C-suite ×1.3 → conviction=${analysis.conviction.toFixed(2)}`);
        } else if (isDirector) {
          analysis.conviction *= 1.15;
          this.logger.debug(`Form4 BUY boost: ${payload.symbol} Director ×1.15 → conviction=${analysis.conviction.toFixed(2)}`);
        }
        // Healthcare boost: tylko dla sektora healthcare (nie semi supply chain)
        if (ticker?.sector === 'healthcare') {
          analysis.conviction *= 1.2;
          this.logger.debug(`Form4 BUY boost: ${payload.symbol} healthcare ×1.2 → conviction=${analysis.conviction.toFixed(2)}`);
        }
      }

      // Oblicz priorytet alertu
      let priority = scoreToAlertPriority(analysis, 'Form4');

      // C-suite boost: podnieś priorytet jeśli discretionary C-suite
      if (isCsuite && priority === 'MEDIUM') priority = 'HIGH';
      if (isCsuite && !priority) priority = 'HIGH';

      if (!priority) {
        this.logger.debug(`Form4 GPT: ${payload.symbol} — brak alertu (low priority, non-C-suite)`);
        return { action: 'SKIP_LOW_PRIORITY', symbol: payload.symbol, traceId: payload.traceId };
      }

      // Sprawdź regułę — BUY ma osobną regułę (Sprint 15, backtest-backed)
      const ruleName = isBuy ? 'Form 4 Insider BUY' : mapToRuleName(analysis, 'Form4');
      const rule = await this.ruleRepo.findOne({
        where: { name: ruleName, isActive: true },
      });
      if (!rule) return { action: 'SKIP_NO_RULE', symbol: payload.symbol, traceId: payload.traceId };

      const isThrottled = await this.checkThrottled(
        rule.name, payload.symbol, rule.throttleMinutes, analysis.catalyst_type,
      );
      if (isThrottled) return { action: 'THROTTLED', symbol: payload.symbol, traceId: payload.traceId };

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

      // TASK-01: centralized dispatch via AlertDispatcherService.
      // isObservationTicker: Sprint 17 semi supply chain.
      // isSellNoEdge: Sprint 17 V4 backtest — wszystkie discretionary SELL zero edge (H2 d≈0).
      //   Produkcja 17.04: 3 C-suite SELL Telegram (GILD×2, DXCM) — noise eliminated.
      //   BUY zostaje: V4 C-suite BUY 7d d=+0.82 ✓✓✓, BUY >$500K d=+0.83 ✓✓✓.
      const dispatchResult = this.dispatcher
        ? await this.dispatcher.dispatch({
            ticker: payload.symbol,
            ruleName: rule.name,
            traceId: payload.traceId,
            parentTraceId: payload.parentTraceId,
            message,
            isObservationTicker: ticker?.observationOnly === true,
            isSellNoEdge: !isBuy,
          })
        : buildDispatcherUnavailableFallback({ ticker: payload.symbol, ruleName: rule.name, traceId: payload.traceId });

      const delivered = dispatchResult.delivered;
      const nonDeliveryReason = dispatchResult.suppressedBy;

      // Sprint 11: pobierz cenę w momencie alertu (fix priceAtAlert=NULL)
      let priceAtAlert: number | undefined;
      try {
        if (this.finnhub) {
          priceAtAlert = (await this.finnhub.getQuote(payload.symbol)) ?? undefined;
        }
      } catch { /* noop — cena niedostępna po sesji */ }

      try {
        await this.alertRepo.save(
          this.alertRepo.create({
            symbol: payload.symbol,
            ruleName: rule.name,
            priority,
            channel: 'TELEGRAM',
            message,
            delivered,
            nonDeliveryReason,
            catalystType: analysis.catalyst_type,
            alertDirection: analysis.price_impact.direction === 'neutral'
              ? (analysis.conviction >= 0 ? 'positive' : 'negative')
              : analysis.price_impact.direction,
            priceAtAlert,
          }),
        );
      } catch (err) {
        this.logger.error(`Failed to save Form4 alert for ${payload.symbol}: ${err.message}`);
      }

      this.logger.log(
        `Form4 GPT alert: ${payload.symbol} ${parsed.insiderName}` +
          (isAggregate ? ` [×${payload.aggregateCount} fills]` : '') +
          ` — ${analysis.price_impact.direction}/${analysis.price_impact.magnitude} ` +
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

      return { action: dispatchResult.action, symbol: payload.symbol, traceId: payload.traceId };
    } catch (err) {
      this.logger.error(`Form4 Pipeline error ${payload.symbol}: ${err.message}`);
      return { action: 'ERROR', symbol: payload.symbol, traceId: payload.traceId };
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
