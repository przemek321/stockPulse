import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Ticker — spółki monitorowane przez system (healthcare + semi supply chain).
 * Źródło prawdy dla całego systemu monitoringu.
 */
@Entity('tickers')
export class Ticker {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ length: 10 })
  symbol: string;

  @Column({ length: 255 })
  name: string;

  /** Numer CIK z SEC EDGAR (do wyszukiwania filingów) */
  @Column({ length: 20, nullable: true })
  cik: string;

  /** Podsektor: Managed Care, Hospitals, PBM, Health IT, Medical Devices */
  @Column({ length: 100 })
  subsector: string;

  /** Priorytet monitoringu: CRITICAL, HIGH, MEDIUM, LOW */
  @Column({ length: 20, default: 'MEDIUM' })
  priority: string;

  /** Alternatywne nazwy do wyszukiwania (JSON array) */
  @Column('jsonb', { default: [] })
  aliases: string[];

  /** Kluczowe metryki do śledzenia (JSON array) */
  @Column('jsonb', { default: [] })
  keyMetrics: string[];

  /** CEO */
  @Column({ length: 100, nullable: true })
  ceo: string;

  /** CFO */
  @Column({ length: 100, nullable: true })
  cfo: string;

  /** Dodatkowe notatki */
  @Column({ type: 'text', nullable: true })
  notes: string;

  /** Sektor: healthcare (domyślny) lub semi_supply_chain */
  @Column({ length: 50, default: 'healthcare' })
  sector: string;

  /**
   * Observation mode: alert zapisywany do DB, ale NIE wysyłany na Telegram.
   * Używane dla nowych sektorów (semi supply chain) — zbieranie danych bez alertowania
   * dopóki backtest nie potwierdzi edge'u.
   * TODO: jeśli go/no-go decision wymaga split na poziomie koszyka,
   * refactor do ticker_categories table (sector + subsector + observation_only).
   */
  @Column({ default: false })
  observationOnly: boolean;

  /** Czy ticker jest aktywnie monitorowany */
  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
