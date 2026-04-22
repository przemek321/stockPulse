import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health/health.controller';
import { TickersController } from './tickers/tickers.controller';
import { SentimentController } from './sentiment/sentiment.controller';
import { AlertsController } from './alerts/alerts.controller';
import { SystemLogsController } from './system-logs/system-logs.controller';
import { OptionsFlowController } from './options-flow/options-flow.controller';
import { SystemStatsService } from './health/system-stats.service';
import {
  Ticker,
  RawMention,
  NewsArticle,
  SecFiling,
  InsiderTrade,
  Alert,
  AlertRule,
  CollectionLog,
  PdufaCatalyst,
  OptionsFlow,
  OptionsVolumeBaseline,
} from '../entities';
import { CollectorsModule } from '../collectors/collectors.module';
import { AlertsModule } from '../alerts/alerts.module';
import { PriceOutcomeModule } from '../price-outcome/price-outcome.module';

/**
 * Moduł REST API.
 * Kontrolery: /api/health, /api/tickers, /api/sentiment, /api/alerts, /api/system-logs, /api/options-flow.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Ticker,
      RawMention,
      NewsArticle,
      SecFiling,
      InsiderTrade,
      Alert,
      AlertRule,
      CollectionLog,
      PdufaCatalyst,
      OptionsFlow,
      OptionsVolumeBaseline,
    ]),
    CollectorsModule,
    AlertsModule,
    PriceOutcomeModule,
  ],
  controllers: [
    HealthController,
    TickersController,
    SentimentController,
    AlertsController,
    SystemLogsController,
    OptionsFlowController,
  ],
  providers: [SystemStatsService],
})
export class ApiModule {}
