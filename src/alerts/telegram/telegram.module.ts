import { Module } from '@nestjs/common';
import { TelegramFormatterService } from './telegram-formatter.service';
import { TelegramService } from './telegram.service';

/**
 * Moduł Telegram — wydzielony z AlertsModule.
 * Pozwala innym modułom (SecFilingsModule, CorrelationModule)
 * importować TelegramService bez circular dependency.
 */
@Module({
  providers: [TelegramService, TelegramFormatterService],
  exports: [TelegramService, TelegramFormatterService],
})
export class TelegramModule {}
