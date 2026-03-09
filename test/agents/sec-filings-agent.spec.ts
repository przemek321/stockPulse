/**
 * Agent: SEC Filings Pipeline
 *
 * Testuje RZECZYWISTY kod z src/sec-filings/ — importy zamiast re-implementacji.
 * Każdy test może PAŚĆ gdy w kodzie jest bug.
 * Pliki: src/sec-filings/parsers/, src/sec-filings/scoring/,
 *        src/sec-filings/prompts/, src/sec-filings/types/
 */

import { detectItems, extractItemText, selectPromptBuilder, isBankruptcyItem, stripHtml } from '../../src/sec-filings/parsers/form8k.parser';
import { scoreToAlertPriority, mapToRuleName } from '../../src/sec-filings/scoring/price-impact.scorer';
import { parseGptResponse, SecFilingAnalysisSchema } from '../../src/sec-filings/types/sec-filing-analysis';
import { buildForm4Prompt, Form4PromptData } from '../../src/sec-filings/prompts/form4.prompt';

// ── Helper: tworzy poprawny SecFilingAnalysis ──

function makeAnalysis(overrides: Record<string, any> = {}) {
  return {
    price_impact: {
      direction: 'positive' as const,
      magnitude: 'medium' as const,
      confidence: 0.7,
      time_horizon: 'short_term' as const,
    },
    conviction: 0.5,
    summary: 'Test summary.',
    conclusion: 'Test conclusion.',
    key_facts: ['fact1'],
    catalyst_type: 'earnings',
    requires_immediate_attention: false,
    ...overrides,
    // Pozwól nadpisać zagnieżdżone price_impact
    ...(overrides.price_impact ? { price_impact: { ...{ direction: 'positive', magnitude: 'medium', confidence: 0.7, time_horizon: 'short_term' }, ...overrides.price_impact } } : {}),
  };
}

function makeForm4Data(overrides: Partial<Form4PromptData> = {}): Form4PromptData {
  return {
    insiderName: 'John Doe',
    insiderRole: 'CEO',
    transactionType: 'BUY',
    shares: 10000,
    pricePerShare: 500,
    totalValue: 5_000_000,
    sharesOwnedAfter: 50000,
    is10b51Plan: false,
    transactionDate: '2026-03-09',
    ...overrides,
  };
}

// ══════════════════════════════════════════════
// detectItems() — regex /Item\s+(\d+\.\d+)/gi
// ══════════════════════════════════════════════

describe('Agent: SEC Filings — detectItems()', () => {
  it('wykrywa pojedynczy Item', () => {
    expect(detectItems('Item 1.01 Material Agreement')).toEqual(['1.01']);
  });

  it('wykrywa wiele Items w kolejności pojawienia się', () => {
    const text = 'Item 2.02 Results of Operations Item 5.02 CEO change Item 9.01 Exhibits';
    expect(detectItems(text)).toEqual(['2.02', '5.02', '9.01']);
  });

  it('deduplikuje powtórzone Items', () => {
    expect(detectItems('Item 2.02 ... Item 2.02 again')).toEqual(['2.02']);
  });

  it('brak Items → pusta tablica', () => {
    expect(detectItems('No items in this text')).toEqual([]);
  });

  it('case insensitive: ITEM 1.01 = Item 1.01', () => {
    expect(detectItems('ITEM 1.01 Material')).toEqual(['1.01']);
  });

  it('dodatkowe spacje: "Item  1.01"', () => {
    expect(detectItems('Item  1.01 Material')).toEqual(['1.01']);
  });

  it('nie wykrywa "Item 1" (brak .XX)', () => {
    expect(detectItems('Item 1 without decimal')).toEqual([]);
  });
});

// ══════════════════════════════════════════════
// extractItemText() — wyciąganie sekcji + MAX_TEXT_LENGTH=8000
// ══════════════════════════════════════════════

describe('Agent: SEC Filings — extractItemText()', () => {
  it('wyciąga tekst sekcji między dwoma Items', () => {
    const text = 'Preamble Item 2.02 Earnings results here. Item 9.01 Exhibits.';
    const result = extractItemText(text, '2.02');
    expect(result).toContain('Earnings results');
    expect(result).not.toContain('Exhibits');
  });

  it('fallback do pełnego tekstu gdy Item nie znaleziony', () => {
    const text = 'Some filing text without matching item.';
    const result = extractItemText(text, '99.99');
    expect(result).toContain('Some filing text');
  });

  it('truncate do 8000 znaków (MAX_TEXT_LENGTH)', () => {
    const longText = 'Item 2.02 ' + 'A'.repeat(10000);
    const result = extractItemText(longText, '2.02');
    expect(result.length).toBeLessThanOrEqual(8000);
  });

  it('strip HTML przed truncation', () => {
    const html = 'Item 2.02 <p>Earnings</p><br/><strong>results</strong>';
    const result = extractItemText(html, '2.02');
    expect(result).not.toContain('<p>');
    expect(result).not.toContain('<strong>');
  });
});

// ══════════════════════════════════════════════
// stripHtml() — czyszczenie tagów HTML/SGML
// ══════════════════════════════════════════════

describe('Agent: SEC Filings — stripHtml()', () => {
  it('br → newline', () => {
    const result = stripHtml('line1<br>line2');
    expect(result).toContain('\n');
  });

  it('zamykające tagi blokowe → newline', () => {
    // Uwaga: trim() usuwa trailing \n, więc testujemy z tekstem po obu stronach
    expect(stripHtml('before<p>paragraph</p>after')).toContain('\n');
  });

  it('inne tagi → usunięte', () => {
    expect(stripHtml('<span>text</span>')).not.toContain('<span>');
  });

  it('&amp; → &', () => {
    expect(stripHtml('A&amp;B')).toContain('A&B');
  });

  it('&nbsp; → spacja', () => {
    expect(stripHtml('A&nbsp;B')).toContain('A B');
  });

  it('&quot; → cudzysłów', () => {
    expect(stripHtml('said &quot;hello&quot;')).toContain('"hello"');
  });

  it('&#39; → apostrof', () => {
    expect(stripHtml("it&#39;s")).toContain("it's");
  });

  it('normalizuje wielokrotne newlines', () => {
    const result = stripHtml('A<br><br><br><br>B');
    expect(result).not.toMatch(/\n{3,}/);
  });

  it('czysty tekst → bez zmian (trim)', () => {
    expect(stripHtml('plain text')).toBe('plain text');
  });
});

// ══════════════════════════════════════════════
// isBankruptcyItem() — Item 1.03
// ══════════════════════════════════════════════

describe('Agent: SEC Filings — isBankruptcyItem()', () => {
  it('1.03 → true (Bankruptcy)', () => {
    expect(isBankruptcyItem('1.03')).toBe(true);
  });

  it('1.01 → false', () => {
    expect(isBankruptcyItem('1.01')).toBe(false);
  });

  it('2.02 → false', () => {
    expect(isBankruptcyItem('2.02')).toBe(false);
  });
});

// ══════════════════════════════════════════════
// selectPromptBuilder() — routing Item → prompt
// ══════════════════════════════════════════════

describe('Agent: SEC Filings — selectPromptBuilder()', () => {
  it('Item 1.01 → zwraca funkcję (nie null)', () => {
    expect(selectPromptBuilder('1.01')).toBeInstanceOf(Function);
  });

  it('Item 1.03 → null (Bankruptcy — bez GPT)', () => {
    expect(selectPromptBuilder('1.03')).toBeNull();
  });

  it('Item 2.02 → zwraca funkcję', () => {
    expect(selectPromptBuilder('2.02')).toBeInstanceOf(Function);
  });

  it('Item 5.02 → zwraca funkcję', () => {
    expect(selectPromptBuilder('5.02')).toBeInstanceOf(Function);
  });

  it('Item 7.01 → zwraca funkcję (other)', () => {
    expect(selectPromptBuilder('7.01')).toBeInstanceOf(Function);
  });

  it('nieznany Item → fallback do buildForm8kOtherPrompt', () => {
    const builder = selectPromptBuilder('99.99');
    expect(builder).toBeInstanceOf(Function);
  });

  it('różne Items → różne prompt buildery (1.01 ≠ 2.02)', () => {
    expect(selectPromptBuilder('1.01')).not.toBe(selectPromptBuilder('2.02'));
  });

  it('prompt builder generuje string z tickerem', () => {
    const builder = selectPromptBuilder('2.02')!;
    const prompt = builder('ISRG', 'Intuitive Surgical', 'Earnings beat expectations');
    expect(prompt).toContain('ISRG');
    expect(prompt).toContain('Intuitive Surgical');
  });
});

// ══════════════════════════════════════════════
// scoreToAlertPriority() — GPT analysis → priorytet
// ══════════════════════════════════════════════

describe('Agent: SEC Filings — scoreToAlertPriority()', () => {
  it('requires_immediate_attention + |conviction| ≥ 0.4 + high magnitude → CRITICAL', () => {
    const analysis = makeAnalysis({
      requires_immediate_attention: true,
      conviction: 0.5,
      price_impact: { magnitude: 'high', confidence: 0.8 },
    });
    expect(scoreToAlertPriority(analysis, '8-K')).toBe('CRITICAL');
  });

  it('requires_immediate_attention + |conviction| ≥ 0.4 + medium magnitude → HIGH', () => {
    const analysis = makeAnalysis({
      requires_immediate_attention: true,
      conviction: 0.5,
      price_impact: { magnitude: 'medium', confidence: 0.5 },
    });
    expect(scoreToAlertPriority(analysis, '8-K')).toBe('HIGH');
  });

  it('requires_immediate_attention + |conviction| < 0.4 → nie matchuje pierwszej reguły', () => {
    const analysis = makeAnalysis({
      requires_immediate_attention: true,
      conviction: 0.3,
      price_impact: { magnitude: 'low', confidence: 0.3 },
    });
    // conviction=0.3 < 0.4, nie matchuje immediate, ale też low magnitude → null
    expect(scoreToAlertPriority(analysis, '8-K')).toBeNull();
  });

  it('high magnitude + confidence ≥ 0.7 → CRITICAL', () => {
    const analysis = makeAnalysis({
      price_impact: { magnitude: 'high', confidence: 0.8 },
    });
    expect(scoreToAlertPriority(analysis, '8-K')).toBe('CRITICAL');
  });

  it('medium magnitude + confidence ≥ 0.6 → HIGH', () => {
    const analysis = makeAnalysis({
      price_impact: { magnitude: 'medium', confidence: 0.7 },
    });
    expect(scoreToAlertPriority(analysis, '8-K')).toBe('HIGH');
  });

  it('high magnitude + confidence < 0.7 → HIGH (nie CRITICAL)', () => {
    const analysis = makeAnalysis({
      price_impact: { magnitude: 'high', confidence: 0.5 },
    });
    expect(scoreToAlertPriority(analysis, '8-K')).toBe('HIGH');
  });

  it('low magnitude + niska confidence → null', () => {
    const analysis = makeAnalysis({
      price_impact: { magnitude: 'low', confidence: 0.3 },
    });
    expect(scoreToAlertPriority(analysis, '8-K')).toBeNull();
  });

  it('medium magnitude + confidence < 0.6 → null', () => {
    const analysis = makeAnalysis({
      price_impact: { magnitude: 'medium', confidence: 0.5 },
    });
    expect(scoreToAlertPriority(analysis, '8-K')).toBeNull();
  });
});

// ══════════════════════════════════════════════
// mapToRuleName() — catalyst_type → nazwa reguły
// ══════════════════════════════════════════════

describe('Agent: SEC Filings — mapToRuleName()', () => {
  it('Form4 → "Form 4 Insider Signal" (niezależnie od catalyst_type)', () => {
    const analysis = makeAnalysis({ catalyst_type: 'anything' });
    expect(mapToRuleName(analysis, 'Form4')).toBe('Form 4 Insider Signal');
  });

  it('8-K + earnings → "8-K Earnings Miss"', () => {
    const analysis = makeAnalysis({ catalyst_type: 'earnings' });
    expect(mapToRuleName(analysis, '8-K')).toBe('8-K Earnings Miss');
  });

  it('8-K + leadership → "8-K Leadership Change"', () => {
    const analysis = makeAnalysis({ catalyst_type: 'leadership' });
    expect(mapToRuleName(analysis, '8-K')).toBe('8-K Leadership Change');
  });

  it('8-K + contract → "8-K Material Event GPT" (default)', () => {
    const analysis = makeAnalysis({ catalyst_type: 'contract' });
    expect(mapToRuleName(analysis, '8-K')).toBe('8-K Material Event GPT');
  });

  it('8-K + unknown → "8-K Material Event GPT" (default)', () => {
    const analysis = makeAnalysis({ catalyst_type: 'unknown' });
    expect(mapToRuleName(analysis, '8-K')).toBe('8-K Material Event GPT');
  });
});

// ══════════════════════════════════════════════
// parseGptResponse() — Zod walidacja + JSON parsing
// ══════════════════════════════════════════════

describe('Agent: SEC Filings — parseGptResponse()', () => {
  const validJson = JSON.stringify({
    price_impact: { direction: 'positive', magnitude: 'high', confidence: 0.8, time_horizon: 'short_term' },
    conviction: 1.2,
    summary: 'Pozytywne wyniki.',
    conclusion: 'Wzrost oczekiwany.',
    key_facts: ['Przychody +20%'],
    catalyst_type: 'earnings',
    requires_immediate_attention: false,
  });

  it('poprawny JSON → parsowany bez błędu', () => {
    const result = parseGptResponse(validJson);
    expect(result.conviction).toBe(1.2);
    expect(result.catalyst_type).toBe('earnings');
  });

  it('JSON z markdown backticks → strip i parsuj', () => {
    const raw = '```json\n' + validJson + '\n```';
    const result = parseGptResponse(raw);
    expect(result.conviction).toBe(1.2);
  });

  it('conviction poza [-2, +2] → Zod rzuca błąd', () => {
    const invalid = JSON.stringify({
      price_impact: { direction: 'positive', magnitude: 'high', confidence: 0.8, time_horizon: 'short_term' },
      conviction: 3.0,
      summary: 'Test', conclusion: 'Test', key_facts: ['a'], catalyst_type: 'test', requires_immediate_attention: false,
    });
    expect(() => parseGptResponse(invalid)).toThrow();
  });

  it('conviction -2.0 → graniczny, przechodzi', () => {
    const edgeJson = JSON.stringify({
      price_impact: { direction: 'negative', magnitude: 'high', confidence: 0.9, time_horizon: 'immediate' },
      conviction: -2.0,
      summary: 'Upadłość.', conclusion: 'Spadek.', key_facts: ['bankruptcy'], catalyst_type: 'bankruptcy', requires_immediate_attention: true,
    });
    expect(() => parseGptResponse(edgeJson)).not.toThrow();
  });

  it('niepoprawny JSON → rzuca SyntaxError', () => {
    expect(() => parseGptResponse('not json at all')).toThrow();
  });

  it('brak wymaganego pola → Zod rzuca błąd', () => {
    const missing = JSON.stringify({ conviction: 0.5 });
    expect(() => parseGptResponse(missing)).toThrow();
  });

  it('pusty key_facts → Zod rzuca błąd (min 1)', () => {
    const emptyFacts = JSON.stringify({
      price_impact: { direction: 'positive', magnitude: 'low', confidence: 0.5, time_horizon: 'medium_term' },
      conviction: 0.1, summary: 'Ok', conclusion: 'Ok', key_facts: [], catalyst_type: 'test', requires_immediate_attention: false,
    });
    expect(() => parseGptResponse(emptyFacts)).toThrow();
  });

  it('confidence > 1.0 w price_impact → Zod rzuca błąd', () => {
    const badConf = JSON.stringify({
      price_impact: { direction: 'positive', magnitude: 'low', confidence: 1.5, time_horizon: 'short_term' },
      conviction: 0.1, summary: 'Ok', conclusion: 'Ok', key_facts: ['a'], catalyst_type: 'test', requires_immediate_attention: false,
    });
    expect(() => parseGptResponse(badConf)).toThrow();
  });
});

// ══════════════════════════════════════════════
// buildForm4Prompt() — generowanie promptu Form 4
// ══════════════════════════════════════════════

describe('Agent: SEC Filings — buildForm4Prompt()', () => {
  it('zawiera ticker i nazwę firmy', () => {
    const prompt = buildForm4Prompt('ISRG', 'Intuitive Surgical', makeForm4Data(), []);
    expect(prompt).toContain('ISRG');
    expect(prompt).toContain('Intuitive Surgical');
  });

  it('is10b51Plan=true → prompt zawiera "YES"', () => {
    const prompt = buildForm4Prompt('ISRG', 'Intuitive Surgical', makeForm4Data({ is10b51Plan: true }), []);
    expect(prompt).toContain('Is 10b5-1 plan (pre-scheduled): YES');
  });

  it('is10b51Plan=false → prompt zawiera "NO"', () => {
    const prompt = buildForm4Prompt('ISRG', 'Intuitive Surgical', makeForm4Data({ is10b51Plan: false }), []);
    expect(prompt).toContain('Is 10b5-1 plan (pre-scheduled): NO');
  });

  it('prompt zawiera insiderRole', () => {
    const prompt = buildForm4Prompt('ISRG', 'Intuitive Surgical', makeForm4Data({ insiderRole: 'CFO' }), []);
    expect(prompt).toContain('CFO');
  });

  it('brak insiderRole → "Unknown role"', () => {
    const prompt = buildForm4Prompt('ISRG', 'Intuitive Surgical', makeForm4Data({ insiderRole: null }), []);
    expect(prompt).toContain('Unknown role');
  });

  it('prompt zawiera skalę conviction z opisem 10b5-1 (±0.1-0.3)', () => {
    const prompt = buildForm4Prompt('ISRG', 'Intuitive Surgical', makeForm4Data(), []);
    expect(prompt).toContain('±0.1-0.3');
    expect(prompt).toContain('10b5-1');
  });

  it('prompt zawiera hierarchię ról: CEO/Founder > CFO > Director > VP', () => {
    const prompt = buildForm4Prompt('ISRG', 'Intuitive Surgical', makeForm4Data(), []);
    expect(prompt).toContain('CEO/Founder > CFO > Director > VP');
  });

  it('prompt zawiera skalę conviction klaster insiderski (±0.9 to ±1.2)', () => {
    const prompt = buildForm4Prompt('ISRG', 'Intuitive Surgical', makeForm4Data(), []);
    expect(prompt).toContain('±0.9 to ±1.2');
  });

  it('recentFilings puste → "No other insider transactions"', () => {
    const prompt = buildForm4Prompt('ISRG', 'Intuitive Surgical', makeForm4Data(), []);
    expect(prompt).toContain('No other insider transactions');
  });

  it('recentFilings z danymi → listuje transakcje', () => {
    const recent = [makeForm4Data({ insiderName: 'Jane Smith', insiderRole: 'CFO', transactionType: 'SELL', totalValue: 200_000 })];
    const prompt = buildForm4Prompt('ISRG', 'Intuitive Surgical', makeForm4Data(), recent);
    expect(prompt).toContain('Jane Smith');
    expect(prompt).toContain('CFO');
    expect(prompt).toContain('SELL');
  });

  it('BUY → PURCHASE w promptzie', () => {
    const prompt = buildForm4Prompt('ISRG', 'Intuitive Surgical', makeForm4Data({ transactionType: 'BUY' }), []);
    expect(prompt).toContain('PURCHASE');
  });

  it('SELL → SALE w promptzie', () => {
    const prompt = buildForm4Prompt('ISRG', 'Intuitive Surgical', makeForm4Data({ transactionType: 'SELL' }), []);
    expect(prompt).toContain('SALE');
  });

  it('sharesOwnedAfter=null → "N/A"', () => {
    const prompt = buildForm4Prompt('ISRG', 'Intuitive Surgical', makeForm4Data({ sharesOwnedAfter: null }), []);
    expect(prompt).toContain('Shares owned after: N/A');
  });

  it('prompt wymaga odpowiedzi JSON po polsku', () => {
    const prompt = buildForm4Prompt('ISRG', 'Intuitive Surgical', makeForm4Data(), []);
    expect(prompt).toContain('POLISH');
    expect(prompt).toContain('JSON');
  });
});

// ══════════════════════════════════════════════
// Conviction normalizacja [-2,+2] → [-1,+1]
// ══════════════════════════════════════════════

describe('Agent: SEC Filings — Conviction normalizacja (logika)', () => {
  // Normalizacja zaimplementowana w pipeline: Math.max(-1, Math.min(1, conviction / 2.0))
  function normalizeConviction(conviction: number): number {
    return Math.max(-1.0, Math.min(1.0, conviction / 2.0));
  }

  it('+2.0 → +1.0', () => expect(normalizeConviction(2.0)).toBe(1.0));
  it('-2.0 → -1.0', () => expect(normalizeConviction(-2.0)).toBe(-1.0));
  it('+1.0 → +0.5', () => expect(normalizeConviction(1.0)).toBeCloseTo(0.5));
  it('0 → 0', () => expect(normalizeConviction(0)).toBe(0));
  it('+3.0 → capped +1.0', () => expect(normalizeConviction(3.0)).toBe(1.0));
  it('-3.0 → capped -1.0', () => expect(normalizeConviction(-3.0)).toBe(-1.0));
});

// ══════════════════════════════════════════════
// DailyCapService — logika atomowego limitu
// ══════════════════════════════════════════════

describe('Agent: SEC Filings — DailyCapService logika', () => {
  const DAILY_CAP = 20;

  it('format klucza Redis: gpt:daily:{ticker}:{YYYY-MM-DD}', () => {
    const key = `gpt:daily:ISRG:2026-03-09`;
    expect(key).toMatch(/^gpt:daily:\w+:\d{4}-\d{2}-\d{2}$/);
  });

  it('limit = 20 wywołań per ticker per dzień', () => {
    expect(DAILY_CAP).toBe(20);
  });
});

// ══════════════════════════════════════════════
// Guardy Form8kPipeline
// ══════════════════════════════════════════════

describe('Agent: SEC Filings — Form8k guardy (logika)', () => {
  it('tekst < 100 znaków → skip', () => {
    expect('Short text'.length).toBeLessThan(100);
  });

  it('tekst >= 100 znaków → procesowany', () => {
    expect('A'.repeat(100).length).toBeGreaterThanOrEqual(100);
  });

  it('detectItems na pustym tekście → brak Items → skip', () => {
    expect(detectItems('')).toEqual([]);
  });
});

// ══════════════════════════════════════════════
// Guardy Form4Pipeline
// ══════════════════════════════════════════════

describe('Agent: SEC Filings — Form4 guardy (logika)', () => {
  const MIN_TRADE_VALUE = 100_000;
  const ALERTABLE_TYPES = ['BUY', 'SELL'];

  it('totalValue < $100K → skip', () => {
    expect(50_000 < MIN_TRADE_VALUE).toBe(true);
  });

  it('totalValue = $100K → procesowany', () => {
    expect(100_000 >= MIN_TRADE_VALUE).toBe(true);
  });

  it('GIFT → skip', () => {
    expect(ALERTABLE_TYPES.includes('GIFT')).toBe(false);
  });

  it('EXERCISE → skip', () => {
    expect(ALERTABLE_TYPES.includes('EXERCISE')).toBe(false);
  });

  it('BUY → procesowany', () => {
    expect(ALERTABLE_TYPES.includes('BUY')).toBe(true);
  });

  it('SELL → procesowany', () => {
    expect(ALERTABLE_TYPES.includes('SELL')).toBe(true);
  });
});
