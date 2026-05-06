/**
 * S19-FIX-12: typy dla porównania raportu z analyst consensus.
 *
 * Trigger: PODD 06.05.2026 alert CRITICAL conviction 1.40 mimo że stock spadł
 * -9.7% po raporcie. Analiza: EPS beat +16% (mocny), ale revenue ledwo pobił
 * konsensus (~+1.8%), a stock już -25% w 30d przed earnings ("smart money exit").
 * GPT chwalił "wzrost +33.9% YoY" nie wiedząc że konsensus oczekiwał wyższego.
 *
 * Intel-class case (metafora): raport $100B revenue (headline imponujący)
 * vs forecast $120B → miss -16.7% → dip mimo "rekordowych przychodów".
 * GPT bez liczby konsensusu interpretuje jako bullish.
 *
 * Fix: pre-LLM fetch consensus z dwóch źródeł (Finnhub free dla EPS,
 * Alpha Vantage free dla revenue forward), inject jako structured block do
 * prompta. Post-GPT guard cap'uje conviction gdy surprise < threshold.
 */

export interface ConsensusComparison {
  /** EPS reported actual (z Finnhub /stock/earnings.actual) */
  epsActual: number | null;
  /** EPS analyst consensus pre-earnings (z Finnhub /stock/earnings.estimate) */
  epsEstimate: number | null;
  /** EPS surprise % (positive = beat, negative = miss). null gdy brak danych. */
  epsSurprisePct: number | null;

  /** Revenue reported actual w USD (extract z reportText, regex) */
  revenueActual: number | null;
  /** Revenue analyst consensus dla raportowanego Q (Alpha Vantage forward estimate) */
  revenueEstimate: number | null;
  /** Revenue surprise % (positive = beat, negative = miss). null gdy brak danych. */
  revenueSurprisePct: number | null;

  /** Liczba analityków pokrywających ticker (z Alpha Vantage analyst_count) */
  analystCount: number | null;

  /** Period raportu (np. "2026-03-31" dla Q1 2026) */
  period: string | null;

  /** Timestamp pobrania (do debug / staleness check) */
  fetchedAt: Date;

  /** True gdy nie udało się pobrać żadnych danych (oba źródła zawiodły) */
  isEmpty: boolean;
}

/**
 * Sformatowany blok do wstrzyknięcia w prompt 8-K Item 2.02.
 * null gdy ConsensusComparison.isEmpty === true (brak inject — pipeline kontynuuje
 * bez consensus context, GPT analizuje sam tekst raportu jak dotychczas).
 */
export type ConsensusPromptBlock = string | null;
