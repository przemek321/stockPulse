import { Injectable } from '@nestjs/common';

/**
 * Formatter wiadomości alertów dla Telegram.
 * Generuje wiadomości w formacie MarkdownV2 z odpowiednim escapingiem.
 */
@Injectable()
export class TelegramFormatterService {
  /**
   * Formatuje alert sentymentu.
   */
  formatSentimentAlert(data: {
    symbol: string;
    companyName: string;
    priority: string;
    ruleName: string;
    sentimentScore: number;
    details?: string;
    enrichedAnalysis?: Record<string, any> | null;
  }): string {
    const icon = this.priorityIcon(data.priority);
    const score = data.sentimentScore.toFixed(2);
    const timestamp = this.escapeMarkdown(new Date().toISOString());

    const lines = [
      `${icon} *StockPulse Alert*`,
      '',
      `*${this.escapeMarkdown(data.priority)}* — \\$${this.escapeMarkdown(data.symbol)} ${this.escapeMarkdown(data.ruleName)}`,
      '',
      `📊 *${this.escapeMarkdown(data.companyName)}* \\(${this.escapeMarkdown(data.symbol)}\\)`,
      `• Sentiment: ${this.escapeMarkdown(score)}`,
      data.details ? `• ${this.escapeMarkdown(data.details)}` : '',
    ];

    // Sekcja AI — jeśli tekst był eskalowany do gpt-4o-mini
    if (data.enrichedAnalysis) {
      const ea = data.enrichedAnalysis;
      lines.push('');
      lines.push('🤖 *Analiza AI \\(gpt\\-4o\\-mini\\):*');
      if (ea.sentiment) {
        const conv = ea.conviction != null ? `, conviction: ${this.escapeMarkdown(String(ea.conviction))}` : '';
        lines.push(`• Sentyment: ${this.escapeMarkdown(ea.sentiment)}${conv}`);
      }
      if (ea.type || ea.urgency) {
        const parts: string[] = [];
        if (ea.type) parts.push(`Typ: ${this.escapeMarkdown(ea.type)}`);
        if (ea.urgency) parts.push(`Pilność: ${this.escapeMarkdown(ea.urgency)}`);
        lines.push(`• ${parts.join(' \\| ')}`);
      }
      if (ea.price_impact_direction || ea.price_impact_magnitude) {
        const dir = ea.price_impact_direction || '?';
        const mag = ea.price_impact_magnitude || '?';
        lines.push(`• Wpływ cenowy: ${this.escapeMarkdown(dir)} / ${this.escapeMarkdown(mag)}`);
      }
      if (ea.catalyst_type) {
        lines.push(`• Katalizator: ${this.escapeMarkdown(ea.catalyst_type)}`);
      }
      if (ea.summary) {
        lines.push(`• ${this.escapeMarkdown(ea.summary.substring(0, 150))}`);
      }
    }

    lines.push('');
    lines.push(`⏰ ${timestamp}`);

    return lines.filter(Boolean).join('\n');
  }

  /**
   * Formatuje alert insider trade.
   */
  formatInsiderTradeAlert(data: {
    symbol: string;
    companyName: string;
    insiderName: string;
    transactionType: string;
    totalValue: number;
    priority: string;
  }): string {
    const icon = this.priorityIcon(data.priority);
    const value = this.escapeMarkdown(
      `$${data.totalValue.toLocaleString('en-US')}`,
    );

    return [
      `${icon} *StockPulse Alert*`,
      '',
      `🕵️ *Insider Trade* — \\$${this.escapeMarkdown(data.symbol)}`,
      '',
      `• Insider: ${this.escapeMarkdown(data.insiderName)}`,
      `• Typ: ${this.escapeMarkdown(data.transactionType)}`,
      `• Wartość: ${value}`,
      '',
      `⏰ ${this.escapeMarkdown(new Date().toISOString())}`,
    ].join('\n');
  }

  /**
   * Formatuje alert o nowym filingu SEC.
   */
  formatFilingAlert(data: {
    symbol: string;
    companyName: string;
    formType: string;
    description?: string;
    priority: string;
  }): string {
    const icon = this.priorityIcon(data.priority);

    return [
      `${icon} *StockPulse Alert*`,
      '',
      `📄 *SEC Filing* — \\$${this.escapeMarkdown(data.symbol)}`,
      '',
      `• Formularz: ${this.escapeMarkdown(data.formType)}`,
      data.description
        ? `• Opis: ${this.escapeMarkdown(data.description)}`
        : '',
      '',
      `⏰ ${this.escapeMarkdown(new Date().toISOString())}`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  /**
   * Escapuje znaki specjalne MarkdownV2.
   */
  private escapeMarkdown(text: string): string {
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
  }

  /**
   * Ikona priorytetu.
   */
  private priorityIcon(priority: string): string {
    switch (priority.toUpperCase()) {
      case 'CRITICAL':
        return '🔴';
      case 'HIGH':
        return '🟠';
      case 'MEDIUM':
        return '🟡';
      case 'INFO':
        return '🔵';
      default:
        return '⚪';
    }
  }
}
