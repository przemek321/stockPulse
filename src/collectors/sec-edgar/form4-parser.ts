import { XMLParser } from 'fast-xml-parser';

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
 */
const TRANSACTION_CODE_MAP: Record<string, Form4Transaction['transactionType']> = {
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
 * Parsuje XML dokumentu Form 4 SEC EDGAR.
 *
 * Struktura XML: <ownershipDocument> z sekcjami:
 * - reportingOwner → imię + rola insidera
 * - nonDerivativeTable → transakcje na akcjach zwykłych
 * - derivativeTable → transakcje na instrumentach pochodnych (opcje itd.)
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

  const doc = parser.parse(xml);
  const ownership = doc.ownershipDocument;
  if (!ownership) {
    throw new Error('Brak <ownershipDocument> w XML');
  }

  // Wyciągnij dane insidera (pierwszy reportingOwner)
  const owners = ownership.reportingOwner || [];
  const firstOwner = Array.isArray(owners) ? owners[0] : owners;
  const insiderName = extractInsiderName(firstOwner);
  const insiderRole = extractInsiderRole(firstOwner);

  const transactions: Form4Transaction[] = [];

  // Transakcje na akcjach zwykłych (non-derivative)
  const nonDerivTxns =
    ownership.nonDerivativeTable?.nonDerivativeTransaction || [];
  for (const txn of nonDerivTxns) {
    const parsed = parseTransaction(txn, insiderName, insiderRole);
    if (parsed) transactions.push(parsed);
  }

  // Transakcje na instrumentach pochodnych (derivative) — np. opcje
  const derivTxns =
    ownership.derivativeTable?.derivativeTransaction || [];
  for (const txn of derivTxns) {
    const parsed = parseTransaction(txn, insiderName, insiderRole);
    if (parsed) transactions.push(parsed);
  }

  return transactions;
}

/**
 * Parsuje pojedynczą transakcję z nonDerivativeTransaction lub derivativeTransaction.
 * Zwraca null jeśli brakuje kluczowych danych.
 */
function parseTransaction(
  txn: any,
  insiderName: string,
  insiderRole: string | null,
): Form4Transaction | null {
  try {
    // Kod transakcji (P, S, M, A, F, G itd.)
    const code =
      txn.transactionCoding?.transactionCode ||
      txn.transactionCoding?.['transactionCode'] ||
      '';
    const transactionType = TRANSACTION_CODE_MAP[code] || 'OTHER';

    // Liczba akcji
    const sharesRaw =
      txn.transactionAmounts?.transactionShares?.value ??
      txn.transactionAmounts?.transactionShares ??
      0;
    const shares = Math.abs(parseFloat(String(sharesRaw)) || 0);
    if (shares === 0) return null; // Brak akcji → skip

    // Cena za akcję (może być pusta dla grantów/giftów)
    const priceRaw =
      txn.transactionAmounts?.transactionPricePerShare?.value ??
      txn.transactionAmounts?.transactionPricePerShare ??
      null;
    const pricePerShare =
      priceRaw != null && priceRaw !== '' && priceRaw !== 0
        ? parseFloat(String(priceRaw)) || null
        : null;

    // Wartość transakcji
    const totalValue =
      pricePerShare != null ? Math.round(shares * pricePerShare * 100) / 100 : 0;

    // Data transakcji
    const dateRaw =
      txn.transactionDate?.value ?? txn.transactionDate ?? null;
    if (!dateRaw) continue; // Brak daty transakcji — pomijamy (zamiast wstawiać dzisiejszą)
    const transactionDate = new Date(dateRaw);

    // Plan 10b5-1 — zaplanowana transakcja (niższy priorytet sygnału)
    const rule10b5Raw =
      txn.transactionCoding?.['Rule10b5-1Transaction'] ??
      txn.transactionCoding?.rule10b51Transaction ??
      '';
    const is10b51Plan = String(rule10b5Raw) === '1' || String(rule10b5Raw).toUpperCase() === 'Y';

    // Akcje po transakcji (z postTransactionAmounts)
    const sharesAfterRaw =
      txn.postTransactionAmounts?.sharesOwnedFollowingTransaction?.value ??
      txn.postTransactionAmounts?.sharesOwnedFollowingTransaction ??
      null;
    const sharesOwnedAfter =
      sharesAfterRaw != null ? parseFloat(String(sharesAfterRaw)) || null : null;

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
 * Wyciąga imię insidera z reportingOwner.
 */
function extractInsiderName(owner: any): string {
  if (!owner) return 'Unknown';
  return (
    owner.reportingOwnerId?.rptOwnerName ||
    owner.reportingOwnerId?.rptOwnerCik ||
    'Unknown'
  );
}

/**
 * Wyciąga rolę insidera z reportingOwnerRelationship.
 * Składa z flag: isOfficer + officerTitle, isDirector, isTenPercentOwner.
 */
function extractInsiderRole(owner: any): string | null {
  const rel = owner?.reportingOwnerRelationship;
  if (!rel) return null;

  const parts: string[] = [];

  // officerTitle jest najdokładniejszy (np. "Chief Executive Officer")
  if (rel.officerTitle) {
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
