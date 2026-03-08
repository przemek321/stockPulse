import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Alert } from '../entities';
import { FinnhubModule } from '../collectors/finnhub/finnhub.module';
import { PriceOutcomeService } from './price-outcome.service';

/**
 * Moduł Price Outcome Tracker.
 * CRON co godzinę uzupełnia ceny akcji po alertach (1h/4h/1d/3d).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Alert]),
    FinnhubModule,
  ],
  providers: [PriceOutcomeService],
})
export class PriceOutcomeModule {}
