import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health/health.controller';
import { TickersController } from './tickers/tickers.controller';
import { SentimentController } from './sentiment/sentiment.controller';
import { AlertsController } from './alerts/alerts.controller';
import {
  Ticker,
  SentimentScore,
  RawMention,
  NewsArticle,
  SecFiling,
  InsiderTrade,
  Alert,
  AlertRule,
  CollectionLog,
  PdufaCatalyst,
  AiPipelineLog,
} from '../entities';
import { CollectorsModule } from '../collectors/collectors.module';
import { AlertsModule } from '../alerts/alerts.module';

/**
 * Moduł REST API.
 * Kontrolery: /api/health, /api/tickers, /api/sentiment, /api/alerts.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Ticker,
      SentimentScore,
      RawMention,
      NewsArticle,
      SecFiling,
      InsiderTrade,
      Alert,
      AlertRule,
      CollectionLog,
      PdufaCatalyst,
      AiPipelineLog,
    ]),
    CollectorsModule,
    AlertsModule,
  ],
  controllers: [
    HealthController,
    TickersController,
    SentimentController,
    AlertsController,
  ],
})
export class ApiModule {}
