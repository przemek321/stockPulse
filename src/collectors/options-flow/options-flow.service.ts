import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { BaseCollectorService } from '../shared/base-collector.service';
import {
  OptionsFlow,
  OptionsVolumeBaseline,
  Ticker,
  CollectionLog,
} from '../../entities';
import { DataSource } from '../../common/interfaces/data-source.enum';
import { EventType } from '../../events/event-types';
import {
  filterContracts,
  detectSpike,
  calcOtmInfo,
  calcDte,
  updateRollingAverage,
  type OptionsContract,
  type DailyBar,
} from './unusual-activity-detector';

const POLYGON_BASE = 'https://api.polygon.io';

/** Opóźnienie między requestami: 12.5s = 4.8 req/min (limit 5/min) */
const RATE_LIMIT_MS = 12_500;

/**
 * Timeout per Polygon fetch. 17.04 produkcja: runCollectionCycle duration=11h 25min
 * bez timeout = zombie proces gdy API odpowiada wolno / nie odpowiada.
 * Analogiczne do FLAG #28 w SEC EDGAR collector.
 */
const POLYGON_FETCH_TIMEOUT_MS = 30_000;

/**
 * S19-FIX-04 (29.04.2026): outer cycle budget. Per-request timeout 30s
 * (Sprint 16b FIX-04 d78a92f) zatrzymuje pojedyncze zawieszone fetche,
 * ALE nie ogranicza całego cyklu który jest sekwencyjny:
 *   42 tickers × (2 head requests + ~50 contracts × 1 fetchPrevBar) = 2184 requests
 *   2184 × (12.5s rate limit + 5-30s fetch) = 7-25h cycle (potwierdzone:
 *   17.04 11h25min, 29.04 11h36min — ten sam bug, dwa razy).
 *
 * Budget 6h: zostawia margines na rate limit retry (60s pauses) ale gwarantuje
 * że cycle nigdy nie zachodzi na następny CRON slot (16:30 ET = 21:30 CEST,
 * następny dzień 16:30 ET = 21:30 CEST → 24h gap). 6h budget = max 1 cycle/dzień,
 * brak nakładania się na siebie.
 */
const OPTIONS_FLOW_CYCLE_BUDGET_MS = 6 * 60 * 60 * 1000;

/**
 * S19-FIX-04: cap na liczbę kontraktów per ticker. Polygon zwraca do 250
 * kontraktów per underlying, po filterContracts (DTE≤60, OTM≤30%) typowo
 * zostaje 30-150. Worst-case: MRNA 200 contracts × 12.5s = 41 minut na sam
 * jeden ticker. Cap 50 = max 11 minut per ticker, 42 tickers × 11min = 7.7h
 * theoretical worst case (z 30s fetches), ale typowo 4-5h. Wybór 50 bo:
 * - 95th percentile filteredCount w prod logach = ~70
 * - top-50 kontraktów po implied liquidity (po sortowaniu desc by underlyingDistance)
 *   pokrywa najbardziej tradeable strikes
 */
const MAX_CONTRACTS_PER_TICKER = 50;

/**
 * Kolektor options flow z Polygon.io (Free Tier, EOD).
 *
 * Strategia: 1 globalny scan po sesji NYSE (CRON 22:15 UTC):
 * 1. Dla każdego tickera — pobierz listę aktywnych kontraktów opcyjnych
 * 2. Filtruj: DTE ≤ 60, OTM ≤ 30%
 * 3. Pobierz EOD bar per kontrakt
 * 4. Porównaj volume vs. 20-dniowy baseline → flaguj spike ≥ 3×
 * 5. Emit event per ticker z unusual activity
 */
@Injectable()
export class OptionsFlowService extends BaseCollectorService {
  protected readonly logger = new Logger(OptionsFlowService.name);
  private readonly apiKey: string;

  constructor(
    @InjectRepository(CollectionLog)
    collectionLogRepo: Repository<CollectionLog>,
    @InjectRepository(OptionsFlow)
    private readonly flowRepo: Repository<OptionsFlow>,
    @InjectRepository(OptionsVolumeBaseline)
    private readonly baselineRepo: Repository<OptionsVolumeBaseline>,
    @InjectRepository(Ticker)
    private readonly tickerRepo: Repository<Ticker>,
    private readonly config: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super(collectionLogRepo);
    this.apiKey = this.config.get<string>('POLYGON_API_KEY', '');
  }

  getSourceName(): DataSource {
    return DataSource.POLYGON;
  }

  async collect(): Promise<number> {
    if (!this.apiKey) {
      this.logger.warn('Brak POLYGON_API_KEY — kolektor options-flow nieaktywny');
      return 0;
    }

    const tickers = await this.tickerRepo.find({ where: { isActive: true } });
    const today = new Date();
    const sessionDate = this.getLastTradingDay(today);
    let totalNew = 0;

    // S19-FIX-04: outer cycle budget. Per-request timeout (30s) nie ogranicza
    // całego sekwencyjnego cyklu — bez tego budgetu cycle trwa 11h+ w produkcji.
    const cycleAbort = new AbortController();
    const startedAt = Date.now();
    const budgetTimer = setTimeout(() => {
      this.logger.warn(
        `OPTIONS_FLOW cycle budget exceeded (${OPTIONS_FLOW_CYCLE_BUDGET_MS}ms) — aborting pending fetches`,
      );
      cycleAbort.abort();
    }, OPTIONS_FLOW_CYCLE_BUDGET_MS);

    let processed = 0;
    let aborted = false;

    try {
      for (const ticker of tickers) {
        if (cycleAbort.signal.aborted) {
          aborted = true;
          this.logger.warn(
            `OPTIONS_FLOW cycle aborted: ${processed}/${tickers.length} tickers processed, ` +
              `elapsed=${Date.now() - startedAt}ms, totalNew=${totalNew}`,
          );
          break;
        }
        try {
          const count = await this.collectForSymbol(
            ticker.symbol,
            sessionDate,
            today,
            cycleAbort.signal,
          );
          totalNew += count;
          processed++;
        } catch (error) {
          // AbortError z cycle budget bubble'uje tu (per-ticker try/catch)
          if (cycleAbort.signal.aborted) {
            aborted = true;
            break;
          }
          this.logger.warn(
            `Błąd options-flow dla ${ticker.symbol}: ${error instanceof Error ? error.message : error}`,
          );
        }
      }
    } finally {
      clearTimeout(budgetTimer);
    }

    if (!aborted) {
      this.logger.log(
        `OPTIONS_FLOW cycle done: ${processed}/${tickers.length} tickers, totalNew=${totalNew}, ` +
          `elapsed=${Date.now() - startedAt}ms`,
      );
    }

    return totalNew;
  }

  /**
   * Zbiera options flow dla jednego tickera.
   */
  private async collectForSymbol(
    symbol: string,
    sessionDate: string,
    today: Date,
    cycleSignal?: AbortSignal,
  ): Promise<number> {
    // 1. Pobierz cenę underlying (z ostatniego agg)
    const underlyingPrice = await this.getUnderlyingPrice(symbol, cycleSignal);
    if (!underlyingPrice) return 0;

    // 2. Pobierz listę aktywnych kontraktów
    const contracts = await this.fetchContracts(symbol, cycleSignal);
    if (!contracts || contracts.length === 0) return 0;

    // 3. Filtruj po DTE i OTM distance + S19-FIX-04 cap (max 50 contracts/ticker)
    const allFiltered = filterContracts(contracts, underlyingPrice, today);
    const filtered = allFiltered.slice(0, MAX_CONTRACTS_PER_TICKER);
    this.logger.debug(
      `${symbol}: ${contracts.length} kontraktów → ${allFiltered.length} po filtrze` +
        (filtered.length < allFiltered.length ? ` → ${filtered.length} (cap)` : ''),
    );

    let newFlows = 0;

    for (const contract of filtered) {
      // S19-FIX-04: abort check przed każdym contract — break inner loop gdy cycle budget exceeded
      if (cycleSignal?.aborted) break;
      try {
        // 4. Pobierz EOD bar
        const bar = await this.fetchPrevBar(contract.ticker, cycleSignal);
        if (!bar || bar.v <= 0) continue;

        // 5. Pobierz/stwórz baseline
        let baseline = await this.baselineRepo.findOne({
          where: { occSymbol: contract.ticker },
        });

        if (!baseline) {
          // Nowy kontrakt — zapisz pierwszy data point
          baseline = this.baselineRepo.create({
            occSymbol: contract.ticker,
            symbol,
            avgVolume20d: bar.v,
            dataPoints: 1,
            lastVolume: bar.v,
            lastUpdated: sessionDate,
          });
          await this.baselineRepo.save(baseline);
          continue; // Za mało danych na spike detection
        }

        // Pomijaj duplikat sesji (lastUpdated może być Date lub string z DB)
        if (baseline.lastUpdated && String(baseline.lastUpdated).slice(0, 10) === sessionDate) continue;

        // 6. Sprawdź spike
        const spike = detectSpike(bar.v, baseline.avgVolume20d, baseline.dataPoints);

        // 7. Update baseline (zawsze, nawet bez spike)
        const updated = updateRollingAverage(
          baseline.avgVolume20d,
          baseline.dataPoints,
          bar.v,
        );
        await this.baselineRepo.update(baseline.id, {
          avgVolume20d: updated.avgVolume20d,
          dataPoints: updated.dataPoints,
          lastVolume: bar.v,
          lastUpdated: sessionDate,
        });

        // 8. Jeśli spike — zapisz i emituj event
        if (spike.isUnusual) {
          const dte = calcDte(contract.expiration_date, today);
          const otm = calcOtmInfo(
            contract.strike_price,
            underlyingPrice,
            contract.contract_type,
          );

          const flow = this.flowRepo.create({
            symbol,
            occSymbol: contract.ticker,
            optionType: contract.contract_type,
            strike: contract.strike_price,
            underlyingPrice,
            expiry: contract.expiration_date,
            dte,
            dailyVolume: bar.v,
            avgVolume20d: baseline.avgVolume20d,
            volumeSpikeRatio: spike.spikeRatio,
            isOtm: otm.isOtm,
            otmDistance: otm.otmDistance,
            sessionDate,
          });

          try {
            await this.flowRepo.save(flow);
            newFlows++;

            this.eventEmitter.emit(EventType.NEW_OPTIONS_FLOW, {
              flowId: flow.id,
              symbol,
              traceId: randomUUID(),
            });
          } catch (err) {
            // UNIQUE constraint violation = duplikat sesji → skip
            if (err?.code === '23505') continue;
            throw err;
          }
        }
      } catch (error) {
        // Skip individual contract errors
        this.logger.debug(
          `${symbol} ${contract.ticker}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    if (newFlows > 0) {
      this.logger.log(`${symbol}: ${newFlows} unusual options flows`);
    }

    return newFlows;
  }

  /**
   * Łączy per-fetch timeout (30s) z cycle budget signal (6h).
   * AbortSignal.any (Node 18+) — pierwszy abort wygrywa.
   */
  private buildFetchSignal(cycleSignal?: AbortSignal): AbortSignal {
    const fetchTimeout = AbortSignal.timeout(POLYGON_FETCH_TIMEOUT_MS);
    return cycleSignal ? AbortSignal.any([fetchTimeout, cycleSignal]) : fetchTimeout;
  }

  /**
   * Pobiera listę aktywnych kontraktów opcyjnych per ticker.
   */
  private async fetchContracts(
    symbol: string,
    cycleSignal?: AbortSignal,
  ): Promise<OptionsContract[]> {
    await this.delay(RATE_LIMIT_MS, cycleSignal);
    const url = `${POLYGON_BASE}/v3/reference/options/contracts?underlying_ticker=${symbol}&expired=false&limit=250&apiKey=${this.apiKey}`;
    const res = await fetch(url, { signal: this.buildFetchSignal(cycleSignal) });

    if (res.status === 429) {
      this.logger.warn('Polygon rate limit — czekam 60s');
      await this.delay(60_000, cycleSignal);
      return [];
    }
    if (!res.ok) {
      throw new Error(`Polygon HTTP ${res.status}`);
    }

    const data = await res.json();
    return data.results || [];
  }

  /**
   * Pobiera EOD bar (previous day) dla kontraktu opcyjnego.
   */
  private async fetchPrevBar(
    occSymbol: string,
    cycleSignal?: AbortSignal,
  ): Promise<DailyBar | null> {
    await this.delay(RATE_LIMIT_MS, cycleSignal);
    const url = `${POLYGON_BASE}/v2/aggs/ticker/${occSymbol}/prev?apiKey=${this.apiKey}`;
    const res = await fetch(url, { signal: this.buildFetchSignal(cycleSignal) });

    if (res.status === 429) {
      this.logger.warn('Polygon rate limit — czekam 60s');
      await this.delay(60_000, cycleSignal);
      return null;
    }
    if (!res.ok) return null;

    const data = await res.json();
    return data.results?.[0] || null;
  }

  /**
   * Pobiera cenę underlying z /prev aggregate.
   */
  private async getUnderlyingPrice(
    symbol: string,
    cycleSignal?: AbortSignal,
  ): Promise<number | null> {
    await this.delay(RATE_LIMIT_MS, cycleSignal);
    const url = `${POLYGON_BASE}/v2/aggs/ticker/${symbol}/prev?apiKey=${this.apiKey}`;
    const res = await fetch(url, { signal: this.buildFetchSignal(cycleSignal) });
    if (!res.ok) return null;

    const data = await res.json();
    return data.results?.[0]?.c || null;
  }

  /**
   * Ostatni dzień handlowy (pomija weekendy).
   */
  private getLastTradingDay(date: Date): string {
    const d = new Date(date);
    const day = d.getUTCDay();
    // Jeśli niedziela lub sobota, cofnij do piątku (UTC)
    if (day === 0) d.setUTCDate(d.getUTCDate() - 2);
    else if (day === 6) d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().split('T')[0];
  }

  /**
   * Backfill baseline — pobiera historię 20 dni per kontrakt.
   * Używany jednorazowo przy cold start.
   */
  async backfillBaseline(limitTickers = 37): Promise<number> {
    if (!this.apiKey) {
      throw new Error('Brak POLYGON_API_KEY');
    }

    const tickers = await this.tickerRepo.find({
      where: { isActive: true },
      take: limitTickers,
    });

    const today = new Date();
    const fromDate = new Date(today.getTime() - 30 * 24 * 3600_000);
    const from = fromDate.toISOString().split('T')[0];
    const to = today.toISOString().split('T')[0];
    let totalUpdated = 0;

    for (const ticker of tickers) {
      try {
        const contracts = await this.fetchContracts(ticker.symbol);
        const underlyingPrice = await this.getUnderlyingPrice(ticker.symbol);
        if (!underlyingPrice || !contracts) continue;

        const filtered = filterContracts(contracts, underlyingPrice, today);
        this.logger.log(
          `Backfill ${ticker.symbol}: ${filtered.length} kontraktów`,
        );

        for (const contract of filtered) {
          try {
            await this.delay(RATE_LIMIT_MS);
            const url = `${POLYGON_BASE}/v2/aggs/ticker/${contract.ticker}/range/1/day/${from}/${to}?apiKey=${this.apiKey}`;
            const res = await fetch(url, { signal: AbortSignal.timeout(POLYGON_FETCH_TIMEOUT_MS) });
            if (!res.ok) continue;

            const data = await res.json();
            const bars: DailyBar[] = data.results || [];
            if (bars.length === 0) continue;

            // Oblicz średnią z ostatnich max 20 barów
            const recentBars = bars.slice(-20);
            const avgVolume =
              recentBars.reduce((s, b) => s + b.v, 0) / recentBars.length;

            await this.baselineRepo.upsert(
              {
                occSymbol: contract.ticker,
                symbol: ticker.symbol,
                avgVolume20d: avgVolume,
                dataPoints: recentBars.length,
                lastVolume: recentBars[recentBars.length - 1].v,
                lastUpdated: to,
              },
              ['occSymbol'],
            );
            totalUpdated++;
          } catch {
            // Skip individual contract errors
          }
        }
      } catch (error) {
        this.logger.warn(
          `Backfill ${ticker.symbol} error: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    this.logger.log(`Backfill zakończony: ${totalUpdated} baseline records`);
    return totalUpdated;
  }

  /**
   * S19-FIX-04: delay z abort support. Bez tego cycle abort musiałby
   * czekać pełne 12.5s × pozostałe iteracje zanim inner-loop check'ł by
   * `cycleSignal.aborted`. Z signal: natychmiastowy cancel + reject =
   * try/catch w pętli wybija się, abort propaguje do outer loop.
   */
  private delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('AbortError: cycle budget exceeded'));
        return;
      }
      const t = setTimeout(() => resolve(), ms);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          reject(new Error('AbortError: cycle budget exceeded'));
        },
        { once: true },
      );
    });
  }
}
