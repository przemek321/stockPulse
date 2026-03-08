import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

/**
 * Historia wysłanych alertów (Telegram, Discord itd.).
 * Służy do throttlingu i audytu.
 */
@Entity('alerts')
export class Alert {
  @PrimaryGeneratedColumn()
  id: number;

  /** Ticker którego dotyczy alert */
  @Column({ length: 10 })
  symbol: string;

  /** Nazwa reguły która wyzwoliła alert */
  @Column({ length: 100 })
  ruleName: string;

  /** Priorytet: INFO, MEDIUM, HIGH, CRITICAL */
  @Column({ length: 20 })
  priority: string;

  /** Kanał dostarczenia: TELEGRAM, DISCORD, EMAIL */
  @Column({ length: 20 })
  channel: string;

  /** Treść wysłanej wiadomości */
  @Column({ type: 'text' })
  message: string;

  /** Typ katalizatora (opcjonalny) — do throttlingu per catalyst */
  @Column({ type: 'varchar', length: 50, nullable: true, default: null })
  catalystType: string | null;

  /** Czy alert został pomyślnie wysłany */
  @Column({ default: true })
  delivered: boolean;

  @CreateDateColumn()
  sentAt: Date;

  // ── Price Outcome Tracker ──────────────────────────────

  /** Kierunek alertu: 'positive' (bullish) lub 'negative' (bearish) */
  @Column({ type: 'varchar', length: 10, nullable: true })
  alertDirection: string | null;

  /** Cena akcji w momencie wysłania alertu */
  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  priceAtAlert: number | null;

  /** Cena po 1 godzinie */
  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  price1h: number | null;

  /** Cena po 4 godzinach */
  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  price4h: number | null;

  /** Cena po 1 dniu */
  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  price1d: number | null;

  /** Cena po 3 dniach */
  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  price3d: number | null;

  /** Czy CRON zakończył zbieranie cen (po 3d) */
  @Column({ type: 'boolean', default: false })
  priceOutcomeDone: boolean;
}
