import { Controller, Get, Post, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OptionsFlow, OptionsVolumeBaseline } from '../../entities';
import { OptionsFlowService } from '../../collectors/options-flow/options-flow.service';

/**
 * REST API dla options flow.
 *
 * GET /api/options-flow — lista wykrytych anomalii
 * GET /api/options-flow/stats — statystyki per ticker
 * POST /api/options-flow/backfill — jednorazowy backfill 20d baseline
 */
@Controller('options-flow')
export class OptionsFlowController {
  constructor(
    @InjectRepository(OptionsFlow)
    private readonly flowRepo: Repository<OptionsFlow>,
    @InjectRepository(OptionsVolumeBaseline)
    private readonly baselineRepo: Repository<OptionsVolumeBaseline>,
    private readonly optionsFlowService: OptionsFlowService,
  ) {}

  @Get()
  async list(
    @Query('limit') limit?: string,
    @Query('symbol') symbol?: string,
    @Query('session_date') sessionDate?: string,
  ) {
    const take = Math.min(Number(limit) || 50, 200);

    const qb = this.flowRepo.createQueryBuilder('f')
      .orderBy('f.collectedAt', 'DESC')
      .take(take);

    if (symbol) {
      qb.andWhere('f.symbol = :symbol', { symbol: symbol.toUpperCase() });
    }
    if (sessionDate) {
      qb.andWhere('f.sessionDate = :sessionDate', { sessionDate });
    }

    const [data, total] = await qb.getManyAndCount();
    return { data, total, limit: take };
  }

  @Get('stats')
  async stats() {
    const result = await this.flowRepo
      .createQueryBuilder('f')
      .select('f.symbol', 'symbol')
      .addSelect('COUNT(*)', 'totalFlows')
      .addSelect('AVG(ABS(f.conviction))', 'avgConviction')
      .addSelect('MAX(f.volumeSpikeRatio)', 'maxSpikeRatio')
      .addSelect('MAX(f.sessionDate)', 'lastSession')
      .groupBy('f.symbol')
      .orderBy('COUNT(*)', 'DESC')
      .getRawMany();

    const baselineCount = await this.baselineRepo.count();

    return { stats: result, baselineRecords: baselineCount };
  }

  @Post('backfill')
  async backfill(@Query('limit') limit?: string) {
    const limitTickers = Number(limit) || 37;
    const count = await this.optionsFlowService.backfillBaseline(limitTickers);
    return { message: `Backfill zakończony: ${count} baseline records`, count };
  }
}
