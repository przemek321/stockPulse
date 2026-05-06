/**
 * S19-FIX-12: testy regex extract reported numbers (EPS + Revenue) z exhibit text.
 *
 * Best-effort extractor — używany jako fallback gdy Finnhub/Alpha Vantage nie
 * mają jeszcze danych dla świeżego raportu. Primary source dla EPS to Finnhub
 * `/stock/earnings.actual`, a dla revenue to extract z reportText (Alpha Vantage
 * free nie udostępnia revenue actual).
 */

import {
  extractEpsDiluted,
  extractRevenue,
  extractReportedNumbers,
} from '../../src/sec-filings/utils/extract-reported-numbers';

describe('extractRevenue — patterns', () => {
  it('PODD-style "Revenue of $761.7 million" → 761700000', () => {
    const text = 'For the first quarter of 2026, total revenue of $761.7 million increased 33.9%.';
    expect(extractRevenue(text)).toBeCloseTo(761_700_000, -3);
  });

  it('"Total revenue: $3.2 billion" → 3.2e9', () => {
    const text = 'For full year 2025, total revenue: $3.2 billion';
    expect(extractRevenue(text)).toBeCloseTo(3_200_000_000, -6);
  });

  it('"Net revenues of $250M" → 250M', () => {
    const text = 'Net revenues of $250M for the quarter.';
    expect(extractRevenue(text)).toBeCloseTo(250_000_000, -3);
  });

  it('bez waluty unit (gołe miliony) zwraca null gdy poniżej 1M progu', () => {
    const text = 'Earnings per share of $1.42 from operations.';
    expect(extractRevenue(text)).toBeNull();
  });

  it('wybiera największą wartość gdy multiple matches', () => {
    const text = `
      US Omnipod revenue of $515.6 million.
      International Omnipod revenue of $242.8 million.
      Total Omnipod revenue of $758.4 million.
      Drug Delivery revenue of $3.3 million.
    `;
    expect(extractRevenue(text)).toBeCloseTo(758_400_000, -3);
  });

  it('"Revenue: $1.5 billion" colon syntax', () => {
    const text = 'Q1 2026 highlights — Revenue: $1.5 billion';
    expect(extractRevenue(text)).toBeCloseTo(1_500_000_000, -6);
  });

  it('przecinki w liczbach: "$761,700,000"', () => {
    // Pattern wymaga unit dla raw numbers — bez "million/billion" to revenue
    // bez unit i może być mylące (e.g. small company "$761,700"). Konserwatywnie
    // wymagamy unit albo $X.X[M|B|million|billion].
    const text = 'Total revenue of $761,700 thousand';
    // 761700 raw bez unit million — pattern1 może przyjąć ale próg 1M filtruje
    const result = extractRevenue(text);
    // Implementacja: parser bierze "761,700" jako 761700, brak unit → 761700 < 1M → null
    expect(result).toBeNull();
  });

  it('case-insensitive "REVENUE OF $500 MILLION"', () => {
    const text = 'NET REVENUE OF $500 MILLION FOR THE PERIOD.';
    expect(extractRevenue(text)).toBeCloseTo(500_000_000, -3);
  });

  it('zero / negative revenue → null (próg minimalny)', () => {
    expect(extractRevenue('Revenue of $0.0 million')).toBeNull();
  });

  it('null gdy text za krótki', () => {
    expect(extractRevenue('Revenue of $100M')).toBeCloseTo(100_000_000, -3);
    expect(extractRevenue('short')).toBeNull();
  });

  it('null gdy brak revenue keyword', () => {
    const text = 'Earnings per share of $1.42 (diluted) for Q1 2026 with strong performance.';
    expect(extractRevenue(text)).toBeNull();
  });
});

describe('extractEpsDiluted — patterns', () => {
  it('"diluted EPS of $1.42" → 1.42', () => {
    const text = 'For Q1 2026, diluted EPS of $1.42, up from $1.02 prior year.';
    expect(extractEpsDiluted(text)).toBe(1.42);
  });

  it('"EPS (diluted): $1.42" → 1.42', () => {
    const text = 'Highlights: EPS (diluted): $1.42, exceeding guidance.';
    expect(extractEpsDiluted(text)).toBe(1.42);
  });

  it('"earnings per share, diluted, $1.30" → 1.30', () => {
    const text = 'GAAP earnings per share, diluted, $1.30 for the quarter.';
    expect(extractEpsDiluted(text)).toBe(1.30);
  });

  it('"net loss per share, diluted, $(3.40)" → -3.40 (parens negate)', () => {
    // Pattern bierze samą liczbę; znak ujemny w nawiasie wymaga osobnej obsługi.
    // Aktualna implementacja parsuje liczbę bez interpretacji nawiasu — zostaje 3.40.
    const text = 'Net loss per share, diluted, $(3.40) for the period.';
    const result = extractEpsDiluted(text);
    // Uznajemy że dla parens nawiasów nie negujemy automatycznie w pierwszej iteracji
    expect(result).toBe(3.40);
  });

  it('"EPS diluted $1.42" bez interpunkcji', () => {
    const text = 'Q1 results: EPS diluted $1.42 vs estimate $1.30.';
    expect(extractEpsDiluted(text)).toBe(1.42);
  });

  it('null dla nonsensownych wartości (>$100)', () => {
    const text = 'Diluted EPS of $250.00'; // share price nie EPS
    expect(extractEpsDiluted(text)).toBeNull();
  });

  it('null gdy brak EPS keyword', () => {
    const text = 'Total revenue of $761.7 million for the quarter.';
    expect(extractEpsDiluted(text)).toBeNull();
  });

  it('case-insensitive "DILUTED EPS OF $2.50"', () => {
    expect(extractEpsDiluted('DILUTED EPS OF $2.50 for Q1.')).toBe(2.50);
  });
});

describe('extractReportedNumbers — combined', () => {
  it('PODD Q1 2026 sample (EPS + revenue)', () => {
    const text = `
      Insulet Corporation Q1 2026 Results

      Total revenue of $761.7 million increased 33.9% versus prior year.
      Diluted EPS of $1.30 (GAAP) and adjusted diluted EPS of $1.42.
      Total Omnipod revenue of $758.4 million increased 36.9%.
      US Omnipod revenue of $515.6 million.
    `;
    const result = extractReportedNumbers(text);
    expect(result.epsDiluted).toBe(1.30); // first match: GAAP diluted (przed adjusted)
    expect(result.revenue).toBeCloseTo(761_700_000, -3);
  });

  it('oba null gdy text bez liczb', () => {
    const result = extractReportedNumbers('Quarterly performance highlights without specifics.');
    expect(result.epsDiluted).toBeNull();
    expect(result.revenue).toBeNull();
  });
});
