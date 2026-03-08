import { Controller, Get, Query } from '@nestjs/common';
import { SystemLogService } from '../../system-log/system-log.service';

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
}
