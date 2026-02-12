import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Reguła alertu — konfiguracja kiedy wysyłać powiadomienie.
 * Inicjalizowane z healthcare-universe.json (sekcja alert_rules).
 */
@Entity('alert_rules')
export class AlertRule {
  @PrimaryGeneratedColumn()
  id: number;

  /** Nazwa reguły (np. "Sentiment Crash", "Insider Trade Large") */
  @Column({ length: 100, unique: true })
  name: string;

  /** Warunek w formie tekstowej (do ewaluacji przez AlertEvaluator) */
  @Column({ type: 'text' })
  condition: string;

  /** Priorytet: INFO, MEDIUM, HIGH, CRITICAL */
  @Column({ length: 20 })
  priority: string;

  /** Minimalne minuty między alertami tego samego typu per ticker */
  @Column({ default: 15 })
  throttleMinutes: number;

  /** Czy reguła jest aktywna */
  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
