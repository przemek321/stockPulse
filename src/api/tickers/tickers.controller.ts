import { Controller, Get, Param, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ticker } from '../../entities';

/**
 * GET /api/tickers — lista monitorowanych tickerów healthcare.
 */
@Controller('tickers')
export class TickersController {
  constructor(
    @InjectRepository(Ticker)
    private readonly tickerRepo: Repository<Ticker>,
  ) {}

  /**
   * Lista wszystkich aktywnych tickerów.
   * ?subsector=Managed+Care — filtruj po podsektorze.
   */
  @Get()
  async findAll(@Query('subsector') subsector?: string) {
    const where: Record<string, any> = { isActive: true };
    if (subsector) {
      where.subsector = subsector;
    }

    const tickers = await this.tickerRepo.find({
      where,
      order: { symbol: 'ASC' },
    });

    return {
      count: tickers.length,
      tickers,
    };
  }

  /**
   * Szczegóły jednego tickera po symbolu.
   */
  @Get(':symbol')
  async findOne(@Param('symbol') symbol: string) {
    const ticker = await this.tickerRepo.findOne({
      where: { symbol: symbol.toUpperCase() },
    });

    if (!ticker) {
      return { error: `Ticker ${symbol.toUpperCase()} nie znaleziony` };
    }

    return ticker;
  }
}
