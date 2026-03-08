import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/** Injection token dla instancji Redis (CorrelationService) */
export const CORRELATION_REDIS = 'CORRELATION_REDIS';

/**
 * Provider Redis dla CorrelationService.
 * Osobna instancja od BullMQ — namespace 'corr:' dla separacji kluczy.
 */
export const correlationRedisProvider: Provider = {
  provide: CORRELATION_REDIS,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    return new Redis({
      host: config.get<string>('REDIS_HOST', 'localhost'),
      port: config.get<number>('REDIS_PORT', 6379),
      keyPrefix: 'corr:',
    });
  },
};
