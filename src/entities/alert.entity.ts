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

  /**
   * Powód niedostarczenia alertu (gdy delivered=false).
   * Rozróżnia: observation mode, silent hour, daily limit.
   * Krytyczne dla forward analysis — bez tego nie da się odfiltrować
   * "semi observation" od "3 w nocy" w backtestach.
   */
  @Column({ type: 'varchar', length: 32, nullable: true, default: null })
  nonDeliveryReason: string | null;

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

  // ── Sector benchmark snapshots (XBI/IBB) ───────────────
  // Patrz `doc/FOLLOWUP-XBI-ADJUSTMENT.md` (trigger: BIIB 14.05.2026 outcome
  // interpretation ambiguity). XBI = SPDR S&P Biotech (equal-weight, mid-cap fit),
  // IBB = iShares Biotechnology (market-cap weighted, large-cap fit).
  // Skip price1h/4h dla sectora — niski signal-to-noise intraday.

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  xbiAtAlert: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  xbi1d: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  xbi3d: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  ibbAtAlert: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  ibb1d: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  ibb3d: number | null;

  /**
   * Soft delete flag — alert ukryty z dashboardu/API ale zachowany w DB.
   * Używaj zamiast DELETE — historia outcomes jest kluczowa do walidacji forward.
   * Nigdy nie kasuj alertów hard-delete; zaznacz archived=true.
   */
  @Column({ type: 'boolean', default: false })
  archived: boolean;
}
