import { Module } from '@nestjs/common';
import { AzureOpenaiClientService } from './azure-openai-client.service';
import { AnthropicClientService } from './anthropic-client.service';

/**
 * Moduł AI (legacy nazwa: SentimentModule z ery FinBERT + sentiment pipeline).
 *
 * Po Sprint 11 (wyłączenie sentiment pipeline) i usunięciu FinBERT (22.04.2026)
 * moduł hostuje wyłącznie klienta Anthropic Claude Sonnet używanego przez SEC
 * filings pipeline (Form4, Form8k).
 *
 * Serwisy:
 * - AnthropicClientService — klient Claude Sonnet (SDK @anthropic-ai/sdk)
 * - AzureOpenaiClientService — alias → AnthropicClientService (Sprint 12 migration,
 *   zachowany dla kompatybilności istniejących inject-ów po typie)
 */
@Module({
  providers: [
    AnthropicClientService,
    {
      provide: AzureOpenaiClientService,
      useExisting: AnthropicClientService,
    },
  ],
  exports: [AzureOpenaiClientService, AnthropicClientService],
})
export class SentimentModule {}
