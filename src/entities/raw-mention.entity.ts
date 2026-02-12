import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { DataSource } from '../common/interfaces/data-source.enum';

/**
 * Surowa wzmianka z Reddit, StockTwits lub innego źródła.
 * Przechowuje oryginalne dane przed analizą sentymentu.
 */
@Entity('raw_mentions')
export class RawMention {
  @PrimaryGeneratedColumn()
  id: number;

  /** Źródło danych */
  @Column({ type: 'enum', enum: DataSource })
  source: DataSource;

  /** ID zewnętrzne (unikalne per źródło — zapobiega duplikatom) */
  @Index()
  @Column({ length: 100 })
  externalId: string;

  /** Autor wpisu */
  @Column({ length: 100, nullable: true })
  author: string;

  /** Tytuł (np. tytuł posta Reddit) */
  @Column({ type: 'text', nullable: true })
  title: string;

  /** Treść wpisu */
  @Column({ type: 'text' })
  body: string;

  /** Wykryte tickery (JSON array, np. ["UNH", "MOH"]) */
  @Column('jsonb', { default: [] })
  detectedTickers: string[];

  /** URL do oryginalnego wpisu */
  @Column({ length: 500, nullable: true })
  url: string;

  /** Subreddit lub kanał źródłowy */
  @Column({ length: 100, nullable: true })
  channel: string;

  /** Liczba upvotes/likes w momencie pobrania */
  @Column({ default: 0 })
  score: number;

  /** Liczba komentarzy */
  @Column({ default: 0 })
  commentsCount: number;

  /** Sentyment z źródła (np. StockTwits Bullish/Bearish) */
  @Column({ length: 20, nullable: true })
  sourceSentiment: string;

  /** Kiedy wpis został opublikowany (czas autora) */
  @Column({ type: 'timestamptz', nullable: true })
  publishedAt: Date;

  /** Kiedy wpis został pobrany przez nas */
  @CreateDateColumn()
  collectedAt: Date;
}
