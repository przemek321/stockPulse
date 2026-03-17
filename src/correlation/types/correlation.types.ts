/**
 * Typy dla CorrelationService — detekcja wzorców między źródłami sygnałów.
 */

/** Kategoria źródła sygnału — klucz do agregacji */
export type SourceCategory = 'social' | 'news' | 'form4' | '8k' | 'options';

/** Kierunek sygnału */
export type Direction = 'positive' | 'negative';

/** Typ wykrytego wzorca */
export type PatternType =
  | 'INSIDER_PLUS_8K'           // Form 4 + 8-K w ciągu 24h
  | 'FILING_CONFIRMS_NEWS'     // news → potem 8-K tego samego catalyst_type
  | 'MULTI_SOURCE_CONVERGENCE' // 3+ kategorie źródeł, ten sam kierunek, 24h
  | 'INSIDER_CLUSTER'          // 2+ Form 4 tego samego tickera w ciągu 7 dni
  | 'ESCALATING_SIGNAL'        // rosnąca conviction przez 3+ sygnały w 72h
  | 'INSIDER_PLUS_OPTIONS';   // Form 4 + unusual options w ciągu 72h

/** Sygnał przechowywany w Redis po każdym alercie */
export interface StoredSignal {
  id: string;
  ticker: string;
  source_category: SourceCategory;
  /** Znormalizowany conviction [-1.0, +1.0] (effectiveScore) */
  conviction: number;
  direction: Direction | 'neutral';
  catalyst_type: string;
  timestamp: number; // unix ms
}

/** Wzorzec wykryty przez detektor */
export interface DetectedPattern {
  type: PatternType;
  signals: StoredSignal[];
  /** Zagregowana conviction [-1.0, +1.0] */
  correlated_conviction: number;
  direction: Direction;
  description: string;
}

/** Mapowanie typu wzorca na czytelną etykietę */
export const PATTERN_LABELS: Record<PatternType, string> = {
  INSIDER_PLUS_8K: 'Insider + SEC Filing',
  FILING_CONFIRMS_NEWS: 'News Confirmed by Filing',
  MULTI_SOURCE_CONVERGENCE: 'Multi-Source Convergence',
  INSIDER_CLUSTER: 'Insider Cluster',
  ESCALATING_SIGNAL: 'Escalating Signal',
  INSIDER_PLUS_OPTIONS: 'Insider + Unusual Options',
};

/** Throttling per pattern type (sekundy) */
export const PATTERN_THROTTLE: Record<PatternType, number> = {
  INSIDER_PLUS_8K: 7200,           // 2h
  FILING_CONFIRMS_NEWS: 14400,     // 4h
  MULTI_SOURCE_CONVERGENCE: 7200,  // 2h
  INSIDER_CLUSTER: 86400,          // 24h
  ESCALATING_SIGNAL: 21600,        // 6h
  INSIDER_PLUS_OPTIONS: 7200,      // 2h
};
