import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
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

bootstrap();
