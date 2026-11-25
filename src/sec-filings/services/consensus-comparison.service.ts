import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsensusComparison, ConsensusPromptBlock } from '../types/consensus-comparison';
import { extractRevenue } from '../utils/extract-reported-numbers';

/**
 * S19-FIX-12: pobiera analyst consensus (EPS + Revenue) z dwóch źródeł:
 *   - Finnhub `/stock/earnings` (FREE, 60 req/min) — historyczne actual + estimate per quarter
 *   - Alpha Vantage `EARNINGS_ESTIMATES` (FREE, 25 req/dzień) — forward fiscal quarter estimate
 *
 * Trigger: PODD 06.05.2026 alert CRITICAL conviction 1.40 mimo że stock spadł
 * -9.7% po raporcie. EPS beat +16% mocny, ale revenue ledwo pobił konsensus
 * (+1.8%). GPT bez liczby konsensusu w prompcie chwalił "wzrost +33.9% YoY"
 * jako bullish — nie wiedział że konsensus oczekiwał wyższego.
 *
 * Strategy:
 *   - Step 1: Finnhub /stock/earnings → najnowszy quarter actual+estimate EPS
 *     (po raporcie 8-K Item 2.02 dane są aktualizowane w 0-24h)
 *   - Step 2: Alpha Vantage EARNINGS_ESTIMATES → forward Q estimate dla EPS i Revenue
 *     (dla raportowanego Q estimate jest "current quarter just reported" — z Alpha Vantage
 *     pobieramy najbliższy fiscal quarter z analyst estimate avg)
 *   - Step 3: extract revenue actual z reportText (regex) — Alpha Vantage free
 *     nie ma actual revenue, Finnhub też nie zwraca revenue per quarter w free tier
 *   - Step 4: calculate surprise %, return ConsensusComparison
 *
 * Graceful degradation: Promise.allSettled — jeśli któreś źródło zawiedzie
 * (timeout, HTTP error, brak klucza), pozostałe pola są wypełnione. Pipeline
 * NIE traci całego alertu z powodu unavailability consensus API.
 *
 * Fix 25.11.2026 (GDRX): Finnhub uzupełnia `actual` z opóźnieniem (często >24h),
 * więc „najnowszy period" bywa POPRZEDNIM kwartałem. Przed użyciem EPS sprawdzamy
 * `assessReportedPeriod` — przy nieaktualnym okresie EPS z Finnhub jest pomijany
 * (null), a szacunek przychodów bierzemy z Alpha Vantage dla kwartału faktycznie
 * raportowanego. Dodatkowo bezpiecznik `isImplausibleRevenueBeat` odrzuca
 * absurdalnie dodatnie zaskoczenie przychodów (regex złapał prognozę roczną).
 */

/**
 * Maksymalny odstęp (dni) między końcem kwartału a publikacją jego wyników.
 * Raport w terminie: 20–60 dni po końcu kwartału, Q4 do ~90 (termin 10-K dla
 * najmniejszych spółek). Poprzedni kwartał ma w dniu raportu co najmniej
 * ~90 + 10 dni (kwartał trwa 90–92 dni), typowo 110+. Okres Finnhub starszy niż
 * ten próg względem daty odniesienia = od tamtej pory skończył się już kolejny
 * kwartał, czyli dane Finnhub NIE dotyczą kwartału właśnie raportowanego.
 * Ten sam próg ogranicza wiek wiersza Alpha Vantage uznawanego za kwartał
 * raportowany (starszy wiersz = AV też nie ma bieżącego kwartału).
 */
export const FINNHUB_PERIOD_MAX_AGE_DAYS = 100;

/**
 * Minimalny odstęp (dni), przy którym wiersz Alpha Vantage uznajemy za INNY,
 * późniejszy kwartał niż `period` z Finnhub. Kolejne kwartały fiskalne dzieli
 * ~91 dni (min. ~84 przy kalendarzach 52/53 tyg.), a rozjazd etykiet tego samego
 * kwartału między źródłami (np. 27.09 vs 30.09) to najwyżej kilka–kilkanaście
 * dni — połowa kwartału rozdziela oba przypadki z zapasem.
 */
export const MIN_QUARTER_GAP_DAYS = 45;

/**
 * Bezpiecznik zaskoczenia przychodów: `revenueActual / revenueEstimate` powyżej
 * tego progu (zaskoczenie > +150%) traktujemy jako niezgodność okresu/jednostek,
 * nie jako beat. Przypadki z produkcji: HIMS 09.11.2026 +329% (realnie +22%),
 * UHS 28.07.2026 +304% — regex przychodów złapał prognozę całoroczną.
 * TYLKO w górę: skrajnie ujemnych zaskoczeń nie zerujemy (zniosłoby to cap R1
 * w consensus-gap-guard dla prawdziwych missów).
 */
export const REVENUE_SURPRISE_MAX_RATIO = 2.5;

const DAY_MS = 86_400_000;

@Injectable()
export class ConsensusComparisonService {
  private readonly logger = new Logger(ConsensusComparisonService.name);
  private readonly finnhubKey: string | undefined;
  private readonly alphaVantageKey: string | undefined;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.finnhubKey = this.config.get<string>('FINNHUB_API_KEY') || undefined;
    this.alphaVantageKey = this.config.get<string>('ALPHA_VANTAGE_API_KEY') || undefined;
    this.timeoutMs = this.config.get<number>('CONSENSUS_TIMEOUT_MS', 5000);
  }

  /**
   * Pobiera consensus dla raportowanego quarter i porównuje z reported numbers.
   * Zwraca null gdy oba źródła zawiodą (caller traktuje to jak "consensus unavailable" — pipeline kontynuuje).
   *
   * S19-FIX-13 Faza 1: parallel fetch (Finnhub + Alpha Vantage raw), potem
   * post-process Alpha Vantage estimates z Finnhub.period — preferuj estimate
   * dla raportowanego Q (`matched`), fallback do forward proxy. Brak re-fetch
   * (Blef #3 critique: Alpha Vantage zwraca pełen archive jednym callem, period
   * filtering to local code).
   *
   * @param referenceDate data odniesienia do oceny aktualności okresu Finnhub —
   *   pipeline przekazuje datę filingu 8-K; domyślnie „teraz". Niepoprawna data
   *   (Invalid Date) → fallback do „teraz".
   */
  async fetchAndCompare(
    symbol: string,
    reportText: string,
    referenceDate: Date = new Date(),
  ): Promise<ConsensusComparison> {
    const fetchedAt = new Date();
    const refDate = Number.isNaN(referenceDate.getTime()) ? fetchedAt : referenceDate;

    const [finnhubResult, alphaRawResult] = await Promise.allSettled([
      this.fetchFinnhubEarnings(symbol),
      this.fetchAlphaVantageEstimatesRaw(symbol),
    ]);

    const finnhubRaw = finnhubResult.status === 'fulfilled' ? finnhubResult.value : null;
    const alphaRaw = alphaRawResult.status === 'fulfilled' ? alphaRawResult.value : null;

    // Fix 25.11.2026 (GDRX): czy „najnowszy period" Finnhub to kwartał właśnie
    // raportowany? Jeśli nie — EPS actual/estimate z Finnhub dotyczą POPRZEDNIEGO
    // kwartału i nie mogą zasilać guarda ani promptu. Celowo NIE dorabiamy EPS
    // actual z regexa na tekście (ryzyko GAAP vs adjusted): brak pełnych danych
    // kieruje byczy alert do DB-only (`bullish_no_consensus_data`) zamiast oceniać
    // go na złym kwartale.
    const assessment = assessReportedPeriod(finnhubRaw?.period ?? null, alphaRaw ?? [], refDate);
    const finnhub = assessment.finnhubStale ? null : finnhubRaw;
    const staleDiag: Pick<ConsensusComparison, 'finnhubStale' | 'finnhubStalePeriod'> =
      assessment.finnhubStale
        ? { finnhubStale: true, finnhubStalePeriod: finnhubRaw?.period ?? null }
        : { finnhubStale: false };
    if (assessment.finnhubStale) {
      const reportedLabel = assessment.reportedRow?.date ?? 'brak wiersza (fallback forward proxy)';
      this.logger.warn(
        `Finnhub period nieaktualny ${symbol}: period=${finnhubRaw?.period ?? '?'} ` +
          `(${assessment.finnhubAgeDays ?? '?'} dni przed datą odniesienia ${refDate.toISOString().slice(0, 10)}, ` +
          `próg ${FINNHUB_PERIOD_MAX_AGE_DAYS}) — EPS z Finnhub pominięty; ` +
          `kwartał raportowany wg AlphaVantage: ${reportedLabel}`,
      );
    }

    // FIX-13: selection logic na local data — bez 2nd HTTP call. Jeśli mamy
    // period z Finnhub i Alpha Vantage zawiera estimate dla tej daty → matched.
    // Inaczej forward proxy (najbliższy fiscal quarter >= data odniesienia).
    // Przy nieaktualnym Finnhub dopasowujemy do kwartału faktycznie raportowanego
    // (wiersz AV z `assessReportedPeriod`); gdy AV go nie ma → forward proxy.
    // NIGDY nie dopasowujemy do nieaktualnego okresu (to był błąd GDRX: szacunek
    // przychodów Q2 porównany z przychodem actual Q3).
    const reportedPeriod = assessment.finnhubStale
      ? (assessment.reportedRow?.date ?? null)
      : (finnhubRaw?.period ?? null);
    const alpha = alphaRaw
      ? selectAlphaEstimate(alphaRaw, reportedPeriod, this.logger, symbol, refDate)
      : null;

    if (!finnhub && !alpha) {
      if (!assessment.finnhubStale) {
        this.logger.warn(`Consensus fetch ${symbol}: oba źródła zawiodły (Finnhub + AlphaVantage)`);
      }
      return { ...this.buildEmpty(fetchedAt), ...staleDiag };
    }

    const epsActual = finnhub?.epsActual ?? null;
    const epsEstimate = finnhub?.epsEstimate ?? null;
    const epsSurprisePct = computeSurprisePct(epsActual, epsEstimate);

    const extractedRevenue = extractRevenue(reportText);
    const alphaRevenueEstimate = alpha?.revenueEstimate ?? null;

    // Bezpiecznik (HIMS +329%, UHS +304%): absurdalnie dodatnie zaskoczenie =
    // niezgodność okresu/jednostek. Nie wiemy, która liczba jest błędna (actual
    // z regexa czy estimate z AV), więc do wyniku — a przez to do promptu GPT
    // i guardów — nie trafia żadna z nich; oryginały zostają w `revenueRejected`.
    const revenueRejected = isImplausibleRevenueBeat(extractedRevenue, alphaRevenueEstimate);
    if (revenueRejected && extractedRevenue !== null && alphaRevenueEstimate !== null) {
      this.logger.warn(
        `Revenue surprise odrzucony ${symbol}: actual=${extractedRevenue} vs estimate=${alphaRevenueEstimate} ` +
          `(ratio ${(extractedRevenue / alphaRevenueEstimate).toFixed(2)} > ${REVENUE_SURPRISE_MAX_RATIO}) — ` +
          `niezgodność okresu/jednostek, revenueSurprisePct=null`,
      );
    }
    const revenueActual = revenueRejected ? null : extractedRevenue;
    const revenueEstimate = revenueRejected ? null : alphaRevenueEstimate;
    const revenueSurprisePct = computeSurprisePct(revenueActual, revenueEstimate);

    const period = finnhub?.period ?? alpha?.period ?? null;
    const analystCount = alpha?.analystCount ?? null;

    // FIX-13 Faza 1: log diff Finnhub vs Alpha Vantage EPS estimate (obserwacja 14d
    // — które źródło preferować jako primary EPS po Q2 earnings season). Drift
    // raport z weekend: GILD Finnhub +0.7% → +3.97% w 1h, AV stabilne. Dane do
    // decyzji architektonicznej w Faza 3, bez aktywnego użycia w Faza 1.
    //
    // Code review 14.05.2026 #10: log na info level (7d retention) zamiast debug (2d).
    // Faza 2 obserwacji jest 14d, debug retention zbyt krótkie żeby zebrać meaningful
    // sample. Info ma 7d — wystarczy do dwu-tygodniowego okna gdy łączymy z DB query
    // pre-cleanup. Q2 earnings season (lipiec) prawdziwa walidacja decision Finnhub
    // vs AV primary EPS source — wtedy raise to warn jeśli decyzja będzie odłożona.
    // Przy nieaktualnym Finnhub (`finnhub` = null) diff nie jest logowany — porównywałby
    // szacunki dwóch różnych kwartałów.
    if (
      finnhub?.epsEstimate !== null &&
      finnhub?.epsEstimate !== undefined &&
      alpha?.epsEstimate !== null &&
      alpha?.epsEstimate !== undefined &&
      alpha.epsEstimate !== 0
    ) {
      const diffPct =
        ((finnhub.epsEstimate - alpha.epsEstimate) / Math.abs(alpha.epsEstimate)) * 100;
      this.logger.log(
        `consensus source diff ${symbol} period=${period ?? '?'}: ` +
          `Finnhub eps=${finnhub.epsEstimate.toFixed(4)}, ` +
          `AlphaVantage eps=${alpha.epsEstimate.toFixed(4)} ` +
          `(diff ${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(2)}%)`,
      );
    }

    return {
      epsActual,
      epsEstimate,
      epsSurprisePct,
      revenueActual,
      revenueEstimate,
      revenueSurprisePct,
      analystCount,
      period,
      fetchedAt,
      isEmpty: false,
      revenueSource: alpha?.source,
      epsEstimateAlphaVantage: alpha?.epsEstimate ?? null,
      ...staleDiag,
      ...(revenueRejected && extractedRevenue !== null && alphaRevenueEstimate !== null
        ? { revenueRejected: { actual: extractedRevenue, estimate: alphaRevenueEstimate } }
        : {}),
    };
  }

  private buildEmpty(fetchedAt: Date): ConsensusComparison {
    return {
      epsActual: null,
      epsEstimate: null,
      epsSurprisePct: null,
      revenueActual: null,
      revenueEstimate: null,
      revenueSurprisePct: null,
      analystCount: null,
      period: null,
      fetchedAt,
      isEmpty: true,
    };
  }

  private async fetchFinnhubEarnings(symbol: string): Promise<{
    epsActual: number | null;
    epsEstimate: number | null;
    period: string | null;
  } | null> {
    if (!this.finnhubKey) return null;

    const url = `https://finnhub.io/api/v1/stock/earnings?symbol=${encodeURIComponent(symbol)}&token=${this.finnhubKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!res.ok) {
      this.logger.warn(`Finnhub earnings ${symbol}: HTTP ${res.status}`);
      return null;
    }

    const json = (await res.json()) as {
      actual: number | null;
      estimate: number | null;
      period: string;
      surprisePercent?: number;
    }[];

    if (!Array.isArray(json) || json.length === 0) return null;

    // Najnowszy quarter (po dacie period desc)
    const sorted = [...json].sort((a, b) => (b.period || '').localeCompare(a.period || ''));
    const latest = sorted[0];

    return {
      epsActual: typeof latest.actual === 'number' ? latest.actual : null,
      epsEstimate: typeof latest.estimate === 'number' ? latest.estimate : null,
      period: latest.period ?? null,
    };
  }

  /**
   * S19-FIX-13 Faza 1: HTTP fetch tylko — zwraca raw quarterly estimates (lub null
   * przy errorze/braku klucza). Selection logic (matched vs forward) jest w
   * `selectAlphaEstimate` (pure function), żeby `fetchAndCompare` mógł re-select
   * po otrzymaniu Finnhub.period bez 2nd HTTP call.
   *
   * Empirical finding (research 2026-05-11): Alpha Vantage zachowuje per-quarter
   * estimates w pełnej historii (≥2017), W TYM dla just-reported Q (estimate przed
   * raportem nie jest zastąpiony przez actual). Czyli matched-period estimate dla
   * raportowanego Q to prawdziwa pre-report consensus value.
   */
  private async fetchAlphaVantageEstimatesRaw(symbol: string): Promise<AlphaVantageEstimateRow[] | null> {
    if (!this.alphaVantageKey) return null;

    const url = `https://www.alphavantage.co/query?function=EARNINGS_ESTIMATES&symbol=${encodeURIComponent(symbol)}&apikey=${this.alphaVantageKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!res.ok) {
      this.logger.warn(`AlphaVantage estimates ${symbol}: HTTP ${res.status}`);
      return null;
    }

    const json = (await res.json()) as {
      symbol?: string;
      estimates?: {
        date: string;
        horizon: string;
        eps_estimate_average?: string;
        revenue_estimate_average?: string;
        revenue_estimate_analyst_count?: string;
      }[];
      Information?: string;
      Note?: string;
    };

    // Alpha Vantage rate-limit message
    if (json.Information || json.Note) {
      this.logger.warn(`AlphaVantage rate-limited dla ${symbol}: ${json.Information ?? json.Note ?? ''}`);
      return null;
    }

    if (!json.estimates || json.estimates.length === 0) return null;

    return json.estimates
      .filter(e => e.horizon === 'fiscal quarter')
      .map(e => ({
        date: e.date ?? null,
        epsEstimate: e.eps_estimate_average ? parseFloat(e.eps_estimate_average) : null,
        revenueEstimate: e.revenue_estimate_average ? parseFloat(e.revenue_estimate_average) : null,
        analystCount: e.revenue_estimate_analyst_count
          ? parseInt(e.revenue_estimate_analyst_count, 10)
          : null,
      }));
  }
}

/** S19-FIX-13: parsed Alpha Vantage row (jeden fiscal quarter estimate). */
export interface AlphaVantageEstimateRow {
  date: string | null;
  epsEstimate: number | null;
  revenueEstimate: number | null;
  analystCount: number | null;
}

/**
 * S19-FIX-13 Faza 1: wybiera estimate dla raportowanego Q (matched) lub fallback
 * do najbliższego forward Q (proxy). Pure function — testowalna w izolacji.
 *
 * Anomaly guard (Blef #6 critique): rev<1M lub |eps|>50 → log WARN ale pass-through
 * value (NIE reject). Reject działał silent — caller dostawał null bez context;
 * pass-through pozwala downstream guard'om (consensus-gap-guard) zobaczyć liczby
 * + my mamy log audytowy.
 */
export function selectAlphaEstimate(
  rows: AlphaVantageEstimateRow[],
  reportedPeriod: string | null,
  logger: Logger,
  symbol: string,
  referenceDate: Date = new Date(),
): {
  revenueEstimate: number | null;
  epsEstimate: number | null;
  analystCount: number | null;
  period: string | null;
  source: 'matched' | 'forward';
} | null {
  if (rows.length === 0) return null;

  // Próba matched period
  if (reportedPeriod) {
    const matched = rows.find(r => r.date === reportedPeriod);
    if (matched) {
      maybeWarnAnomaly(matched, logger, symbol);
      return {
        revenueEstimate: validNumber(matched.revenueEstimate),
        epsEstimate: validNumber(matched.epsEstimate),
        analystCount: validNumber(matched.analystCount),
        period: matched.date,
        source: 'matched',
      };
    }
  }

  // Fallback forward proxy (najbliższy fiscal quarter >= data odniesienia, domyślnie dziś)
  const todayIso = referenceDate.toISOString().slice(0, 10);
  const forward = rows
    .filter(r => (r.date || '') >= todayIso)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  if (forward.length === 0) return null;

  const target = forward[0];
  maybeWarnAnomaly(target, logger, symbol);
  return {
    revenueEstimate: validNumber(target.revenueEstimate),
    epsEstimate: validNumber(target.epsEstimate),
    analystCount: validNumber(target.analystCount),
    period: target.date,
    source: 'forward',
  };
}

function validNumber(n: number | null): number | null {
  if (n === null) return null;
  return isFinite(n) ? n : null;
}

function maybeWarnAnomaly(row: AlphaVantageEstimateRow, logger: Logger, symbol: string): void {
  if (row.revenueEstimate !== null && isFinite(row.revenueEstimate) && row.revenueEstimate < 1_000_000) {
    logger.warn(
      `AlphaVantage suspect revenue ${symbol} ${row.date ?? '?'}: ` +
        `${row.revenueEstimate} (likely thousands not dollars; passing through)`,
    );
  }
  if (row.epsEstimate !== null && isFinite(row.epsEstimate) && Math.abs(row.epsEstimate) > 50) {
    logger.warn(
      `AlphaVantage suspect EPS ${symbol} ${row.date ?? '?'}: ` +
        `${row.epsEstimate} (likely one-time charge or data issue; passing through)`,
    );
  }
}

/** Wynik oceny, czy `period` z Finnhub to kwartał właśnie raportowany. */
export interface ReportedPeriodAssessment {
  /** true = okres Finnhub to NIE jest kwartał raportowany (dane z poprzedniego kwartału) */
  finnhubStale: boolean;
  /** Dni od końca okresu Finnhub do daty odniesienia; null gdy brak/niepoprawny period */
  finnhubAgeDays: number | null;
  /**
   * Wiersz Alpha Vantage dla kwartału faktycznie raportowanego = najnowszy kwartał
   * zakończony ≤ data odniesienia, nie starszy niż próg i późniejszy od okresu Finnhub.
   * null gdy AV takiego wiersza nie ma (albo Finnhub jest aktualny).
   */
  reportedRow: AlphaVantageEstimateRow | null;
}

/**
 * Fix 25.11.2026 (GDRX): ocenia, czy najnowszy `period` z Finnhub to kwartał właśnie
 * raportowany. Pure function — testowalna w izolacji.
 *
 * Finnhub jest NIEAKTUALNY, gdy zachodzi którykolwiek warunek:
 *   (a) od końca okresu Finnhub do daty odniesienia minęło > FINNHUB_PERIOD_MAX_AGE_DAYS
 *       (GDRX 24.11.2026: period 30.06 → 147 dni) — działa także bez danych AV;
 *   (b) Alpha Vantage ma wiersz PÓŹNIEJSZEGO kwartału (o > MIN_QUARTER_GAP_DAYS),
 *       który skończył się już przed datą odniesienia. Łapie to, czego sam próg (a)
 *       nie widzi: wstępne wyniki / pre-announcementy składane w pierwszych ~10 dniach
 *       po końcu kwartału (ABBV 05.10.2026: Finnhub 30.06 = 97 dni; na produkcji
 *       8 ze 129 8-K „earnings" wypadło w tym oknie, wszystkie o nowym kwartale).
 *
 * Znana luka: raport złożony PO końcu następnego kwartału (ponad ~90 dni po końcu
 * raportowanego, np. Q4 w kwietniu) — warunek (b) uzna następny kwartał za raportowany.
 * Z samych dat nie da się tego odróżnić od pre-announcementu; skutek jest konserwatywny
 * po stronie EPS (null), ale szacunek przychodów pochodzi wtedy z sąsiedniego kwartału.
 *
 * Brak/niepoprawny `period` → nie orzekamy (finnhubStale=false, zachowanie jak dotąd).
 */
export function assessReportedPeriod(
  finnhubPeriod: string | null,
  rows: AlphaVantageEstimateRow[],
  referenceDate: Date,
): ReportedPeriodAssessment {
  const periodDay = parseIsoDay(finnhubPeriod);
  if (periodDay === null) return { finnhubStale: false, finnhubAgeDays: null, reportedRow: null };

  const refDay = Date.UTC(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    referenceDate.getUTCDate(),
  );
  const finnhubAgeDays = Math.round((refDay - periodDay) / DAY_MS);

  let reportedRow: AlphaVantageEstimateRow | null = null;
  let reportedDay = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const rowDay = parseIsoDay(row.date);
    if (rowDay === null) continue;
    const endedBeforeReference = rowDay < refDay;
    const recentEnough = refDay - rowDay <= FINNHUB_PERIOD_MAX_AGE_DAYS * DAY_MS;
    const laterQuarter = rowDay - periodDay > MIN_QUARTER_GAP_DAYS * DAY_MS;
    if (endedBeforeReference && recentEnough && laterQuarter && rowDay > reportedDay) {
      reportedRow = row;
      reportedDay = rowDay;
    }
  }

  return {
    finnhubStale: finnhubAgeDays > FINNHUB_PERIOD_MAX_AGE_DAYS || reportedRow !== null,
    finnhubAgeDays,
    reportedRow,
  };
}

/** 'YYYY-MM-DD' → ms północy UTC; null dla braku lub innego formatu. */
function parseIsoDay(iso: string | null): number | null {
  if (iso === null || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Bezpiecznik przychodów: true gdy actual/estimate > REVENUE_SURPRISE_MAX_RATIO
 * (zaskoczenie > +150%) — niezgodność okresu/jednostek, nie beat. Tylko w górę:
 * ujemne zaskoczenia (także skrajne) przechodzą bez zmian.
 */
export function isImplausibleRevenueBeat(actual: number | null, estimate: number | null): boolean {
  if (actual === null || estimate === null) return false;
  if (estimate <= 0) return false;
  return actual / estimate > REVENUE_SURPRISE_MAX_RATIO;
}

/**
 * Surprise % = (actual - estimate) / |estimate| * 100. null gdy któreś niedostępne lub estimate=0.
 */
export function computeSurprisePct(actual: number | null, estimate: number | null): number | null {
  if (actual === null || estimate === null) return null;
  if (estimate === 0) return null;
  return ((actual - estimate) / Math.abs(estimate)) * 100;
}

/**
 * Formatuje ConsensusComparison jako Markdown block do wstrzyknięcia w prompt.
 * Zwraca null gdy oba surprise są null (brak sensownej zawartości).
 *
 * Format intentionally redundant — explicit liczby + interpretation rules pomagają
 * GPT nie chwalić "$761.7M revenue +33.9% YoY" jako bullish gdy konsensus oczekiwał
 * $789M (miss) albo gdy surprise jest marginalny (<3%).
 */
export function formatConsensusBlock(comp: ConsensusComparison): ConsensusPromptBlock {
  if (comp.isEmpty) return null;
  if (comp.epsSurprisePct === null && comp.revenueSurprisePct === null) return null;

  const lines: string[] = ['## ANALYST CONSENSUS (pre-earnings — TRUST OVER YOUR INFERENCE FROM HEADLINE NUMBERS)'];

  if (comp.epsActual !== null && comp.epsEstimate !== null && comp.epsSurprisePct !== null) {
    const verdict = surpriseVerdict(comp.epsSurprisePct);
    lines.push(
      `- EPS estimate: $${comp.epsEstimate.toFixed(2)} → actual $${comp.epsActual.toFixed(2)} ` +
        `(surprise: ${formatPct(comp.epsSurprisePct)} ${verdict})`,
    );
  } else if (comp.epsEstimate !== null) {
    lines.push(`- EPS estimate (pre-earnings): $${comp.epsEstimate.toFixed(2)} (actual not yet available)`);
  }

  if (comp.revenueActual !== null && comp.revenueEstimate !== null && comp.revenueSurprisePct !== null) {
    const verdict = surpriseVerdict(comp.revenueSurprisePct);
    lines.push(
      `- Revenue estimate: ${formatRevenue(comp.revenueEstimate)} → actual ${formatRevenue(comp.revenueActual)} ` +
        `(surprise: ${formatPct(comp.revenueSurprisePct)} ${verdict})`,
    );
  } else if (comp.revenueEstimate !== null) {
    lines.push(`- Revenue estimate (pre-earnings): ${formatRevenue(comp.revenueEstimate)} (actual extraction failed — verify in text)`);
  }

  if (comp.analystCount !== null && comp.analystCount > 0) {
    lines.push(`- Coverage: ${comp.analystCount} analysts`);
  }

  lines.push('');
  lines.push('REASONING RULES (apply BEFORE assessing conviction):');
  lines.push('- Surprise <3% in EITHER metric → "in-line", NOT bullish (priced in).');
  lines.push('  Headline YoY growth (e.g., "+30% YoY") is irrelevant if it merely matches consensus.');
  lines.push('- Surprise <0% (miss) in EITHER metric → conviction MAX +0.3 regardless of headline.');
  lines.push('- "Strong beat" requires BOTH surprises >5%. Single-metric beat = mixed.');
  lines.push('- The market PRICES IN consensus. Beating consensus by 1-2% is neutral, not positive.');
  lines.push('- Headline numbers in PRESS RELEASE are PRICED IN — only DEVIATION from consensus moves stock.');

  return lines.join('\n');
}

function surpriseVerdict(pct: number): string {
  if (pct >= 10) return '**STRONG BEAT**';
  if (pct >= 3) return 'beat';
  if (pct > -3) return '**IN-LINE**';
  if (pct > -10) return 'miss';
  return '**BIG MISS**';
}

function formatPct(pct: number): string {
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

function formatRevenue(usd: number): string {
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(2)}B`;
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  return `$${usd.toFixed(0)}`;
}
