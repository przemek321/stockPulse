import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  Unique,
} from 'typeorm';

/**
 * Rolling 20-dniowa średnia volume per kontrakt opcyjny.
 * Używana do wykrywania volume spike (unusual activity).
 */
@Entity('options_volume_baseline')
@Unique(['occSymbol'])
export class OptionsVolumeBaseline {
  @PrimaryGeneratedColumn()
  id: number;

  /** OCC symbol opcji */
  @Column({ length: 30, unique: true })
  occSymbol: string;

  @Index()
  @Column({ length: 10 })
  symbol: string;

  /** Rolling 20-day average volume */
  @Column('decimal', { precision: 10, scale: 2, default: 0 })
  avgVolume20d: number;

  /** Ile dni w średniej (max 20) */
  @Column({ type: 'int', default: 0 })
  dataPoints: number;

  /** Ostatni dzienny volume */
  @Column({ type: 'int', default: 0 })
  lastVolume: number;

  /** Data ostatniej aktualizacji */
  @Column({ type: 'date' })
  lastUpdated: Date;
}
