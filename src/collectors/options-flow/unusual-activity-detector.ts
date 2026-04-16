/**
 * Detektor nietypowej aktywności opcyjnej (volume spike).
 *
 * Polygon Free Tier nie daje OI/Greeks/sweep — budujemy własny baseline
 * z 20-dniowej rolling average volume per kontrakt i flagujemy spike > 3×.
 */

/** Kontrakt opcyjny z Polygon reference API */
export interface OptionsContract {
  /** OCC symbol (np. O:MRNA260417C00180000) */
  ticker: string;
  /** underlying ticker */
  underlying_ticker: string;
  /** call / put */
  contract_type: 'call' | 'put';
  strike_price: number;
  expiration_date: string; // YYYY-MM-DD
}

/** EOD bar z Polygon aggregates */
export interface DailyBar {
  /** Volume */
  v: number;
  /** Close */
  c: number;
  /** Timestamp (unix ms) */
  t: number;
}

/** Wynik detekcji dla pojedynczego kontraktu */
export interface UnusualContract {
  occSymbol: string;
  symbol: string;
  optionType: 'call' | 'put';
  strike: number;
  expiry: string;
  dte: number;
  dailyVolume: number;
  avgVolume20d: number;
  spikeRatio: number;
  isOtm: boolean;
  otmDistance: number;
}

/** Zagregowany wynik per ticker */
export interface TickerAggregation {
  symbol: string;
  unusualContracts: UnusualContract[];
  callVolume: number;
  putVolume: number;
  /** call / (call + put), 0-1 */
  callPutRatio: number;
  /** Kontrakt z najwyższym spike ratio */
  headlineContract: UnusualContract;
  totalUnusualContracts: number;
}

/** Minimalna liczba dni w baseline — poniżej pomijamy kontrakt */
const MIN_DATA_POINTS = 5;

/** Minimalny dzienny volume — poniżej to szum */
const MIN_DAILY_VOLUME = 100;

/** Minimalny spike ratio — poniżej to normalna aktywność */
const MIN_SPIKE_RATIO = 3.0;

/** Max DTE — opcje dalej niż 60 dni to pozycjonowanie, nie sygnał */
const MAX_DTE = 60;

/** Max OTM distance — dalej niż 30% to loteria */
const MAX_OTM_DISTANCE = 0.30;

/**
 * Faza 1: Filtrowanie kontraktów — redukcja API calls.
 * Zostawia tylko kontrakty OTM z krótkim DTE.
 */
export function filterContracts(
  contracts: OptionsContract[],
  underlyingPrice: number,
  today: Date,
): OptionsContract[] {
  return contracts.filter((c) => {
    const expiry = new Date(c.expiration_date);
    const dte = Math.ceil(
      (expiry.getTime() - today.getTime()) / (24 * 3600_000),
    );
    if (dte <= 0 || dte > MAX_DTE) return false;

    const otmDistance =
      Math.abs(c.strike_price - underlyingPrice) / underlyingPrice;
    if (otmDistance > MAX_OTM_DISTANCE) return false;

    // Pomijaj deep ITM — to hedging, nie directional bet
    const isOtm =
      c.contract_type === 'call'
        ? c.strike_price > underlyingPrice
        : c.strike_price < underlyingPrice;
    if (!isOtm && otmDistance > 0.05) return false; // Lekko ITM OK, deep ITM nie

    return true;
  });
}

/**
 * Faza 2: Detekcja volume spike dla pojedynczego kontraktu.
 */
export function detectSpike(
  todayVolume: number,
  avgVolume20d: number,
  dataPoints: number,
): { spikeRatio: number; isUnusual: boolean } {
  if (dataPoints < MIN_DATA_POINTS) {
    return { spikeRatio: 0, isUnusual: false };
  }
  if (todayVolume < MIN_DAILY_VOLUME) {
    return { spikeRatio: 0, isUnusual: false };
  }
  if (avgVolume20d <= 0) {
    return { spikeRatio: 0, isUnusual: false };
  }

  const spikeRatio = todayVolume / avgVolume20d;
  return {
    spikeRatio,
    isUnusual: spikeRatio >= MIN_SPIKE_RATIO,
  };
}

/**
 * Faza 3: Agregacja nietypowych kontraktów per ticker.
 */
export function aggregatePerTicker(
  symbol: string,
  unusualContracts: UnusualContract[],
): TickerAggregation | null {
  if (unusualContracts.length === 0) return null;

  const callVolume = unusualContracts
    .filter((c) => c.optionType === 'call')
    .reduce((sum, c) => sum + c.dailyVolume, 0);

  const putVolume = unusualContracts
    .filter((c) => c.optionType === 'put')
    .reduce((sum, c) => sum + c.dailyVolume, 0);

  const totalVolume = callVolume + putVolume;
  const callPutRatio = totalVolume > 0 ? callVolume / totalVolume : 0.5;

  const headlineContract = unusualContracts.reduce((best, c) =>
    c.spikeRatio > best.spikeRatio ? c : best,
  );

  return {
    symbol,
    unusualContracts,
    callVolume,
    putVolume,
    callPutRatio,
    headlineContract,
    totalUnusualContracts: unusualContracts.length,
  };
}

/**
 * Faza 4: Aktualizacja baseline z winsorization outlier'ów.
 *
 * Sprint 16 FLAG #21 fix: winsoryzuje volume do 5× obecnego avg przed update.
 * Pojedynczy duży spike nie zawyża baseline → kolejne prawdziwe spike'i nadal
 * detectowane. Bez winsorization jeden 100× spike podnosił baseline o ~5×,
 * ukrywając spike'i 10-50× przez tygodnie (camouflage effect).
 */
export function updateRollingAverage(
  currentAvg: number,
  currentDataPoints: number,
  newVolume: number,
): { avgVolume20d: number; dataPoints: number } {
  // Winsorize: jeśli newVolume > 5× obecnego avg, clip do 5× avg.
  // Dla pierwszych dni (dp<5) nie winsoryzujemy — avg jest jeszcze niestabilne.
  const WINSORIZE_CAP = 5.0;
  const effectiveVolume =
    currentDataPoints >= 5 && currentAvg > 0 && newVolume > WINSORIZE_CAP * currentAvg
      ? WINSORIZE_CAP * currentAvg
      : newVolume;

  const effectivePoints = Math.min(currentDataPoints, 19);
  const newAvg =
    (currentAvg * effectivePoints + effectiveVolume) / (effectivePoints + 1);
  const newDataPoints = Math.min(currentDataPoints + 1, 20);

  return { avgVolume20d: newAvg, dataPoints: newDataPoints };
}

/**
 * Helper: oblicz OTM distance i flagę isOtm.
 */
export function calcOtmInfo(
  strike: number,
  underlyingPrice: number,
  optionType: 'call' | 'put',
): { isOtm: boolean; otmDistance: number } {
  const isOtm =
    optionType === 'call'
      ? strike > underlyingPrice
      : strike < underlyingPrice;

  const otmDistance = Math.abs(strike - underlyingPrice) / underlyingPrice;

  return { isOtm, otmDistance };
}

/**
 * Helper: oblicz DTE z daty wygaśnięcia.
 */
export function calcDte(expiry: string, today: Date): number {
  const expiryDate = new Date(expiry);
  return Math.ceil(
    (expiryDate.getTime() - today.getTime()) / (24 * 3600_000),
  );
}
