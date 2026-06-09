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

/** Throttling per pattern type (sekundy).
 *
 * Pakiet 1 fix #3 (09.06.2026): INSIDER_PLUS_8K + INSIDER_PLUS_OPTIONS 2h → 72h.
 * Forward 09.04-08.06: jedyne post-fixowe (02.05) redundancje to HIMS re-broadcasty
 * tego samego kierunku w 2-3 dni (3/11 delivered); 72h tnie 2/3 z nich kosztem zero
 * utraconych winnerów w 50d sample (cuts to duplikaty albo losery; first-wins
 * zachowuje 100% Form 4 BUY które i tak mają standalone alert). Wariant 1-liner
 * zamiast pełnego cross-rule throttle (M, 7 plików) — pełny cross-rule dopiero
 * gdy forward pokaże powtórzenia między regułami, nie wewnątrz patternu. */
export const PATTERN_THROTTLE: Record<PatternType, number> = {
  INSIDER_PLUS_8K: 259200,         // 72h (Pakiet 1 fix #3; było 2h)
  FILING_CONFIRMS_NEWS: 14400,     // 4h
  MULTI_SOURCE_CONVERGENCE: 7200,  // 2h
  INSIDER_CLUSTER: 86400,          // 24h
  ESCALATING_SIGNAL: 21600,        // 6h
  INSIDER_PLUS_OPTIONS: 259200,    // 72h (Pakiet 1 fix #3; było 2h)
};
