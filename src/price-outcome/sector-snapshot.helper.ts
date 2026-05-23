import { FinnhubService } from '../collectors/finnhub/finnhub.service';

/**
 * Snapshot 3 cen równolegle: ticker + XBI + IBB.
 *
 * Patrz `doc/FOLLOWUP-XBI-ADJUSTMENT.md` (trigger: BIIB 14.05.2026 outcome
 * interpretation ambiguity). Bez XBI/IBB priceAtAlert nie da się policzyć
 * sector-adjusted alpha — `priceAtAlert - benchmarkAtAlert` jest wymaganym
 * warunkiem pełnego alpha computation.
 *
 * Wszystkie 3 fetches parallel (Promise.all) — Finnhub free 60 req/min,
 * 3 fetches per alert daleko od limitu. Każdy z fetches ma własny error
 * handler (.catch) — jeden failure NIE blokuje innych. Częściowy snapshot
 * (np. tylko ticker + XBI) jest acceptable — `computeAlphaForSlot` graceful
 * handle null benchmark dla missing leg.
 *
 * Single source of truth dla "capture 3 quotes" — używane w 7 sites alert
 * dispatch path (Form4, Form8k main + bankruptcy + 5.02, Correlation,
 * OptionsFlow, AlertEvaluator).
 */
export async function captureAlertSnapshot(
  finnhub: FinnhubService | null | undefined,
  symbol: string,
): Promise<{
  priceAtAlert: number | null;
  xbiAtAlert: number | null;
  ibbAtAlert: number | null;
}> {
  if (!finnhub) {
    return { priceAtAlert: null, xbiAtAlert: null, ibbAtAlert: null };
  }
  const [priceAtAlert, xbiAtAlert, ibbAtAlert] = await Promise.all([
    finnhub.getQuote(symbol).catch(() => null),
    finnhub.getQuote('XBI').catch(() => null),
    finnhub.getQuote('IBB').catch(() => null),
  ]);
  return { priceAtAlert, xbiAtAlert, ibbAtAlert };
}
