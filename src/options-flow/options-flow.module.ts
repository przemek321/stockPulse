import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OptionsFlowScoringService } from './options-flow-scoring.service';
import { OptionsFlowAlertService } from './options-flow-alert.service';
import {
  OptionsFlow,
  Alert,
  AlertRule,
  PdufaCatalyst,
} from '../entities';
import { TelegramModule } from '../alerts/telegram/telegram.module';
import { CorrelationModule } from '../correlation/correlation.module';
import { CollectorsModule } from '../collectors/collectors.module';

/**
 * Moduł scoringu i alertów options flow.
 * Reaguje na NEW_OPTIONS_FLOW → scoring → correlation → Telegram.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([OptionsFlow, Alert, AlertRule, PdufaCatalyst]),
    TelegramModule,
    CorrelationModule,
    CollectorsModule,
  ],
  providers: [OptionsFlowScoringService, OptionsFlowAlertService],
  exports: [OptionsFlowScoringService],
})
export class OptionsFlowModule {}
