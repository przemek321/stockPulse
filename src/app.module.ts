import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { EventsModule } from './events/events.module';

/**
 * Główny moduł aplikacji StockPulse.
 * Importuje wszystkie podmoduły — konfiguracja, baza danych, eventy.
 */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    EventsModule,
  ],
})
export class AppModule {}
