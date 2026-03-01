import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';

/**
 * Katalizator PDUFA — data decyzji FDA dla leku.
 * Dane scrapowane z pdufa.bio.
 * Deduplikacja po (ticker + drugName + pdufaDate).
 */
@Entity('pdufa_catalysts')
@Unique(['symbol', 'pdufaDate', 'drugName'])
export class PdufaCatalyst {
  @PrimaryGeneratedColumn()
  id: number;

  /** Ticker spółki (np. BMY, MRNA, ISRG) */
  @Index()
  @Column({ length: 10 })
  symbol: string;

  /** Nazwa leku/terapii */
  @Column({ name: 'drug_name', length: 255, nullable: true })
  drugName: string;

  /** Wskazanie terapeutyczne (np. Acute Myeloid Leukemia) */
  @Column({ length: 500, nullable: true })
  indication: string;

  /** Obszar terapeutyczny (np. Oncology, Rare Disease) */
  @Column({ name: 'therapeutic_area', length: 100, nullable: true })
  therapeuticArea: string;

  /** Data decyzji PDUFA (dzień oczekiwanej decyzji FDA) */
  @Index()
  @Column({ name: 'pdufa_date', type: 'date' })
  pdufaDate: Date;

  /** ODIN tier z pdufa.bio: TIER_1..TIER_4 (jeśli dostępny) */
  @Column({ name: 'odin_tier', length: 10, nullable: true })
  odinTier: string;

  /** ODIN score — prawdopodobieństwo approval (np. 90.7) */
  @Column({
    name: 'odin_score',
    type: 'decimal',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  odinScore: number;

  /** Typ eventu: pdufa, readout, earnings */
  @Column({ name: 'event_type', length: 50, default: 'pdufa' })
  eventType: string;

  /** Wynik decyzji FDA: NULL=pending, APPROVED, CRL, DELAYED */
  @Column({ length: 20, nullable: true })
  outcome: string;

  /** Timestamp ostatniego scrape'a */
  @Column({
    name: 'scraped_at',
    type: 'timestamp',
    default: () => 'NOW()',
  })
  scrapedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
