import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Alert } from '../entities';

/**
 * Buduje skondensowany profil historyczny per ticker (200-400 tokenów).
 * Wstrzykiwany do promptów Claude Sonnet (Form 4 + 8-K) jako kontekst kalibrujący conviction.
 *
 * Dane: tabela alerts z ostatnich 90 dni (priceAtAlert + price1d).
 * Cache: in-memory Map z TTL 2h (42 tickery × ~300 znaków = trivial).
 */

interface TickerMetrics {
  totalSignals: number;
  hitRate1d: number | null;
  avgAbsMove1d: number | null;
  ruleBreakdown: {
    ruleName: string;
    count: number;
    hitRate1d: number | null;
    avgMove1d: number | null;
  }[];
  dominantDirection: 'bullish' | 'bearish' | 'mixed';
  directionConsistency: number;
  recentSignals: {
    ruleName: string;
    direction: 'positive' | 'negative';
    daysAgo: number;
    move1dPct: number;
  }[];
}

/** Skrócone nazwy reguł — oszczędność tokenów w prompcie */
const SHORT_RULE_NAMES: Record<string, string> = {
  'Form 4 Insider Signal': 'Form4',
  '8-K Material Event GPT': '8-K',
  '8-K Earnings Miss': '8-K Earnings',
  '8-K Leadership Change': '8-K Leadership',
  '8-K Bankruptcy': '8-K Bankruptcy',
  'Correlated Signal': 'Correlated',
  'Unusual Options Activity': 'Options',
};

@Injectable()
export class TickerProfileService {
  private readonly logger = new Logger(TickerProfileService.name);

  /** In-memory cache — 42 tickery × 1 wpis = ~12KB, trivial */
  private cache = new Map<string, { text: string; expiresAt: number }>();
  private readonly CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2h

  constructor(
    @InjectRepository(Alert)
    private readonly alertRepo: Repository<Alert>,
  ) {}

  /**
   * Zwraca profil historyczny tickera gotowy do wklejenia w prompt Claude.
   * Null jeśli za mało danych (<3 alerty z price outcome).
   */
  async getSignalProfile(symbol: string): Promise<string | null> {
    // 1. Sprawdź in-memory cache
    const cached = this.cache.get(symbol);
    if (cached && cached.expiresAt > Date.now()) return cached.text;

    // 2. Pobierz alerty z ostatnich 90 dni z wypełnionym price1d
    const alerts = await this.alertRepo
      .createQueryBuilder('a')
      .where('a.symbol = :symbol', { symbol })
      .andWhere('a."priceAtAlert" IS NOT NULL')
      .andWhere('a.price1d IS NOT NULL')
      .andWhere('a.archived = false')
      .andWhere('a."sentAt" > NOW() - INTERVAL \'90 days\'')
      .orderBy('a."sentAt"', 'DESC')
      .limit(20)
      .getMany();

    if (alerts.length < 3) return null;

    // 3. Oblicz metryki
    const metrics = this.computeMetrics(alerts);

    // 4. Sformatuj jako tekst
    const text = this.formatProfile(metrics, symbol);

    // 5. Cache in-memory (2h TTL)
    this.cache.set(symbol, { text, expiresAt: Date.now() + this.CACHE_TTL_MS });

    this.logger.debug(`TickerProfile: ${symbol} — ${metrics.totalSignals} sygnałów, hit rate ${metrics.hitRate1d}%`);

    return text;
  }

  /** Oblicza metryki z listy alertów */
  computeMetrics(alerts: Alert[]): TickerMetrics {
    const now = Date.now();

    // Hit rate ogólny
    const hits = alerts.map(a => this.isHit(a));
    const evaluated = hits.filter(h => h !== null);
    const correct = evaluated.filter(h => h === true).length;
    const hitRate1d = evaluated.length > 0 ? Math.round(correct / evaluated.length * 100) : null;

    // Średni |ruch| 1d
    const moves = alerts
      .filter(a => a.priceAtAlert && a.price1d)
      .map(a => Math.abs((Number(a.price1d) - Number(a.priceAtAlert)) / Number(a.priceAtAlert) * 100));
    const avgAbsMove1d = moves.length > 0 ? Math.round(moves.reduce((s, v) => s + v, 0) / moves.length * 10) / 10 : null;

    // Hit rate per reguła
    const ruleMap = new Map<string, Alert[]>();
    for (const a of alerts) {
      const list = ruleMap.get(a.ruleName) ?? [];
      list.push(a);
      ruleMap.set(a.ruleName, list);
    }

    const ruleBreakdown = [...ruleMap.entries()].map(([ruleName, ruleAlerts]) => {
      const rHits = ruleAlerts.map(a => this.isHit(a));
      const rEval = rHits.filter(h => h !== null);
      const rCorrect = rEval.filter(h => h === true).length;

      const rMoves = ruleAlerts
        .filter(a => a.priceAtAlert && a.price1d && a.alertDirection)
        .map(a => {
          const move = (Number(a.price1d) - Number(a.priceAtAlert)) / Number(a.priceAtAlert) * 100;
          return move;
        });
      const avgMove = rMoves.length > 0 ? Math.round(rMoves.reduce((s, v) => s + v, 0) / rMoves.length * 10) / 10 : null;

      return {
        ruleName,
        count: ruleAlerts.length,
        hitRate1d: rEval.length > 0 ? Math.round(rCorrect / rEval.length * 100) : null,
        avgMove1d: avgMove,
      };
    }).sort((a, b) => b.count - a.count);

    // Kierunkowość
    const directions = alerts.filter(a => a.alertDirection).map(a => a.alertDirection!);
    const positive = directions.filter(d => d === 'positive').length;
    const negative = directions.filter(d => d === 'negative').length;
    const totalDir = directions.length;
    const directionConsistency = totalDir > 0 ? Math.round(Math.max(positive, negative) / totalDir * 100) / 100 : 0;
    const dominantDirection: 'bullish' | 'bearish' | 'mixed' =
      positive > negative ? 'bullish' : negative > positive ? 'bearish' : 'mixed';

    // Ostatnie 3 sygnały
    const recentSignals = alerts
      .filter(a => a.alertDirection && a.priceAtAlert && a.price1d)
      .slice(0, 3)
      .map(a => ({
        ruleName: a.ruleName,
        direction: a.alertDirection as 'positive' | 'negative',
        daysAgo: Math.round((now - new Date(a.sentAt).getTime()) / (24 * 60 * 60 * 1000)),
        move1dPct: Math.round((Number(a.price1d) - Number(a.priceAtAlert)) / Number(a.priceAtAlert) * 1000) / 10,
      }));

    return {
      totalSignals: alerts.length,
      hitRate1d,
      avgAbsMove1d,
      ruleBreakdown,
      dominantDirection,
      directionConsistency,
      recentSignals,
    };
  }

  /** Formatuje metryki jako tekst do promptu (200-400 tokenów) */
  formatProfile(m: TickerMetrics, symbol: string): string {
    const pct = (v: number | null) => v != null ? `${v}%` : 'N/A';
    const short = (name: string) => SHORT_RULE_NAMES[name] || name;
    const lines: string[] = [];

    lines.push(`=== HISTORICAL SIGNAL PROFILE: ${symbol} (last 90 days) ===`);
    lines.push(`${m.totalSignals} signals | Hit rate 1d: ${pct(m.hitRate1d)} | Avg |move|: ${m.avgAbsMove1d?.toFixed(1) ?? 'N/A'}%`);
    lines.push(`Direction: ${m.dominantDirection} (${Math.round(m.directionConsistency * 100)}% consistency)`);

    // Per reguła — tylko >=2 alertów
    const rules = m.ruleBreakdown.filter(r => r.count >= 2);
    if (rules.length > 0) {
      for (const r of rules) {
        lines.push(`  ${short(r.ruleName)}: ${r.count}x, hit ${pct(r.hitRate1d)}, avg ${r.avgMove1d != null ? (r.avgMove1d > 0 ? '+' : '') + r.avgMove1d.toFixed(1) : 'N/A'}%`);
      }
    }

    // Ostatnie 3 sygnały
    if (m.recentSignals.length > 0) {
      lines.push(`Recent:`);
      for (const s of m.recentSignals) {
        const arrow = s.direction === 'positive' ? '▲' : '▼';
        lines.push(`  ${s.daysAgo}d ago: ${short(s.ruleName)} ${arrow} → 1d: ${s.move1dPct > 0 ? '+' : ''}${s.move1dPct.toFixed(1)}%`);
      }
    }

    lines.push(`CALIBRATION RULES:`);
    lines.push(`- Hit rate >70%: boost |conviction| by 0.1-0.3`);
    lines.push(`- Hit rate <40%: reduce |conviction| by 0.1-0.3`);
    lines.push(`- Recent 3 signals all same direction: developing pattern, weight accordingly`);
    lines.push(`=== END PROFILE ===`);

    return lines.join('\n');
  }

  /** Sprawdza czy alert trafnie przewidział kierunek ceny 1d */
  private isHit(alert: Alert): boolean | null {
    if (!alert.priceAtAlert || !alert.price1d || !alert.alertDirection) return null;
    const move = Number(alert.price1d) - Number(alert.priceAtAlert);
    if (alert.alertDirection === 'positive') return move > 0;
    if (alert.alertDirection === 'negative') return move < 0;
    return null;
  }
}
