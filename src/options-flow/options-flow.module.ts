import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertsModule } from '../alerts/alerts.module';
import { TelegramModule } from '../alerts/telegram/telegram.module';
import { CollectorsModule } from '../collectors/collectors.module';
import { CorrelationModule } from '../correlation/correlation.module';
import {
  OptionsFlow,
  Alert,
  AlertRule,
  PdufaCatalyst,
  Ticker,
} from '../entities';
import { OptionsFlowAlertService } from './options-flow-alert.service';
import { OptionsFlowScoringService } from './options-flow-scoring.service';

/**
 * Moduł scoringu i alertów options flow.
 * Reaguje na NEW_OPTIONS_FLOW → scoring → correlation → Telegram.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([OptionsFlow, Alert, AlertRule, PdufaCatalyst, Ticker]),
    TelegramModule,
    CorrelationModule,
    CollectorsModule,
    forwardRef(() => AlertsModule), // TASK-01: AlertDispatcherService
  ],
  providers: [OptionsFlowScoringService, OptionsFlowAlertService],
  exports: [OptionsFlowScoringService],
})
export class OptionsFlowModule {}
