import { Module } from '@nestjs/common';
import { AgentsModule } from './agents/agents.module';
import { AlertsModule } from './alerts/alerts.module';
import { ApiModule } from './api/api.module';
import { CollectorsModule } from './collectors/collectors.module';
import { ConfigModule } from './config/config.module';
import { CorrelationModule } from './correlation/correlation.module';
import { DatabaseModule } from './database/database.module';
import { EventsModule } from './events/events.module';
import { OptionsFlowModule } from './options-flow/options-flow.module';
import { PriceOutcomeModule } from './price-outcome/price-outcome.module';
import { QueuesModule } from './queues/queues.module';
import { SecFilingsModule } from './sec-filings/sec-filings.module';
import { SentimentModule } from './sentiment/sentiment.module';
import { SystemLogModule } from './system-log/system-log.module';

/**
 * Główny moduł aplikacji StockPulse.
 * Wszystkie podmoduły: konfiguracja, baza danych, eventy, kolejki, kolektory,
 * sentyment, SEC filings GPT, korelacja sygnałów, options flow, alerty, logi systemowe, API.
 */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    SystemLogModule,
    EventsModule,
    QueuesModule,
    CollectorsModule,
    SentimentModule,
    SecFilingsModule,
    CorrelationModule,
    OptionsFlowModule,
    AlertsModule,
    PriceOutcomeModule,
    AgentsModule,
    ApiModule,
  ],
})
export class AppModule {}
