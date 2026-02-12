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

  /** Czy alert został pomyślnie wysłany */
  @Column({ default: true })
  delivered: boolean;

  @CreateDateColumn()
  sentAt: Date;
}
