import { FinnhubService } from '../../src/collectors/finnhub/finnhub.service';

/**
 * Werdykt 01.09.2026 — guard na martwe notowania w FinnhubService.getQuote.
 *
 * Case SEM #2441: spółka zeszła z giełdy 07.2026, Finnhub oddawał ostatni kurs
 * (16.51) z coraz starszym `t`; Price Outcome wypełnił 5 slotów tą samą ceną.
 *
 * Kontrakt:
 *   1. c>0 i t świeże (≤7d) → cena.
 *   2. c>0 i t starsze niż 7d → null + warn (slot zostaje pusty).
 *   3. c=0 (po pełnym delistingu Finnhub zwraca same zera) → null.
 *   4. brak pola t (starsze odpowiedzi / mocki) → cena bez guardu (kompatybilność).
 */

function buildService(quote: any) {
  const svc: any = Object.create(FinnhubService.prototype);
  svc.logger = { warn: jest.fn(), log: jest.fn(), debug: jest.fn() };
  svc.fetchApi = jest.fn().mockResolvedValue(quote);
  return svc as FinnhubService & { logger: { warn: jest.Mock } };
}

const NOW_SEC = Math.floor(Date.now() / 1000);

describe('FinnhubService.getQuote — stale/delisted guard (werdykt 01.09.2026)', () => {
  it('świeże notowanie (t sprzed 1 dnia) → cena', async () => {
    const svc = buildService({ c: 16.51, t: NOW_SEC - 86400 });
    await expect(svc.getQuote('SEM')).resolves.toBe(16.51);
    expect(svc.logger.warn).not.toHaveBeenCalled();
  });

  it('notowanie sprzed 8 dni → null + warn (SEM po delistingu)', async () => {
    const svc = buildService({ c: 16.51, t: NOW_SEC - 8 * 86400 });
    await expect(svc.getQuote('SEM')).resolves.toBeNull();
    expect(svc.logger.warn).toHaveBeenCalledWith(expect.stringContaining('stale quote'));
  });

  it('granica: dokładnie 7 dni → jeszcze cena, 7 dni + 1h → null', async () => {
    await expect(buildService({ c: 10, t: NOW_SEC - FinnhubService.QUOTE_MAX_AGE_SEC + 60 }).getQuote('X')).resolves.toBe(10);
    await expect(buildService({ c: 10, t: NOW_SEC - FinnhubService.QUOTE_MAX_AGE_SEC - 3600 }).getQuote('X')).resolves.toBeNull();
  });

  it('c=0, t=0 (Finnhub po pełnym delistingu) → null bez warn o stale', async () => {
    const svc = buildService({ c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 });
    await expect(svc.getQuote('WBA')).resolves.toBeNull();
    expect(svc.logger.warn).not.toHaveBeenCalled();
  });

  it('brak pola t → cena (kompatybilność ze starszymi odpowiedziami/mockami)', async () => {
    await expect(buildService({ c: 42.5 }).getQuote('ELV')).resolves.toBe(42.5);
  });

  it('błąd API → null (bez wyjątku)', async () => {
    const svc: any = Object.create(FinnhubService.prototype);
    svc.logger = { warn: jest.fn() };
    svc.fetchApi = jest.fn().mockRejectedValue(new Error('Finnhub rate limit (60 req/min)'));
    await expect(svc.getQuote('ELV')).resolves.toBeNull();
    expect(svc.logger.warn).toHaveBeenCalledWith(expect.stringContaining('rate limit'));
  });
});
