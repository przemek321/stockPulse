import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/** Injection token dla instancji Redis (Form4DiscoveryService) */
export const DISCOVERY_REDIS = 'DISCOVERY_REDIS';

/**
 * Provider Redis dla discovery (Pakiet 2) — wzorzec z correlation/redis.provider.ts.
 * Namespace 'disc:' dla separacji kluczy: seen:{accession} (TTL 7d, dedup
 * poll↔reconciliation) + sic:{cik} (TTL 30d, cache submissions JSON).
 */
export const discoveryRedisProvider: Provider = {
  provide: DISCOVERY_REDIS,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    return new Redis({
      host: config.get<string>('REDIS_HOST', 'localhost'),
      port: config.get<number>('REDIS_PORT', 6379),
      password: config.get<string>('REDIS_PASSWORD') || undefined,
      keyPrefix: 'disc:',
    });
  },
};
