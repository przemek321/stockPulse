import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Alert, AlertRule, InsiderTrade, Ticker } from '../entities';
import { AlertEvaluatorService } from './alert-evaluator.service';
import { AlertDeliveryGate } from './alert-delivery-gate.service';
import { AlertDispatcherService } from './alert-dispatcher.service';
import { SummarySchedulerService } from './summary-scheduler.service';
import { TelegramModule } from './telegram/telegram.module';
import { PdufaBioModule } from '../collectors/pdufa-bio/pdufa-bio.module';
import { CorrelationModule } from '../correlation/correlation.module';
import { FinnhubModule } from '../collectors/finnhub/finnhub.module';

/**
 * Moduł alertów.
 * Ewaluacja reguł, throttling, wysyłka przez Telegram.
 * Cykliczny raport systemowy co 8h (alerty, insider trades, PDUFA).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Alert, AlertRule, InsiderTrade, Ticker]),
    PdufaBioModule,
    TelegramModule,
    forwardRef(() => CorrelationModule),
    FinnhubModule,
  ],
  providers: [
    AlertEvaluatorService,
    AlertDeliveryGate,
    AlertDispatcherService,
    SummarySchedulerService,
  ],
  exports: [TelegramModule, AlertEvaluatorService, AlertDeliveryGate, AlertDispatcherService],
})
export class AlertsModule {}
