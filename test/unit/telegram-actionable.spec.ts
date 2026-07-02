import { TelegramFormatterService } from '../../src/alerts/telegram/telegram-formatter.service';

/**
 * Pakiet 1 fix #5 (09.06.2026) — actionable Telegram.
 *
 * Forward-ocena 09.06: alerty komunikują analizę, nie decyzję. Dodana linia
 * "📌 Akcja: LONG | Horyzont: 3-7d | Wejście: $X.XX" w 3 formatterach +
 * nazwisko/kwota nogi form4 w Correlated. Horyzonty: statyczna mapa
 * backtest-backed, bez LLM.
 */

describe('Telegram actionable (Pakiet 1 fix #5)', () => {
  const formatter = new TelegramFormatterService();

  describe('resolveHorizon — statyczna mapa', () => {
    it('form4 BUY → 3-7d (V5 d=+0.92 na 7d, 30d edge znika)', () => {
      expect(formatter.resolveHorizon('form4', 'positive')).toBe('3-7d');
    });

    it('8-K bearish → 1-3d (PEAD front-loaded, HIMS -19.7% 1d)', () => {
      expect(formatter.resolveHorizon('8k', 'negative')).toBe('1-3d');
    });

    it('correlated → 3-7d (dominanta nogi form4)', () => {
      expect(formatter.resolveHorizon('correlated', 'positive')).toBe('3-7d');
      expect(formatter.resolveHorizon('correlated', 'negative')).toBe('3-7d');
    });

    it('reszta → 3d (8-K bullish, form4 SELL)', () => {
      expect(formatter.resolveHorizon('8k', 'positive')).toBe('3d');
      expect(formatter.resolveHorizon('form4', 'negative')).toBe('3d');
    });
  });

  describe('formatActionLine', () => {
    it('positive → LONG z ceną wejścia (MarkdownV2-escaped)', () => {
      const line = formatter.formatActionLine({
        kind: 'form4',
        direction: 'positive',
        entryPrice: 322.5,
      });
      expect(line).toContain('Akcja: LONG');
      expect(line).toContain('Horyzont: 3\\-7d');
      expect(line).toContain('Wejście: $322\\.50');
    });

    it('negative → SHORT', () => {
      const line = formatter.formatActionLine({
        kind: '8k',
        direction: 'negative',
        entryPrice: 29.14,
      });
      expect(line).toContain('Akcja: SHORT');
      expect(line).toContain('Horyzont: 1\\-3d');
      expect(line).toContain('Wejście: $29\\.14');
    });

    it('brak ceny (Finnhub fail) → linia bez segmentu Wejście', () => {
      const line = formatter.formatActionLine({
        kind: 'form4',
        direction: 'positive',
        entryPrice: null,
      });
      expect(line).toContain('Akcja: LONG');
      expect(line).not.toContain('Wejście');
    });
  });

  describe('integracja z formatterami alertów', () => {
    const analysis = {
      price_impact: { direction: 'positive', magnitude: 'medium', confidence: 0.8 },
      conviction: 1.1,
      summary: 'Insider BUY',
      conclusion: 'Silny sygnał.',
      key_facts: ['BUY $497K'],
      catalyst_type: 'insider_buy',
    };

    it('formatForm4GptAlert: BUY z entryPrice → linia LONG 3-7d', () => {
      const msg = formatter.formatForm4GptAlert({
        symbol: 'PODD',
        companyName: 'Insulet',
        insiderName: 'Weatherman Elizabeth',
        insiderRole: 'Director',
        transactionType: 'BUY',
        totalValue: 496_960,
        shares: 1_600,
        is10b51Plan: false,
        sharesOwnedAfter: 12_000,
        analysis,
        priority: 'MEDIUM',
        entryPrice: 310.6,
      });
      expect(msg).toContain('Akcja: LONG');
      expect(msg).toContain('3\\-7d');
      expect(msg).toContain('$310\\.60');
    });

    it('formatForm8kGptAlert: bearish → SHORT 1-3d', () => {
      const msg = formatter.formatForm8kGptAlert({
        symbol: 'HIMS',
        companyName: 'Hims & Hers',
        itemNumber: '2.02',
        analysis: { ...analysis, conviction: -1.6, catalyst_type: 'earnings' },
        priority: 'CRITICAL',
        entryPrice: 29.14,
      });
      expect(msg).toContain('Akcja: SHORT');
      expect(msg).toContain('1\\-3d');
    });

    it('formatCorrelatedAlert: label nogi form4 + akcja', () => {
      const msg = formatter.formatCorrelatedAlert({
        symbol: 'HIMS',
        patternType: 'INSIDER_PLUS_OPTIONS',
        patternLabel: 'Insider + Unusual Options',
        direction: 'positive',
        correlatedConviction: 0.71,
        description: 'Form4 BUY + options bullish w 5d',
        signals: [
          {
            sourceCategory: 'form4',
            catalystType: 'insider_buy',
            conviction: 0.55,
            label: 'Dudum Andrew (CEO) BUY $1,038,000',
          },
          { sourceCategory: 'options', catalystType: 'unusual_volume', conviction: 0.5 },
        ],
        priority: 'CRITICAL',
        entryPrice: 41.2,
      });
      expect(msg).toContain('Dudum Andrew');
      expect(msg).toContain('Akcja: LONG');
      expect(msg).toContain('$41\\.20');
      // sygnał bez label → fallback na catalyst_type (stare wpisy w Redis)
      expect(msg).toContain('unusual\\_volume');
    });

    it('formatForm4GptAlert bez entryPrice → bez Wejście, reszta bez zmian', () => {
      const msg = formatter.formatForm4GptAlert({
        symbol: 'PODD',
        companyName: 'Insulet',
        insiderName: 'X',
        insiderRole: 'Director',
        transactionType: 'BUY',
        totalValue: 100_000,
        shares: 100,
        is10b51Plan: false,
        sharesOwnedAfter: null,
        analysis,
        priority: 'MEDIUM',
      });
      expect(msg).toContain('Akcja: LONG');
      expect(msg).not.toContain('Wejście');
    });
  });

  describe('znacznik 🎯 reguł gry real (doc/REGULY-GRY-REAL-2026-07-02.md)', () => {
    const analysis = {
      price_impact: { direction: 'positive', magnitude: 'medium', confidence: 0.8 },
      conviction: 1.1,
      summary: 'Insider BUY',
      conclusion: 'Silny sygnał.',
      key_facts: ['BUY $497K'],
      catalyst_type: 'insider_buy',
    };
    const base = {
      symbol: 'PODD',
      companyName: 'Insulet',
      insiderName: 'Weatherman Elizabeth',
      insiderRole: 'Director',
      transactionType: 'BUY',
      totalValue: 496_960,
      shares: 1_600,
      is10b51Plan: false,
      sharesOwnedAfter: 12_000,
      analysis,
      priority: 'MEDIUM' as const,
    };

    it('qualifiesRealRules + entryPrice → tag z max wejściem (chase +3%)', () => {
      const msg = formatter.formatForm4GptAlert({
        ...base,
        entryPrice: 310.6,
        qualifiesRealRules: true,
      });
      expect(msg).toContain('KWALIFIKUJE wg reguł gry real');
      // 310.60 * 1.03 = 319.918 → $319.92
      expect(msg).toContain('$319\\.92');
      expect(msg).toContain('wyjście 7d');
    });

    it('qualifiesRealRules bez entryPrice → tag bez segmentu max wejścia', () => {
      const msg = formatter.formatForm4GptAlert({
        ...base,
        qualifiesRealRules: true,
      });
      expect(msg).toContain('KWALIFIKUJE wg reguł gry real');
      expect(msg).not.toContain('max wejście');
    });

    it('brak flagi (observation/SELL/domyślnie) → ZERO znacznika', () => {
      const noFlag = formatter.formatForm4GptAlert({ ...base, entryPrice: 310.6 });
      const flagFalse = formatter.formatForm4GptAlert({
        ...base,
        entryPrice: 310.6,
        qualifiesRealRules: false,
      });
      expect(noFlag).not.toContain('KWALIFIKUJE');
      expect(flagFalse).not.toContain('KWALIFIKUJE');
    });
  });
});
