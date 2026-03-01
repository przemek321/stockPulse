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
   * Formatuje alert insider trade z pełnymi danymi z Form 4 XML.
   */
  formatInsiderTradeAlert(data: {
    symbol: string;
    companyName: string;
    insiderName: string;
    insiderRole?: string;
    transactionType: string;
    totalValue: number;
    shares?: number;
    priority: string;
  }): string {
    const icon = this.priorityIcon(data.priority);
    const value = this.escapeMarkdown(
      `$${data.totalValue.toLocaleString('en-US')}`,
    );
    const timestamp = this.escapeMarkdown(new Date().toISOString());

    const lines = [
      `${icon} *StockPulse Alert*`,
      '',
      `\u{1F575}\uFE0F *Insider Trade* \u2014 \\$${this.escapeMarkdown(data.symbol)}`,
      '',
      `\u{1F4CA} *${this.escapeMarkdown(data.companyName)}* \\(${this.escapeMarkdown(data.symbol)}\\)`,
      `\u2022 Insider: ${this.escapeMarkdown(data.insiderName)}`,
    ];

    if (data.insiderRole) {
      lines.push(`\u2022 Rola: ${this.escapeMarkdown(data.insiderRole)}`);
    }

    lines.push(`\u2022 Typ: ${this.escapeMarkdown(data.transactionType)}`);

    if (data.shares) {
      lines.push(
        `\u2022 Akcje: ${this.escapeMarkdown(data.shares.toLocaleString('en-US'))}`,
      );
    }

    lines.push(`\u2022 Warto\u015b\u0107: ${value}`);
    lines.push('');
    lines.push(`\u23F0 ${timestamp}`);

    return lines.join('\n');
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
   * Formatuje alert High Conviction Signal — czytelny format bez rozkładu wymiarów.
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

    const direction = data.conviction > 0 ? 'BULLISH' : 'BEARISH';
    const dirIcon = data.conviction > 0 ? '\u{1F7E2}' : '\u{1F534}';

    const lines = [
      `${icon} *StockPulse — High Conviction Signal*`,
      '',
      `${dirIcon} *${this.escapeMarkdown(direction)}* — \\$${this.escapeMarkdown(data.symbol)}`,
      '',
      `\u{1F3AF} *Conviction: ${this.escapeMarkdown(data.conviction.toFixed(3))}*`,
    ];

    if (ea.catalyst_type) {
      lines.push('');
      lines.push(`\u{1F3F7}\uFE0F Katalizator: ${this.escapeMarkdown(ea.catalyst_type)}`);
    }

    if (ea.summary) {
      lines.push(`\u{1F4AC} ${this.escapeMarkdown(ea.summary.substring(0, 200))}`);
    }

    lines.push('');
    lines.push(`\u{1F4CC} Źródło: ${this.escapeMarkdown(data.source)}`);
    lines.push(`\u23F0 ${timestamp}`);

    return lines.join('\n');
  }

  /**
   * Formatuje alert Strong FinBERT Signal — fallback gdy VM offline.
   */
  formatStrongFinbertAlert(data: {
    symbol: string;
    priority: string;
    score: number;
    confidence: number;
    source: string;
  }): string {
    const icon = this.priorityIcon(data.priority);
    const timestamp = this.escapeMarkdown(new Date().toISOString());

    const direction = data.score > 0 ? 'BULLISH' : 'BEARISH';
    const dirIcon = data.score > 0 ? '\u{1F7E2}' : '\u{1F534}';

    return [
      `${icon} *StockPulse — Strong FinBERT Signal \\(unconfirmed\\)*`,
      '',
      `${dirIcon} *${this.escapeMarkdown(direction)}* — \\$${this.escapeMarkdown(data.symbol)}`,
      '',
      `\u{1F4CA} FinBERT: score ${this.escapeMarkdown(data.score.toFixed(3))}, confidence ${this.escapeMarkdown(data.confidence.toFixed(3))}`,
      `\u26A0\uFE0F Brak potwierdzenia AI — VM offline`,
      '',
      `\u{1F4CC} Źródło: ${this.escapeMarkdown(data.source)}`,
      `\u23F0 ${timestamp}`,
    ].join('\n');
  }

  /**
   * Formatuje sekcję PDUFA w raporcie 2h — nadchodzące katalizatory FDA (7 dni).
   * Kolorowanie: ≤1d czerwony, ≤3d pomarańczowy, ≤7d niebieski.
   */
  formatPdufaSummarySection(catalysts: {
    symbol: string;
    drugName: string;
    indication?: string;
    pdufaDate: Date;
    odinTier?: string;
    odinScore?: number;
  }[]): string {
    if (catalysts.length === 0) return '';

    const esc = (t: string) => t.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
    const now = new Date();

    const lines = [
      '',
      '💊 *PDUFA — nadchodzące decyzje FDA:*',
    ];

    for (const c of catalysts) {
      const pdufaDate = new Date(c.pdufaDate);
      const daysUntil = Math.ceil(
        (pdufaDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
      );
      const icon = daysUntil <= 1 ? '🔴' : daysUntil <= 3 ? '🟠' : '🔵';
      const dateStr = pdufaDate.toISOString().split('T')[0];
      const odin = c.odinTier
        ? ` \\| ${esc(c.odinTier)}${c.odinScore ? ` ${esc(String(c.odinScore))}%` : ''}`
        : '';

      lines.push(
        `${icon} \\$${esc(c.symbol)} — ${esc(c.drugName)} — za ${esc(String(daysUntil))}d \\(${esc(dateStr)}\\)${odin}`,
      );
    }

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
