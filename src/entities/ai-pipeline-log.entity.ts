import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { DataSource } from '../common/interfaces/data-source.enum';

/**
 * Log egzekucji pipeline AI sentymentu.
 * Rejestruje każde uruchomienie procesora: od odbioru jobu z kolejki
 * przez FinBERT → klasyfikację tieru → eskalację do Azure VM → wynik.
 * Służy do diagnostyki i monitoringu pipeline na dashboardzie.
 */
@Entity('ai_pipeline_logs')
@Index(['symbol', 'createdAt'])
export class AiPipelineLog {
  @PrimaryGeneratedColumn()
  id: number;

  /** Ticker (np. MRNA, BMY) */
  @Index()
  @Column({ length: 10 })
  symbol: string;

  /** Źródło danych (STOCKTWITS, FINNHUB, SEC_EDGAR) */
  @Column({ type: 'enum', enum: DataSource })
  source: DataSource;

  /** Typ źródłowego rekordu: mention | article */
  @Column({ length: 20, name: 'entity_type' })
  entityType: string;

  /** ID źródłowego rekordu (raw_mentions.id lub news_articles.id) */
  @Column({ name: 'entity_id' })
  entityId: number;

  /**
   * Status pipeline:
   * AI_ESCALATED — sukces, pełna analiza AI
   * FINBERT_ONLY — Tier 3, pominięto AI
   * AI_FAILED — Azure VM zwróciło błąd/timeout
   * AI_DISABLED — Tier 1/2 ale VM niedostępna
   * FINBERT_FALLBACK — Strong FinBERT Signal (bez VM)
   * SKIPPED_SHORT — tekst < 20 znaków
   * SKIPPED_NOT_FOUND — brak rekordu w bazie
   * ERROR — wyjątek
   */
  @Index()
  @Column({ length: 30 })
  status: string;

  /** Tier eskalacji: 1, 2, 3 lub null (jeśli pominięto przed klasyfikacją) */
  @Column({ type: 'smallint', nullable: true })
  tier: number | null;

  /** Powód klasyfikacji tier (np. "strong_signal (confidence=0.821, absScore=0.672)") */
  @Column({ type: 'text', nullable: true, name: 'tier_reason' })
  tierReason: string | null;

  /** Wynik FinBERT: score */
  @Column('decimal', { precision: 4, scale: 3, nullable: true, name: 'finbert_score' })
  finbertScore: number | null;

  /** Wynik FinBERT: confidence */
  @Column('decimal', { precision: 4, scale: 3, nullable: true, name: 'finbert_confidence' })
  finbertConfidence: number | null;

  /** Tekst wysłany do analizy (skrócony do 500 znaków) */
  @Column({ type: 'text', nullable: true, name: 'input_text' })
  inputText: string | null;

  /** Kontekst PDUFA wstrzyknięty do prompta AI */
  @Column({ type: 'text', nullable: true, name: 'pdufa_context' })
  pdufaContext: string | null;

  /** Pełny payload wysłany do Azure VM (JSON) */
  @Column({ type: 'jsonb', nullable: true, name: 'request_payload' })
  requestPayload: Record<string, any> | null;

  /** Odpowiedź z Azure VM (pełny EnrichedAnalysis) */
  @Column({ type: 'jsonb', nullable: true, name: 'response_payload' })
  responsePayload: Record<string, any> | null;

  /** Czas przetwarzania FinBERT w ms */
  @Column({ type: 'int', nullable: true, name: 'finbert_duration_ms' })
  finbertDurationMs: number | null;

  /** Czas przetwarzania Azure VM w ms (round-trip) */
  @Column({ type: 'int', nullable: true, name: 'azure_duration_ms' })
  azureDurationMs: number | null;

  /** Komunikat błędu (jeśli wystąpił) */
  @Column({ type: 'text', nullable: true, name: 'error_message' })
  errorMessage: string | null;

  /** ID zapisanego sentiment_score (jeśli powstał) */
  @Column({ type: 'int', nullable: true, name: 'sentiment_score_id' })
  sentimentScoreId: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
