import {
  detectItems,
  extractItemText,
  isBankruptcyItem,
  stripHtml,
  selectPromptBuilder,
} from '../../src/sec-filings/parsers/form8k.parser';

/**
 * Testy parsera 8-K — detekcja Items, ekstrakcja tekstu, strip HTML.
 */
describe('Form 8-K Parser', () => {
  describe('detectItems', () => {
    it('wykrywa pojedynczy Item', () => {
      const text = 'Item 2.02 Results of Operations and Financial Condition';
      expect(detectItems(text)).toEqual(['2.02']);
    });

    it('wykrywa wiele Items', () => {
      const text = `
        Item 2.02 Results of Operations
        Item 9.01 Financial Statements and Exhibits
      `;
      expect(detectItems(text)).toEqual(['2.02', '9.01']);
    });

    it('deduplikuje powtórzenia', () => {
      const text = `
        Item 2.02 Results of Operations
        Item 2.02 (continued)
        Item 9.01 Exhibits
      `;
      expect(detectItems(text)).toEqual(['2.02', '9.01']);
    });

    it('zwraca pustą tablicę gdy brak Items', () => {
      expect(detectItems('No items here')).toEqual([]);
    });

    it('obsługuje case-insensitive', () => {
      const text = 'ITEM 5.02 Departure of Directors';
      expect(detectItems(text)).toEqual(['5.02']);
    });

    it('wykrywa Item 1.01 Material Definitive Agreement', () => {
      const text = 'Item 1.01 Entry into a Material Definitive Agreement';
      expect(detectItems(text)).toEqual(['1.01']);
    });

    it('wykrywa Item 1.03 Bankruptcy', () => {
      const text = 'Item 1.03 Bankruptcy or Receivership';
      expect(detectItems(text)).toEqual(['1.03']);
    });
  });

  describe('extractItemText', () => {
    it('wyciąga tekst między dwoma Items', () => {
      const text = `
        Item 2.02 Results of Operations
        The company reported revenue of $10B...
        Item 9.01 Financial Statements
        See exhibits.
      `;
      const result = extractItemText(text, '2.02');
      expect(result).toContain('revenue');
      expect(result).not.toContain('See exhibits');
    });

    it('wyciąga tekst do końca gdy brak następnego Item', () => {
      const text = `
        Item 5.02 CEO Departure
        John Doe resigned as CEO effective March 1.
      `;
      const result = extractItemText(text, '5.02');
      expect(result).toContain('resigned as CEO');
    });

    it('ogranicza tekst do MAX_TEXT_LENGTH (50 000 znaków, S19-FIX-02c)', () => {
      const longText = 'Item 2.02 ' + 'x'.repeat(60_000);
      const result = extractItemText(longText, '2.02');
      expect(result.length).toBeLessThanOrEqual(50_000);
      expect(result.length).toBeGreaterThan(8_000); // wcześniej obcinał do 8k, teraz 50k
    });

    it('zwraca cały tekst (stripHtml) gdy Item nie znaleziony', () => {
      const text = 'Some random text without any Item markers';
      const result = extractItemText(text, '99.99');
      expect(result).toContain('Some random text');
    });

    it('zatrzymuje się na SIGNATURES', () => {
      const text = `
        Item 2.02 Revenue missed expectations.
        SIGNATURES
        By: /s/ John Doe
      `;
      const result = extractItemText(text, '2.02');
      expect(result).toContain('Revenue missed');
      expect(result).not.toContain('John Doe');
    });
  });

  describe('isBankruptcyItem', () => {
    it('zwraca true dla Item 1.03', () => {
      expect(isBankruptcyItem('1.03')).toBe(true);
    });

    it('zwraca false dla innych Items', () => {
      expect(isBankruptcyItem('1.01')).toBe(false);
      expect(isBankruptcyItem('2.02')).toBe(false);
      expect(isBankruptcyItem('5.02')).toBe(false);
    });
  });

  describe('selectPromptBuilder', () => {
    it('zwraca null dla Item 1.03 (bankruptcy)', () => {
      expect(selectPromptBuilder('1.03')).toBeNull();
    });

    it('zwraca funkcję dla Item 1.01', () => {
      expect(typeof selectPromptBuilder('1.01')).toBe('function');
    });

    it('zwraca funkcję dla Item 2.02', () => {
      expect(typeof selectPromptBuilder('2.02')).toBe('function');
    });

    it('zwraca funkcję dla Item 5.02', () => {
      expect(typeof selectPromptBuilder('5.02')).toBe('function');
    });

    it('zwraca domyślną funkcję dla nieznanego Item', () => {
      const result = selectPromptBuilder('99.99');
      expect(typeof result).toBe('function');
    });
  });

  describe('stripHtml', () => {
    it('usuwa tagi HTML', () => {
      expect(stripHtml('<p>Hello <b>world</b></p>')).toBe('Hello world');
    });

    it('zamienia <br> na newline', () => {
      const result = stripHtml('Line1<br/>Line2');
      expect(result).toContain('Line1');
      expect(result).toContain('Line2');
    });

    it('dekoduje encje HTML', () => {
      expect(stripHtml('A &amp; B &lt; C')).toBe('A & B < C');
    });

    it('normalizuje wielokrotne spacje', () => {
      expect(stripHtml('a     b')).toBe('a b');
    });

    it('normalizuje wielokrotne newline', () => {
      const result = stripHtml('a\n\n\n\n\nb');
      expect(result).toBe('a\n\nb');
    });
  });
});
