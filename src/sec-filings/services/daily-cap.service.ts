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
   * Zwraca true jeśli jest jeszcze miejsce (atomowy INCR unika race condition).
   */
  async canCallGpt(ticker: string): Promise<boolean> {
    const key = this.buildKey(ticker);
    const count = await this.redis.incr(key);

    // Ustaw TTL przy pierwszym użyciu klucza
    if (count === 1) {
      await this.redis.expire(key, 86400); // 24h
    }

    if (count > MAX_DAILY_CALLS) {
      // Przekroczono limit — cofnij INCR, żeby nie zawyżać licznika
      await this.redis.decr(key);
      this.logger.warn(
        `Daily GPT cap reached for ${ticker}: ${count - 1}/${MAX_DAILY_CALLS}`,
      );
      return false;
    }
    return true;
  }

  /**
   * Rejestracja wywołania GPT — slot już zarezerwowany w canCallGpt().
   * Zachowane dla wstecznej kompatybilności, ale nie inkrementuje ponownie.
   */
  async recordGptCall(_ticker: string): Promise<void> {
    // Slot zarezerwowany atomowo w canCallGpt() — tu nic nie robimy
  }

  private buildKey(ticker: string): string {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return `gpt:daily:${ticker}:${date}`;
  }
}
