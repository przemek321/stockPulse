import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Transakcja insiderowska z Form 4 (SEC EDGAR).
 * Alert generowany gdy wartość > $100K.
 */
@Entity('insider_trades')
export class InsiderTrade {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ length: 10 })
  symbol: string;

  /** Imię i nazwisko insidera */
  @Column({ length: 100 })
  insiderName: string;

  /** Rola (CEO, CFO, Director, 10% Owner itd.) */
  @Column({ length: 100, nullable: true })
  insiderRole: string;

  /** Typ transakcji: BUY, SELL, EXERCISE */
  @Column({ length: 20 })
  transactionType: string;

  /** Liczba akcji */
  @Column('decimal', { precision: 15, scale: 2, default: 0 })
  shares: number;

  /** Cena za akcję */
  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  pricePerShare: number;

  /** Łączna wartość transakcji w USD */
  @Column('decimal', { precision: 15, scale: 2, default: 0 })
  totalValue: number;

  /** Data transakcji */
  @Column({ type: 'date' })
  transactionDate: Date;

  /** Numer accession filingu Form 4 */
  @Column({ length: 30, nullable: true })
  accessionNumber: string;

  @CreateDateColumn()
  collectedAt: Date;
}
