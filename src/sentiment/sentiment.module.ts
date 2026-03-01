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
 * - AzureOpenaiClientService — klient Azure OpenAI gpt-4o-mini (2. etap: niuansowa analiza)
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
    AzureOpenaiClientService,
    SentimentListenerService,
    SentimentProcessorService,
  ],
  exports: [FinbertClientService, AzureOpenaiClientService],
})
export class SentimentModule {}
