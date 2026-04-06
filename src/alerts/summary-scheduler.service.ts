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

      // Insider trades (discretionary BUY/SELL, non-10b5-1)
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

      const message = this.formatSummary(alerts, totalAlerts, totalDelivered, trades) + pdufaSection;
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
   * Formatuje wiadomość podsumowania w MarkdownV2.
   */
  private formatSummary(
    alertsByRule: { rule: string; count: string; delivered: string }[],
    totalAlerts: number,
    totalDelivered: number,
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

    lines.push('');
    lines.push(`⏰ ${esc(now)} UTC`);

    return lines.join('\n');
  }
}
