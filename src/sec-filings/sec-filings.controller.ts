import { Controller, Post, Query, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SecFiling } from '../entities';
import { Form8kPipeline } from './pipelines/form8k.pipeline';

/**
 * Kontroler administracyjny dla SEC Filing GPT Pipeline.
 * POST /api/sec-filings/backfill-gpt — przetwarza istniejące 8-K filingi przez GPT.
 */
@Controller('sec-filings')
export class SecFilingsController {
  private readonly logger = new Logger(SecFilingsController.name);

  constructor(
    @InjectRepository(SecFiling)
    private readonly filingRepo: Repository<SecFiling>,
    private readonly form8k: Form8kPipeline,
  ) {}

  /**
   * Backfill: przetwarza istniejące 8-K filingi bez gptAnalysis.
   * Wywołuje Form8kPipeline.onFiling() bezpośrednio (bez eventów).
   * ?limit=10 — ile filingów przetworzyć (max 50).
   */
  @Post('backfill-gpt')
  async backfillGpt(@Query('limit') limit?: string) {
    const take = Math.min(parseInt(limit || '10', 10), 50);

    const filings = await this.filingRepo
      .createQueryBuilder('f')
      .where("f.formType = '8-K'")
      .andWhere('f.gptAnalysis IS NULL')
      .orderBy('f.filingDate', 'DESC')
      .take(take)
      .getMany();

    this.logger.log(`Backfill GPT: ${filings.length} filingów 8-K do przetworzenia`);

    let processed = 0;
    for (const filing of filings) {
      await this.form8k.onFiling({
        filingId: filing.id,
        symbol: filing.symbol,
        formType: '8-K',
      });

      // Sprawdź czy gptAnalysis zostało zapisane
      const updated = await this.filingRepo.findOne({ where: { id: filing.id } });
      if (updated?.gptAnalysis) processed++;

      // Rate limit: 2s między wywołaniami GPT
      if (filing !== filings[filings.length - 1]) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    this.logger.log(`Backfill GPT: ${processed}/${filings.length} przetworzonych`);
    return { total: filings.length, processed };
  }
}
