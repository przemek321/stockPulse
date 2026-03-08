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
   * Sprawdza czy ticker nie przekroczył dziennego limitu wywołań GPT.
   */
  async canCallGpt(ticker: string): Promise<boolean> {
    const key = this.buildKey(ticker);
    const count = await this.redis.get(key);
    const current = count ? parseInt(count, 10) : 0;

    if (current >= MAX_DAILY_CALLS) {
      this.logger.warn(
        `Daily GPT cap reached for ${ticker}: ${current}/${MAX_DAILY_CALLS}`,
      );
      return false;
    }
    return true;
  }

  /**
   * Rejestruje wywołanie GPT dla tickera.
   */
  async recordGptCall(ticker: string): Promise<void> {
    const key = this.buildKey(ticker);
    const count = await this.redis.incr(key);
    // Ustaw TTL tylko przy pierwszym incrze (gdy count === 1)
    if (count === 1) {
      await this.redis.expire(key, 86400); // 24h
    }
  }

  private buildKey(ticker: string): string {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return `gpt:daily:${ticker}:${date}`;
  }
}
