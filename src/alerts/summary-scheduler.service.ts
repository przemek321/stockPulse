import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { Alert, InsiderTrade } from '../entities';
import { TelegramService } from './telegram/telegram.service';
import { TelegramFormatterService } from './telegram/telegram-formatter.service';
import { PdufaBioService } from '../collectors/pdufa-bio/pdufa-bio.service';

/**
 * Raport statusu systemu wysyłany na Telegram co 8 godzin.
 * Agreguje: alerty, insider trades, options flow, nadchodzące PDUFA.
 * Sprint 15: usunięto sentyment (wyłączony od Sprint 11, zero danych).
 */

/**
 * Kalendarz walidacji (10.06.2026, prośba Przemka o przypomnienia) — daty
 * decyzyjne z planu doc/PLAN-EDGE-IMPROVEMENTS-2026-06-09.md. Raport 8h
 * pokazuje zdarzenie od 7 dni PRZED terminem do 3 dni PO (z flagą ZALEGŁY).
 * Szczegóły kryteriów per data: doc/KALENDARZ-WALIDACJI-2026.md.
 * Po wykonaniu przeglądu — usuń wpis z tej tablicy.
 */
export const VALIDATION_CALENDAR: ReadonlyArray<{ date: string; label: string }> = [
  { date: '2026-07-09', label: 'APLS Faza 4 review (≥6 BUY, hit 7d ≥60%, alpha ≥+2%)' },
  { date: '2026-07-25', label: 'Przegląd okna obs discovery → decyzja delivery top-N' },
  { date: '2026-08-25', label: 'FIX-16 shadow review (N≥3 would_uncap) → decyzja deploy' },
  { date: '2026-09-01', label: 'Werdykt "czy system ma edge" (forward 7d, ~20-30 alertów)' },
  { date: '2026-09-07', label: 'Bullish-8K gate revisit (90d; hit suppressed >55% → zawęzić)' },
];

/**
 * Zdarzenia do pokazania w raporcie 8h: due za <=7 dni LUB zaległe <=3 dni.
 * Pure function — testowalna bez NestJS.
 */
export function upcomingValidationEvents(
  now: Date,
  calendar: ReadonlyArray<{ date: string; label: string }> = VALIDATION_CALENDAR,
): Array<{ date: string; label: string; daysLeft: number }> {
  const DAY = 24 * 3600_000;
  const today = new Date(now.toISOString().split('T')[0] + 'T00:00:00Z').getTime();
  return calendar
    .map((e) => ({
      ...e,
      daysLeft: Math.round((new Date(e.date + 'T00:00:00Z').getTime() - today) / DAY),
    }))
    .filter((e) => e.daysLeft <= 7 && e.daysLeft >= -3)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

@Injectable()
export class SummarySchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SummarySchedulerService.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;
  private timeoutRef: ReturnType<typeof setTimeout> | null = null;

  /** Interwał raportu: 8 godzin */
  private readonly INTERVAL_MS = 8 * 60 * 60 * 1000;

  /** Opóźnienie pierwszego raportu po starcie */
  private readonly INITIAL_DELAY_MS = 15_000;

  constructor(
    @InjectRepository(Alert)
    private readonly alertRepo: Repository<Alert>,
    @InjectRepository(InsiderTrade)
    private readonly tradeRepo: Repository<InsiderTrade>,
    private readonly telegram: TelegramService,
    private readonly formatter: TelegramFormatterService,
    private readonly pdufaBio: PdufaBioService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.telegram.isConfigured()) {
      this.logger.warn('Telegram nie skonfigurowany — raport 8h wyłączony');
      return;
    }

    // Pierwszy raport po krótkim opóźnieniu (żeby system zdążył wystartować)
    this.timeoutRef = setTimeout(() => this.sendSummary(), this.INITIAL_DELAY_MS);

    // Powtarzalny raport co 8h
    this.intervalRef = setInterval(() => this.sendSummary(), this.INTERVAL_MS);

    this.logger.log('Zaplanowano raport systemowy co 8h na Telegram');
  }

  onModuleDestroy(): void {
    if (this.intervalRef) clearInterval(this.intervalRef);
    if (this.timeoutRef) clearTimeout(this.timeoutRef);
  }

  /**
   * Zbiera dane z ostatnich 8h i wysyła podsumowanie na Telegram.
   */
  async sendSummary(): Promise<void> {
    try {
      const since = new Date(Date.now() - this.INTERVAL_MS);

      // Alerty per typ
      const alerts = await this.alertRepo
        .createQueryBuilder('a')
        .select('a.ruleName', 'rule')
        .addSelect('COUNT(*)', 'count')
        .addSelect('SUM(CASE WHEN a.delivered = true THEN 1 ELSE 0 END)', 'delivered')
        .where('a.sentAt > :since', { since })
        .groupBy('a.ruleName')
        .getRawMany();

      const totalAlerts = alerts.reduce((sum, r) => sum + parseInt(r.count, 10), 0);
      const totalDelivered = alerts.reduce((sum, r) => sum + parseInt(r.delivered ?? '0', 10), 0);

      // Breakdown suppressed — grupuj nonDeliveryReason (TASK-07, 23.04.2026).
      // Raport 8h pokazywał "Łącznie: 2 (dostarczono: 0)" bez kontekstu, wyglądało
      // jak alarm. Po audycie: suppressed to observation (semi) / sell_no_edge /
      // csuite_sell_no_edge — poprawne zachowanie, nie bug. Breakdown daje wgląd.
      const reasons = await this.alertRepo
        .createQueryBuilder('a')
        .select('a.nonDeliveryReason', 'reason')
        .addSelect('COUNT(*)', 'count')
        .where('a.sentAt > :since', { since })
        .andWhere('a.delivered = false')
        .andWhere('a.nonDeliveryReason IS NOT NULL')
        .groupBy('a.nonDeliveryReason')
        .getRawMany();

      // Insider trades BUY/SELL — celowo BEZ filtra is10b51Plan (raport pokazuje cały
      // wolumen; od fixu aff10b5One 09.06.2026 plany są realnie flagowane w DB)
      const trades = await this.tradeRepo
        .createQueryBuilder('t')
        .select('t.transactionType', 'type')
        .addSelect('COUNT(*)', 'count')
        .addSelect('SUM(t.totalValue)', 'totalValue')
        .where('t.collectedAt > :since', { since })
        .andWhere('t.transactionType IN (:...types)', { types: ['BUY', 'SELL'] })
        .groupBy('t.transactionType')
        .getRawMany();

      // Nadchodzące katalizatory PDUFA (7 dni)
      let pdufaSection = '';
      try {
        const upcoming = await this.pdufaBio.getAllUpcoming(7);
        if (upcoming.length > 0) {
          pdufaSection = this.formatter.formatPdufaSummarySection(upcoming);
        }
      } catch {
        // Brak danych PDUFA nie blokuje raportu
      }

      const message = this.formatSummary(alerts, totalAlerts, totalDelivered, reasons, trades) + pdufaSection;
      const sent = await this.telegram.sendMarkdown(message);

      if (sent) {
        this.logger.log(`Raport 8h wysłany (${totalAlerts} alertów)`);
      } else {
        this.logger.error('TELEGRAM FAILED: raport 8h nie wysłany');
      }
    } catch (error) {
      this.logger.error(
        `Błąd generowania raportu: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /**
   * Mapuje `nonDeliveryReason` na polskie etykiety dla raportu 8h.
   * Wartości pokrywają się z AlertDispatcherService.dispatch() suppression values
   * (observation, sell_no_edge, csuite_sell_no_edge, cluster_sell_no_edge,
   * silent_rule, daily_limit, telegram_failed, dispatcher_unavailable)
   * + legacy silent_hour. FOLLOW-1 (23.04.2026): dispatcher_unavailable dodany
   * jako defensive label — w produkcji AlertsModule eksportuje dispatcher, ale
   * gdyby future refactor rozłączył moduły, raport 8h pokaże czytelną etykietę.
   */
  private static readonly REASON_LABELS: Record<string, string> = {
    observation: 'Obserwacja',
    sell_no_edge: 'SELL (zero edge)',
    csuite_sell_no_edge: 'C-suite SELL (zero edge)',
    cluster_sell_no_edge: 'Cluster SELL (zero edge)',
    silent_rule: 'Silent rule',
    silent_hour: 'Cicha godzina',
    daily_limit: 'Dzienny limit',
    telegram_failed: 'Telegram failed',
    dispatcher_unavailable: 'Dispatcher niedostępny',
    gpt_missing_data: 'GPT brak danych',
    direction_conflict: 'Konflikt kierunków',
    // S19-FIX-12: PODD-class consensus gap breakdown
    consensus_miss: 'Miss vs konsensus',
    consensus_in_line: 'Wynik in-line z konsensusem',
    consensus_mixed: 'Mieszany sygnał (single-metric beat)',
    consensus_gap: 'Niezgodność z konsensusem',
    // Pakiet 1 fix #2 (09.06.2026): bullish 8-K gate
    bullish_8k_no_edge: 'Byczy 8-K (zero edge)',
    bullish_no_consensus_data: 'Byczy 8-K (brak danych konsensusu)',
  };

  /**
   * Formatuje wiadomość podsumowania w MarkdownV2.
   */
  private formatSummary(
    alertsByRule: { rule: string; count: string; delivered: string }[],
    totalAlerts: number,
    totalDelivered: number,
    reasonBreakdown: { reason: string; count: string }[],
    trades: { type: string; count: string; totalValue: string }[],
  ): string {
    const esc = (t: string) => t.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
    const now = new Date().toISOString().replace('T', ' ').substring(0, 16);
    const fmtValue = (v: number) => v >= 1_000_000
      ? `$${(v / 1_000_000).toFixed(1)}M`
      : `$${(v / 1_000).toFixed(0)}K`;

    const lines: string[] = [
      '📋 *StockPulse — Raport 8h*',
      '',
    ];

    // Alerty
    lines.push(`🔔 *Alerty \\(ostatnie 8h\\):*`);
    if (totalAlerts === 0) {
      lines.push('  Brak alertów w tym okresie');
    } else {
      lines.push(`  Łącznie: ${esc(String(totalAlerts))} \\(dostarczono: ${esc(String(totalDelivered))}\\)`);
      for (const r of alertsByRule) {
        lines.push(`  • ${esc(r.rule)}: ${esc(r.count)}`);
      }

      // Breakdown powodów niedostarczenia — pokazuje czemu totalDelivered < totalAlerts.
      // Np. "Obserwacja: 11" = semi tickery observation mode, poprawne zachowanie.
      const suppressed = totalAlerts - totalDelivered;
      if (suppressed > 0 && reasonBreakdown.length > 0) {
        lines.push(`  _Niedostarczone \\(${esc(String(suppressed))}\\):_`);
        for (const r of reasonBreakdown) {
          const label = SummarySchedulerService.REASON_LABELS[r.reason] ?? r.reason;
          lines.push(`    ◦ ${esc(label)}: ${esc(r.count)}`);
        }
      }
    }

    // Insider trades
    lines.push('');
    lines.push('👤 *Insider Trades \\(zebrane\\):*');
    if (trades.length === 0) {
      lines.push('  Brak nowych BUY/SELL');
    } else {
      for (const t of trades) {
        const val = parseFloat(t.totalValue || '0');
        lines.push(`  • ${esc(t.type)}: ${esc(t.count)} transakcji \\(${esc(fmtValue(val))}\\)`);
      }
    }

    // Kalendarz walidacji — przypomnienia o nadchodzących przeglądach decyzyjnych
    const events = upcomingValidationEvents(new Date());
    if (events.length > 0) {
      lines.push('');
      lines.push('📅 *Kalendarz walidacji:*');
      for (const e of events) {
        const when = e.daysLeft < 0
          ? `⚠️ ZALEGŁY ${esc(String(-e.daysLeft))}d`
          : e.daysLeft === 0
            ? '🔴 DZIŚ'
            : `za ${esc(String(e.daysLeft))}d`;
        lines.push(`  • ${esc(e.date)} \(${when}\): ${esc(e.label)}`);
      }
    }

    lines.push('');
    lines.push(`⏰ ${esc(now)} UTC`);

    return lines.join('\n');
  }
}
