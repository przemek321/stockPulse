/**
 * Kształt `index.json` katalogu filingu w SEC EDGAR
 * (`https://www.sec.gov/Archives/edgar/data/<cik>/<accession>/index.json`).
 *
 * Realny payload (fragment):
 * ```json
 * {
 *   "directory": {
 *     "item": [
 *       { "last-modified": "2026-04-29 16:05:12", "name": "abbv-20260429.htm", "type": "text.gif", "size": "41 KB" },
 *       { "last-modified": "2026-04-29 16:05:12", "name": "ex991.htm",         "type": "text.gif", "size": "212 KB" }
 *     ],
 *     "name": "/Archives/edgar/data/1551152/000155115226000013",
 *     "parent-dir": "/Archives/edgar/data/1551152"
 *   }
 * }
 * ```
 *
 * Pipeline 8-K używa wyłącznie `name` (wybór głównego dokumentu / Exhibit 99.1);
 * pozostałe pola są opcjonalne i ignorowane, dlatego nie wymuszamy ich w guardzie.
 */
export interface EdgarIndexItem {
  name: string;
  type?: string;
  size?: string;
  'last-modified'?: string;
}

export interface EdgarFilingIndex {
  directory: {
    item: EdgarIndexItem[];
    name?: string;
    'parent-dir'?: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/** Wpis index.json ze stringowym `name` — jedyne pole, po którym pipeline dopasowuje pliki. */
export function isEdgarIndexItem(entry: unknown): entry is EdgarIndexItem {
  return isRecord(entry) && typeof entry.name === 'string';
}

/**
 * Zwraca wpisy `directory.item` z odpowiedzi index.json albo `null`, gdy struktura
 * się nie zgadza (odpowiednik dawnego `indexData?.directory?.item` + `Array.isArray`).
 *
 * Wpisy bez stringowego `name` są pomijane: nie da się po nich dopasować pliku,
 * a dawny kod traktował brak `name` jako pusty string (czyli też brak dopasowania).
 * W realnym index.json SEC każdy wpis ma `name` — filtr to wyłącznie zabezpieczenie typów.
 */
export function parseEdgarIndexItems(data: unknown): EdgarIndexItem[] | null {
  if (!isRecord(data) || !isRecord(data.directory)) return null;
  const items = data.directory.item;
  if (!isUnknownArray(items)) return null;
  return items.filter(isEdgarIndexItem);
}
