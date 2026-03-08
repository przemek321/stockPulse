import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
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
}

/** Filtry do wyszukiwania logów */
export interface SystemLogFilters {
  module?: string;
  functionName?: string;
  status?: string;
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
   * Codzienny cleanup o 3:00 — usuwa logi starsze niż 7 dni.
   */
  @Cron('0 3 * * *')
  async cleanup(): Promise<void> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);

    const result = await this.repo.delete({
      createdAt: LessThan(cutoff),
    });

    if (result.affected && result.affected > 0) {
      this.logger.log(`Cleanup: usunięto ${result.affected} logów starszych niż 7 dni`);
    }
  }
}
