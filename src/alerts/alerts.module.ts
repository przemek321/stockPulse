import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Alert, AlertRule, SentimentScore, Ticker } from '../entities';
import { AlertEvaluatorService } from './alert-evaluator.service';
import { SummarySchedulerService } from './summary-scheduler.service';
import { TelegramService } from './telegram/telegram.service';
import { TelegramFormatterService } from './telegram/telegram-formatter.service';
import { PdufaBioModule } from '../collectors/pdufa-bio/pdufa-bio.module';

/**
 * Moduł alertów.
 * Ewaluacja reguł, throttling, wysyłka przez Telegram.
 * Cykliczny raport sentymentu co 2h (z sekcją PDUFA).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Alert, AlertRule, SentimentScore, Ticker]),
    PdufaBioModule,
  ],
  providers: [
    AlertEvaluatorService,
    SummarySchedulerService,
    TelegramService,
    TelegramFormatterService,
  ],
  exports: [TelegramService, AlertEvaluatorService],
})
export class AlertsModule {}
