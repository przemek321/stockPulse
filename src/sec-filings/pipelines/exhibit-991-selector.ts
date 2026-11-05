import { EdgarIndexItem } from './edgar-filing-index.types';

/**
 * Wybór pliku press release (Exhibit 99.1) z `index.json` katalogu filingu 8-K Item 2.02.
 *
 * Fix 05.11.2026 („exhibit regex”): skan 571 8-K z `sec_filings` pokazał, że dawny regex
 * `/ex(hibit)?[-_]?99[-_.]?1\b/ || /ex(hibit)?991/` gubił press release w dwóch klasach:
 *  1. warianty numeru 99.1, w których po „1” jest `_`/litera albo separator to `x`
 *     (`ex-991_q32026.htm` VRTX, `q326ex-991earningsrelease.htm` ISRG, `tdoc-…xexx991.htm`,
 *     `hum-2026q1xex99x1brief….htm`, `cvs_ex99x1q4-25.htm`) albo goły numer 99 (`pfe-…xex99.htm`);
 *  2. nazwy bez numeru exhibitu (`q326lillysalesandearningsp.htm` LLY, `a3q2026elvearningsrelease.htm`
 *     ELV, `moh3q26_er.htm` MOH, `amgn-20260930earningsrelea.htm` AMGN, `earningsrelease_live.htm` BSX).
 * Skutek: GPT widział sam wrapper 2.02 → pusta `key_facts` → SKIP_INVALID_JSON / gpt_missing_data.
 *
 * Progi (pierwszy trafiony wygrywa):
 *  - `ex991`    — numer 99.1 w dowolnym spotykanym zapisie (ex991, ex-99-1, ex99x1, exx991, exhibit_99_1…),
 *  - `ex99`     — goły numer 99 bez podnumeru (ex99.htm), ale nie 99.2/99.3,
 *  - `fallback` — pozostałe .htm poza dokumentem głównym, R*.htm, *index* i plikami jawnie
 *                 oznaczonymi INNYM numerem exhibitu (ex10_1, dex42, ex4-2, exhibit31…);
 *                 najpierw nazwy z earn/relea/result/quarter/_er, potem dowolne — w każdej grupie największy.
 * Fallback jest wołany tylko dla filingów z Item 2.02 (caller), więc „największy pozostały
 * dokument” to w praktyce press release.
 */
export type Exhibit991Tier = 'ex991' | 'ex99' | 'fallback';

export interface Exhibit991Choice {
  name: string;
  tier: Exhibit991Tier;
}

/** 99.1: ex/exhibit, dowolne separatory [-_x], „99”, opcjonalny separator [-_.x], „1” lub „01”, bez kolejnej cyfry (99.10/99.11). */
const EX991 = /ex(?:hibit)?[-_x]*99[-_.x]?0?1(?!\d)/;
/** Goły numer 99 — wykluczamy, gdy po nim (z opcjonalnym separatorem) idzie cyfra (99.2, 99x2, 992). */
const EX99_BARE = /ex(?:hibit)?[-_x]*99(?![-_.x]?\d)/;
/** Numer exhibitu zapisany po „ex”: ex10_1, dex42, ex-31x…, exhibit101… (grupa 1 = cyfry). */
const EXHIBIT_NUMBER = /ex(?:hibit)?[-_x]*(\d+)/;
/** Nazwy sugerujące press release z wynikami. */
const EARNINGS_HINT = /earn|relea|result|quarter|_er[._]/;

function isHtml(name: string): boolean {
  return name.endsWith('.htm') || name.endsWith('.html');
}

function sizeOf(item: EdgarIndexItem): number {
  const n = Number(item.size);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Plik jawnie oznaczony numerem exhibitu innym niż 99.x (np. ex10_1 = umowa, dex42 = indenture).
 * Numery ≥5 cyfr to identyfikatory drukarni (`ex_917742.htm`), nie numer exhibitu — nie wykluczamy.
 */
function isOtherNumberedExhibit(name: string): boolean {
  const m = EXHIBIT_NUMBER.exec(name);
  if (!m) return false;
  const digits = m[1];
  if (digits.length >= 5) return false;
  return !digits.startsWith('99');
}

function largest(items: EdgarIndexItem[]): EdgarIndexItem | undefined {
  return [...items].sort((a, b) => sizeOf(b) - sizeOf(a))[0];
}

/**
 * @param items     wpisy `directory.item` z index.json
 * @param mainName  nazwa dokumentu głównego 8-K (wrapper) — wykluczana z fallbacku; null gdy nieznana
 */
export function selectExhibit991(
  items: EdgarIndexItem[],
  mainName: string | null,
): Exhibit991Choice | null {
  const main = mainName?.toLowerCase() ?? null;
  const html = items.filter(i => isHtml(i.name.toLowerCase()));

  const ex991 = html.find(i => EX991.test(i.name.toLowerCase()));
  if (ex991) return { name: ex991.name, tier: 'ex991' };

  const ex99 = html.find(i => EX99_BARE.test(i.name.toLowerCase()));
  if (ex99) return { name: ex99.name, tier: 'ex99' };

  // Bez znanego dokumentu głównego fallback mógłby zwrócić sam wrapper — nie zgadujemy.
  if (main === null || main === '') return null;

  const candidates = html.filter(i => {
    const name = i.name.toLowerCase();
    return (
      name !== main &&
      !/^r\d+\.htm$/.test(name) &&
      !name.includes('index') &&
      !isOtherNumberedExhibit(name)
    );
  });
  const hinted = candidates.filter(i => EARNINGS_HINT.test(i.name.toLowerCase()));
  const pick = largest(hinted) ?? largest(candidates);
  return pick ? { name: pick.name, tier: 'fallback' } : null;
}
