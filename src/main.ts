import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * Punkt startowy aplikacji StockPulse.
 * Uruchamia serwer NestJS na porcie z .env (domyślnie 3000).
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT || 3000;

  app.setGlobalPrefix('api');

  await app.listen(port);
  Logger.log(
    `StockPulse działa na porcie ${port} (${process.env.NODE_ENV || 'development'})`,
    'Bootstrap',
  );
}

// Bez catch błąd startu (np. brak DB) ginął jako unhandled rejection bez kodu wyjścia.
bootstrap().catch((err: unknown) => {
  Logger.error(`Start StockPulse nieudany: ${err instanceof Error ? err.stack ?? err.message : String(err)}`, 'Bootstrap');
  process.exit(1);
});
