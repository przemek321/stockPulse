import { XMLParser } from 'fast-xml-parser';
import {
  Form4OwnershipDocumentXml,
  Form4ReportingOwnerXml,
  Form4TransactionXml,
  isForm4XmlRoot,
  XmlElement,
  xmlElement,
} from './form4-xml.types';

/**
 * Sparsowana transakcja z Form 4 SEC EDGAR.
 */
export interface Form4Transaction {
  insiderName: string;
  insiderRole: string | null;
  transactionType: 'BUY' | 'SELL' | 'EXERCISE' | 'GRANT' | 'GIFT' | 'TAX' | 'OTHER';
  shares: number;
  pricePerShare: number | null;
  totalValue: number;
  transactionDate: Date;
  /** Czy transakcja jest częścią planu 10b5-1 (zaplanowana z góry) */
  is10b51Plan: boolean;
  /** Liczba akcji po transakcji (z <postTransactionAmounts>) */
  sharesOwnedAfter: number | null;
}

/**
 * Mapowanie kodów transakcji SEC na czytelne typy.
 * https://www.sec.gov/about/forms/form4data.pdf
 * `Partial` — nieznany kod (klucz spoza mapy) daje `undefined` → fallback 'OTHER'.
 */
const TRANSACTION_CODE_MAP: Partial<Record<string, Form4Transaction['transactionType']>> = {
  P: 'BUY',       // Purchase — zakup na rynku
  S: 'SELL',       // Sale — sprzedaż na rynku
  A: 'GRANT',      // Award/Grant — przyznanie akcji/opcji
  M: 'EXERCISE',   // Exercise — wykonanie opcji
  F: 'TAX',        // Payment of exercise price or tax liability (tax withholding)
  G: 'GIFT',       // Gift — darowizna
  D: 'OTHER',      // Disposition to the issuer
  C: 'OTHER',      // Conversion of derivative
  E: 'OTHER',      // Expiration of short derivative
  H: 'OTHER',      // Expiration of long derivative
  I: 'OTHER',      // Discretionary transaction
  J: 'OTHER',      // Other acquisition or disposition
  K: 'OTHER',      // Equity swap or similar
  U: 'OTHER',      // Disposition due to tender of shares
  W: 'OTHER',      // Acquisition or disposition by will or laws of descent
  Z: 'OTHER',      // Deposit into or withdrawal from voting trust
};

/**
 * Prawdziwość JS surowej wartości XML — 1:1 z dawnym `if (x)` / `x || fallback` na `any`
 * (`''` / `0` / `false` / `undefined` = „brak"), tylko bez `any` w warunku.
 * Uwaga: po strnum `<isOfficer>0</isOfficer>` to liczba 0 — falsy, jak dotąd.
 */
function truthy(value: unknown): boolean {
  return Boolean(value);
}

/**
 * `parseFloat(String(x))` liścia XML — ta sama koercja co dotąd na `any`: liczba po strnum →
 * tekst → liczba; `''`, tekst nienumeryczny lub liść-obiekt (np. `<transactionPricePerShare>`
 * z samym `<footnoteId/>`, bez `<value>` → '[object Object]') → NaN, które wołający zamienia
 * przez `|| 0` / `|| null` dokładnie jak dotąd.
 */
function leafToFloat(value: unknown): number {
  return parseFloat(String(value));
}

/**
 * `new Date(x)` dla surowej wartości XML z zachowaniem koercji, którą dawał `new Date(any)`:
 * string/number wprost, boolean → ToNumber (`true` → 1 ms epoki), pozostałe → ToString
 * (`'[object Object]'` → Invalid Date). W realnych filingach to zawsze string "YYYY-MM-DD"
 * z `<transactionDate><value>`.
 */
function toDate(value: unknown): Date {
  if (typeof value === 'string' || typeof value === 'number') return new Date(value);
  if (typeof value === 'boolean') return new Date(Number(value));
  return new Date(String(value));
}

/**
 * Parsuje XML dokumentu Form 4 SEC EDGAR.
 *
 * Struktura XML: <ownershipDocument> z sekcjami:
 * - reportingOwner → imię + rola insidera
 * - nonDerivativeTable → transakcje na akcjach zwykłych
 * - derivativeTable → transakcje na instrumentach pochodnych (opcje itd.)
 *
 * Kształt drzewa po fast-xml-parser i pułapki strnum: `form4-xml.types.ts`.
 *
 * Zwraca tablicę transakcji (Form 4 może mieć wiele transakcji).
 * Puste tablice (brak transakcji) lub błędne pola → skip, bez crash.
 */
export function parseForm4Xml(xml: string): Form4Transaction[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: true,
    isArray: (_name: string, jpath: string) => {
      // Pola, które mogą zawierać wiele elementów
      return [
        'ownershipDocument.reportingOwner',
        'ownershipDocument.nonDerivativeTable.nonDerivativeTransaction',
        'ownershipDocument.nonDerivativeTable.nonDerivativeHolding',
        'ownershipDocument.derivativeTable.derivativeTransaction',
        'ownershipDocument.derivativeTable.derivativeHolding',
      ].includes(jpath);
    },
  });

  const doc: unknown = parser.parse(xml);
  const ownershipRaw = isForm4XmlRoot(doc) ? doc.ownershipDocument : undefined;
  if (!truthy(ownershipRaw)) {
    throw new Error('Brak <ownershipDocument> w XML');
  }
  // Prawdziwy, ale bezdzietny (tekstowy) <ownershipDocument> → jak dotąd: brak sekcji = 0 transakcji.
  const ownership: Form4OwnershipDocumentXml = xmlElement(ownershipRaw) ?? {};

  // Wyciągnij dane insiderów — obsługuje multi-reportingOwner (Sprint 16 FLAG #30 fix).
  // Z `isArray` to zawsze tablica; wariant pojedynczego elementu zachowany defensywnie
  // (dawne `reportingOwner || []` + `Array.isArray`: falsy → [], tablica → ona, inne → [x]).
  const ownersRaw = ownership.reportingOwner;
  let ownersList: XmlElement<Form4ReportingOwnerXml>[] = [];
  if (Array.isArray(ownersRaw)) {
    ownersList = ownersRaw;
  } else if (ownersRaw !== undefined && truthy(ownersRaw)) {
    ownersList = [ownersRaw];
  }
  const { name: insiderName, role: insiderRole } = mergeOwnerRoles(ownersList);

  // Doc-level checkbox 10b5-1 (Pakiet 1 fix #0, 09.06.2026): <aff10b5One>1</aff10b5One>.
  // Obowiązkowy element od amendmentu SEC z kwietnia 2023 — to JEDYNY znacznik planu
  // w realnych filingach (per-transaction Rule10b5-1Transaction praktycznie nie występuje:
  // 0/3394 wierszy w produkcji miało flagę przed tym fixem). Doc-level = "co najmniej
  // jedna transakcja w filingu z planu" — mieszany filing (plan SELL + discretionary BUY)
  // zostanie w całości oflagowany. Świadomy trade-off: przy celu "precyzja nad wolumenem"
  // wolimy stracić rzadki mieszany BUY niż alertować planowe SELL jako discretionary
  // (case GILD O'Day 29.04.2026: aff10b5One=1, system potraktował jako discretionary).
  // Akceptowane wartości spójne z edgar_fetcher.py: '1' / 'true' / 'y' (xs:boolean
  // dopuszcza tylko 1/0/true/false; 'Y' to defensywa zgodna z per-transaction fallbackiem).
  // `unknown` jawnie: TS typuje `unknown ?? ''` jako `{}`, a to liść XML (string/number/boolean/obiekt).
  const aff10b5Value: unknown = ownership.aff10b5One ?? '';
  const aff10b5Raw = String(aff10b5Value).trim().toLowerCase();
  const docLevel10b51 = aff10b5Raw === '1' || aff10b5Raw === 'true' || aff10b5Raw === 'y';

  const transactions: Form4Transaction[] = [];

  // Transakcje na akcjach zwykłych (non-derivative)
  const nonDerivTxns = xmlElement(ownership.nonDerivativeTable)?.nonDerivativeTransaction ?? [];
  for (const txn of nonDerivTxns) {
    const parsed = parseTransaction(txn, insiderName, insiderRole, docLevel10b51);
    if (parsed) transactions.push(parsed);
  }

  // Transakcje na instrumentach pochodnych (derivative) — np. opcje
  const derivTxns = xmlElement(ownership.derivativeTable)?.derivativeTransaction ?? [];
  for (const txn of derivTxns) {
    const parsed = parseTransaction(txn, insiderName, insiderRole, docLevel10b51);
    if (parsed) transactions.push(parsed);
  }

  return transactions;
}

/**
 * Parsuje pojedynczą transakcję z nonDerivativeTransaction lub derivativeTransaction.
 * Zwraca null jeśli brakuje kluczowych danych.
 */
function parseTransaction(
  txn: XmlElement<Form4TransactionXml>,
  insiderName: string,
  insiderRole: string | null,
  docLevel10b51: boolean,
): Form4Transaction | null {
  try {
    // Pusty/tekstowy element (<nonDerivativeTransaction/> → '') nie ma pól → jak dotąd shares=0 → skip
    const t = xmlElement(txn);
    if (t === undefined) return null;

    // Kod transakcji (P, S, M, A, F, G itd.)
    const coding = xmlElement(t.transactionCoding);
    const codeRaw = coding?.transactionCode;
    const code = truthy(codeRaw) ? String(codeRaw) : '';
    const transactionType = TRANSACTION_CODE_MAP[code] ?? 'OTHER';

    // Liczba akcji. Surowe wartości liści trzymamy jako `unknown` (TS typowałby `x ?? 0` jako `{}`),
    // a koercję robi leafToFloat — identyczną z dawnym `parseFloat(String(any))`.
    const amounts = xmlElement(t.transactionAmounts);
    const sharesRaw: unknown =
      xmlElement(amounts?.transactionShares)?.value ??
      amounts?.transactionShares ??
      0;
    const shares = Math.abs(leafToFloat(sharesRaw) || 0);
    if (shares === 0) return null; // Brak akcji → skip

    // Cena za akcję (może być pusta dla grantów/giftów)
    const priceRaw: unknown =
      xmlElement(amounts?.transactionPricePerShare)?.value ??
      amounts?.transactionPricePerShare ??
      null;
    const pricePerShare =
      priceRaw != null && priceRaw !== '' && priceRaw !== 0
        ? leafToFloat(priceRaw) || null
        : null;

    // Wartość transakcji
    const totalValue =
      pricePerShare != null ? Math.round(shares * pricePerShare * 100) / 100 : 0;

    // Data transakcji
    const dateRaw: unknown = xmlElement(t.transactionDate)?.value ?? t.transactionDate ?? null;
    if (!truthy(dateRaw)) return null; // Brak daty transakcji — pomijamy (zamiast wstawiać dzisiejszą)
    const transactionDate = toDate(dateRaw);

    // Plan 10b5-1 — zaplanowana transakcja (niższy priorytet sygnału).
    // Źródło prawdy: doc-level <aff10b5One> (docLevel10b51, parsowany w parseForm4Xml).
    // Per-transaction tag zachowany jako fallback dla nietypowych filerów — w realnych
    // filingach EDGAR nie występuje (Pakiet 1 fix #0).
    const rule10b5Raw: unknown =
      coding?.['Rule10b5-1Transaction'] ??
      coding?.rule10b51Transaction ??
      '';
    const is10b51Plan =
      docLevel10b51 ||
      String(rule10b5Raw) === '1' ||
      String(rule10b5Raw).toUpperCase() === 'Y';

    // Akcje po transakcji (z postTransactionAmounts)
    const post = xmlElement(t.postTransactionAmounts);
    const sharesAfterRaw: unknown =
      xmlElement(post?.sharesOwnedFollowingTransaction)?.value ??
      post?.sharesOwnedFollowingTransaction ??
      null;
    const sharesOwnedAfter =
      sharesAfterRaw != null ? leafToFloat(sharesAfterRaw) || null : null;

    return {
      insiderName,
      insiderRole,
      transactionType,
      shares,
      pricePerShare,
      totalValue,
      transactionDate,
      is10b51Plan,
      sharesOwnedAfter,
    };
  } catch {
    return null; // Błędne dane → skip transakcji
  }
}

/**
 * Łączy role z wielu reportingOwners w jedną reprezentatywną rolę.
 *
 * Reguły (Sprint 16 FLAG #30 fix):
 * - 1 owner → zwróć jego role
 * - >1 owner → połącz unikalne role-parts ze wszystkich owners
 * - Nazwa: "primary (co-filing z secondary, ...)"
 *
 * Motywacja: SEC Form 4 może być co-filing (małżeństwo, trust, kilku execs).
 * Brać pierwszego ownera = skażone dane (Director SELL anti-signal błędnie
 * aplikowany do transakcji gdzie faktyczny decision-maker jest CEO).
 */
function mergeOwnerRoles(
  owners: XmlElement<Form4ReportingOwnerXml>[],
): { name: string; role: string | null } {
  if (owners.length === 0) {
    return { name: 'Unknown', role: null };
  }

  if (owners.length === 1) {
    return {
      name: extractInsiderName(owners[0]),
      role: extractInsiderRole(owners[0]),
    };
  }

  // >1 owner — połącz role
  const names: string[] = [];
  const allRoles: string[] = [];

  for (const owner of owners) {
    names.push(extractInsiderName(owner));
    const role = extractInsiderRole(owner);
    if (role !== null) allRoles.push(role); // extractInsiderRole nigdy nie zwraca '' (join niepustych parts)
  }

  // Unikalne role-parts (niezależnie od owner)
  const roleParts = new Set<string>();
  for (const r of allRoles) {
    for (const part of r.split(',').map(s => s.trim())) {
      if (part) roleParts.add(part);
    }
  }

  const combinedRole = roleParts.size > 0 ? [...roleParts].join(', ') : null;

  // Primary name: pierwszy owner (ale role = combined)
  const primaryName = names[0];
  const extraNames = names.slice(1);
  const displayName = extraNames.length > 0
    ? `${primaryName} (co-filing z ${extraNames.join(', ')})`
    : primaryName;

  // Limity kolumn DB (insiderName 255, insiderRole 100) — co-filingi funduszy
  // potrafią skleić >255 znaków; bez przycięcia INSERT pada i trade przepada
  // (DATA GAP CBIO/ARTV/PBLS 20-22.07.2026).
  return {
    name: truncateForColumn(displayName, 255),
    role: combinedRole !== null ? truncateForColumn(combinedRole, 100) : null,
  };
}

/** Przycina string do limitu kolumny DB z wielokropkiem (bezstratnie gdy mieści się). */
function truncateForColumn(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

/**
 * Wyciąga imię insidera z reportingOwner.
 * Kolejność jak dotąd: rptOwnerName → rptOwnerCik → 'Unknown' (po prawdziwości JS: pusty tag
 * `''` = brak). `String()` bo po strnum CIK jest liczbą (0001234567 → 1234567) — do kolumny
 * varchar i tak trafiał jako tekst.
 */
function extractInsiderName(owner: XmlElement<Form4ReportingOwnerXml>): string {
  const id = xmlElement(xmlElement(owner)?.reportingOwnerId);
  const name = id?.rptOwnerName;
  if (truthy(name)) return String(name);
  const cik = id?.rptOwnerCik;
  if (truthy(cik)) return String(cik);
  return 'Unknown';
}

/**
 * Wyciąga rolę insidera z reportingOwnerRelationship.
 * Składa z flag: isOfficer + officerTitle, isDirector, isTenPercentOwner.
 * Flagi po strnum: "1" → 1, "true" → true, "0" → 0 — stąd `String(x) === '1' || x === true`.
 */
function extractInsiderRole(owner: XmlElement<Form4ReportingOwnerXml>): string | null {
  const rel = xmlElement(xmlElement(owner)?.reportingOwnerRelationship);
  if (rel === undefined) return null;

  const parts: string[] = [];

  // officerTitle jest najdokładniejszy (np. "Chief Executive Officer")
  if (truthy(rel.officerTitle)) {
    parts.push(String(rel.officerTitle));
  } else if (String(rel.isOfficer) === '1' || rel.isOfficer === true) {
    parts.push('Officer');
  }

  if (String(rel.isDirector) === '1' || rel.isDirector === true) {
    parts.push('Director');
  }

  if (
    String(rel.isTenPercentOwner) === '1' ||
    rel.isTenPercentOwner === true
  ) {
    parts.push('10% Owner');
  }

  return parts.length > 0 ? parts.join(', ') : null;
}
