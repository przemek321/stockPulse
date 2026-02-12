import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';
import { DataSource } from '../common/interfaces/data-source.enum';

/**
 * Log każdego cyklu zbierania danych.
 * Służy do monitorowania zdrowia kolektorów (/api/health).
 */
@Entity('collection_logs')
export class CollectionLog {
  @PrimaryGeneratedColumn()
  id: number;

  /** Nazwa kolektora */
  @Column({ type: 'enum', enum: DataSource })
  collector: DataSource;

  /** Status: SUCCESS, PARTIAL, FAILED */
  @Column({ length: 20 })
  status: string;

  /** Ile elementów zebrano w tym cyklu */
  @Column({ default: 0 })
  itemsCollected: number;

  /** Opis błędu (jeśli wystąpił) */
  @Column({ type: 'text', nullable: true })
  errorMessage: string;

  /** Czas trwania cyklu w milisekundach */
  @Column({ default: 0 })
  durationMs: number;

  @CreateDateColumn()
  startedAt: Date;
}
