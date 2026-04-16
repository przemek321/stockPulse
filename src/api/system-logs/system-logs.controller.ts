import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { SystemLogService } from '../../system-log/system-log.service';
import { ApiTokenGuard } from '../../common/guards/api-token.guard';

/**
 * Kontroler REST API dla logów systemowych.
 * GET /api/system-logs — lista logów z filtrami i paginacją.
 */
@Controller('system-logs')
export class SystemLogsController {
  constructor(private readonly systemLogService: SystemLogService) {}

  /**
   * Pobiera logi systemowe z opcjonalnymi filtrami.
   *
   * Query params:
   *   module    — filtr po module (collectors, sentiment, sec-filings, correlation, alerts)
   *   function  — filtr po nazwie funkcji
   *   status    — filtr po statusie (success, error)
   *   dateFrom  — od daty (ISO string)
   *   dateTo    — do daty (ISO string)
   *   limit     — max rekordów (domyślnie 100, max 500)
   *   offset    — przesunięcie dla paginacji
   */
  @Get()
  async getLogs(
    @Query('module') module?: string,
    @Query('function') functionName?: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.systemLogService.findAll({
      module,
      functionName,
      status,
      dateFrom,
      dateTo,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  /**
   * Pełna ścieżka pojedynczego eventu po traceId (wymaga tokenu).
   * GET /api/system-logs/trace/:traceId
   */
  @Get('trace/:traceId')
  @UseGuards(ApiTokenGuard)
  async getTrace(@Param('traceId') traceId: string) {
    const logs = await this.systemLogService.findByTrace(traceId);
    return { count: logs.length, logs };
  }

  /**
   * Logi per ticker w ostatnich N godzin (wymaga tokenu).
   * GET /api/system-logs/ticker/:symbol?hours=24&limit=100
   */
  @Get('ticker/:symbol')
  @UseGuards(ApiTokenGuard)
  async getTickerLogs(
    @Param('symbol') symbol: string,
    @Query('hours') hoursParam?: string,
    @Query('limit') limitParam?: string,
  ) {
    const hours = Math.min(parseInt(hoursParam || '24', 10) || 24, 168);
    const limit = Math.min(parseInt(limitParam || '100', 10) || 100, 500);
    const logs = await this.systemLogService.findByTicker(symbol, hours, limit);
    return { ticker: symbol.toUpperCase(), count: logs.length, logs };
  }

  /**
   * Agregacja decision reasons za ostatnie N godzin (wymaga tokenu).
   * GET /api/system-logs/decisions?hours=24
   */
  @Get('decisions')
  @UseGuards(ApiTokenGuard)
  async getDecisions(@Query('hours') hoursParam?: string) {
    const hours = Math.min(parseInt(hoursParam || '24', 10) || 24, 168);
    const stats = await this.systemLogService.getDecisionStats(hours);
    return { hours, stats };
  }
}
