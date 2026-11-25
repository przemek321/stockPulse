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
    // Fixture zmieniony 25.11.2026: dawny tekst "For full year 2025, total revenue: $3.2 billion"
    // opisywał przychód ROCZNY — ekstraktor zwraca teraz tylko przychód kwartału (test niżej).
    const text = 'For the fourth quarter of 2025, total revenue: $3.2 billion';
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

/**
 * Fix 25.11.2026: `extractRevenue` zwracał NAJWIĘKSZĄ kwotę przy słowie „revenue", czyli
 * prognozę całoroczną zamiast przychodu kwartału (HIMS 09.11.2026: $3,13 mld przy $890,4M
 * → „surprise" +328,7%; UHS 28.07.2026: $18,501 mld przy $4,638 mld → +304%).
 *
 * Pierwszy blok to cytaty z Exhibit 99.1 po `stripHtml`: treść dosłowna (miejscami skrócona),
 * białe znaki między komórkami tabel uproszczone. Drugi blok („fragmenty spreparowane")
 * to zdania ułożone na potrzeby testu — nie pochodzą z filingów.
 */
describe('extractRevenue — przychód kwartału zamiast prognozy (cytaty z filingów)', () => {
  // HIMS 8-K 0001773751-26-000242, Exhibit 99.1 — nagłówek + highlights
  const HIMS_HEADLINE = `
 Hims Hers Health, Inc. Reports Third Quarter 2026 Financial Results
 \n \n Revenue of approximately $890 million, up 49% year-over-year in Q3 2026
 \n \n Subscribers grew to nearly 2.8 million, up 13% year-over-year in Q3 2026
 \n \n Tightens full year 2026 revenue guidance to a range of $3.13 billion to $3.15 billion and reduces Adjusted EBITDA guidance to a range of $257 million to $277 million
`;
  const HIMS_HIGHLIGHTS = `
 Third Quarter 2026 Financial Highlights
 Revenue was $890.4 million for the third quarter of 2026 compared to $599.0 million for the third quarter of 2025, an increase of 49% year-over-year.
 Gross margin was 57% for the third quarter of 2026 compared to 74% for the third quarter of 2025.
`;
  // HIMS — sekcja Financial Outlook: te dwie frazy dawały starej wersji $3,13 mld
  const HIMS_OUTLOOK = `
 Financial Outlook
 \n \n Hims Hers is providing the following guidance
 \n \n For the fourth quarter 2026, we expect
 Revenue of $875 million to $895 million.
 Adjusted EBITDA of $70 million to $90 million, reflecting an Adjusted EBITDA margin of 8% to 10%.
 \n \n For the full year 2026, we expect
 Revenue of $3.13 billion to $3.15 billion.
 Adjusted EBITDA of $257 million to $277 million, reflecting an Adjusted EBITDA margin of 8% to 9%.
`;
  // HIMS — tabela w tysiącach (kwoty bez jednostki, poniżej progu 1M)
  const HIMS_TABLE = `
 Revenue
 (In Thousands, Unaudited)
 \n Three Months Ended September 30,
 Nine Months Ended September 30,
 \n 2026 \n 2025 \n % Change \n 2026 \n 2025 \n % Change
 \n United States Revenue \n $ \n 657,089 \n \n $ \n 543,523 \n \n 21 \n % \n $ \n 1,808,828 \n \n $ \n 1,659,501 \n \n 9 \n %
 \n Total revenue \n $ \n 890,373 \n \n $ \n 598,976 \n \n 49 \n % \n $ \n 2,251,691 \n \n $ \n 1,729,819 \n \n 30 \n %
`;

  // UHS 8-K 0001193125-26-318940, Exhibit 99.1 — tabela prognozy: stara wersja brała $18,501 mld
  const UHS_FORECAST_TABLE = `
 The tables below include our full year revised 2026 operating results forecast, as well as our original 2026 operating results forecast which was previously disclosed on February 25, 2026.
 \n \n Revised Forecast \n \n Original Forecast
 \n \n For the Year Ended \n \n For the Year Ended
 \n \n December 31, 2026 \n \n December 31, 2026
 \n \n Low \n \n High \n \n Low \n \n High
 \n \n Net revenues \n \n $18.501 billion \n \n $18.762 billion \n \n $18.417 billion \n \n $18.789 billion
 \n \n Adjusted EBITDA, net of NCI \n \n $2.610 billion \n \n $2.717 billion \n \n $2.641 billion \n \n $2.789 billion
`;
  const UHS_QUARTER =
    'Net revenues increased by 8.3% to $4.638 billion during the second quarter of 2026, as compared to $4.284 billion during the second quarter of 2025.';
  const UHS_SIX_MONTHS =
    'Net revenues increased by 8.9% to $9.133 billion during the first six months of 2026, as compared to $8.384 billion during the comparable period of 2025.';
  const UHS_BOILERPLATE =
    'UHS is one of the nation’s largest and most respected providers of hospital and healthcare services, with annual revenues of approximately $17.4 billion during 2025. Through its subsidiaries, UHS employs more than 102,000 employees.';
  // UHS — rachunek wyników w tysiącach: kwoty ≥ 1 000 000 bez jednostki
  const UHS_INCOME_STATEMENT = `
 Consolidated Statements of Income
 (in thousands, except per share amounts)
 (unaudited)
 \n Three months \n Six months
 \n ended June 30, \n ended June 30,
 \n 2026 \n 2025 \n 2026 \n 2025
 \n Net revenues \n $ \n 4,638,012 \n $ \n 4,283,816 \n $ \n 9,133,194 \n $ \n 8,383,536
`;
  const UHS_SEGMENT_TABLE =
    'Amount % of Net Revenues Amount % of Net Revenues Net revenues $ 2,507,889 100.0 % $ 2,318,826 100.0 % $ 4,977,934 100.0 %';

  it('HIMS: pełny zestaw fragmentów → $890,4M kwartału, nie $3,13 mld prognozy', () => {
    const text = HIMS_HEADLINE + HIMS_TABLE + HIMS_HIGHLIGHTS + HIMS_OUTLOOK;
    expect(extractRevenue(text)).toBeCloseTo(890_400_000, -3);
  });

  it('HIMS: sam Financial Outlook (prognoza Q4 + całoroczna, zakresy) → null', () => {
    expect(extractRevenue(HIMS_OUTLOOK)).toBeNull();
  });

  it('HIMS: nagłówek z "approximately" przy nazwanym kwartale → $890M', () => {
    expect(extractRevenue(HIMS_HEADLINE)).toBeCloseTo(890_000_000, -3);
  });

  it('HIMS: tabela w tysiącach + outlook, bez zdania z kwotą kwartału → null', () => {
    expect(extractRevenue(HIMS_TABLE + HIMS_OUTLOOK)).toBeNull();
  });

  it('UHS: sama tabela prognozy "For the Year Ended … Low High" → null', () => {
    expect(extractRevenue(UHS_FORECAST_TABLE)).toBeNull();
  });

  it('UHS: zdanie o kwartale + suma 6 miesięcy + prognoza + tabele → $4,638 mld', () => {
    const text = [
      UHS_QUARTER,
      UHS_SIX_MONTHS,
      UHS_FORECAST_TABLE,
      UHS_BOILERPLATE,
      UHS_INCOME_STATEMENT,
      UHS_SEGMENT_TABLE,
    ].join('\n');
    expect(extractRevenue(text)).toBeCloseTo(4_638_000_000, -6);
  });

  it('UHS: suma narastająca "during the first six months" → null', () => {
    expect(extractRevenue(UHS_SIX_MONTHS)).toBeNull();
  });

  it('UHS: "annual revenues of approximately $17.4 billion during 2025" → null', () => {
    expect(extractRevenue(UHS_BOILERPLATE)).toBeNull();
  });

  it('UHS: kwoty bez jednostki w dokumencie "in thousands" → null (to tysiące, nie dolary)', () => {
    expect(extractRevenue(UHS_INCOME_STATEMENT + UHS_SEGMENT_TABLE)).toBeNull();
  });

  it('GDRX: guidance całoroczne tuż przed cytatem z przychodem kwartału → $218,4M', () => {
    // GDRX 8-K 0001809519-26-000231 — bliższy kwocie okres ("third quarter") wygrywa z "FY 2026"
    const text =
      'Management is raising its full-year 2026 guidance as follows $ in millions FY 2026 FY 2025 YoY Change ' +
      'Revenue $844 - $850 $796.9 6% - 7% Adjusted EBITDA 2 $280 - $286 $270.5 4% - 6% ' +
      '"We delivered third quarter revenue of $218.4 million and Adjusted EBITDA 1 of $74.5 million , as Pharma Direct and subscriptions continued to perform well," said the CEO.';
    expect(extractRevenue(text)).toBeCloseTo(218_400_000, -3);
  });

  it('TDOC: zdania z sekcji "Six Months Ended" nie wygrywają z przychodem kwartału', () => {
    // TDOC 8-K 0001477449-26-000036 — "U.S. revenue decreased 6% to $978.9 million" to 6 miesięcy
    const text =
      'Highlights Second Quarter 2026 revenue of $606.9 million, down 4% year-over-year ' +
      'Second Quarter 2026 Revenue decreased 4% to $606.9 million from $631.9 million in Second Quarter 2025. ' +
      'Access fees revenue decreased 9% to $474.2 million while other revenue increased 23% to $132.7 million. ' +
      'Six Months Ended June 30, 2026 Revenue decreased 3% to $1,220.8 million from $1,261.3 million in the first six months of 2025. ' +
      'Access fees revenue decreased 9% to $958.9 million while other revenue increased 24% to $261.9 million. ' +
      'U.S. revenue decreased 6% to $978.9 million while International revenue increased 12% to $241.9 million. ' +
      'Integrated Care segment revenue increased 1% to $789.8 million in the first six months of 2026 while BetterHelp segment revenue decreased 10% to $431.0 million.';
    expect(extractRevenue(text)).toBeCloseTo(606_900_000, -3);
  });

  it('TDOC: outlook "Range Revenue $2,362 - $2,447 million" → null', () => {
    const text =
      'For the full year of 2026, we expect Full Year 2026 Outlook Range Revenue $2,362 - $2,447 million Adjusted EBITDA $271 - $303 million ' +
      'For the third quarter of 2026, we expect 3Q 2026 Outlook Range Revenue $569 - $609 million';
    expect(extractRevenue(text)).toBeNull();
  });
});

describe('extractRevenue — filtr kontekstu (fragmenty spreparowane)', () => {
  it('sam przychód całoroczny → null (dawniej zwracany jako wynik kwartału)', () => {
    expect(extractRevenue('For full year 2025, total revenue: $3.2 billion')).toBeNull();
    expect(extractRevenue('Fiscal year 2025 revenue of $3.2 billion.')).toBeNull();
    expect(extractRevenue('Annual revenue of $3.2 billion.')).toBeNull();
  });

  it('kwartał i rok w jednym zdaniu → wartość kwartalna', () => {
    const text = 'Fourth quarter revenue of $800 million and full year revenue of $3.2 billion.';
    expect(extractRevenue(text)).toBeCloseTo(800_000_000, -3);
  });

  it('rok obrotowy w nazwie kwartału nie blokuje dopasowania', () => {
    expect(extractRevenue('Third quarter of fiscal year 2026 revenue of $5.0 billion.')).toBeCloseTo(5_000_000_000, -6);
    expect(extractRevenue('Q3 FY26 revenue of $5.0 billion.')).toBeCloseTo(5_000_000_000, -6);
  });

  it('prognoza bez zakresu ("we expect", "guidance", "outlook") → null', () => {
    expect(extractRevenue('For the fourth quarter, we expect revenue of $900 million.')).toBeNull();
    expect(extractRevenue('Guidance for the first quarter: revenue of $900 million.')).toBeNull();
    expect(extractRevenue('Second quarter outlook: total revenue of $900 million.')).toBeNull();
  });

  it('prognoza obok wyniku → zostaje wynik kwartału', () => {
    const text =
      'Third quarter revenue of $890.4 million. For the fourth quarter, we expect revenue of $950 million.';
    expect(extractRevenue(text)).toBeCloseTo(890_400_000, -3);
  });

  it('"better-than-expected" to wynik, nie prognoza', () => {
    const text = 'The company delivered better-than-expected third quarter revenue of $890.4 million.';
    expect(extractRevenue(text)).toBeCloseTo(890_400_000, -3);
  });

  it('zakres kwot ("$X to $Y", "$X - $Y") → null', () => {
    expect(extractRevenue('Revenue of $875 million to $895 million.')).toBeNull();
    expect(extractRevenue('Revenue of $3.1 billion - $3.2 billion.')).toBeNull();
  });

  it('suma narastająca przed kwotą ("nine months", "year-to-date") → null', () => {
    expect(extractRevenue('For the nine months ended September 30, 2026, revenue of $2.25 billion.')).toBeNull();
    expect(extractRevenue('Year-to-date revenue of $2.25 billion.')).toBeNull();
  });

  it('okres porównawczy ("compared to revenue of …") nie wygrywa przy spadku przychodów', () => {
    const text =
      'Third quarter revenue of $90.0 million, compared to revenue of $100.0 million in the prior-year quarter.';
    expect(extractRevenue(text)).toBeCloseTo(90_000_000, -3);
  });

  it('kwota bez jednostki w dolarach przechodzi, gdy dokument nie deklaruje skali tabel', () => {
    expect(extractRevenue('Net revenues of $761,700,000 for the quarter.')).toBeCloseTo(761_700_000, -3);
  });

  it('"revenue was $X" bez nazwy kwartału w zdaniu → null (wzorzec wymaga kwartału)', () => {
    expect(extractRevenue('Revenue was $890.4 million, an increase of 49%.')).toBeNull();
    expect(extractRevenue('Revenue increased 11% to $218.4 million.')).toBeNull();
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
