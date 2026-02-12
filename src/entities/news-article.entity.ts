import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Artykuł newsowy z Finnhub lub innego źródła.
 */
@Entity('news_articles')
export class NewsArticle {
  @PrimaryGeneratedColumn()
  id: number;

  /** Ticker powiązany z artykułem */
  @Index()
  @Column({ length: 10 })
  symbol: string;

  /** Tytuł artykułu */
  @Column({ type: 'text' })
  headline: string;

  /** Źródło (np. "Yahoo", "MarketWatch", "Benzinga") */
  @Column({ length: 100 })
  source: string;

  /** URL do artykułu */
  @Column({ length: 500 })
  url: string;

  /** Podsumowanie artykułu */
  @Column({ type: 'text', nullable: true })
  summary: string;

  /** Kategoria newsa (np. "company", "market", "forex") */
  @Column({ length: 50, nullable: true })
  category: string;

  /** Wynik sentymentu po analizie (null = nie analizowano jeszcze) */
  @Column('decimal', { precision: 4, scale: 3, nullable: true })
  sentimentScore: number;

  /** Kiedy artykuł został opublikowany */
  @Index()
  @Column({ type: 'timestamptz' })
  publishedAt: Date;

  @CreateDateColumn()
  collectedAt: Date;
}
