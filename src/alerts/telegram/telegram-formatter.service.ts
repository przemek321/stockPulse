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
   * Formatuje alert High Conviction Signal z pełnym rozkładem wymiarów.
   */
  formatConvictionAlert(data: {
    symbol: string;
    priority: string;
    conviction: number;
    finbertScore: number;
    finbertConfidence: number;
    source: string;
    enrichedAnalysis: Record<string, any>;
  }): string {
    const icon = this.priorityIcon(data.priority);
    const ea = data.enrichedAnalysis;
    const timestamp = this.escapeMarkdown(new Date().toISOString());

    // Kierunek sygnału
    const direction = data.conviction > 0 ? 'BULLISH' : 'BEARISH';
    const dirIcon = data.conviction > 0 ? '\u{1F7E2}' : '\u{1F534}';

    // Rozkład conviction: sent × rel × nov × auth × conf × mag
    const sentVal = ea.sentiment === 'BULLISH' ? 1 : ea.sentiment === 'BEARISH' ? -1 : 0;
    const magMap: Record<string, number> = { low: 1.0, medium: 2.0, high: 3.0 };
    const mag = magMap[ea.price_impact_magnitude] || 1.0;
    const breakdown =
      `sent:${sentVal} \u00d7 rel:${this.escapeMarkdown(String(ea.relevance ?? '?'))} ` +
      `\u00d7 nov:${this.escapeMarkdown(String(ea.novelty ?? '?'))} ` +
      `\u00d7 auth:${this.escapeMarkdown(String(ea.source_authority ?? '?'))} ` +
      `\u00d7 conf:${this.escapeMarkdown(String(ea.confidence ?? '?'))} ` +
      `\u00d7 mag:${this.escapeMarkdown(String(mag))}`;

    const lines = [
      `${icon} *StockPulse — High Conviction Signal*`,
      '',
      `${dirIcon} *${this.escapeMarkdown(direction)}* — \\$${this.escapeMarkdown(data.symbol)}`,
      '',
      `\u{1F3AF} *Conviction: ${this.escapeMarkdown(data.conviction.toFixed(3))}*`,
      '',
      `\u{1F4D0} Rozkład:`,
      `  ${breakdown}`,
      '',
      `\u{1F4CA} FinBERT: score ${this.escapeMarkdown(data.finbertScore.toFixed(3))}, confidence ${this.escapeMarkdown(data.finbertConfidence.toFixed(3))}`,
    ];

    if (ea.catalyst_type) {
      lines.push(`\u{1F3F7}\uFE0F Katalizator: ${this.escapeMarkdown(ea.catalyst_type)}`);
    }
    if (ea.temporal_signal) {
      lines.push(`\u23F3 Horyzont: ${this.escapeMarkdown(ea.temporal_signal)}`);
    }
    if (ea.price_impact_direction || ea.price_impact_magnitude) {
      const dir = ea.price_impact_direction || '?';
      const magStr = ea.price_impact_magnitude || '?';
      lines.push(`\u{1F4B0} Wpływ cenowy: ${this.escapeMarkdown(dir)} \\(${this.escapeMarkdown(magStr)}\\)`);
    }
    if (ea.urgency) {
      lines.push(`\u26A1 Pilność: ${this.escapeMarkdown(ea.urgency)}`);
    }

    if (ea.summary) {
      lines.push('');
      lines.push(`\u{1F4AC} ${this.escapeMarkdown(ea.summary.substring(0, 200))}`);
    }

    lines.push('');
    lines.push(`\u{1F4CC} Źródło: ${this.escapeMarkdown(data.source)}`);
    lines.push(`\u23F0 ${timestamp}`);

    return lines.join('\n');
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
