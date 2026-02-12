import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Serwis do wysyłania wiadomości przez Telegram Bot API.
 * Używa endpointu sendMessage z MarkdownV2 lub plain text.
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly botToken: string;
  private readonly chatId: string;
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.botToken = this.config.get<string>('TELEGRAM_BOT_TOKEN', '');
    this.chatId = this.config.get<string>('TELEGRAM_CHAT_ID', '');
    this.baseUrl = `https://api.telegram.org/bot${this.botToken}`;
  }

  /**
   * Sprawdza czy Telegram jest skonfigurowany.
   */
  isConfigured(): boolean {
    return !!(this.botToken && this.chatId);
  }

  /**
   * Wysyła wiadomość MarkdownV2 na Telegram.
   */
  async sendMarkdown(text: string): Promise<boolean> {
    return this.send(text, 'MarkdownV2');
  }

  /**
   * Wysyła prostą wiadomość tekstową na Telegram.
   */
  async sendText(text: string): Promise<boolean> {
    return this.send(text);
  }

  /**
   * Bazowa metoda wysyłania wiadomości.
   */
  private async send(
    text: string,
    parseMode?: 'MarkdownV2' | 'HTML',
  ): Promise<boolean> {
    if (!this.isConfigured()) {
      this.logger.warn('Telegram nie skonfigurowany — pomijam wysyłkę');
      return false;
    }

    try {
      const body: Record<string, string> = {
        chat_id: this.chatId,
        text,
      };
      if (parseMode) {
        body.parse_mode = parseMode;
      }

      const res = await fetch(`${this.baseUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!data.ok) {
        this.logger.error(`Telegram API error: ${data.description}`);
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(
        `Błąd wysyłki Telegram: ${error instanceof Error ? error.message : error}`,
      );
      return false;
    }
  }
}
