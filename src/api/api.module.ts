import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertsModule } from '../alerts/alerts.module';
import { CollectorsModule } from '../collectors/collectors.module';
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
import { PriceOutcomeModule } from '../price-outcome/price-outcome.module';
import { AlertsController } from './alerts/alerts.controller';
import { HealthController } from './health/health.controller';
import { SystemStatsService } from './health/system-stats.service';
import { OptionsFlowController } from './options-flow/options-flow.controller';
import { SentimentController } from './sentiment/sentiment.controller';
import { SystemLogsController } from './system-logs/system-logs.controller';
import { TickersController } from './tickers/tickers.controller';

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
