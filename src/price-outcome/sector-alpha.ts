/**
 * Sector-adjusted alpha — wydziela "edge" alertu od szumu sektora.
 *
 * Surowy priceChange % miesza dwa sygnały:
 *  1. Alpha (edge alertu) — to chcemy mierzyć
 *  2. Sector beta exposure — ruch sektora niezależny od katalizatora alertu (szum)
 *
 * Dla biotech (typowa beta vs XBI 1.0-2.5) sektor regime tego okna może
 * dominować outcome. Bez sector-adjustment nie da się rozróżnić "real signal"
 * od "biotech minął -5% w okno, alert nic nie wyjaśnia".
 *
 * Patrz `doc/FOLLOWUP-XBI-ADJUSTMENT.md` dla pełnego rationale i triggera (BIIB
 * 14.05.2026 case interpretation ambiguity).
 *
 * Beta=1.0 default — consensus dla biotech ETF members, błąd rzędu ±20%
 * acceptable for outcome interpretation. Per-ticker historical beta to
 * enhancement Fazy 2 (TTM, 60-day rolling).
 */

/**
 * Oblicza sector-adjusted alpha %.
 *
 * @param tickerChangePct % zmiana ceny tickera w okno (np. +5.2 dla wzrostu o 5.2%)
 * @param benchmarkChangePct % zmiana benchmark (XBI/IBB) w tym samym oknie
 * @param beta opcjonalny per-ticker beta vs benchmark, default 1.0
 * @returns alpha % = tickerChangePct - (beta × benchmarkChangePct)
 */
export function computeSectorAlpha(
  tickerChangePct: number,
  benchmarkChangePct: number,
  beta: number = 1.0,
): number {
  return tickerChangePct - beta * benchmarkChangePct;
}

/**
 * Pomocnik: % change z dwóch cen (priceAtAlert, priceLater).
 * Zwraca null gdy którakolwiek cena nieprawidłowa (null, 0, ujemna).
 */
export function pctChange(
  priceAtAlert: number | null,
  priceLater: number | null,
): number | null {
  if (
    priceAtAlert == null ||
    priceLater == null ||
    priceAtAlert <= 0 ||
    priceLater <= 0
  ) {
    return null;
  }
  return ((priceLater - priceAtAlert) / priceAtAlert) * 100;
}

/**
 * Computes both raw priceChange % and sector-adjusted alpha % for an alert outcome.
 *
 * Returns null dla alpha gdy brak XBI/IBB snapshot (legacy alerts pre-FOLLOWUP).
 * Caller decyduje który benchmark fairer fit (XBI dla mid-cap biotech,
 * IBB dla large-cap pharma >$10B).
 */
export interface AlphaResult {
  rawPct: number | null;
  xbiAlphaPct: number | null;
  ibbAlphaPct: number | null;
}

export function computeAlphaForSlot(args: {
  priceAtAlert: number | null;
  priceLater: number | null;
  xbiAtAlert: number | null;
  xbiLater: number | null;
  ibbAtAlert: number | null;
  ibbLater: number | null;
  beta?: number;
}): AlphaResult {
  const beta = args.beta ?? 1.0;
  const rawPct = pctChange(args.priceAtAlert, args.priceLater);
  const xbiBenchmark = pctChange(args.xbiAtAlert, args.xbiLater);
  const ibbBenchmark = pctChange(args.ibbAtAlert, args.ibbLater);

  return {
    rawPct,
    xbiAlphaPct:
      rawPct != null && xbiBenchmark != null
        ? computeSectorAlpha(rawPct, xbiBenchmark, beta)
        : null,
    ibbAlphaPct:
      rawPct != null && ibbBenchmark != null
        ? computeSectorAlpha(rawPct, ibbBenchmark, beta)
        : null,
  };
}
