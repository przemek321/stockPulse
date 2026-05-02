/**
 * S19-FIX-05: testy detectDirectionConflict (pure function w correlation.service.ts)
 * + integracja z AlertDispatcher priority order.
 *
 * Trigger: 3× UNH false positive CRITICAL w 4 dni (29.04 00:14 + 22:58, 30.04 23:03).
 * Wszystkie: 1× negative Form4 SELL conviction -0.20 + 4× positive options
 * +0.32/+0.33/+0.50/+0.53 → aggregateConviction zwracał +0.7 → "Insider + Unusual
 * Options" CRITICAL positive z mylącym tytułem.
 *
 * detectDirectionConflict liczy net direction per source_category. Konflikt: ≥1
 * kategoria positive net + ≥1 kategoria negative net. Próg neutralności 0.05
 * (zgodne z MIN_CONVICTION) eliminuje przypadki gdzie wewnątrz kategorii
 * conviction się zeruje.
 */

import { detectDirectionConflict } from '../../src/correlation/correlation.service';
import { StoredSignal } from '../../src/correlation/types/correlation.types';

function sig(
  category: 'form4' | 'options' | '8k',
  conviction: number,
  id = `${category}-${Math.random()}`,
): StoredSignal {
  return {
    id,
    ticker: 'TEST',
    source_category: category,
    conviction,
    direction: conviction >= 0 ? 'positive' : 'negative',
    catalyst_type: 'unknown',
    timestamp: Date.now(),
  };
}

describe('detectDirectionConflict — UNH replay (S19-FIX-05)', () => {
  it('UNH 30.04 case: 1× form4 -0.20 + 4× options +0.32/+0.33/+0.50/+0.53 → CONFLICT', () => {
    const signals = [
      sig('form4', -0.2),
      sig('options', 0.32),
      sig('options', 0.33),
      sig('options', 0.5),
      sig('options', 0.53),
    ];
    expect(detectDirectionConflict(signals)).toBe(true);
  });

  it('mirror: 1× form4 +0.6 + 3× options -0.4 → CONFLICT', () => {
    const signals = [
      sig('form4', 0.6),
      sig('options', -0.4),
      sig('options', -0.4),
      sig('options', -0.4),
    ];
    expect(detectDirectionConflict(signals)).toBe(true);
  });

  it('form4 + 8k z przeciwnymi kierunkami → CONFLICT', () => {
    const signals = [sig('form4', -0.5), sig('8k', 0.7)];
    expect(detectDirectionConflict(signals)).toBe(true);
  });

  it('form4 + options + 8k — wszystkie negative → BRAK CONFLICT', () => {
    const signals = [
      sig('form4', -0.5),
      sig('options', -0.4),
      sig('options', -0.6),
      sig('8k', -0.3),
    ];
    expect(detectDirectionConflict(signals)).toBe(false);
  });

  it('GILD 29.04 case (consensus negative): form4 -0.55 + options -0.5/-0.36/-0.46/+0.53 → BRAK CONFLICT (options net negative)', () => {
    const signals = [
      sig('form4', -0.55),
      sig('options', -0.5),
      sig('options', -0.36),
      sig('options', -0.46),
      sig('options', 0.53),
    ];
    // options net = -0.5-0.36-0.46+0.53 = -0.79 (negative)
    // form4 net = -0.55 (negative)
    // wszystkie kategorie negative → no conflict
    expect(detectDirectionConflict(signals)).toBe(false);
  });
});

describe('detectDirectionConflict — edge cases', () => {
  it('tylko 1 source category → BRAK CONFLICT z definicji', () => {
    const signals = [sig('form4', -0.5), sig('form4', 0.7)];
    expect(detectDirectionConflict(signals)).toBe(false);
  });

  it('pusta lista → BRAK CONFLICT', () => {
    expect(detectDirectionConflict([])).toBe(false);
  });

  it('options net = 0 (równe conviction +0.3 i -0.3) + form4 negative → BRAK CONFLICT (options neutral)', () => {
    const signals = [
      sig('form4', -0.5),
      sig('options', 0.3),
      sig('options', -0.3),
    ];
    // options net = 0, neutral pomijany; tylko 1 kategoria z direction → no conflict
    expect(detectDirectionConflict(signals)).toBe(false);
  });

  it('options net = 0.04 (poniżej progu 0.05) + form4 negative → BRAK CONFLICT', () => {
    const signals = [sig('form4', -0.5), sig('options', 0.04)];
    expect(detectDirectionConflict(signals)).toBe(false);
  });

  it('options net = 0.06 (powyżej progu) + form4 negative → CONFLICT', () => {
    const signals = [sig('form4', -0.5), sig('options', 0.06)];
    expect(detectDirectionConflict(signals)).toBe(true);
  });

  it('custom neutralThreshold 0.20 — tłumi słabe kategorie', () => {
    const signals = [sig('form4', -0.5), sig('options', 0.15)];
    expect(detectDirectionConflict(signals, 0.2)).toBe(false);
    expect(detectDirectionConflict(signals, 0.05)).toBe(true);
  });

  it('3 kategorie z 2 different directions: form4 negative, options positive, 8k positive → CONFLICT', () => {
    const signals = [sig('form4', -0.4), sig('options', 0.3), sig('8k', 0.2)];
    expect(detectDirectionConflict(signals)).toBe(true);
  });

  it('3 kategorie wszystkie positive → BRAK CONFLICT', () => {
    const signals = [sig('form4', 0.4), sig('options', 0.3), sig('8k', 0.2)];
    expect(detectDirectionConflict(signals)).toBe(false);
  });

  it('summed within-category overrides individual signs: 2× form4 +0.7 + 1× form4 -0.3 (net +1.1) + options +0.5 → BRAK CONFLICT', () => {
    const signals = [
      sig('form4', 0.7),
      sig('form4', 0.7),
      sig('form4', -0.3),
      sig('options', 0.5),
    ];
    expect(detectDirectionConflict(signals)).toBe(false);
  });
});
