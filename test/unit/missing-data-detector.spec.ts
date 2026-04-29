import { detectMissingDataFacts, hasGptMissingData } from '../../src/sec-filings/utils/missing-data-detector';
import * as fs from 'fs';
import * as path from 'path';

/**
 * S19-FIX-01: testy detektora missing-data flag w GPT key_facts.
 * Trigger case: HUM 8-K Item 2.02 (29.04.2026), alert id 2381 — GPT zhalucynował
 * conviction=-1.6 mimo że sam zadeklarował 'niedostępne'/'brak danych' w 2/4 facts.
 */

describe('detectMissingDataFacts — HUM 29.04.2026 regression (alert id 2381)', () => {
  it('łapie obie missing-data fact w prod HUM scenariuszu', () => {
    const fixturePath = path.join(
      __dirname,
      '../fixtures/regression/HUM-2026-04-29.json',
    );
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const keyFacts = fixture.gptAnalysis.key_facts;

    const flagged = detectMissingDataFacts(keyFacts);

    expect(flagged.length).toBeGreaterThanOrEqual(2);
    expect(flagged.some((f) => /niedost[eę]pn/i.test(f))).toBe(true);
    expect(flagged.some((f) => /brak\s+szczeg[oó][lł]owych/i.test(f))).toBe(true);
    expect(hasGptMissingData(keyFacts)).toBe(true);
  });
});

describe('detectMissingDataFacts — pattern coverage', () => {
  it('niedostępne / niedostepne (z i bez ogonka)', () => {
    expect(hasGptMissingData(['EPS niedostępne'])).toBe(true);
    expect(hasGptMissingData(['EPS niedostepne'])).toBe(true);
  });

  it('brak szczegółowych / brak danych / brak liczbowych', () => {
    expect(hasGptMissingData(['brak szczegółowych liczb'])).toBe(true);
    expect(hasGptMissingData(['brak danych w fragmencie'])).toBe(true);
    expect(hasGptMissingData(['brak liczbowych wartości'])).toBe(true);
  });

  it('nie podano / nie ujawniono / nie wiadomo', () => {
    expect(hasGptMissingData(['Revenue nie podano'])).toBe(true);
    expect(hasGptMissingData(['Guidance nie ujawniono w treści'])).toBe(true);
    expect(hasGptMissingData(['Wartość nie wiadomo'])).toBe(true);
  });

  it('angielskie warianty: unknown, insufficient, not disclosed', () => {
    expect(hasGptMissingData(['EPS unknown'])).toBe(true);
    expect(hasGptMissingData(['insufficient data'])).toBe(true);
    expect(hasGptMissingData(['Revenue not disclosed'])).toBe(true);
    expect(hasGptMissingData(['MLR not specified in filing'])).toBe(true);
  });

  it('case insensitive', () => {
    expect(hasGptMissingData(['EPS NIEDOSTĘPNE'])).toBe(true);
    expect(hasGptMissingData(['Revenue UNKNOWN'])).toBe(true);
  });
});

describe('detectMissingDataFacts — happy path (brak halucynacji)', () => {
  it('konkretne liczby — zero match', () => {
    const facts = [
      'Adjusted EPS Q1: $10.31 vs konsensus $9.97 (BEAT +$0.34)',
      'MLR Q1: 89.4% w line z guidance "just under 90%"',
      'Revenue: $32.5B (+8% YoY)',
      'FY2026 Adjusted guidance: AFFIRMED at least $9 EPS',
    ];
    expect(detectMissingDataFacts(facts)).toEqual([]);
    expect(hasGptMissingData(facts)).toBe(false);
  });

  it('słowa "brak" w kontekście non-data nie matchują', () => {
    expect(hasGptMissingData(['brak zmian w guidance, AFFIRMED'])).toBe(false);
    expect(hasGptMissingData(['brak negatywnych niespodzianek'])).toBe(false);
  });

  it('fact zawierający liczby, ale z "niedostępne" — match (priorytet match)', () => {
    expect(hasGptMissingData(['EPS $10.31 ale dokładny breakdown niedostępny'])).toBe(true);
  });

  it('puste wejście', () => {
    expect(detectMissingDataFacts([])).toEqual([]);
    expect(hasGptMissingData([])).toBe(false);
  });

  it('odporne na non-string elementy (defensive)', () => {
    const facts = ['EPS $10.31', null as any, undefined as any, 123 as any];
    expect(detectMissingDataFacts(facts)).toEqual([]);
  });
});
