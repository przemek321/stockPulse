/**
 * S19-FIX-02: pre-LLM extraction "Affirms / Reaffirms / Maintains / Lowers /
 * Raises / Withdraws guidance" z tekstu 8-K Item 2.02.
 *
 * Trigger case: HUM 8-K 29.04.2026 — release headline "Affirms Full Year 2026
 * Adjusted Financial Guidance" nie trafił do GPT prompt. Mechaniczna przyczyna:
 * `extractItemText(filingText, '2.02')` w `form8k.parser.ts` szuka pierwszego
 * matcha `/Item 2\.02/i` i bierze sekcję OD tej pozycji do następnego "Item
 * X.XX" lub "SIGNATURES". Headline release (typowo cover page / intro w
 * pierwszych 500-2000 znakach filingu) jest PRZED tym matchem, więc całkowicie
 * pomijany przez extractor.
 * `text.slice(0, 8000)` w prompt builderze bierze pierwsze 8000 znaków
 * już-wyciętej sekcji Item 2.02 — nie obcina od tyłu i nie ma związku z
 * gubieniem headline'u (slice działa od początku). GPT widział tylko Item 2.02
 * body + appendix XBRL, bez headline z affirmation, więc zhalucynował
 * "guidance lowered" → bear conviction.
 *
 * Fix: skanujemy CAŁY raw `filingText` (przed wycięciem do Item 2.02), żeby
 * złapać headline z cover page; deterministyczne keywords podajemy GPT jako
 * structured `extractedFacts` block; post-GPT enforce floor conviction gdy
 * `affirmsAdjusted=true` (no bear allowed niżej niż -0.3).
 *
 * Design notes:
 * - Healthcare/managed care = adjusted-driven. `affirmsAdjusted` ma priorytet
 *   nad `hasLowering` jeśli oba match (HUM: lowers GAAP + affirms Adjusted →
 *   net signal = neutral/positive).
 * - Mixed signal (affirms + lowers, ale lowers nie-GAAP) → no floor enforced,
 *   ale GPT prompt dostaje warning żeby wziął oba pod uwagę.
 */

export interface GuidanceStatus {
  /** 'Affirms/Reaffirms/Maintains/Reiterates' z słowem kluczowym guidance/outlook/forecast */
  hasAffirmation: boolean;
  /** Affirmation explicite na Adjusted/Non-GAAP — ma priorytet dla managed care */
  affirmsAdjusted: boolean;
  /** 'Lowers/Reduces/Cuts/Trims/Decreases guidance' */
  hasLowering: boolean;
  /** Lowering explicite na GAAP — typowo non-cash, mniejszy weight */
  lowersGaapOnly: boolean;
  /** 'Raises/Increases/Boosts/Lifts guidance' */
  hasRaising: boolean;
  /** 'Withdraws/Suspends/Pulls guidance' — zawsze bear */
  hasWithdrawal: boolean;
  /** Matched fragments dla audit logu (max 3 per typ, 200 znaków każdy) */
  matchedFragments: string[];
}

const AFFIRM_KEYWORDS = '(?:affirms?|reaffirms?|maintains?|reiterates?|reconfirms?|continues?\\s+to\\s+expect)';
const LOWER_KEYWORDS = '(?:lowers?|reduces?|cuts?|trims?|decreases?|narrows?\\s+down)';
const RAISE_KEYWORDS = '(?:raises?|increases?|boosts?|lifts?|expands?|narrows?\\s+up)';
const WITHDRAW_KEYWORDS = '(?:withdraws?|suspends?|pulls?|removes?)';
const GUIDANCE_TARGET = '(?:guidance|outlook|forecast|guidance\\s+range|target|expectations?)';
const ADJUSTED_QUALIFIER = '(?:adjusted|adj\\.?|non[\\s-]gaap)';
const GAAP_QUALIFIER = '\\bgaap\\b';

const AFFIRM_RE = new RegExp(
  `${AFFIRM_KEYWORDS}[^.\\n]{0,200}\\b${GUIDANCE_TARGET}\\b`,
  'gi',
);
const AFFIRM_ADJUSTED_RE = new RegExp(
  `${AFFIRM_KEYWORDS}[^.\\n]{0,200}${ADJUSTED_QUALIFIER}[^.\\n]{0,80}\\b${GUIDANCE_TARGET}\\b|` +
  `${AFFIRM_KEYWORDS}[^.\\n]{0,200}\\b${GUIDANCE_TARGET}\\b[^.\\n]{0,80}${ADJUSTED_QUALIFIER}`,
  'gi',
);
const LOWER_RE = new RegExp(
  `${LOWER_KEYWORDS}[^.\\n]{0,200}\\b${GUIDANCE_TARGET}\\b`,
  'gi',
);
const LOWER_GAAP_ONLY_RE = new RegExp(
  `${LOWER_KEYWORDS}[^.\\n]{0,200}${GAAP_QUALIFIER}[^.\\n]{0,80}\\b${GUIDANCE_TARGET}\\b|` +
  `${GAAP_QUALIFIER}\\b[^.\\n]{0,80}${LOWER_KEYWORDS}[^.\\n]{0,200}\\b${GUIDANCE_TARGET}\\b`,
  'gi',
);
const RAISE_RE = new RegExp(
  `${RAISE_KEYWORDS}[^.\\n]{0,200}\\b${GUIDANCE_TARGET}\\b`,
  'gi',
);
const WITHDRAW_RE = new RegExp(
  `${WITHDRAW_KEYWORDS}[^.\\n]{0,200}\\b${GUIDANCE_TARGET}\\b`,
  'gi',
);

function collectMatches(re: RegExp, text: string, max = 3): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null && out.length < max) {
    out.push(m[0].slice(0, 200).trim());
  }
  return out;
}

export function extractGuidanceStatus(filingText: string): GuidanceStatus {
  if (!filingText || typeof filingText !== 'string') {
    return {
      hasAffirmation: false,
      affirmsAdjusted: false,
      hasLowering: false,
      lowersGaapOnly: false,
      hasRaising: false,
      hasWithdrawal: false,
      matchedFragments: [],
    };
  }

  const affirmMatches = collectMatches(AFFIRM_RE, filingText);
  const affirmAdjMatches = collectMatches(AFFIRM_ADJUSTED_RE, filingText);
  const lowerMatches = collectMatches(LOWER_RE, filingText);
  const lowerGaapMatches = collectMatches(LOWER_GAAP_ONLY_RE, filingText);
  const raiseMatches = collectMatches(RAISE_RE, filingText);
  const withdrawMatches = collectMatches(WITHDRAW_RE, filingText);

  const fragments: string[] = [];
  if (affirmAdjMatches.length) fragments.push(`AFFIRMS_ADJUSTED: ${affirmAdjMatches[0]}`);
  else if (affirmMatches.length) fragments.push(`AFFIRMS: ${affirmMatches[0]}`);
  if (lowerGaapMatches.length) fragments.push(`LOWERS_GAAP: ${lowerGaapMatches[0]}`);
  else if (lowerMatches.length) fragments.push(`LOWERS: ${lowerMatches[0]}`);
  if (raiseMatches.length) fragments.push(`RAISES: ${raiseMatches[0]}`);
  if (withdrawMatches.length) fragments.push(`WITHDRAWS: ${withdrawMatches[0]}`);

  // hasLowering: tylko jeśli match istnieje ALE nie tylko GAAP-qualified
  // (jeśli WSZYSTKIE lower matches są GAAP, traktujemy jako lowersGaapOnly=true → no general lowering)
  const lowersGaapOnly = lowerMatches.length > 0 && lowerGaapMatches.length === lowerMatches.length;
  const hasLowering = lowerMatches.length > lowerGaapMatches.length;

  return {
    hasAffirmation: affirmMatches.length > 0,
    affirmsAdjusted: affirmAdjMatches.length > 0,
    hasLowering,
    lowersGaapOnly,
    hasRaising: raiseMatches.length > 0,
    hasWithdrawal: withdrawMatches.length > 0,
    matchedFragments: fragments,
  };
}

/**
 * Czy guidance status implikuje conviction floor (no bear poniżej -0.3).
 * True gdy filing zawiera affirmation (zwłaszcza adjusted) i NIE zawiera
 * niezależnego lowering/withdrawal poza GAAP-only.
 *
 * HUM 29.04: affirmsAdjusted=true, lowersGaapOnly=true (FY GAAP $8.89→$8.36),
 * hasLowering=false, hasWithdrawal=false → floor enforced.
 */
export function shouldEnforceConvictionFloor(status: GuidanceStatus): boolean {
  if (status.hasWithdrawal) return false;
  if (status.hasLowering) return false;
  return status.hasAffirmation || status.affirmsAdjusted;
}
