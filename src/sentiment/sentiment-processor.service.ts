import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../queues/queue-names.const';
import { EventType } from '../events/event-types';
import { SentimentScore } from '../entities/sentiment-score.entity';
import { RawMention } from '../entities/raw-mention.entity';
import { NewsArticle } from '../entities/news-article.entity';
import { FinbertClientService, FinbertResult } from './finbert-client.service';
import {
  AzureOpenaiClientService,
  EnrichedAnalysis,
} from './azure-openai-client.service';
import { PdufaBioService } from '../collectors/pdufa-bio/pdufa-bio.service';
import { AiPipelineLog } from '../entities/ai-pipeline-log.entity';
import { DataSource } from '../common/interfaces/data-source.enum';

/** Minimalna długość tekstu do analizy sentymentu (krótsze = szum) */
const MIN_TEXT_LENGTH = 20;

/**
 * Progi tier-based eskalacji do LLM (2. etap pipeline).
 * Tier 1 (silne): confidence > 0.7 AND absScore > 0.5 → ZAWSZE do AI (złote sygnały)
 * Tier 2 (średnie): confidence > 0.3 AND absScore > 0.2 → do AI jeśli VM aktywna
 * Tier 3 (śmieci): reszta → skip AI, tylko FinBERT
 */
const TIER1_MIN_CONFIDENCE = 0.7;
const TIER1_MIN_ABS_SCORE = 0.5;
const TIER2_MIN_CONFIDENCE = 0.3;
const TIER2_MIN_ABS_SCORE = 0.2;

/** Dane jobu w kolejce sentiment-analysis */
interface SentimentJobData {
  type: 'mention' | 'article';
  entityId: number;
  symbol: string;
  source: DataSource;
}

/**
 * BullMQ processor dla kolejki sentiment-analysis.
 *
 * 2-etapowy pipeline z tier-based eskalacją:
 * 1. FinBERT sidecar — szybka analiza lokalna (GPU)
 * 2. Azure OpenAI gpt-4o-mini — tier-based eskalacja:
 *    - Tier 1 (silne): conf > 0.7 AND absScore > 0.5 → ZAWSZE do AI
 *    - Tier 2 (średnie): conf > 0.3 AND absScore > 0.2 → do AI jeśli VM aktywna
 *    - Tier 3 (śmieci): skip AI, tylko FinBERT
 *
 * Wynik zapisywany do sentiment_scores z opcjonalnym enrichedAnalysis (jsonb).
 */
@Processor(QUEUE_NAMES.SENTIMENT)
export class SentimentProcessorService extends WorkerHost {
  private readonly logger = new Logger(SentimentProcessorService.name);

  constructor(
    private readonly finbert: FinbertClientService,
    private readonly azureOpenai: AzureOpenaiClientService,
    private readonly pdufaBio: PdufaBioService,
    @InjectRepository(SentimentScore)
    private readonly sentimentRepo: Repository<SentimentScore>,
    @InjectRepository(RawMention)
    private readonly mentionRepo: Repository<RawMention>,
    @InjectRepository(NewsArticle)
    private readonly articleRepo: Repository<NewsArticle>,
    @InjectRepository(AiPipelineLog)
    private readonly pipelineLogRepo: Repository<AiPipelineLog>,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super();
  }

  async process(job: Job<SentimentJobData>): Promise<SentimentScore | null> {
    const { type, entityId, symbol, source } = job.data;

    // Inicjalizacja logu pipeline — budowany inkrementalnie
    const pLog = this.pipelineLogRepo.create({
      symbol,
      source,
      entityType: type,
      entityId,
      status: 'SKIPPED_NOT_FOUND',
    });

    try {
      this.logger.debug(
        `Analiza sentymentu: ${symbol} (${type} #${entityId})`,
      );

      // Pobierz tekst do analizy
      const textData = await this.extractText(type, entityId);
      if (!textData) {
        this.logger.warn(`Nie znaleziono ${type} #${entityId} — pomijam`);
        await this.savePipelineLog(pLog);
        return null;
      }

      // Filtruj za krótkie teksty (sam ticker, emoji, "wow" itp.)
      if (textData.text.length < MIN_TEXT_LENGTH) {
        this.logger.debug(
          `Pomijam ${symbol} ${type} #${entityId} — za krótki tekst (${textData.text.length} znaków): "${textData.text}"`,
        );
        pLog.status = 'SKIPPED_SHORT';
        pLog.inputText = textData.text;
        await this.savePipelineLog(pLog);
        return null;
      }

      // 1. etap: FinBERT (szybka analiza lokalna)
      const finbertStart = Date.now();
      const result = await this.finbert.analyze(textData.text);
      pLog.finbertDurationMs = Date.now() - finbertStart;
      pLog.finbertScore = result.score;
      pLog.finbertConfidence = result.confidence;
      pLog.inputText = textData.text.substring(0, 500);

      // 2. etap: Tier-based eskalacja do LLM
      let enrichedAnalysis: EnrichedAnalysis | null = null;
      let finalModel = 'finbert';

      const { tier, reason } = this.classifyTier(result);
      pLog.tier = tier;
      pLog.tierReason = reason;

      const shouldEscalate =
        tier === 1 || (tier === 2 && this.azureOpenai.isEnabled());

      if (shouldEscalate && this.azureOpenai.isEnabled()) {
        this.logger.debug(
          `Eskalacja do LLM (tier ${tier}): ${symbol} — ${reason}`,
        );

        // Pobierz kontekst PDUFA dla tickera (nadchodzące katalizatory FDA)
        let pdufaContext: string | null = null;
        try {
          const catalysts = await this.pdufaBio.getUpcomingCatalysts(symbol);
          if (catalysts.length > 0) {
            pdufaContext = this.pdufaBio.buildPdufaContext(catalysts);
            this.logger.debug(
              `PDUFA context dla ${symbol}: ${catalysts.length} katalizator(ów)`,
            );
          }
        } catch (pdufaErr) {
          this.logger.warn(
            `Błąd pobierania PDUFA context dla ${symbol}: ${pdufaErr instanceof Error ? pdufaErr.message : pdufaErr}`,
          );
        }

        pLog.pdufaContext = pdufaContext;
        pLog.requestPayload = {
          text: textData.text.substring(0, 500),
          symbol,
          escalation_reason: reason,
          ...(pdufaContext ? { pdufa_context: pdufaContext } : {}),
        };

        const azureStart = Date.now();
        enrichedAnalysis = await this.azureOpenai.analyze(
          textData.text.substring(0, 500),
          symbol,
          reason,
          pdufaContext,
          source,
        );
        pLog.azureDurationMs = Date.now() - azureStart;

        if (enrichedAnalysis) {
          finalModel = 'finbert+gpt-4o-mini';
          pLog.status = 'AI_ESCALATED';
          pLog.responsePayload = enrichedAnalysis as any;
          this.logger.debug(
            `Analiza AI ${symbol}: sentiment=${enrichedAnalysis.sentiment}, ` +
              `conviction=${enrichedAnalysis.conviction}, ` +
              `czas=${enrichedAnalysis.processing_time_ms}ms`,
          );
        } else {
          pLog.status = 'AI_FAILED';
          pLog.errorMessage = 'Azure VM zwróciło null (timeout lub błąd parsowania)';
        }
      } else if (shouldEscalate && !this.azureOpenai.isEnabled()) {
        pLog.status = 'AI_DISABLED';
      } else if (tier === 3) {
        pLog.status = 'FINBERT_ONLY';
        this.logger.debug(
          `Skip AI (tier 3): ${symbol} — ${reason}`,
        );
      }

      // Zapisz wynik do sentiment_scores
      const sentimentScore = this.sentimentRepo.create({
        symbol,
        score: result.score,
        confidence: result.confidence,
        source,
        model: finalModel,
        rawText: textData.text.substring(0, 500),
        externalId: textData.externalId,
        enrichedAnalysis,
      });

      const saved = await this.sentimentRepo.save(sentimentScore);
      pLog.sentimentScoreId = saved.id;

      // Aktualizuj sentimentScore w NewsArticle (jeśli to artykuł)
      if (type === 'article') {
        await this.articleRepo.update(entityId, {
          sentimentScore: result.score,
        });
      }

      // Zapisz log pipeline
      await this.savePipelineLog(pLog);

      // Emituj event — AlertEvaluator i inne moduły mogą reagować
      this.eventEmitter.emit(EventType.SENTIMENT_SCORED, {
        scoreId: saved.id,
        symbol,
        score: result.score,
        confidence: result.confidence,
        label: result.label,
        source,
        model: finalModel,
        conviction: enrichedAnalysis?.conviction ?? null,
        enrichedAnalysis: enrichedAnalysis ?? null,
      });

      this.logger.debug(
        `Sentyment ${symbol}: ${result.score.toFixed(3)} ` +
          `(${result.label}, confidence: ${result.confidence.toFixed(3)}, model: ${finalModel})`,
      );

      return saved;
    } catch (err) {
      pLog.status = 'ERROR';
      pLog.errorMessage = err instanceof Error ? err.message : String(err);
      await this.savePipelineLog(pLog);
      throw err;
    }
  }

  /** Zapisuje log pipeline — błąd zapisu nie blokuje pipeline */
  private async savePipelineLog(pLog: AiPipelineLog): Promise<void> {
    try {
      await this.pipelineLogRepo.save(pLog);
    } catch (err) {
      this.logger.warn(
        `Błąd zapisu pipeline log: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * Klasyfikuje wynik FinBERT do jednego z 3 tierów eskalacji.
   * Tier 1: silne sygnały (złote) — ZAWSZE do AI
   * Tier 2: średnie — do AI jeśli VM aktywna
   * Tier 3: śmieci — skip AI
   */
  private classifyTier(
    result: FinbertResult,
  ): { tier: 1 | 2 | 3; reason: string } {
    const absScore = Math.abs(result.score);

    if (
      result.confidence > TIER1_MIN_CONFIDENCE &&
      absScore > TIER1_MIN_ABS_SCORE
    ) {
      return {
        tier: 1,
        reason: `strong_signal (confidence=${result.confidence.toFixed(3)}, absScore=${absScore.toFixed(3)})`,
      };
    }

    if (
      result.confidence > TIER2_MIN_CONFIDENCE &&
      absScore > TIER2_MIN_ABS_SCORE
    ) {
      return {
        tier: 2,
        reason: `medium_signal (confidence=${result.confidence.toFixed(3)}, absScore=${absScore.toFixed(3)})`,
      };
    }

    return {
      tier: 3,
      reason: `junk (confidence=${result.confidence.toFixed(3)}, absScore=${absScore.toFixed(3)})`,
    };
  }

  /**
   * Wyciąga tekst do analizy z RawMention lub NewsArticle.
   */
  private async extractText(
    type: 'mention' | 'article',
    entityId: number,
  ): Promise<{ text: string; externalId: string } | null> {
    if (type === 'mention') {
      const mention = await this.mentionRepo.findOne({
        where: { id: entityId },
      });
      if (!mention) return null;

      // Łączymy tytuł i body — tytuł często zawiera więcej kontekstu
      const text = [mention.title, mention.body]
        .filter(Boolean)
        .join('. ')
        .trim();

      return { text, externalId: mention.externalId };
    }

    if (type === 'article') {
      const article = await this.articleRepo.findOne({
        where: { id: entityId },
      });
      if (!article) return null;

      // Headline + summary dają pełny kontekst
      const text = [article.headline, article.summary]
        .filter(Boolean)
        .join('. ')
        .trim();

      return { text, externalId: article.url };
    }

    return null;
  }
}
