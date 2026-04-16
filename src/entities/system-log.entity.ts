import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Log systemowy — rejestruje wywołania kluczowych funkcji w pipeline.
 * Przechowuje: moduł, klasę, funkcję, input/output (JSONB), czas trwania, status.
 * Używany przez decorator @Logged() do automatycznego logowania.
 */
@Entity('system_logs')
@Index(['module', 'createdAt'])
@Index(['traceId'])
@Index(['ticker', 'createdAt'])
export class SystemLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  /** Moduł źródłowy: collectors, sentiment, sec-filings, correlation, alerts */
  @Index()
  @Column({ length: 50 })
  module: string;

  /** Nazwa klasy serwisu, np. StocktwitsService */
  @Column({ length: 100, name: 'class_name' })
  className: string;

  /** Nazwa metody, np. collect, analyze */
  @Index()
  @Column({ length: 100, name: 'function_name' })
  functionName: string;

  /** Status: success | error */
  @Index()
  @Column({ length: 20 })
  status: string;

  /** Czas trwania w milisekundach */
  @Column({ type: 'int', name: 'duration_ms' })
  durationMs: number;

  /** Argumenty wejściowe (obcięte do 2000 znaków) */
  @Column({ type: 'jsonb', nullable: true })
  input: Record<string, any> | null;

  /** Wartość zwrócona (obcięta do 2000 znaków) */
  @Column({ type: 'jsonb', nullable: true })
  output: Record<string, any> | null;

  // ── Tier 1 observability ──────────────────────────────────

  /** UUID identyfikujący pełną ścieżkę pojedynczego eventu (filing/trade/flow). */
  @Column({ length: 36, name: 'trace_id', nullable: true })
  traceId: string | null;

  /** trace_id rodzica — np. dla Form 4 trades parent = filing traceId. */
  @Column({ length: 36, name: 'parent_trace_id', nullable: true })
  parentTraceId: string | null;

  /** Poziom logu: debug | info | warn | error. Wpływa na retencję (tiered cleanup). */
  @Index()
  @Column({ length: 5, nullable: true })
  level: string | null;

  /** Ticker ekstraktowany z payload/output — fast filter bez JSONB query. */
  @Column({ length: 10, nullable: true })
  ticker: string | null;

  /** Powód decyzji — np. SKIP_LOW_VALUE, ALERT_SENT_TELEGRAM, PATTERNS_DETECTED. */
  @Column({ length: 80, name: 'decision_reason', nullable: true })
  decisionReason: string | null;

  // ── Istniejące ──────────────────────────────────────────

  /** Komunikat błędu (stack trace) */
  @Column({ type: 'text', nullable: true, name: 'error_message' })
  errorMessage: string | null;
}
