/**
 * Faza 2 baseline replay (12.05.2026): mierzy ratio revenueSource='matched' vs 'forward'
 * + Finnhub vs Alpha Vantage EPS diff distribution dla 10 ostatnich 8-K Item 2.02.
 *
 * Cel: pre-observation baseline — bez tego za 14d (deadline 25.05.2026) nie będziemy
 * wiedzieć od czego startowaliśmy. Decyzja Faza 3 (FIX-14 priority, primary EPS source)
 * wymaga liczb "vs co".
 *
 * Run: docker compose exec -T app node -r ts-node/register /app/scripts/replay-consensus-baseline.ts
 *      (lub: docker compose exec -T app /app/node_modules/.bin/ts-node /app/scripts/replay-consensus-baseline.ts)
 *
 * Output: stdout markdown table.
 */
import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
// Path absolute (`/app/src/...`) bo skrypt jest kopiowany przez `docker cp` do
// roota kontenera, NIE montowany przez compose volumes (volumes only: ./src ./doc ./test).
// Lokalnie ts-node nie znajdzie tego path — to OK, skrypt run-only-in-container.
import { ConsensusComparisonService } from '/app/src/sec-filings/services/consensus-comparison.service';

const SYMBOLS = [
  'HIMS', 'MOH', 'GILD', 'OSCR', 'GDRX',
  'PODD', 'VRTX', 'MRNA', 'CI',   'SEM',
  'AMGN', 'BMY',  'DXCM', 'REGN', 'ABBV',
];

interface ReplayRow {
  symbol: string;
  finnhubPeriod: string | null;
  finnhubEpsActual: number | null;
  finnhubEpsEstimate: number | null;
  finnhubEpsSurprisePct: number | null;
  avPeriod: string | null;
  avEpsEstimate: number | null;
  avRevenueEstimate: number | null;
  revenueSource: 'matched' | 'forward' | 'null';
  diffPct: number | null;
  errors: string[];
}

async function main() {
  const config = {
    get: (key: string, def?: any) => process.env[key] ?? def,
  } as unknown as ConfigService;

  const svc = new ConsensusComparisonService(config);
  const rows: ReplayRow[] = [];

  for (const symbol of SYMBOLS) {
    const errors: string[] = [];
    try {
      // Pusty reportText — chcemy mierzyć tylko consensus side, nie extractRevenue
      // (FIX-14 question to osobny test).
      const result = await svc.fetchAndCompare(symbol, '');

      let diffPct: number | null = null;
      if (
        result.epsEstimate !== null &&
        result.epsEstimateAlphaVantage !== null &&
        result.epsEstimateAlphaVantage !== undefined &&
        result.epsEstimateAlphaVantage !== 0
      ) {
        diffPct =
          ((result.epsEstimate - result.epsEstimateAlphaVantage) /
            Math.abs(result.epsEstimateAlphaVantage)) *
          100;
      }

      rows.push({
        symbol,
        finnhubPeriod: result.period,
        finnhubEpsActual: result.epsActual,
        finnhubEpsEstimate: result.epsEstimate,
        finnhubEpsSurprisePct: result.epsSurprisePct,
        avPeriod: result.period, // ta sama wartość gdy matched
        avEpsEstimate: result.epsEstimateAlphaVantage ?? null,
        avRevenueEstimate: result.revenueEstimate,
        revenueSource: result.revenueSource ?? 'null',
        diffPct,
        errors,
      });
    } catch (err) {
      errors.push(`${(err as Error).message}`);
      rows.push({
        symbol,
        finnhubPeriod: null,
        finnhubEpsActual: null,
        finnhubEpsEstimate: null,
        finnhubEpsSurprisePct: null,
        avPeriod: null,
        avEpsEstimate: null,
        avRevenueEstimate: null,
        revenueSource: 'null',
        diffPct: null,
        errors,
      });
    }

    // Soft rate limit AV (25/dzień, but bursts hit per-second too)
    await new Promise(r => setTimeout(r, 1500));
  }

  // Render markdown table
  console.log('\n## Faza 2 baseline (12.05.2026, 10:XX UTC) — 15 healthcare tickers\n');
  console.log(
    '| Symbol | Finnhub Period | Finnhub EPS act/est | EPS surprise | AV revEst | revenueSource | Finnhub vs AV diff% | Errors |',
  );
  console.log(
    '|---|---|---|---|---|---|---|---|',
  );
  for (const r of rows) {
    const epsActEst =
      r.finnhubEpsActual !== null && r.finnhubEpsEstimate !== null
        ? `${r.finnhubEpsActual.toFixed(2)} / ${r.finnhubEpsEstimate.toFixed(4)}`
        : 'n/a';
    const epsSurp =
      r.finnhubEpsSurprisePct !== null
        ? `${r.finnhubEpsSurprisePct >= 0 ? '+' : ''}${r.finnhubEpsSurprisePct.toFixed(1)}%`
        : 'n/a';
    const avRev =
      r.avRevenueEstimate !== null
        ? r.avRevenueEstimate >= 1_000_000_000
          ? `$${(r.avRevenueEstimate / 1_000_000_000).toFixed(2)}B`
          : `$${(r.avRevenueEstimate / 1_000_000).toFixed(0)}M`
        : 'n/a';
    const diff =
      r.diffPct !== null
        ? `${r.diffPct >= 0 ? '+' : ''}${r.diffPct.toFixed(2)}%`
        : 'n/a';
    const errs = r.errors.length > 0 ? r.errors.join('; ') : '';
    console.log(
      `| ${r.symbol} | ${r.finnhubPeriod ?? 'n/a'} | ${epsActEst} | ${epsSurp} | ${avRev} | ${r.revenueSource} | ${diff} | ${errs} |`,
    );
  }

  // Aggregate stats
  const matched = rows.filter(r => r.revenueSource === 'matched').length;
  const forward = rows.filter(r => r.revenueSource === 'forward').length;
  const nullSource = rows.filter(r => r.revenueSource === 'null').length;
  const finnhubOk = rows.filter(r => r.finnhubEpsEstimate !== null).length;
  const avOk = rows.filter(r => r.avEpsEstimate !== null).length;
  const bothEpsAvailable = rows.filter(
    r => r.diffPct !== null,
  ).length;
  const diffs = rows
    .filter(r => r.diffPct !== null)
    .map(r => Math.abs(r.diffPct!));
  const avgDiff = diffs.length > 0 ? diffs.reduce((a, b) => a + b, 0) / diffs.length : null;
  const maxDiff = diffs.length > 0 ? Math.max(...diffs) : null;

  console.log('\n### Aggregate stats\n');
  console.log(`- Total tickers replayed: ${rows.length}`);
  console.log(`- Finnhub EPS estimate available: ${finnhubOk}/${rows.length}`);
  console.log(`- Alpha Vantage EPS estimate available: ${avOk}/${rows.length}`);
  console.log(`- revenueSource breakdown: matched=${matched}, forward=${forward}, null=${nullSource}`);
  console.log(`- Both EPS available (diff measurable): ${bothEpsAvailable}/${rows.length}`);
  if (avgDiff !== null && maxDiff !== null) {
    console.log(`- |Finnhub vs AV diff|: avg=${avgDiff.toFixed(2)}%, max=${maxDiff.toFixed(2)}%`);
  }
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
