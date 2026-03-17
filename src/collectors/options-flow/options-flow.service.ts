import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
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

    for (const ticker of tickers) {
      try {
        const count = await this.collectForSymbol(ticker.symbol, sessionDate, today);
        totalNew += count;
      } catch (error) {
        this.logger.warn(
          `Błąd options-flow dla ${ticker.symbol}: ${error instanceof Error ? error.message : error}`,
        );
      }
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
  ): Promise<number> {
    // 1. Pobierz cenę underlying (z ostatniego agg)
    const underlyingPrice = await this.getUnderlyingPrice(symbol);
    if (!underlyingPrice) return 0;

    // 2. Pobierz listę aktywnych kontraktów
    const contracts = await this.fetchContracts(symbol);
    if (!contracts || contracts.length === 0) return 0;

    // 3. Filtruj po DTE i OTM distance
    const filtered = filterContracts(contracts, underlyingPrice, today);
    this.logger.debug(
      `${symbol}: ${contracts.length} kontraktów → ${filtered.length} po filtrze`,
    );

    let newFlows = 0;

    for (const contract of filtered) {
      try {
        // 4. Pobierz EOD bar
        const bar = await this.fetchPrevBar(contract.ticker);
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

        // Pomijaj duplikat sesji
        if (baseline.lastUpdated?.toString() === sessionDate) continue;

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
   * Pobiera listę aktywnych kontraktów opcyjnych per ticker.
   */
  private async fetchContracts(symbol: string): Promise<OptionsContract[]> {
    await this.delay(RATE_LIMIT_MS);
    const url = `${POLYGON_BASE}/v3/reference/options/contracts?underlying_ticker=${symbol}&expired=false&limit=250&apiKey=${this.apiKey}`;
    const res = await fetch(url);

    if (res.status === 429) {
      this.logger.warn('Polygon rate limit — czekam 60s');
      await this.delay(60_000);
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
  private async fetchPrevBar(occSymbol: string): Promise<DailyBar | null> {
    await this.delay(RATE_LIMIT_MS);
    const url = `${POLYGON_BASE}/v2/aggs/ticker/${occSymbol}/prev?apiKey=${this.apiKey}`;
    const res = await fetch(url);

    if (res.status === 429) {
      this.logger.warn('Polygon rate limit — czekam 60s');
      await this.delay(60_000);
      return null;
    }
    if (!res.ok) return null;

    const data = await res.json();
    return data.results?.[0] || null;
  }

  /**
   * Pobiera cenę underlying z /prev aggregate.
   */
  private async getUnderlyingPrice(symbol: string): Promise<number | null> {
    await this.delay(RATE_LIMIT_MS);
    const url = `${POLYGON_BASE}/v2/aggs/ticker/${symbol}/prev?apiKey=${this.apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    return data.results?.[0]?.c || null;
  }

  /**
   * Ostatni dzień handlowy (pomija weekendy).
   */
  private getLastTradingDay(date: Date): string {
    const d = new Date(date);
    const day = d.getDay();
    // Jeśli niedziela lub sobota, cofnij do piątku
    if (day === 0) d.setDate(d.getDate() - 2);
    else if (day === 6) d.setDate(d.getDate() - 1);
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
            const res = await fetch(url);
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

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
