import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Alert, AlertRule } from '../entities';
import { TelegramModule } from '../alerts/telegram/telegram.module';
import { FinnhubModule } from '../collectors/finnhub/finnhub.module';
import { correlationRedisProvider } from './redis.provider';
import { CorrelationService } from './correlation.service';

/**
 * Moduł korelacji sygnałów — wykrywa wzorce między źródłami
 * (insider + 8-K, news potwierdzone filingiem, klaster insiderów itd.)
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Alert, AlertRule]),
    TelegramModule,
    FinnhubModule,       // Sprint 11: priceAtAlert dla Correlated Signal alertów
  ],
  providers: [
    correlationRedisProvider,
    CorrelationService,
  ],
  exports: [CorrelationService],
})
export class CorrelationModule {}
