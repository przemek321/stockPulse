import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { EventsModule } from './events/events.module';
import { QueuesModule } from './queues/queues.module';
import { CollectorsModule } from './collectors/collectors.module';
import { AlertsModule } from './alerts/alerts.module';
import { SentimentModule } from './sentiment/sentiment.module';
import { SecFilingsModule } from './sec-filings/sec-filings.module';
import { CorrelationModule } from './correlation/correlation.module';
import { ApiModule } from './api/api.module';

/**
 * Główny moduł aplikacji StockPulse.
 * Wszystkie podmoduły: konfiguracja, baza danych, eventy, kolejki, kolektory,
 * sentyment, SEC filings GPT, korelacja sygnałów, alerty, API.
 */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    EventsModule,
    QueuesModule,
    CollectorsModule,
    SentimentModule,
    SecFilingsModule,
    CorrelationModule,
    AlertsModule,
    ApiModule,
  ],
})
export class AppModule {}
