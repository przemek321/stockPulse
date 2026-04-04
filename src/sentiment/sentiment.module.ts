import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../queues/queue-names.const';
import { SentimentScore } from '../entities/sentiment-score.entity';
import { RawMention } from '../entities/raw-mention.entity';
import { NewsArticle } from '../entities/news-article.entity';
import { AiPipelineLog } from '../entities/ai-pipeline-log.entity';
import { FinbertClientService } from './finbert-client.service';
import { AzureOpenaiClientService } from './azure-openai-client.service';
import { AnthropicClientService } from './anthropic-client.service';
import { SentimentListenerService } from './sentiment-listener.service';
import { SentimentProcessorService } from './sentiment-processor.service';
import { PdufaBioModule } from '../collectors/pdufa-bio/pdufa-bio.module';

/**
 * Moduł analizy sentymentu.
 *
 * 2-etapowy pipeline: event z kolektora → BullMQ → FinBERT sidecar → [eskalacja LLM] → zapis do bazy.
 *
 * Serwisy:
 * - FinbertClientService — HTTP klient do FinBERT sidecar (1. etap: szybka analiza)
 * - AnthropicClientService — klient Anthropic Claude Sonnet (2. etap: niuansowa analiza)
 * - AzureOpenaiClientService — alias → AnthropicClientService (backward compatible)
 * - SentimentListenerService — nasłuchuje eventów NEW_MENTION/NEW_ARTICLE
 * - SentimentProcessorService — BullMQ processor kolejki sentiment-analysis
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SentimentScore, RawMention, NewsArticle, AiPipelineLog]),
    BullModule.registerQueue({ name: QUEUE_NAMES.SENTIMENT }),
    PdufaBioModule,
  ],
  providers: [
    FinbertClientService,
    AnthropicClientService,
    // Provider alias: kto wstrzykuje AzureOpenaiClientService, dostaje AnthropicClientService.
    // Dzięki temu Form4Pipeline, Form8kPipeline i SentimentProcessorService
    // nie wymagają żadnych zmian — inject po typie działa transparentnie.
    // Rollback: zamień useExisting na useClass: AzureOpenaiClientService
    {
      provide: AzureOpenaiClientService,
      useExisting: AnthropicClientService,
    },
    SentimentListenerService,
    SentimentProcessorService,
  ],
  exports: [FinbertClientService, AzureOpenaiClientService],
})
export class SentimentModule {}
