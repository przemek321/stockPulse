import { Injectable } from '@nestjs/common';

/**
 * Formatter wiadomości alertów dla Telegram.
 * Generuje wiadomości w formacie MarkdownV2 z odpowiednim escapingiem.
 */
@Injectable()
export class TelegramFormatterService {
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
      `\u{1F575}\uFE0F *Transakcja Insidera* \u2014 \\$${this.escapeMarkdown(data.symbol)}`,
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
      `📄 *Filing SEC* — \\$${this.escapeMarkdown(data.symbol)}`,
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
   * Formatuje alert Unusual Options Activity — volume spike wykryty w danych EOD.
   */
  formatOptionsFlowAlert(data: {
    symbol: string;
    priority: string;
    conviction: number;
    direction: string;
    callPutRatio: number;
    headlineContract: {
      optionType: string;
      strike: number;
      expiry: string;
      dte: number;
      dailyVolume: number;
      avgVolume20d: number;
      spikeRatio: number;
      otmDistance: number;
    };
    pdufaBoosted: boolean;
    sessionDate: string;
  }): string {
    const icon = this.priorityIcon(data.priority);
    const h = data.headlineContract;

    const dirLabel = data.direction === 'positive' ? 'BULLISH'
      : data.direction === 'negative' ? 'BEARISH' : 'MIXED';
    const dirIcon = data.direction === 'positive' ? '\u{1F7E2}'
      : data.direction === 'negative' ? '\u{1F534}' : '\u{1F7E1}';

    const cpPct = Math.round(data.callPutRatio * 100);
    const cpLabel = data.direction === 'positive'
      ? `call dominance ${cpPct}%`
      : data.direction === 'negative'
        ? `put dominance ${100 - cpPct}%`
        : `mixed ${cpPct}/${100 - cpPct}`;

    const typeLabel = h.optionType === 'call' ? 'Call' : 'Put';
    const otmPct = (h.otmDistance * 100).toFixed(1);

    const lines = [
      `\u{1F4CA} *StockPulse — Unusual Options*`,
      '',
      `${dirIcon} *${this.escapeMarkdown(dirLabel)}* — \\$${this.escapeMarkdown(data.symbol)} \\(${this.escapeMarkdown(cpLabel)}\\)`,
      '',
      `\u{1F3AF} *Conviction: ${this.escapeMarkdown(data.conviction.toFixed(3))}*`,
      '',
      `\u{1F4C8} Headline: ${this.escapeMarkdown(data.symbol)} ${this.escapeMarkdown(h.expiry)} \\$${this.escapeMarkdown(String(h.strike))} ${this.escapeMarkdown(typeLabel)}`,
      `  Volume: ${this.escapeMarkdown(h.dailyVolume.toLocaleString())} \\(spike ${this.escapeMarkdown(h.spikeRatio.toFixed(1))}\u00D7 vs avg ${this.escapeMarkdown(Math.round(h.avgVolume20d).toLocaleString())}\\)`,
      `  OTM: ${this.escapeMarkdown(otmPct)}% \\| DTE: ${this.escapeMarkdown(String(h.dte))} dni`,
    ];

    if (data.pdufaBoosted) {
      lines.push('');
      lines.push(`\u{1F48A} *PDUFA boost aktywny*`);
    }

    lines.push('');
    lines.push(`\u{1F4C5} Sesja: ${this.escapeMarkdown(data.sessionDate)}`);

    return lines.join('\n');
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
   * Formatuje alert Form 4 z analizą GPT — insider info + wniosek AI.
   */
  formatForm4GptAlert(data: {
    symbol: string;
    companyName: string;
    insiderName: string;
    insiderRole: string | null;
    transactionType: string;
    totalValue: number;
    shares: number;
    is10b51Plan: boolean;
    sharesOwnedAfter: number | null;
    analysis: {
      price_impact: { direction: string; magnitude: string; confidence: number };
      conviction: number;
      conclusion: string;
      key_facts: string[];
    };
    priority: string;
  }): string {
    const icon = this.priorityIcon(data.priority);
    const dirIcon = data.analysis.conviction > 0 ? '🟢' : '🔴';
    const value = this.escapeMarkdown(`$${data.totalValue.toLocaleString('en-US')}`);
    const timestamp = this.escapeMarkdown(new Date().toISOString());

    const lines = [
      `${icon} *StockPulse Alert*`,
      `*${this.escapeMarkdown(data.priority)}* — \\$${this.escapeMarkdown(data.symbol)} Sygnał Insidera`,
      '',
      `👤 *${this.escapeMarkdown(data.insiderName)}* \\(${this.escapeMarkdown(data.insiderRole ?? 'Nieznana')}\\)`,
      `• Transakcja: ${this.escapeMarkdown(data.transactionType)} ${this.escapeMarkdown(data.shares.toLocaleString('en-US'))} akcji @ ${value}`,
    ];

    if (data.sharesOwnedAfter != null) {
      lines.push(`• Udziały po transakcji: ${this.escapeMarkdown(data.sharesOwnedAfter.toLocaleString('en-US'))} akcji`);
    }

    lines.push(`• Plan 10b5\\-1: ${data.is10b51Plan ? 'TAK' : 'NIE'}`);
    lines.push('');
    lines.push(`${dirIcon} *Wniosek GPT:*`);
    lines.push(this.escapeMarkdown(data.analysis.conclusion.substring(0, 300)));
    lines.push('');

    for (const fact of data.analysis.key_facts.slice(0, 3)) {
      lines.push(`• ${this.escapeMarkdown(fact.substring(0, 100))}`);
    }

    lines.push('');
    lines.push(
      `• Conviction: ${this.escapeMarkdown(data.analysis.conviction.toFixed(2))} \\| ` +
        `Wpływ: ${this.escapeMarkdown(data.analysis.price_impact.direction)} / ${this.escapeMarkdown(data.analysis.price_impact.magnitude)}`,
    );
    lines.push(`⏰ ${timestamp}`);

    return lines.join('\n');
  }

  /**
   * Formatuje alert 8-K z analizą GPT — Item number + wniosek AI.
   */
  formatForm8kGptAlert(data: {
    symbol: string;
    companyName: string;
    itemNumber: string;
    analysis: {
      price_impact: { direction: string; magnitude: string; confidence: number };
      conviction: number;
      summary: string;
      conclusion: string;
      key_facts: string[];
      catalyst_type: string;
    };
    priority: string;
  }): string {
    const icon = this.priorityIcon(data.priority);
    const dirIcon = data.analysis.conviction > 0 ? '🟢' : '🔴';
    const timestamp = this.escapeMarkdown(new Date().toISOString());

    const lines = [
      `${icon} *StockPulse Alert*`,
      `*${this.escapeMarkdown(data.priority)}* — \\$${this.escapeMarkdown(data.symbol)} 8\\-K Item ${this.escapeMarkdown(data.itemNumber)}`,
      '',
      `📄 *${this.escapeMarkdown(data.companyName)}* \\(${this.escapeMarkdown(data.symbol)}\\)`,
      `• Katalizator: ${this.escapeMarkdown(data.analysis.catalyst_type)}`,
      '',
      `${dirIcon} *Wniosek GPT:*`,
      this.escapeMarkdown(data.analysis.conclusion.substring(0, 300)),
      '',
    ];

    for (const fact of data.analysis.key_facts.slice(0, 4)) {
      lines.push(`• ${this.escapeMarkdown(fact.substring(0, 100))}`);
    }

    lines.push('');
    lines.push(
      `• Conviction: ${this.escapeMarkdown(data.analysis.conviction.toFixed(2))} \\| ` +
        `Wpływ: ${this.escapeMarkdown(data.analysis.price_impact.direction)} / ${this.escapeMarkdown(data.analysis.price_impact.magnitude)}`,
    );
    lines.push(`⏰ ${timestamp}`);

    return lines.join('\n');
  }

  /**
   * Formatuje alert Bankruptcy (8-K Item 1.03) — CRITICAL, bez GPT.
   */
  formatBankruptcyAlert(data: {
    symbol: string;
    companyName: string;
    filingDate: string;
    documentUrl?: string;
  }): string {
    const timestamp = this.escapeMarkdown(new Date().toISOString());

    return [
      `🔴 *StockPulse — CRITICAL*`,
      '',
      `⚠️ *WNIOSEK O UPADŁOŚĆ* — \\$${this.escapeMarkdown(data.symbol)}`,
      '',
      `📄 *${this.escapeMarkdown(data.companyName)}* złożyło 8\\-K Item 1\\.03 \\(Upadłość\\)`,
      `• Data filingu: ${this.escapeMarkdown(data.filingDate)}`,
      data.documentUrl ? `• [Link do SEC](${data.documentUrl})` : '',
      '',
      `⏰ ${timestamp}`,
    ].filter(Boolean).join('\n');
  }

  /**
   * Formatuje alert skorelowanych sygnałów (CorrelationService).
   */
  formatCorrelatedAlert(data: {
    symbol: string;
    patternType: string;
    patternLabel: string;
    direction: string;
    correlatedConviction: number;
    description: string;
    signals: { sourceCategory: string; catalystType: string; conviction: number }[];
    priority: string;
  }): string {
    const icon = this.priorityIcon(data.priority);
    const dirIcon = data.direction === 'positive' ? '🟢' : '🔴';
    const timestamp = this.escapeMarkdown(new Date().toISOString());

    const lines = [
      `${icon} *StockPulse Alert*`,
      `*${this.escapeMarkdown(data.priority)}* — \\$${this.escapeMarkdown(data.symbol)} ${this.escapeMarkdown(data.patternLabel)}`,
      '',
      `🔗 *Skorelowane sygnały:*`,
    ];

    for (const sig of data.signals.slice(0, 5)) {
      lines.push(
        `• ${this.escapeMarkdown(sig.sourceCategory.toUpperCase())}: ${this.escapeMarkdown(sig.catalystType)} — conviction ${this.escapeMarkdown(sig.conviction.toFixed(2))}`,
      );
    }

    lines.push('');
    lines.push(
      `${dirIcon} Zagregowana conviction: ${this.escapeMarkdown(data.correlatedConviction.toFixed(2))} \\| ${this.escapeMarkdown(data.direction)}`,
    );
    lines.push(`ℹ️ ${this.escapeMarkdown(data.description.substring(0, 200))}`);
    lines.push(`⏰ ${timestamp}`);

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
