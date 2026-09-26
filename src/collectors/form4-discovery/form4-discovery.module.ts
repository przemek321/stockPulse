import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelegramModule } from '../../alerts/telegram/telegram.module';
import { SecFiling, Ticker } from '../../entities';
import { QUEUE_NAMES } from '../../queues/queue-names.const';
import { FinnhubModule } from '../finnhub/finnhub.module';
import { SecEdgarModule } from '../sec-edgar/sec-edgar.module';
import { Form4DiscoveryProcessor } from './form4-discovery.processor';
import { Form4DiscoveryScheduler } from './form4-discovery.scheduler';
import { Form4DiscoveryService } from './form4-discovery.service';
import { discoveryRedisProvider } from './redis.provider';

/**
 * Moduł discovery Form 4 sector-wide (Pakiet 2, 10.06.2026).
 * Event-driven screening wszystkich Form 4 z EDGAR → pre-filter → auto-rejestracja
 * healthcare/biotech tickerów w observation mode.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SecFiling, Ticker]),
    BullModule.registerQueue({ name: QUEUE_NAMES.FORM4_DISCOVERY }),
    SecEdgarModule,
    FinnhubModule,
    TelegramModule,
  ],
  providers: [
    discoveryRedisProvider,
    Form4DiscoveryService,
    Form4DiscoveryProcessor,
    Form4DiscoveryScheduler,
  ],
  exports: [Form4DiscoveryService],
})
export class Form4DiscoveryModule {}
