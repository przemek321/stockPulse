/**
 * Kształt XML Form 4 SEC EDGAR (`<ownershipDocument>`) PO przejściu przez fast-xml-parser
 * z opcjami użytymi w `form4-parser.ts` (`ignoreAttributes: false`, `parseTagValue: true`,
 * `isArray` dla reportingOwner / *Transaction / *Holding).
 *
 * Realny payload po parsowaniu (fragment, fast-xml-parser 5.4.1):
 * ```json
 * {
 *   "ownershipDocument": {
 *     "reportingOwner": [{
 *       "reportingOwnerId": { "rptOwnerCik": 1234567, "rptOwnerName": "Smith John" },
 *       "reportingOwnerRelationship": {
 *         "isDirector": 1, "isOfficer": 1, "isTenPercentOwner": 0, "officerTitle": "Chief Executive Officer"
 *       }
 *     }],
 *     "aff10b5One": 0,
 *     "nonDerivativeTable": { "nonDerivativeTransaction": [{
 *       "transactionDate": { "value": "2026-03-01" },
 *       "transactionCoding": { "transactionFormType": 4, "transactionCode": "P", "footnoteId": { "@_id": "F1" } },
 *       "transactionAmounts": {
 *         "transactionShares": { "value": 1000 },
 *         "transactionPricePerShare": { "value": 50.25 },
 *         "transactionAcquiredDisposedCode": { "value": "A" }
 *       },
 *       "postTransactionAmounts": { "sharesOwnedFollowingTransaction": { "value": 12345.67 } }
 *     }] },
 *     "derivativeTable": ""
 *   }
 * }
 * ```
 *
 * Konsekwencje opcji parsera (zweryfikowane 27.09.2026 na fast-xml-parser 5.4.1):
 * - `parseTagValue: true` (strnum): tekst "1000" → 1000, "0001234567" → 1234567 (CIK traci
 *   zera wiodące), "1" → 1, "true" → true, "P" / "2026-03-01" → string. Dlatego liście są
 *   `unknown`, a parser koercuje je ZAWSZE przez `String()` / `parseFloat(String())` /
 *   `=== true` — dokładnie tak, jak robił to na `any`.
 * - Pusty element (`<derivativeTable/>`, `<reportingOwner></reportingOwner>`) → `''` (string),
 *   NIE obiekt. Stąd `XmlElement<T>` dopuszcza tekst, a dostęp do pól idzie przez `xmlElement()`.
 * - `ignoreAttributes: false`: atrybuty jako klucze `@_nazwa`, tekst obok atrybutów w `#text`
 *   (w Form 4 dotyczy to `<footnoteId id="F1"/>` — parser tego nie czyta).
 * - Elementy z listy `isArray` są ZAWSZE tablicą (także 1 element; pusty tag → `['']`).
 * - Parser nigdy nie zwraca `null` (brak tagu = `undefined`, pusty tag = `''`).
 */

/** Tekst elementu po strnum (`parseTagValue: true`). */
export type XmlText = string | number | boolean;

/**
 * Obecny element XML o kształcie `T` — albo obiekt z dziećmi, albo goły tekst / `''`
 * (gdy tag nie ma dzieci). Do pól `T` sięgamy wyłącznie przez `xmlElement()`.
 */
export type XmlElement<T extends object> = T | XmlText;

/**
 * Liść (`<value>1000</value>`, `<isOfficer>1</isOfficer>`, `<rptOwnerCik>`): string | number |
 * boolean | `''`, a przy atrybutach obiekt z `#text`. Celowo `unknown` — koercja należy do
 * parsera (String/parseFloat), nie do typu.
 */
export type XmlLeaf = unknown;

/** `<transactionShares><value>1000</value></transactionShares>` itp. */
export interface Form4ValueXml {
  value?: XmlLeaf;
}

export interface Form4TransactionCodingXml {
  transactionCode?: XmlLeaf;
  /**
   * Per-transaction flaga planu 10b5-1 — w realnych filingach EDGAR nie występuje
   * (Pakiet 1 fix #0: 0/3394 wierszy), zachowana jako fallback dla nietypowych filerów.
   */
  'Rule10b5-1Transaction'?: XmlLeaf;
  rule10b51Transaction?: XmlLeaf;
}

export interface Form4TransactionAmountsXml {
  transactionShares?: XmlElement<Form4ValueXml>;
  transactionPricePerShare?: XmlElement<Form4ValueXml>;
  transactionAcquiredDisposedCode?: XmlElement<Form4ValueXml>;
}

export interface Form4PostTransactionAmountsXml {
  sharesOwnedFollowingTransaction?: XmlElement<Form4ValueXml>;
}

/** `nonDerivativeTransaction` / `derivativeTransaction` — parser czyta z obu te same pola. */
export interface Form4TransactionXml {
  transactionDate?: XmlElement<Form4ValueXml>;
  transactionCoding?: XmlElement<Form4TransactionCodingXml>;
  transactionAmounts?: XmlElement<Form4TransactionAmountsXml>;
  postTransactionAmounts?: XmlElement<Form4PostTransactionAmountsXml>;
}

export interface Form4ReportingOwnerIdXml {
  rptOwnerCik?: XmlLeaf;
  rptOwnerName?: XmlLeaf;
}

export interface Form4ReportingOwnerRelationshipXml {
  isDirector?: XmlLeaf;
  isOfficer?: XmlLeaf;
  isTenPercentOwner?: XmlLeaf;
  officerTitle?: XmlLeaf;
}

export interface Form4ReportingOwnerXml {
  reportingOwnerId?: XmlElement<Form4ReportingOwnerIdXml>;
  reportingOwnerRelationship?: XmlElement<Form4ReportingOwnerRelationshipXml>;
}

export interface Form4NonDerivativeTableXml {
  nonDerivativeTransaction?: XmlElement<Form4TransactionXml>[];
}

export interface Form4DerivativeTableXml {
  derivativeTransaction?: XmlElement<Form4TransactionXml>[];
}

export interface Form4OwnershipDocumentXml {
  /** Z `isArray` zawsze tablica; wariant pojedynczy zostaje dla defensywnego `Array.isArray` w parserze. */
  reportingOwner?: XmlElement<Form4ReportingOwnerXml>[] | XmlElement<Form4ReportingOwnerXml>;
  /** Doc-level checkbox 10b5-1 (od amendmentu SEC 04.2023): "1"/"0"/"true"/"false" → po strnum 1/0/true/false. */
  aff10b5One?: XmlLeaf;
  nonDerivativeTable?: XmlElement<Form4NonDerivativeTableXml>;
  derivativeTable?: XmlElement<Form4DerivativeTableXml>;
}

/** Korzeń wyniku `XMLParser.parse()` — obok `ownershipDocument` bywa jeszcze klucz `?xml`. */
export interface Form4XmlRoot {
  ownershipDocument?: XmlElement<Form4OwnershipDocumentXml>;
}

/**
 * Płytki guard korzenia drzewa fast-xml-parser. Parser zwraca zwykły obiekt `{ tag: węzeł }`
 * (dla pustego wejścia `{}`), a `Form4XmlRoot` ma wszystkie pola opcjonalne z liśćmi `unknown`,
 * więc „to niepusty obiekt" to cała wiedza potrzebna, by każdy dalszy dostęp był bezpieczny.
 */
export function isForm4XmlRoot(value: unknown): value is Form4XmlRoot {
  return typeof value === 'object' && value !== null;
}

/**
 * Zwraca element jako obiekt `T` albo `undefined`, gdy tagu nie ma lub jest pusty/tekstowy
 * (`''`, liczba, boolean po strnum). Odpowiednik dawnego `node?.pole` na `any`: dla tekstu
 * dostęp do pola i tak dawał `undefined`, więc wynik jest identyczny — tylko bez `any`.
 * `null` w wyjściu parsera nie występuje; sprawdzenie jest tanią asekuracją przed TypeError.
 */
export function xmlElement<T extends object>(node: XmlElement<T> | null | undefined): T | undefined {
  return typeof node === 'object' && node !== null ? node : undefined;
}
