import type { InsiderTrade } from '../../entities';
import type { FindingSeverity } from '../../entities/agent-finding.entity';
import type { AuditCheck, AuditContext, CheckResult, FindingDraft } from './audit-context';
import { getEffectiveStartTime, isNyseOpen } from '../../common/utils/market-hours.util';

/**
 * Warstwa deterministyczna audytora (tasks-2026-09-27/03) — czyste checki nad AuditContext.
 *
 * Inwarianty:
 * - zero LLM, zero DB, zero sieci; jedyny import ze ścieżki decyzyjnej to read-only `market-hours.util`;
 * - żaden check nie modyfikuje `ctx`; wyjątek jednego checku nie gubi wyników pozostałych;
 * - wynik: FindingDraft | 'AMBIGUOUS' | null (patrz audit-context.ts).
 *
 * Definicje reguł: tasks-2026-09-27/00-README-plan.md §Checki + 03-auditor-deterministic-checks.md
 * + korekty z przeglądu adwersarialnego 29.09 (opisane przy checkach). Fixture: test/fixtures/auditor/*.json.
 */

/** Próg chase z reguł gry real (doc/REGULY-GRY-REAL-2026-07-02.md): wejście do ±3% od ceny alertu. */
export const ENTRY_GAP_THRESHOLD = 0.03;
/** Data szablonowa starsza niż 30 dni od wysyłki = przeterminowany szablon (ping discovery „25.07"). */
export const STALE_TEMPLATE_DAYS = 30;
/** Miejsce w formatterze, gdzie „akcji @ $X" pokazuje wartość łączną, nie cenę za akcję. */
export const PRICE_LABEL_FORMATTER_REF = 'src/alerts/telegram/telegram-formatter.service.ts:264';
/** Formatter ucina wniosek GPT do 300 znaków (Form 4 :274, 8-K :340) — projektowe, ale niewidoczne dla czytelnika. */
export const CONCLUSION_CUT_FORMATTER_REF = 'src/alerts/telegram/telegram-formatter.service.ts:274,340';
export const CONCLUSION_CUT_LENGTH = 300;
/**
 * Backfill flagi 10b5-1 (e17c947, 10.06.2026: 752 wierszy plan=true po fixie parsera aff10b5One 682b13d)
 * zmienił insider_trades PO wysłaniu starszych alertów — mismatch planu sprzed tej daty to znany incydent, nie bug.
 */
export const PLAN_FLAG_BACKFILL_AT = new Date('2026-06-10T00:00:00Z');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const PRICE_EPSILON = 1e-9;
const MAX_ESCAPE_SAMPLES = 20;
/** Alert w sesji: price1h uznajemy za „po 1h" tylko gdy CRON wypełnił slot ≤2h po wysyłce. */
const SAME_SESSION_MAX_LAG_MS = 2 * HOUR_MS;
const MAX_FILL_TICKS = 24 * 12;
const MIN_EMPTY_SLOTS = 3;

/** Znaki zarezerwowane MarkdownV2 (po zdjęciu par `*…*`/`_…_` i linków każdy pozostały `*`/`_` też jest błędem). */
const UNESCAPED_RESERVED_RE = /(?<!\\)[()[\]~`>#+=|{}.!*_-]/g;
const LINK_RE = /(?<!\\)\[([^\]\n]*)\]\([^)\n]*\)/g;
const BOLD_PAIR_RE = /(?<!\\)\*([^*\n]+?)(?<!\\)\*/g;
const ITALIC_PAIR_RE = /(?<!\\)_([^_\n]+?)(?<!\\)_/g;
/** Nagłówek Form 4 z formattera: `👤 *Imię Nazwisko* \(Rola\)` (już zescapowany MarkdownV2). */
const INSIDER_HEADER_RE = /👤 \*(.+?)\* \\\((.*?)\\\)/;
const TRANSACTION_LINE_RE = /• Transakcja: ([A-Z]+) /;
const PLAN_LINE_RE = /Plan 10b5\\-1: (TAK|NIE)/;
/** „przegląd okna obs ~25.07.2026" lub realny ping „przegląd 25\.07\." (bez roku) — kropki/tylda zescapowane. */
const TEMPLATE_DATE_RE = /przegląd (?:okna obs )?(?:\\?~)?(\d{2})\\?\.(\d{2})(?:\\?\.(\d{4}))?/i;
/** Angielskie i polskie warianty „już ogłoszone" (treść alertów/GPT jest po polsku). */
const PREVIOUSLY_ANNOUNCED_RE =
  /previously (announced|disclosed)|wcześniej (ogłoszon|zapowiedzian|zapowiadan|ujawnion|komunikowan)|uprzednio (ogłoszon|ujawnion)|już (ogłoszon|zapowiedzian)/i;
/** Formatter NIE escapuje `$` w tej linii (w nagłówku `\$PFE` już tak) — akceptujemy oba warianty. */
const PRICE_LABEL_LINE_RE = /^• Transakcja: .* akcji @ \\?\$.*$/m;
const CONCLUSION_LINE_RE = /\*Wniosek GPT:\*\n(.+)\n/;
const SENTENCE_END_RE = /[.!?)]$/;

/** `hourCycle: 'h23'` — `hour12:false` daje „24:xx" o północy ET (quirk S20-T04 w market-hours.util). */
const NY_TIME_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
  hourCycle: 'h23',
});

/**
 * TypeORM hydruje kolumny `decimal` jako stringi ("16.5100") mimo typu `number | null` w encji —
 * jedyna bezpieczna konwersja liczb z alertów/insider_trades.
 */
export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Kiedy CRON Price Outcome faktycznie wypełnił slot 1h: pierwsza pełna godzina UTC ≥ effectiveStart+1h,
 * w której NYSE jest otwarta (price-outcome.service.ts: `@Cron('0 * * * *')` + guard isNyseOpen + sloty od
 * getEffectiveStartTime). Dla alertu w sesji po ~15:00 NY to NASTĘPNA sesja (10:00 NY) — ELV #2446/#2447.
 */
export function price1hFillTime(sentAt: Date): Date | null {
  const due = getEffectiveStartTime(sentAt).getTime() + HOUR_MS;
  let tick = Math.ceil(due / HOUR_MS) * HOUR_MS;
  for (let i = 0; i < MAX_FILL_TICKS; i++) {
    const t = new Date(tick);
    if (isNyseOpen(t)) return t;
    tick += HOUR_MS;
  }
  return null;
}

/** Odczyt pola z gptAnalysis bez zaufania do kształtu (legacy wiersze sprzed zod / fix16_shadow). */
function readString(o: object | null | undefined, key: string): string | null {
  if (o === null || o === undefined) return null;
  const v = (o as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : null;
}

/** Zdejmuje escapy MarkdownV2 (`\.` → `.`) — treść alertu jest zescapowana przez formatter. */
function unescapeMarkdownV2(s: string): string {
  return s.replace(/\\(.)/g, '$1');
}

function normalizeName(s: string): string {
  return unescapeMarkdownV2(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

function pct(x: number): string {
  return `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
}

function draft(
  ctx: AuditContext,
  checkId: string,
  severity: FindingSeverity,
  summary: string,
  evidence: Record<string, unknown>,
): FindingDraft {
  return {
    checkId,
    severity,
    alertId: ctx.alert.id,
    ticker: ctx.alert.symbol,
    accessionNumber: ctx.filing?.accessionNumber ?? null,
    summary,
    evidence,
  };
}

function globalDraft(
  checkId: string,
  severity: FindingSeverity,
  summary: string,
  evidence: Record<string, unknown>,
): FindingDraft {
  return { checkId, severity, alertId: null, ticker: null, accessionNumber: null, summary, evidence };
}

function tradeSummary(t: InsiderTrade): Record<string, unknown> {
  return {
    id: t.id,
    insiderName: t.insiderName,
    insiderRole: t.insiderRole,
    transactionType: t.transactionType,
    transactionDate: String(t.transactionDate),
    collectedAt: String(t.collectedAt),
    is10b51Plan: t.is10b51Plan,
    totalValue: toNumber(t.totalValue),
  };
}

function priceSlots(ctx: AuditContext): Record<'price1h' | 'price4h' | 'price1d' | 'price3d' | 'price7d', number | null> {
  const a = ctx.alert;
  return {
    price1h: toNumber(a.price1h),
    price4h: toNumber(a.price4h),
    price1d: toNumber(a.price1d),
    price3d: toNumber(a.price3d),
    price7d: toNumber(a.price7d),
  };
}

// ── 1. PRICE_FROZEN ───────────────────────────────────────────────────────────

/** price1h..price7d wszystkie non-null i identyczne → tracker nie widzi ruchu (SEM #2441: delisting). */
const priceFrozen: AuditCheck = {
  id: 'PRICE_FROZEN',
  severity: 'P1',
  scope: 'ALERT',
  run: (ctx): CheckResult => {
    const slots = priceSlots(ctx);
    const values = Object.values(slots).filter((v): v is number => v !== null);
    if (values.length !== Object.keys(slots).length) return null;
    const first = values[0];
    if (!values.every((v) => Math.abs(v - first) < PRICE_EPSILON)) return null;
    return draft(
      ctx,
      priceFrozen.id,
      priceFrozen.severity,
      `Ceny 1h/4h/1d/3d/7d identyczne (${first}) — outcome zamrożony, tracker nie widzi ruchu kursu (delisting lub stale quote)`,
      { ...slots, priceAtAlert: toNumber(ctx.alert.priceAtAlert) },
    );
  },
};

// ── 2. OUTCOME_DONE_EMPTY ─────────────────────────────────────────────────────

/** Od guardu getQuote (01.09) delisting nie mrozi cen, tylko zostawia puste sloty do hard-timeoutu 11d. */
const outcomeDoneEmpty: AuditCheck = {
  id: 'OUTCOME_DONE_EMPTY',
  severity: 'P2',
  scope: 'ALERT',
  run: (ctx): CheckResult => {
    if (!ctx.alert.priceOutcomeDone || toNumber(ctx.alert.priceAtAlert) === null) return null;
    const slots = priceSlots(ctx);
    const empty = Object.entries(slots)
      .filter(([, v]) => v === null)
      .map(([k]) => k);
    if (empty.length < MIN_EMPTY_SLOTS) return null;
    return draft(
      ctx,
      outcomeDoneEmpty.id,
      outcomeDoneEmpty.severity,
      `Outcome zamknięty (priceOutcomeDone) z pustymi slotami: ${empty.join(', ')} — hard-timeout bez pomiaru (brak notowań?)`,
      { ...slots, emptySlots: empty },
    );
  },
};

// ── 3. ENTRY_GAP_UNENTERABLE ──────────────────────────────────────────────────

/**
 * Kurs po 1h uciekł >3% w kierunku alertu (LONG: w górę, SHORT: w dół) → poza chase ±3% z reguł gry real.
 * Alert w sesji, którego slot 1h CRON wypełnił dopiero w następnej sesji (price1hFillTime) → 'AMBIGUOUS':
 * „cena po 1h" jest wtedy ceną z jutra i nie mówi, czy dało się wejść (przegląd 29.09: ELV #2446/#2447).
 */
const entryGapUnenterable: AuditCheck = {
  id: 'ENTRY_GAP_UNENTERABLE',
  severity: 'P2',
  scope: 'ALERT',
  run: (ctx): CheckResult => {
    const a = ctx.alert;
    const direction = a.alertDirection;
    if (direction !== 'positive' && direction !== 'negative') return null;
    const priceAtAlert = toNumber(a.priceAtAlert);
    const price1h = toNumber(a.price1h);
    if (priceAtAlert === null || price1h === null || priceAtAlert <= 0) return null;
    const move = (price1h - priceAtAlert) / priceAtAlert;
    const gapPct = direction === 'positive' ? move : -move;
    if (gapPct <= ENTRY_GAP_THRESHOLD) return null;
    const sentAt = new Date(a.sentAt);
    const fillAt = price1hFillTime(sentAt);
    const inSession = isNyseOpen(sentAt);
    if (inSession && (fillAt === null || fillAt.getTime() - sentAt.getTime() > SAME_SESSION_MAX_LAG_MS)) {
      return 'AMBIGUOUS';
    }
    return draft(
      ctx,
      entryGapUnenterable.id,
      entryGapUnenterable.severity,
      `Kurs uciekł ${pct(gapPct)} w kierunku alertu (${direction === 'positive' ? 'LONG' : 'SHORT'}) między ceną alertu (${priceAtAlert}) a ceną po 1h (${price1h}) — powyżej chase 3%, sygnał niewchodzalny`,
      {
        direction,
        gapPct,
        priceAtAlert,
        price1h,
        threshold: ENTRY_GAP_THRESHOLD,
        price1hAt: fillAt?.toISOString() ?? null,
        sentInSession: inSession,
      },
    );
  },
};

// ── 4. ALERT_TEXT_TRUNCATED ───────────────────────────────────────────────────

/** Każdy szablon formattera kończy się stopką `⏰ …`; jej brak w ostatniej linii = tekst urwany. */
const alertTextTruncated: AuditCheck = {
  id: 'ALERT_TEXT_TRUNCATED',
  severity: 'P2',
  scope: 'ALERT',
  run: (ctx): CheckResult => {
    const lines = ctx.alert.message.trimEnd().split('\n');
    const lastLine = lines[lines.length - 1];
    if (lastLine.startsWith('⏰')) return null;
    return draft(
      ctx,
      alertTextTruncated.id,
      alertTextTruncated.severity,
      'Ostatnia linia wiadomości nie jest stopką „⏰" — tekst alertu urwany',
      { lastLine: lastLine.slice(-80), lines: lines.length, length: ctx.alert.message.length },
    );
  },
};

// ── 5. GPT_CONCLUSION_TRUNCATED ───────────────────────────────────────────────

/** `gptAnalysis.conclusion` bez końca zdania → model uciął odpowiedź (max_tokens) albo parser obciął tekst. */
const gptConclusionTruncated: AuditCheck = {
  id: 'GPT_CONCLUSION_TRUNCATED',
  severity: 'P2',
  scope: 'ALERT',
  run: (ctx): CheckResult => {
    const conclusion = readString(ctx.filing?.gptAnalysis, 'conclusion');
    if (conclusion === null) return null;
    const trimmed = conclusion.trim();
    if (trimmed === '' || SENTENCE_END_RE.test(trimmed)) return null;
    return draft(
      ctx,
      gptConclusionTruncated.id,
      gptConclusionTruncated.severity,
      'Wniosek GPT (gptAnalysis.conclusion) nie kończy się końcem zdania — odpowiedź modelu prawdopodobnie ucięta',
      { conclusionTail: trimmed.slice(-60), filingId: ctx.filing?.id ?? null },
    );
  },
};

// ── 6. ESCAPE_MISSING ─────────────────────────────────────────────────────────

/**
 * Po zdjęciu linków `[tekst](url)` (zostaje tekst) i par `*…*` / `_…_` (zostaje treść) każdy niezescapowany
 * znak zarezerwowany MarkdownV2 — w tym niesparowany `*`/`_` — = Telegram odrzuci wiadomość
 * (bug raportu 8h 02-05.07.2026: `\(`→`(`; „Can't find end of the entity" dla nieparzystych znaczników).
 */
const escapeMissing: AuditCheck = {
  id: 'ESCAPE_MISSING',
  severity: 'P1',
  scope: 'ALERT',
  run: (ctx): CheckResult => {
    const stripped = ctx.alert.message
      .replace(LINK_RE, '$1')
      .replace(BOLD_PAIR_RE, '$1')
      .replace(ITALIC_PAIR_RE, '$1');
    const samples: { char: string; at: number; context: string }[] = [];
    let count = 0;
    for (const m of stripped.matchAll(UNESCAPED_RESERVED_RE)) {
      count++;
      if (samples.length < MAX_ESCAPE_SAMPLES) {
        samples.push({ char: m[0], at: m.index, context: stripped.slice(Math.max(0, m.index - 15), m.index + 15) });
      }
    }
    if (count === 0) return null;
    return draft(
      ctx,
      escapeMissing.id,
      escapeMissing.severity,
      `${count} niezescapowanych znaków MarkdownV2 w treści (pierwszy: „${samples[0].char}" w „${samples[0].context}") — Telegram odrzuci taką wiadomość`,
      { count, samples },
    );
  },
};

// ── 7. TRANSACTION_TYPE_MISMATCH ──────────────────────────────────────────────

/**
 * Nagłówek alertu Form 4 (insider + „Transakcja: TYP" + „Plan 10b5-1: TAK/NIE") vs insider_trades tego
 * insidera (okno 14d po transactionDate LUB transakcja zebrana tuż przed alertem). Brak nagłówka lub brak
 * transakcji tej osoby (joint filers, inna forma nazwiska) → AMBIGUOUS (LLM w 04). Żadna transakcja
 * oczekiwanego typu → P1; wiadomość mówi „NIE", a WSZYSTKIE transakcje tego typu mają is10b51Plan=true → P1,
 * chyba że alert jest sprzed backfillu 10.06.2026 (znany incydent) → INFO.
 */
const transactionTypeMismatch: AuditCheck = {
  id: 'TRANSACTION_TYPE_MISMATCH',
  severity: 'P1',
  scope: 'ALERT',
  run: (ctx): CheckResult => {
    const a = ctx.alert;
    if (!a.ruleName.startsWith('Form 4 Insider')) return null;
    const header = INSIDER_HEADER_RE.exec(a.message);
    const tx = TRANSACTION_LINE_RE.exec(a.message);
    if (header === null || tx === null) return 'AMBIGUOUS';
    const insiderName = unescapeMarkdownV2(header[1]);
    const expectedType = tx[1];
    const messagePlan = PLAN_LINE_RE.exec(a.message)?.[1] ?? null;

    const wanted = normalizeName(insiderName);
    const candidates = ctx.trades.filter((t) => normalizeName(t.insiderName) === wanted);
    if (candidates.length === 0) return 'AMBIGUOUS';

    const evidence = { insiderName, expectedType, messagePlan, candidates: candidates.map(tradeSummary) };
    const sameType = candidates.filter((t) => t.transactionType === expectedType);
    if (sameType.length === 0) {
      const types = [...new Set(candidates.map((t) => t.transactionType))].join(', ');
      return draft(
        ctx,
        transactionTypeMismatch.id,
        transactionTypeMismatch.severity,
        `Alert mówi „${expectedType}" dla ${insiderName}, a w insider_trades ta osoba ma tylko: ${types}`,
        { ...evidence, reason: 'NO_TRADE_OF_TYPE' },
      );
    }
    if (messagePlan === 'NIE' && sameType.every((t) => t.is10b51Plan === true)) {
      const preBackfill = new Date(a.sentAt).getTime() < PLAN_FLAG_BACKFILL_AT.getTime();
      return draft(
        ctx,
        transactionTypeMismatch.id,
        preBackfill ? 'INFO' : transactionTypeMismatch.severity,
        `Alert mówi „Plan 10b5-1: NIE", a każda transakcja ${expectedType} insidera ${insiderName} ma is10b51Plan=true` +
          (preBackfill ? ' (alert sprzed backfillu 10b5-1 z 10.06.2026 — znany incydent)' : ''),
        { ...evidence, reason: preBackfill ? 'PLAN_FLAG_MISMATCH_PRE_BACKFILL' : 'PLAN_FLAG_MISMATCH' },
      );
    }
    return null;
  },
};

// ── 8. STALE_TEMPLATE_DATE ────────────────────────────────────────────────────

/** Data „przegląd (okna obs) ~DD.MM[.RRRR]" w treści starsza niż 30 dni od wysyłki = szablon nieodświeżony. */
const staleTemplateDate: AuditCheck = {
  id: 'STALE_TEMPLATE_DATE',
  severity: 'INFO',
  scope: 'ALERT',
  run: (ctx): CheckResult => {
    const m = TEMPLATE_DATE_RE.exec(ctx.alert.message);
    if (m === null) return null;
    const sentAt = new Date(ctx.alert.sentAt);
    const day = Number(m[1]);
    const month = Number(m[2]) - 1;
    // grupa opcjonalna: TS typuje m[3] jako string (bez noUncheckedIndexedAccess), w runtime bywa undefined;
    // adnotacja typu nie wystarczy (control-flow zawęża z powrotem do string) — stąd rzutowanie rozszerzające
    const year = m[3] as string | undefined;
    let templateDate: Date;
    if (year === undefined) {
      // realny ping discovery nie ma roku: bierzemy rok wysyłki, a jeśli data wypada w przyszłości — poprzedni
      templateDate = new Date(Date.UTC(sentAt.getUTCFullYear(), month, day));
      if (templateDate.getTime() > sentAt.getTime()) {
        templateDate = new Date(Date.UTC(sentAt.getUTCFullYear() - 1, month, day));
      }
    } else {
      templateDate = new Date(Date.UTC(Number(year), month, day));
    }
    if (Number.isNaN(templateDate.getTime())) return null;
    const ageDays = (sentAt.getTime() - templateDate.getTime()) / DAY_MS;
    if (ageDays <= STALE_TEMPLATE_DAYS) return null;
    const label = templateDate.toISOString().slice(0, 10);
    return draft(
      ctx,
      staleTemplateDate.id,
      staleTemplateDate.severity,
      `Treść odwołuje się do przeglądu z ${label}, czyli ${Math.floor(ageDays)} dni przed wysyłką — przeterminowany szablon`,
      { templateDate: label, yearInText: year !== undefined, sentAt: sentAt.toISOString(), ageDays, matched: m[0] },
    );
  },
};

// ── 9. PREVIOUSLY_ANNOUNCED_8K ────────────────────────────────────────────────

/** 8-K z ceną wejścia, którego treść/summary mówi „previously announced" / „wcześniej ogłoszone" — rynek już to wycenił. */
const previouslyAnnounced8k: AuditCheck = {
  id: 'PREVIOUSLY_ANNOUNCED_8K',
  severity: 'P2',
  scope: 'ALERT',
  run: (ctx): CheckResult => {
    const a = ctx.alert;
    if (!a.ruleName.startsWith('8-K') || toNumber(a.priceAtAlert) === null) return null;
    const inMessage = PREVIOUSLY_ANNOUNCED_RE.exec(a.message);
    const summary = readString(ctx.filing?.gptAnalysis, 'summary');
    const inSummary = summary === null ? null : PREVIOUSLY_ANNOUNCED_RE.exec(summary);
    const hit = inMessage ?? inSummary;
    if (hit === null) return null;
    const matchedIn = inMessage !== null ? 'message' : 'gptAnalysis.summary';
    const source = matchedIn === 'message' ? a.message : (summary ?? '');
    return draft(
      ctx,
      previouslyAnnounced8k.id,
      previouslyAnnounced8k.severity,
      `Zdarzenie 8-K opisane jako „${hit[0]}" — informacja była już publiczna, cena wejścia bez edge'u`,
      { matchedIn, snippet: source.slice(Math.max(0, hit.index - 60), hit.index + 60) },
    );
  },
};

// ── 10. POST_CLOSE_8K_ENTRY_PRICE ─────────────────────────────────────────────

/**
 * 8-K z priceAtAlert wysłany poza sesją NYSE → „wejście" to ostatnie zamknięcie, realne wejście = gap na otwarciu.
 * Dotyczy ~94% 8-K (CRON :05/:35 trafia w pre/post-market), więc P2 tylko dla dostarczonych; stłumione → INFO.
 */
const postClose8kEntryPrice: AuditCheck = {
  id: 'POST_CLOSE_8K_ENTRY_PRICE',
  severity: 'P2',
  scope: 'ALERT',
  run: (ctx): CheckResult => {
    const a = ctx.alert;
    if (!a.ruleName.startsWith('8-K')) return null;
    const priceAtAlert = toNumber(a.priceAtAlert);
    if (priceAtAlert === null) return null;
    const sentAt = new Date(a.sentAt);
    if (isNyseOpen(sentAt)) return null;
    const price1h = toNumber(a.price1h);
    const gapPct = price1h === null || priceAtAlert <= 0 ? null : (price1h - priceAtAlert) / priceAtAlert;
    return draft(
      ctx,
      postClose8kEntryPrice.id,
      a.delivered ? postClose8kEntryPrice.severity : 'INFO',
      `8-K wysłany poza sesją NYSE (${NY_TIME_FMT.format(sentAt)} NY) — cena wejścia ${priceAtAlert} to ostatnie zamknięcie${gapPct === null ? '' : `, po 1h ${pct(gapPct)}`}`,
      { sentAt: sentAt.toISOString(), sentAtNy: NY_TIME_FMT.format(sentAt), priceAtAlert, price1h, gapPct, delivered: a.delivered },
    );
  },
};

// ── 11. PRICE_LABEL_AMBIGUOUS (globalny) ─────────────────────────────────────

/** Linia „Transakcja: BUY 39,231 akcji @ $998,821.26" — po `@` stoi wartość łączna, nie cena/akcję. */
const priceLabelAmbiguous: AuditCheck = {
  id: 'PRICE_LABEL_AMBIGUOUS',
  severity: 'INFO',
  scope: 'GLOBAL',
  run: (ctx): CheckResult => {
    const m = PRICE_LABEL_LINE_RE.exec(ctx.alert.message);
    if (m === null) return null;
    return globalDraft(
      priceLabelAmbiguous.id,
      priceLabelAmbiguous.severity,
      'Linia „Transakcja: … akcji @ $X" pokazuje wartość łączną transakcji, nie cenę za akcję — etykieta myląca (formatter Form 4)',
      { where: PRICE_LABEL_FORMATTER_REF, exampleAlertId: ctx.alert.id, exampleLine: m[0] },
    );
  },
};

// ── 12. CONCLUSION_CUT_AT_300 (globalny) ─────────────────────────────────────

/** Linia wniosku w Telegramie ucięta do 300 znaków w pół zdania (109/144 realnych alertów, przegląd 29.09). */
const conclusionCutAt300: AuditCheck = {
  id: 'CONCLUSION_CUT_AT_300',
  severity: 'INFO',
  scope: 'GLOBAL',
  run: (ctx): CheckResult => {
    const m = CONCLUSION_LINE_RE.exec(ctx.alert.message);
    if (m === null) return null;
    const line = unescapeMarkdownV2(m[1]);
    if (line.length < CONCLUSION_CUT_LENGTH || SENTENCE_END_RE.test(line.trim())) return null;
    return globalDraft(
      conclusionCutAt300.id,
      conclusionCutAt300.severity,
      `Wniosek GPT w Telegramie ucinany do ${CONCLUSION_CUT_LENGTH} znaków w pół zdania (substring w formatterze) — czytelnik nie widzi końca argumentu`,
      { where: CONCLUSION_CUT_FORMATTER_REF, exampleAlertId: ctx.alert.id, exampleTail: line.slice(-40) },
    );
  },
};

// ── 13. PIPELINE_VERSION_UNKNOWN (globalny) ──────────────────────────────────

/** Runtime nie zna git SHA → agent_findings.pipelineVersion zawsze null; nie da się przypisać findingu do wersji kodu. */
const pipelineVersionUnknown: AuditCheck = {
  id: 'PIPELINE_VERSION_UNKNOWN',
  severity: 'INFO',
  scope: 'GLOBAL',
  run: (ctx): CheckResult =>
    globalDraft(
      pipelineVersionUnknown.id,
      pipelineVersionUnknown.severity,
      'Brak git SHA w runtime (env/build arg) — findingów nie da się przypisać do wersji pipeline’u (pipelineVersion zawsze null)',
      { reason: 'brak git SHA w runtime', exampleAlertId: ctx.alert.id },
    ),
};

// ── Rejestr i runner ──────────────────────────────────────────────────────────

/** Checki per alert (unique (alertId, checkId) w agent_findings). */
export const ALERT_CHECKS: readonly AuditCheck[] = [
  priceFrozen,
  outcomeDoneEmpty,
  entryGapUnenterable,
  alertTextTruncated,
  gptConclusionTruncated,
  escapeMissing,
  transactionTypeMismatch,
  staleTemplateDate,
  previouslyAnnounced8k,
  postClose8kEntryPrice,
];

/** Checki globalne (alertId=null) — orkiestrator zapisuje każdy raz. */
export const GLOBAL_CHECKS: readonly AuditCheck[] = [priceLabelAmbiguous, conclusionCutAt300, pipelineVersionUnknown];

export interface CheckError {
  readonly checkId: string;
  readonly message: string;
}

export interface AlertChecksOutcome {
  readonly findings: FindingDraft[];
  /** checkId checków, które zwróciły 'AMBIGUOUS'. */
  readonly ambiguous: string[];
  readonly checksRun: string[];
  /** Checki, które rzuciły wyjątkiem (izolowane — reszta wyników zostaje). */
  readonly checkErrors: CheckError[];
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function runAlertChecks(ctx: AuditContext): AlertChecksOutcome {
  const findings: FindingDraft[] = [];
  const ambiguous: string[] = [];
  const checkErrors: CheckError[] = [];
  for (const check of ALERT_CHECKS) {
    try {
      const result = check.run(ctx);
      if (result === null) continue;
      if (result === 'AMBIGUOUS') ambiguous.push(check.id);
      else findings.push(result);
    } catch (err) {
      checkErrors.push({ checkId: check.id, message: errorMessage(err) });
    }
  }
  return { findings, ambiguous, checksRun: ALERT_CHECKS.map((c) => c.id), checkErrors };
}

export function runGlobalChecks(ctx: AuditContext): FindingDraft[] {
  const findings: FindingDraft[] = [];
  for (const check of GLOBAL_CHECKS) {
    try {
      const result = check.run(ctx);
      if (result !== null && result !== 'AMBIGUOUS') findings.push(result);
    } catch {
      // globalne checki są informacyjne — wyjątek nie może zatrzymać audytu alertu
    }
  }
  return findings;
}
