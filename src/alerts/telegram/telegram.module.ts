import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramFormatterService } from './telegram-formatter.service';

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
