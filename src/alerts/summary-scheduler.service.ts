import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { SentimentScore, Alert } from '../entities';
import { TelegramService } from './telegram/telegram.service';

/**
 * Cykliczne podsumowanie sentymentu wysyłane na Telegram co 2 godziny.
 * Agreguje dane z ostatnich 2h: średni score, top negatywne/pozytywne tickery, liczba alertów.
 */
@Injectable()
export class SummarySchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SummarySchedulerService.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;
  private timeoutRef: ReturnType<typeof setTimeout> | null = null;

  /** Interwał raportu: 2 godziny */
  private readonly INTERVAL_MS = 2 * 60 * 60 * 1000;

  /** Opóźnienie pierwszego raportu po starcie */
  private readonly INITIAL_DELAY_MS = 15_000;

  constructor(
    @InjectRepository(SentimentScore)
    private readonly sentimentRepo: Repository<SentimentScore>,
    @InjectRepository(Alert)
    private readonly alertRepo: Repository<Alert>,
    private readonly telegram: TelegramService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.telegram.isConfigured()) {
      this.logger.warn('Telegram nie skonfigurowany — raport 2h wyłączony');
      return;
    }

    // Pierwszy raport po krótkim opóźnieniu (żeby system zdążył wystartować)
    this.timeoutRef = setTimeout(() => this.sendSummary(), this.INITIAL_DELAY_MS);

    // Powtarzalny raport co 2h
    this.intervalRef = setInterval(() => this.sendSummary(), this.INTERVAL_MS);

    this.logger.log('Zaplanowano raport sentymentu co 2h na Telegram');
  }

  onModuleDestroy(): void {
    if (this.intervalRef) clearInterval(this.intervalRef);
    if (this.timeoutRef) clearTimeout(this.timeoutRef);
  }

  /**
   * Zbiera dane z ostatnich 2h i wysyła podsumowanie na Telegram.
   */
  async sendSummary(): Promise<void> {
    try {
      const since = new Date(Date.now() - this.INTERVAL_MS);

      // Agregacja ogólna
      const stats = await this.sentimentRepo
        .createQueryBuilder('s')
        .select('COUNT(*)', 'total')
        .addSelect('ROUND(AVG(s.score::numeric), 2)', 'avgScore')
        .where('s.timestamp > :since', { since })
        .getRawOne();

      const total = parseInt(stats?.total ?? '0', 10);
      const avgScore = parseFloat(stats?.avgScore ?? '0');

      // Liczba alertów
      const alertCount = await this.alertRepo.count({
        where: { sentAt: MoreThan(since) },
      });

      // Top 3 negatywne tickery
      const negative = await this.sentimentRepo
        .createQueryBuilder('s')
        .select('s.symbol', 'symbol')
        .addSelect('ROUND(AVG(s.score::numeric), 2)', 'avg')
        .where('s.timestamp > :since', { since })
        .groupBy('s.symbol')
        .having('COUNT(*) >= 2')
        .orderBy('avg', 'ASC')
        .limit(3)
        .getRawMany();

      // Top 3 pozytywne tickery
      const positive = await this.sentimentRepo
        .createQueryBuilder('s')
        .select('s.symbol', 'symbol')
        .addSelect('ROUND(AVG(s.score::numeric), 2)', 'avg')
        .where('s.timestamp > :since', { since })
        .groupBy('s.symbol')
        .having('COUNT(*) >= 2')
        .orderBy('avg', 'DESC')
        .limit(3)
        .getRawMany();

      const message = this.formatSummary(total, avgScore, alertCount, negative, positive);
      const sent = await this.telegram.sendMarkdown(message);

      if (sent) {
        this.logger.log(`Raport 2h wysłany (${total} analiz, ${alertCount} alertów)`);
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
    total: number,
    avgScore: number,
    alertCount: number,
    negative: { symbol: string; avg: string }[],
    positive: { symbol: string; avg: string }[],
  ): string {
    const esc = (t: string) => t.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
    const now = new Date().toISOString().replace('T', ' ').substring(0, 16);

    const lines: string[] = [
      '📋 *StockPulse — Raport 2h*',
      '',
      `📊 *Sentyment \\(ostatnie 2h\\):*`,
      `• Nowych analiz: ${esc(String(total))}`,
      `• Średni score: ${esc(avgScore.toFixed(2))}`,
      `• Alertów: ${esc(String(alertCount))}`,
    ];

    if (negative.length > 0) {
      lines.push('');
      lines.push('🔴 *Najbardziej negatywne:*');
      const neg = negative
        .map((r) => `${esc(r.symbol)} ${esc(String(r.avg))}`)
        .join(' \\| ');
      lines.push(`  ${neg}`);
    }

    if (positive.length > 0) {
      lines.push('');
      lines.push('🟢 *Najbardziej pozytywne:*');
      const pos = positive
        .map((r) => `${esc(r.symbol)} \\+${esc(String(r.avg).replace('-', ''))}`)
        .join(' \\| ');
      lines.push(`  ${pos}`);
    }

    if (total === 0) {
      lines.push('');
      lines.push('ℹ️ Brak nowych danych w tym okresie');
    }

    lines.push('');
    lines.push(`⏰ ${esc(now)} UTC`);

    return lines.join('\n');
  }
}
