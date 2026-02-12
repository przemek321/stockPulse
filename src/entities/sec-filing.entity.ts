import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * SEC filing (8-K, 10-Q, 10-K, Form 4, SC 13D itd.).
 * Dane z SEC EDGAR API.
 */
@Entity('sec_filings')
export class SecFiling {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ length: 10 })
  symbol: string;

  /** Numer CIK firmy */
  @Column({ length: 20 })
  cik: string;

  /** Typ formularza: 4, 8-K, 10-Q, 10-K, SC 13D itd. */
  @Index()
  @Column({ length: 20 })
  formType: string;

  /** Numer accession (unikalny identyfikator SEC) */
  @Index({ unique: true })
  @Column({ length: 30 })
  accessionNumber: string;

  /** Data złożenia */
  @Column({ type: 'date' })
  filingDate: Date;

  /** Opis/tytuł filingu */
  @Column({ type: 'text', nullable: true })
  description: string;

  /** URL do dokumentu na SEC */
  @Column({ length: 500, nullable: true })
  documentUrl: string;

  @CreateDateColumn()
  collectedAt: Date;
}
