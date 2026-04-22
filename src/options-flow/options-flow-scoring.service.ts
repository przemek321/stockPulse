import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { OptionsFlow, PdufaCatalyst } from '../entities';
import { type TickerAggregation } from '../collectors/options-flow/unusual-activity-detector';

/** Wynik scoringu — conviction + direction + metadata */
export interface ScoringResult {
  conviction: number;
  direction: 'positive' | 'negative' | 'mixed';
  pdufaBoosted: boolean;
  callPutRatio: number;
}

/**
 * Heurystyczny scoring options flow (bez GPT).
 *
 * Wagi:
 *   0.35 — volume spike ratio (najważniejszy)
 *   0.20 — absolutny volume (log scale)
 *   0.15 — OTM distance
 *   0.15 — DTE (krócej = pilniej)
 *   0.15 — call/put dominance clarity
 *
 * Direction z call/put ratio:
 *   > 0.65 → positive (bullish)
 *   < 0.35 → negative (bearish)
 *   else   → mixed (conviction × 0.7 penalty)
 *
 * PDUFA boost: ×1.3 gdy PDUFA < 30 dni (cap ±1.0)
 */
@Injectable()
export class OptionsFlowScoringService {
  private readonly logger = new Logger(OptionsFlowScoringService.name);

  constructor(
    @InjectRepository(PdufaCatalyst)
    private readonly pdufaRepo: Repository<PdufaCatalyst>,
  ) {}

  /**
   * Scoruje zagregowaną aktywność opcyjną per ticker.
   */
  async score(agg: TickerAggregation): Promise<ScoringResult> {
    const h = agg.headlineContract;

    // Sprint 11: spike ratio > 1000 → anomalia danych (MRNA 5032× = false positive)
    const suspicious = h.spikeRatio > 1000;
    if (suspicious) {
      this.logger.warn(
        `${agg.symbol}: spike ratio ${h.spikeRatio.toFixed(0)}× > 1000 — suspicious, conviction ×0.5`,
      );
    }

    // Składniki rawScore
    const spikeComponent = 0.35 * clamp(h.spikeRatio / 10, 0, 1);
    const volumeComponent = 0.20 * clamp(Math.log10(h.dailyVolume / 500), 0, 1);
    const otmComponent = 0.15 * clamp(h.otmDistance / 0.15, 0, 1);
    const dteComponent = 0.15 * clamp(1 - h.dte / 60, 0, 1);

    const callPutDominance = Math.abs(agg.callPutRatio - 0.5) * 2;
    const dominanceComponent = 0.15 * callPutDominance;

    const rawScore =
      spikeComponent +
      volumeComponent +
      otmComponent +
      dteComponent +
      dominanceComponent;

    // Direction z call/put ratio
    let direction: 'positive' | 'negative' | 'mixed';
    let directionSign: number;

    if (agg.callPutRatio > 0.65) {
      direction = 'positive';
      directionSign = 1;
    } else if (agg.callPutRatio < 0.35) {
      direction = 'negative';
      directionSign = -1;
    } else {
      direction = 'mixed';
      // Mixed: sign oparty na headline contract type
      directionSign = h.optionType === 'call' ? 1 : -1;
    }

    const mixedPenalty = direction === 'mixed' ? 0.7 : 1.0;
    const suspiciousPenalty = suspicious ? 0.5 : 1.0;
    let conviction = rawScore * directionSign * mixedPenalty * suspiciousPenalty;

    // PDUFA boost
    let pdufaBoosted = false;
    try {
      const upcoming = await this.pdufaRepo.findOne({
        where: {
          symbol: agg.symbol,
          pdufaDate: Between(
            new Date(),
            new Date(Date.now() + 30 * 24 * 3600_000),
          ),
        },
        order: { pdufaDate: 'ASC' },
      });

      if (upcoming) {
        const daysToEvent = Math.ceil(
          (new Date(upcoming.pdufaDate).getTime() - Date.now()) / (24 * 3600_000),
        );
        if (daysToEvent > 0 && daysToEvent <= 30) {
          conviction *= 1.3;
          pdufaBoosted = true;
          this.logger.debug(
            `${agg.symbol}: PDUFA boost ×1.3 (${upcoming.drugName}, za ${daysToEvent} dni)`,
          );
        }
      }
    } catch {
      // Brak PDUFA = brak boostu
    }

    // Cap do [-1, +1]
    conviction = Math.max(-1, Math.min(1, conviction));

    return { conviction, direction, pdufaBoosted, callPutRatio: agg.callPutRatio };
  }

  /**
   * Scoruje pojedynczy OptionsFlow record (dla use case bez agregacji).
   */
  async scoreFlow(flow: OptionsFlow): Promise<ScoringResult> {
    // TypeORM decimal columns (volumeSpikeRatio, otmDistance) są zwracane jako string
    // mimo deklaracji `number` w entity. Explicit Number() cast na wejściu — inaczej
    // > 1000 robi porównanie leksykalne, toFixed/arithmetic rzuca TypeError.
    const spikeRatio = Number(flow.volumeSpikeRatio);
    const otmDistance = Number(flow.otmDistance);

    // Sprint 11: spike ratio > 1000 → anomalia danych
    const suspicious = spikeRatio > 1000;
    if (suspicious) {
      this.logger.warn(
        `${flow.symbol}: spike ratio ${spikeRatio.toFixed(0)}× > 1000 — suspicious, conviction ×0.5`,
      );
    }

    const spikeComponent = 0.35 * clamp(spikeRatio / 10, 0, 1);
    const volumeComponent = 0.20 * clamp(Math.log10(flow.dailyVolume / 500), 0, 1);
    const otmComponent = 0.15 * clamp(otmDistance / 0.15, 0, 1);
    const dteComponent = 0.15 * clamp(1 - flow.dte / 60, 0, 1);
    // Bez agregacji brak call/put dominance — używamy 0.5 (neutral)
    const dominanceComponent = 0;

    const rawScore =
      spikeComponent + volumeComponent + otmComponent + dteComponent + dominanceComponent;

    const directionSign = flow.optionType === 'call' ? 1 : -1;
    const suspiciousPenalty = suspicious ? 0.5 : 1.0;
    let conviction = rawScore * directionSign * suspiciousPenalty;

    // PDUFA boost (identyczny jak w score())
    let pdufaBoosted = false;
    try {
      const upcoming = await this.pdufaRepo.findOne({
        where: {
          symbol: flow.symbol,
          pdufaDate: Between(
            new Date(),
            new Date(Date.now() + 30 * 24 * 3600_000),
          ),
        },
        order: { pdufaDate: 'ASC' },
      });
      if (upcoming) {
        const daysToEvent = Math.ceil(
          (new Date(upcoming.pdufaDate).getTime() - Date.now()) / (24 * 3600_000),
        );
        if (daysToEvent > 0 && daysToEvent <= 30) {
          conviction *= 1.3;
          pdufaBoosted = true;
        }
      }
    } catch { /* noop */ }

    conviction = Math.max(-1, Math.min(1, conviction));

    return {
      conviction,
      direction: flow.optionType === 'call' ? 'positive' : 'negative',
      pdufaBoosted,
      callPutRatio: flow.optionType === 'call' ? 1 : 0,
    };
  }
}

/** Clamp wartości do zakresu [min, max] */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
