import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { SecFiling, InsiderTrade, Ticker, Alert, AlertRule } from '../entities';
import { SentimentModule } from '../sentiment/sentiment.module';
import { TelegramModule } from '../alerts/telegram/telegram.module';
import { CorrelationModule } from '../correlation/correlation.module';
import { Form4Pipeline } from './pipelines/form4.pipeline';
import { Form8kPipeline } from './pipelines/form8k.pipeline';
import { DailyCapService, SEC_FILINGS_REDIS } from './services/daily-cap.service';
import { SecFilingsController } from './sec-filings.controller';

/**
 * Moduł analizy GPT filingów SEC (Form 4 + 8-K).
 *
 * Działa równolegle z istniejącym sec-edgar.service.ts — subskrybuje te same eventy
 * (NEW_FILING, NEW_INSIDER_TRADE) i dodaje analizę GPT z per-typ promptami.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SecFiling, InsiderTrade, Ticker, Alert, AlertRule]),
    SentimentModule,     // AzureOpenaiClientService
    TelegramModule,      // TelegramService, TelegramFormatterService
    CorrelationModule,   // CorrelationService (storeSignal)
  ],
  controllers: [SecFilingsController],
  providers: [
    {
      provide: SEC_FILINGS_REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        return new Redis({
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          keyPrefix: 'secfil:',
        });
      },
    },
    Form4Pipeline,
    Form8kPipeline,
    DailyCapService,
  ],
})
export class SecFilingsModule {}
