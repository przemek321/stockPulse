import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { DataSource } from '../common/interfaces/data-source.enum';

/**
 * Wynik analizy sentymentu — dane time-series.
 * Tabela będzie hypertable TimescaleDB (partycjonowana po timestamp).
 */
@Entity('sentiment_scores')
@Index(['symbol', 'timestamp'])
export class SentimentScore {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ length: 10 })
  symbol: string;

  /** Wynik sentymentu: -1.0 (ultra bearish) do +1.0 (ultra bullish) */
  @Column('decimal', { precision: 4, scale: 3 })
  score: number;

  /** Poziom pewności modelu: 0.0 do 1.0 */
  @Column('decimal', { precision: 4, scale: 3, default: 0 })
  confidence: number;

  /** Źródło danych */
  @Column({ type: 'enum', enum: DataSource })
  source: DataSource;

  /** Model użyty do analizy: keyword, finbert, claude */
  @Column({ length: 50, default: 'keyword' })
  model: string;

  /** Oryginalny tekst (skrócony do 500 znaków) */
  @Column({ type: 'text', nullable: true })
  rawText: string;

  /** ID zewnętrzne (np. Reddit post ID, StockTwits message ID) */
  @Column({ length: 100, nullable: true })
  externalId: string;

  /**
   * Wzbogacona analiza z LLM (gpt-4o-mini).
   * Nullable — wypełniane tylko gdy tekst przeszedł eskalację do 2. etapu pipeline.
   * Zawiera: sentiment, urgency, relevance, novelty, confidence, source_authority,
   * conviction, catalyst_type, price_impact, summary, escalation_reason.
   */
  @Column({ type: 'jsonb', nullable: true })
  enrichedAnalysis: Record<string, any> | null;

  /** Timestamp pomiaru — klucz partycjonowania TimescaleDB */
  @Index()
  @CreateDateColumn()
  timestamp: Date;
}
