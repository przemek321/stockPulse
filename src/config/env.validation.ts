import * as Joi from 'joi';

/**
 * Schemat walidacji zmiennych środowiskowych.
 * Aplikacja nie uruchomi się jeśli brakuje wymaganych zmiennych.
 */
export const envValidationSchema = Joi.object({
  // Aplikacja
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),

  // PostgreSQL + TimescaleDB
  POSTGRES_HOST: Joi.string().default('localhost'),
  POSTGRES_PORT: Joi.number().default(5432),
  POSTGRES_DB: Joi.string().default('stockpulse'),
  POSTGRES_USER: Joi.string().default('stockpulse'),
  POSTGRES_PASSWORD: Joi.string().required(),

  // Redis (BullMQ)
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').default(''),

  // Finnhub
  FINNHUB_API_KEY: Joi.string().required(),

  // SEC EDGAR
  SEC_USER_AGENT: Joi.string().required(),

  // Telegram
  TELEGRAM_BOT_TOKEN: Joi.string().required(),
  TELEGRAM_CHAT_ID: Joi.string().required(),

  // Reddit (opcjonalne — czeka na dostęp)
  REDDIT_CLIENT_ID: Joi.string().allow('').default(''),
  REDDIT_CLIENT_SECRET: Joi.string().allow('').default(''),
  REDDIT_USERNAME: Joi.string().allow('').default(''),
  REDDIT_PASSWORD: Joi.string().allow('').default(''),
  REDDIT_USER_AGENT: Joi.string().allow('').default(''),

  // StockTwits (opcjonalne — publiczne API)
  STOCKTWITS_ACCESS_TOKEN: Joi.string().allow('').default(''),

  // Anthropic (opcjonalne — Faza 2)
  ANTHROPIC_API_KEY: Joi.string().allow('').default(''),

  // Azure Analysis Service (opcjonalne — 2-etapowy pipeline sentymentu)
  // URL do VM z gpt-4o-mini, np. http://74.248.113.3:3100
  AZURE_ANALYSIS_URL: Joi.string().uri().allow('').default(''),
  AZURE_ANALYSIS_TIMEOUT_MS: Joi.number().default(30000),

  // FinBERT sidecar (opcjonalne — Faza 2)
  FINBERT_SIDECAR_URL: Joi.string().default('http://localhost:8000'),
});
