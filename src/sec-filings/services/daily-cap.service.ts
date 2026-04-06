import { Injectable, Logger, Inject } from '@nestjs/common';
import Redis from 'ioredis';

/** Injection token dla instancji Redis (SEC filings) */
export const SEC_FILINGS_REDIS = 'SEC_FILINGS_REDIS';

/** Maksymalna liczba wywołań GPT per ticker per dzień */
const MAX_DAILY_CALLS = 20;

/**
 * Kontrola limitu dziennych wywołań GPT per ticker.
 * Ochrona przed flood w earnings season (wiele filingów dziennie per ticker).
 * Używa Redis INCR z TTL 86400s (24h).
 */
@Injectable()
export class DailyCapService {
  private readonly logger = new Logger(DailyCapService.name);

  constructor(
    @Inject(SEC_FILINGS_REDIS) private readonly redis: Redis,
  ) {}

  /**
   * Atomowo sprawdza limit i rezerwuje slot GPT dla tickera.
   * Lua script gwarantuje atomowość — brak race condition między INCR a DECR.
   */
  private static readonly LUA_CHECK_AND_RESERVE = `
    local count = redis.call('INCR', KEYS[1])
    if count == 1 then
      redis.call('EXPIRE', KEYS[1], 86400)
    end
    if count > tonumber(ARGV[1]) then
      redis.call('DECR', KEYS[1])
      return 0
    end
    return 1
  `;

  async canCallGpt(ticker: string): Promise<boolean> {
    const key = this.buildKey(ticker);
    try {
      const result = await this.redis.eval(
        DailyCapService.LUA_CHECK_AND_RESERVE,
        1,
        key,
        MAX_DAILY_CALLS,
      );
      if (result === 0) {
        this.logger.warn(`Daily GPT cap reached for ${ticker}: ${MAX_DAILY_CALLS}/${MAX_DAILY_CALLS}`);
        return false;
      }
      return true;
    } catch (err) {
      this.logger.error(`DailyCap Redis error for ${ticker}: ${err.message}`);
      return true; // fail-open: nie blokuj pipeline przy problemach Redis
    }
  }

  private buildKey(ticker: string): string {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return `gpt:daily:${ticker}:${date}`;
  }
}
