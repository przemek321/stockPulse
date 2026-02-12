import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { ALL_QUEUE_NAMES } from './queue-names.const';

/**
 * Moduł kolejek BullMQ.
 * Rejestruje połączenie do Redis i wszystkie kolejki zdefiniowane w QUEUE_NAMES.
 *
 * Kolejki służą do:
 * - Planowania cyklicznego zbierania danych (cron → job)
 * - Przetwarzania zebranych danych (sentyment, alerty)
 * - Retry przy błędach (domyślnie 3 próby z exponential backoff)
 */
@Module({
  imports: [
    // Globalna konfiguracja połączenia Redis dla BullMQ
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: {
            count: 100, // Zachowaj ostatnie 100 zakończonych jobów
          },
          removeOnFail: {
            count: 500, // Zachowaj ostatnie 500 błędnych jobów (do debugowania)
          },
        },
      }),
    }),

    // Rejestracja wszystkich kolejek
    ...ALL_QUEUE_NAMES.map((name) =>
      BullModule.registerQueue({ name }),
    ),
  ],
  exports: [BullModule],
})
export class QueuesModule {}
