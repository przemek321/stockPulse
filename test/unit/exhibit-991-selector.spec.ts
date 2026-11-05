/**
 * Fix 05.11.2026 („exhibit regex”): selectExhibit991 — wybór press release dla 8-K Item 2.02.
 *
 * Trigger: LLY 29.10.2026 (filing 4081, Q3) — press release `q326lillysalesandearningsp.htm`
 * nie pasował do dawnego regexu → GPT widział sam wrapper → SKIP_INVALID_JSON.
 * Skan 571 8-K z prod: 59 filingów 2.02 bez exhibitu (VRTX ex-991_q…, ISRG q…ex-991earnings…,
 * TDOC xexx991, HUM ex99x1, PFE xex99, ELV/MOH/AMGN/UNH bez numeru). Nazwy niżej = realne pliki z tego skanu.
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseEdgarIndexItems } from '../../src/sec-filings/pipelines/edgar-filing-index.types';
import { selectExhibit991 } from '../../src/sec-filings/pipelines/exhibit-991-selector';

const LLY_INDEX = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'exhibit', 'lly-2026-10-29-index.json'), 'utf8'),
);

const items = (...entries: [string, string?][]) => entries.map(([name, size]) => ({ name, size }));

describe('selectExhibit991 (fix 05.11.2026)', () => {
  it('LLY 29.10 (realny index.json): fallback wybiera q326lillysalesandearningsp.htm, nie wrapper ani R1', () => {
    const parsed = parseEdgarIndexItems(LLY_INDEX);
    expect(parsed).not.toBeNull();
    expect(selectExhibit991(parsed ?? [], 'lly-20261029.htm')).toEqual({
      name: 'q326lillysalesandearningsp.htm',
      tier: 'fallback',
    });
  });

  describe('próg ex991 — warianty numeru 99.1 gubione przez dawny regex', () => {
    const variants = [
      'ex-991_q32026.htm', // VRTX
      'q326ex-991earningsrelease.htm', // ISRG
      'tdoc-20260930xexx991.htm', // TDOC
      'gdrxq226-exx991pressrelease.htm', // GDRX
      'hum-2026q2xex99x1briefxjul.htm', // HUM
      'cvs_ex99x1q4-25.htm', // CVS
      'ex-991x922026x8k.htm', // HPE
    ];
    for (const name of variants) {
      it(name, () => {
        expect(selectExhibit991(items(['main-8k.htm', '30000'], [name, '100']), 'main-8k.htm')).toEqual({
          name,
          tier: 'ex991',
        });
      });
    }

    it('dawne warianty dalej łapane (ex991, ex-99-1, exhibit_99_1, abbv-…xexhibit991)', () => {
      for (const name of ['ex991.htm', 'ex-99-1.htm', 'ex-99.1.htm', 'exhibit_99_1.htm', 'abbv-20260331xexhibit991.htm']) {
        expect(selectExhibit991(items(['m.htm'], [name]), 'm.htm')?.tier).toBe('ex991');
      }
    });

    it('HUM: 99.1 (brief) wygrywa z większym 99.2 (detailed)', () => {
      const r = selectExhibit991(
        items(
          ['hum-20260729.htm', '30000'],
          ['hum-2026q2xex99x2detailedx.htm', '854179'],
          ['hum-2026q2xex99x1briefxjul.htm', '133732'],
        ),
        'hum-20260729.htm',
      );
      expect(r).toEqual({ name: 'hum-2026q2xex99x1briefxjul.htm', tier: 'ex991' });
    });

    it('nie myli 99.10 / 99.2 z 99.1', () => {
      expect(selectExhibit991(items(['m.htm'], ['ex99-10.htm']), null)).toBeNull();
      expect(selectExhibit991(items(['m.htm'], ['ex992.htm']), null)).toBeNull();
    });
  });

  it('próg ex99 — goły numer 99 (PFE pfe-9272026xex99.htm, CERT …earningsreleaseex99.htm)', () => {
    expect(selectExhibit991(items(['pfe-20261103.htm'], ['pfe-9272026xex99.htm', '918181']), 'pfe-20261103.htm')).toEqual({
      name: 'pfe-9272026xex99.htm',
      tier: 'ex99',
    });
    expect(selectExhibit991(items(['c.htm'], ['q42025earningsreleaseex99.htm']), 'c.htm')?.tier).toBe('ex99');
  });

  describe('próg fallback', () => {
    it('ELV / MOH / AMGN: press release bez numeru exhibitu', () => {
      expect(selectExhibit991(items(['elv-20261021.htm', '32797'], ['a3q2026elvearningsrelease.htm', '530251'], ['R1.htm', '58000']), 'elv-20261021.htm')?.name)
        .toBe('a3q2026elvearningsrelease.htm');
      expect(selectExhibit991(items(['moh-20261021.htm'], ['moh3q26_er.htm', '348457']), 'moh-20261021.htm')?.name)
        .toBe('moh3q26_er.htm');
      expect(selectExhibit991(items(['amgn-20261103.htm'], ['amgn-20260930earningsrelea.htm', '617058']), 'amgn-20261103.htm')?.name)
        .toBe('amgn-20260930earningsrelea.htm');
    });

    it('OSCR: nazwa „earnings-podobna” wygrywa z większą umową kredytową', () => {
      const r = selectExhibit991(
        items(
          ['oscr-20260206.htm', '36977'],
          ['oscar-revolvingcreditagr.htm', '594556'],
          ['oscarhealthfourthquarteran.htm', '328300'],
        ),
        'oscr-20260206.htm',
      );
      expect(r).toEqual({ name: 'oscarhealthfourthquarteran.htm', tier: 'fallback' });
    });

    it('pomija exhibity jawnie oznaczone innym numerem (ex10_1 umowa, dex42 indenture, ex4-2)', () => {
      const r = selectExhibit991(
        items(
          ['uhs-20260720.htm', '50000'],
          ['uhs-ex10_1.htm', '1682841'],
          ['d845102dex42.htm', '499655'],
          ['tm2615045d1_ex4-2.htm', '335969'],
        ),
        'uhs-20260720.htm',
      );
      expect(r).toBeNull();
    });

    it('identyfikator drukarni (ex_995856.htm, ≥5 cyfr) to nie numer exhibitu — kandydat', () => {
      expect(selectExhibit991(items(['urgn20260730_8k.htm'], ['ex_995856.htm', '92866']), 'urgn20260730_8k.htm')?.name)
        .toBe('ex_995856.htm');
    });

    it('nigdy nie zwraca wrappera, R*.htm ani plików *index*', () => {
      const r = selectExhibit991(
        items(
          ['lly-20261029.htm', '47525'],
          ['R1.htm', '58681'],
          ['0000059478-26-000104-index.html', ''],
          ['0000059478-26-000104-index-headers.html', ''],
        ),
        'lly-20261029.htm',
      );
      expect(r).toBeNull();
    });

    it('nieznany dokument główny (documentUrl = katalog) → bez fallbacku', () => {
      expect(selectExhibit991(items(['unh-20260112.htm', '29134'], ['earnings.htm', '90000']), null)).toBeNull();
    });

    it('rozmiar pusty/nieliczbowy traktowany jak 0', () => {
      expect(selectExhibit991(items(['m.htm'], ['a.htm', ''], ['b.htm', '10']), 'm.htm')?.name).toBe('b.htm');
    });
  });
});
