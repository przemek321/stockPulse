import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CollectionLog } from '../../entities';
import { ICollector, CollectorHealth } from '../../common/interfaces/collector.interface';
import { DataSource } from '../../common/interfaces/data-source.enum';
import { Logged } from '../../common/decorators/logged.decorator';

/**
 * Bazowa klasa dla wszystkich kolektorów danych.
 * Obsługuje logowanie wyników cyklu zbierania do tabeli collection_logs.
 */
export abstract class BaseCollectorService implements ICollector {
  protected abstract readonly logger: Logger;

  constructor(
    protected readonly collectionLogRepo: Repository<CollectionLog>,
  ) {}

  abstract getSourceName(): DataSource;

  abstract collect(): Promise<number>;

  /**
   * Zapisuje wynik cyklu zbierania danych do collection_logs.
   */
  protected async logCollection(
    status: 'SUCCESS' | 'PARTIAL' | 'FAILED',
    itemsCollected: number,
    durationMs: number,
    errorMessage?: string,
  ): Promise<void> {
    const log = this.collectionLogRepo.create({
      collector: this.getSourceName(),
      status,
      itemsCollected,
      durationMs,
      errorMessage: errorMessage || undefined,
    });
    await this.collectionLogRepo.save(log);

    this.logger.log(
      `Cykl ${status}: ${itemsCollected} elementów w ${durationMs}ms` +
        (errorMessage ? ` — ${errorMessage}` : ''),
    );
  }

  /**
   * Status zdrowia kolektora na podstawie ostatniego wpisu w collection_logs.
   */
  async getHealthStatus(): Promise<CollectorHealth> {
    const lastLog = await this.collectionLogRepo.findOne({
      where: { collector: this.getSourceName() },
      order: { startedAt: 'DESC' },
    });

    return {
      source: this.getSourceName(),
      isHealthy: lastLog ? lastLog.status !== 'FAILED' : false,
      lastCollectionAt: lastLog?.startedAt || null,
      itemsCollected: lastLog?.itemsCollected || 0,
      errorMessage: lastLog?.errorMessage || undefined,
    };
  }

  /**
   * Wrapper uruchamiający collect() z pomiarem czasu i logowaniem.
   * Zwraca obiekt z nazwą kolektora i liczbą zebranych elementów
   * (zamiast samego count — @Logged loguje output do system_logs).
   */
  @Logged('collectors')
  async runCollectionCycle(): Promise<{ collector: string; count: number }> {
    const collector = this.getSourceName();
    const start = Date.now();
    try {
      const count = await this.collect();
      await this.logCollection('SUCCESS', count, Date.now() - start);
      return { collector, count };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Błąd cyklu zbierania: ${msg}`);
      await this.logCollection('FAILED', 0, Date.now() - start, msg);
      return { collector, count: 0 };
    }
  }
}
