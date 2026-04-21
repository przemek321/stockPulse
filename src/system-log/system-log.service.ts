import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, MoreThan, In } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { SystemLog } from '../entities/system-log.entity';

/** Dane do zapisu logu systemowego */
export interface CreateSystemLogDto {
  module: string;
  className: string;
  functionName: string;
  status: 'success' | 'error';
  durationMs: number;
  input?: Record<string, any> | null;
  output?: Record<string, any> | null;
  errorMessage?: string | null;
  // Tier 1 observability:
  traceId?: string | null;
  parentTraceId?: string | null;
  level?: 'debug' | 'info' | 'warn' | 'error';
  ticker?: string | null;
  decisionReason?: string | null;
}

/** Filtry do wyszukiwania logów */
export interface SystemLogFilters {
  module?: string;
  functionName?: string;
  status?: string;
  level?: string;
  ticker?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

/**
 * Serwis logowania systemowego.
 * Globalny singleton — decorator @Logged() korzysta z niego przez getInstance().
 * Zapis fire-and-forget: błąd zapisu nie blokuje pipeline.
 */
@Injectable()
export class SystemLogService implements OnModuleInit {
  private static instance: SystemLogService | null = null;
  private readonly logger = new Logger(SystemLogService.name);

  constructor(
    @InjectRepository(SystemLog)
    private readonly repo: Repository<SystemLog>,
  ) {}

  onModuleInit() {
    SystemLogService.instance = this;
    this.logger.log('SystemLogService — globalny singleton aktywny');
  }

  /** Dostęp do singletona z poziomu decoratora */
  static getInstance(): SystemLogService | null {
    return SystemLogService.instance;
  }

  /**
   * Zapisuje log systemowy — fire-and-forget.
   * Błąd zapisu nie propaguje się do callera.
   */
  log(data: CreateSystemLogDto): void {
    const entity = this.repo.create({
      module: data.module,
      className: data.className,
      functionName: data.functionName,
      status: data.status,
      durationMs: data.durationMs,
      input: data.input ?? null,
      output: data.output ?? null,
      errorMessage: data.errorMessage ?? null,
      // Tier 1:
      traceId: data.traceId ?? null,
      parentTraceId: data.parentTraceId ?? null,
      level: data.level ?? null,
      ticker: data.ticker ? data.ticker.toUpperCase() : null,
      decisionReason: data.decisionReason ?? null,
    });

    this.repo.save(entity).catch((err) => {
      this.logger.warn(
        `Błąd zapisu system log: ${err instanceof Error ? err.message : err}`,
      );
    });
  }

  /**
   * Wyszukuje logi z opcjonalnymi filtrami.
   * Zwraca { count, total, logs } — count = wyniki na stronie, total = wszystkie pasujące.
   */
  async findAll(
    filters: SystemLogFilters,
  ): Promise<{ count: number; total: number; logs: SystemLog[] }> {
    const take = Math.min(filters.limit || 100, 500);
    const skip = filters.offset || 0;

    const qb = this.repo
      .createQueryBuilder('log')
      .orderBy('log.created_at', 'DESC')
      .take(take)
      .skip(skip);

    if (filters.module) {
      qb.andWhere('log.module = :module', { module: filters.module });
    }
    if (filters.functionName) {
      qb.andWhere('log.function_name = :fn', { fn: filters.functionName });
    }
    if (filters.status) {
      qb.andWhere('log.status = :status', { status: filters.status });
    }
    if (filters.level) {
      qb.andWhere('log.level = :level', { level: filters.level });
    }
    if (filters.ticker) {
      qb.andWhere('log.ticker = :ticker', { ticker: filters.ticker.toUpperCase() });
    }
    if (filters.dateFrom) {
      qb.andWhere('log.created_at >= :dateFrom', {
        dateFrom: new Date(filters.dateFrom),
      });
    }
    if (filters.dateTo) {
      qb.andWhere('log.created_at <= :dateTo', {
        dateTo: new Date(filters.dateTo),
      });
    }

    const [logs, total] = await qb.getManyAndCount();
    return { count: logs.length, total, logs };
  }

  /**
   * Tiered cleanup o 3:00 UTC:
   * - debug: 2 dni (stats, low-value heartbeats)
   * - info/null: 7 dni (normalny flow, default + pre-migration)
   * - warn/error: 30 dni (problemy, do debugowania)
   */
  @Cron('0 3 * * *', { timeZone: 'UTC' })
  async cleanup(): Promise<void> {
    const results: Record<string, number> = {};

    // Debug: 2 dni
    const debugCutoff = new Date();
    debugCutoff.setDate(debugCutoff.getDate() - 2);
    const debugResult = await this.repo.delete({
      level: 'debug',
      createdAt: LessThan(debugCutoff),
    });
    results.debug = debugResult.affected ?? 0;

    // Info + null (pre-migration): 7 dni
    const infoCutoff = new Date();
    infoCutoff.setDate(infoCutoff.getDate() - 7);
    const infoResult = await this.repo
      .createQueryBuilder()
      .delete()
      .from(SystemLog)
      .where("(level = 'info' OR level IS NULL)")
      .andWhere('created_at < :cutoff', { cutoff: infoCutoff })
      .execute();
    results.info_null = infoResult.affected ?? 0;

    // Warn + error: 30 dni
    const warnCutoff = new Date();
    warnCutoff.setDate(warnCutoff.getDate() - 30);
    const warnResult = await this.repo.delete({
      level: In(['warn', 'error']),
      createdAt: LessThan(warnCutoff),
    });
    results.warn_error = warnResult.affected ?? 0;

    const total = Object.values(results).reduce((a, b) => a + b, 0);
    if (total > 0) {
      this.logger.log(
        `Cleanup: debug=${results.debug}, info/null=${results.info_null}, warn/error=${results.warn_error} (total: ${total})`,
      );
    }
  }

  // ── Query helpers (Tier 1) ──────────────────────────────

  /** Pełna ścieżka pojedynczego eventu (traceId). */
  async findByTrace(traceId: string): Promise<SystemLog[]> {
    return this.repo.find({
      where: { traceId },
      order: { createdAt: 'ASC' },
    });
  }

  /** Logi per ticker w ostatnich N godzin. */
  async findByTicker(
    ticker: string,
    hoursAgo: number = 24,
    limit: number = 500,
  ): Promise<SystemLog[]> {
    const cutoff = new Date(Date.now() - hoursAgo * 3600_000);
    return this.repo.find({
      where: {
        ticker: ticker.toUpperCase(),
        createdAt: MoreThan(cutoff),
      },
      order: { createdAt: 'DESC' },
      take: Math.min(limit, 500),
    });
  }

  /** Agregacja decision reasons za ostatnie N godzin. */
  async getDecisionStats(hours: number = 24): Promise<Array<{ reason: string; count: number }>> {
    const cutoff = new Date(Date.now() - hours * 3600_000);
    return this.repo.query(
      `SELECT decision_reason as reason, COUNT(*)::int as count
       FROM system_logs
       WHERE created_at > $1 AND decision_reason IS NOT NULL
       GROUP BY decision_reason
       ORDER BY count DESC`,
      [cutoff],
    );
  }
}
