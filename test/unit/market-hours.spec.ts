/**
 * Testy market-hours.util — focus S20-T04 (28.05.2026):
 * getEffectiveStartTime musi pomijać NYSE holidays, nie tylko weekendy.
 *
 * Trigger: getEffectiveStartTime pętlowała wyłącznie po TRADING_DAYS (Mon-Fri),
 * ignorując NYSE_FULL_CLOSURES. Alerty Options Flow (22:15 UTC) / SEC pre-market
 * (7:00 UTC) złożone wieczorem przed świętem dostawały effective start = 9:30 ET
 * w święto (giełda zamknięta) → price1h/4h/1d liczone od momentu gdy nie było
 * sesji. ~9 dni/rok zanieczyszczonych pomiarów outcome.
 */

import {
  getEffectiveStartTime,
  isNyseOpen,
  isNyseHoliday,
} from '../../src/common/utils/market-hours.util';

describe('isNyseHoliday — sanity check listy 2026', () => {
  it('Thanksgiving 2026-11-26 (czwartek) jest na liście NYSE_FULL_CLOSURES', () => {
    // EST (UTC-5 w listopadzie). 2026-11-26 14:30 UTC = 09:30 ET (otwarcie w normalny dzień).
    expect(isNyseHoliday(new Date('2026-11-26T14:30:00Z'))).toBe(true);
  });

  it('Black Friday 2026-11-27 (piątek) NIE jest na liście (early close ≠ full closure)', () => {
    expect(isNyseHoliday(new Date('2026-11-27T14:30:00Z'))).toBe(false);
  });

  it('Christmas 2026-12-25 (piątek) jest na liście', () => {
    expect(isNyseHoliday(new Date('2026-12-25T14:30:00Z'))).toBe(true);
  });

  it('dzień powszedni nie-świąteczny zwraca false', () => {
    // 2026-05-15 (piątek) — między Memorial Day a Juneteenth, brak święta.
    expect(isNyseHoliday(new Date('2026-05-15T14:30:00Z'))).toBe(false);
  });
});

describe('getEffectiveStartTime — S20-T04 holiday awareness', () => {
  it('alert śr 2026-11-25 20:00 ET (przed Thanksgiving czw) → pt 2026-11-27 9:30 ET', () => {
    // 2026-11-25 20:00 ET (EST UTC-5) = 2026-11-26 01:00 UTC
    const alert = new Date('2026-11-26T01:00:00Z');
    const effective = getEffectiveStartTime(alert);

    // Oczekiwane: piątek 2026-11-27 09:30 ET = 14:30 UTC (Thanksgiving czw pominięty).
    // Pre-fix: zwracałoby czw 2026-11-26 14:30 UTC (9:30 ET) — w święto giełda zamknięta.
    expect(effective.toISOString()).toBe('2026-11-27T14:30:00.000Z');
  });

  it('alert pt 2026-12-25 8:00 ET (Christmas pre-open) → pn 2026-12-28 9:30 ET (skip Christmas + weekend)', () => {
    // Multi-day skip: Christmas (pt 25) + sobota (26) + niedziela (27) → pn 28.
    // 2026-12-25 08:00 ET (EST UTC-5) = 13:00 UTC
    const alert = new Date('2026-12-25T13:00:00Z');
    const effective = getEffectiveStartTime(alert);

    // Pn 2026-12-28 09:30 ET = 14:30 UTC
    expect(effective.toISOString()).toBe('2026-12-28T14:30:00.000Z');
  });

  it('regresja: alert pt 2026-05-15 20:00 ET (po close, bez święta) → pn 2026-05-18 9:30 ET', () => {
    // 2026-05-15 20:00 ET (EDT UTC-4) = 2026-05-16 00:00 UTC
    const alert = new Date('2026-05-16T00:00:00Z');
    const effective = getEffectiveStartTime(alert);

    // Pn 2026-05-18 09:30 ET (EDT UTC-4) = 13:30 UTC
    expect(effective.toISOString()).toBe('2026-05-18T13:30:00.000Z');
  });

  it('regresja: alert wt 2026-05-12 12:00 ET (w trakcie sesji) → zwraca alertSentAt bez zmian', () => {
    // 2026-05-12 12:00 ET (EDT UTC-4) = 16:00 UTC. NYSE open 9:30-16:00 ET.
    const alert = new Date('2026-05-12T16:00:00Z');
    const effective = getEffectiveStartTime(alert);

    expect(effective.getTime()).toBe(alert.getTime());
  });

  it('regresja: alert pn 2026-05-18 9:00 ET (przed otwarciem, dzień handlowy) → 9:30 ET tego dnia', () => {
    // 2026-05-18 09:00 ET (EDT UTC-4) = 13:00 UTC. Przed otwarciem 9:30.
    const alert = new Date('2026-05-18T13:00:00Z');
    const effective = getEffectiveStartTime(alert);

    // 9:30 ET = 13:30 UTC
    expect(effective.toISOString()).toBe('2026-05-18T13:30:00.000Z');
  });
});

describe('getEffectiveStartTime — S20-T06 okno 00:00-04:00 UTC (wieczór ET)', () => {
  it('EYE replay: alert 2026-06-10 02:43 UTC (= 09.06 22:43 ET, po close) → ŚR 10.06 9:30 ET, nie czwartek', () => {
    // Bug: setUTCDate(+1) na dacie UTC, która jest już "jutrzejsza" względem
    // wieczoru ET → przeskok całej sesji 10.06. Okno discovery reconciliation
    // (22:40 ET = 02:40 UTC) — każdy alert z recon tracił dzień pomiaru.
    const result = getEffectiveStartTime(new Date('2026-06-10T02:43:32Z'));
    // granulacja minutowa (sekundy alertu zachowane) → porównanie do minuty
    expect(result.toISOString().slice(0, 16)).toBe('2026-06-10T13:30'); // 9:30 EDT
  });

  it('weekend w oknie: sob 2026-06-13 02:00 UTC (= pt 22:00 ET) → pn 15.06 9:30 ET', () => {
    const result = getEffectiveStartTime(new Date('2026-06-13T02:00:00Z'));
    expect(result.toISOString()).toBe('2026-06-15T13:30:00.000Z');
  });

  it('regresja: Options Flow 22:15 UTC (= 18:15 ET po close) → następny dzień 9:30 ET (bez zmiany)', () => {
    // wt 09.06 22:15Z → śr 10.06 13:30Z
    const result = getEffectiveStartTime(new Date('2026-06-09T22:15:00Z'));
    expect(result.toISOString()).toBe('2026-06-10T13:30:00.000Z');
  });

  it('regresja: SEC pre-market 07:00 UTC (= 03:00 ET) → ten sam dzień 9:30 ET', () => {
    const result = getEffectiveStartTime(new Date('2026-06-10T07:00:00Z'));
    expect(result.toISOString()).toBe('2026-06-10T13:30:00.000Z');
  });
});

describe('isNyseOpen — sanity (zmiany w T04 nie dotyczą, regresja)', () => {
  it('święto w trakcie godzin sesji → false', () => {
    // Thanksgiving 2026-11-26 14:30 UTC = 9:30 ET (otwarcie w normalny dzień)
    expect(isNyseOpen(new Date('2026-11-26T14:30:00Z'))).toBe(false);
  });

  it('dzień handlowy w trakcie sesji → true', () => {
    // Wt 2026-05-12 16:00 UTC = 12:00 ET
    expect(isNyseOpen(new Date('2026-05-12T16:00:00Z'))).toBe(true);
  });

  it('weekend → false', () => {
    // Sob 2026-05-16 16:00 UTC = 12:00 ET
    expect(isNyseOpen(new Date('2026-05-16T16:00:00Z'))).toBe(false);
  });
});
