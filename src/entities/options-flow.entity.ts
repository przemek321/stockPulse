import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  Unique,
} from 'typeorm';

/**
 * Wykryta nietypowa aktywność opcyjna (volume spike).
 * Dane z Polygon.io EOD — 1 wpis per kontrakt per sesja giełdowa.
 */
@Entity('options_flow')
@Unique(['occSymbol', 'sessionDate'])
export class OptionsFlow {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ length: 10 })
  symbol: string;

  /** OCC symbol opcji (np. O:MRNA260417C00180000) */
  @Column({ length: 30 })
  occSymbol: string;

  /** call / put */
  @Column({ length: 4 })
  optionType: string;

  /** Strike price */
  @Column('decimal', { precision: 10, scale: 2 })
  strike: number;

  /** Cena close underlying w dniu sesji */
  @Column('decimal', { precision: 10, scale: 2 })
  underlyingPrice: number;

  /** Data wygaśnięcia opcji */
  @Column({ type: 'date' })
  expiry: Date;

  /** Days to expiry */
  @Column({ type: 'int' })
  dte: number;

  /** Volume z EOD */
  @Column({ type: 'int' })
  dailyVolume: number;

  /** 20-dniowa średnia volume (snapshot w momencie detekcji) */
  @Column('decimal', { precision: 10, scale: 2 })
  avgVolume20d: number;

  /** dailyVolume / avgVolume20d */
  @Column('decimal', { precision: 8, scale: 2 })
  volumeSpikeRatio: number;

  /** Czy strike > underlying (call) lub strike < underlying (put) */
  @Column({ type: 'boolean', default: false })
  isOtm: boolean;

  /** |strike - underlying| / underlying */
  @Column('decimal', { precision: 6, scale: 4, default: 0 })
  otmDistance: number;

  /** Wyliczony conviction [-1, +1] */
  @Column('decimal', { precision: 6, scale: 4, default: 0 })
  conviction: number;

  /** positive / negative / mixed */
  @Column({ length: 10, default: 'mixed' })
  direction: string;

  /** Czy conviction został wzmocniony przez nadchodzącą datę PDUFA */
  @Column({ type: 'boolean', default: false })
  pdufaBoosted: boolean;

  /** Data sesji giełdowej */
  @Index()
  @Column({ type: 'date' })
  sessionDate: Date;

  @CreateDateColumn()
  collectedAt: Date;
}
