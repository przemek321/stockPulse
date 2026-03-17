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

/**
 * Moduł scoringu i alertów options flow.
 * Reaguje na NEW_OPTIONS_FLOW → scoring → correlation → Telegram.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([OptionsFlow, Alert, AlertRule, PdufaCatalyst]),
  ],
  providers: [OptionsFlowScoringService, OptionsFlowAlertService],
  exports: [OptionsFlowScoringService],
})
export class OptionsFlowModule {}
