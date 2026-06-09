import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { SecFiling, Ticker } from '../../entities';
import { SecEdgarService } from '../sec-edgar/sec-edgar.service';
import { FinnhubService } from '../finnhub/finnhub.service';
import { parseForm4Xml, Form4Transaction } from '../sec-edgar/form4-parser';
import { isCsuiteRole, isDirectorRole } from '../../sec-filings/pipelines/form4.pipeline';
import { EventType } from '../../events/event-types';
import { Logged } from '../../common/decorators/logged.decorator';
import { DISCOVERY_REDIS } from './redis.provider';

/**
 * Pakiet 2 (10.06.2026): event-driven discovery Form 4 sector-wide healthcare/biotech.
 * Plan: doc/PLAN-EDGE-IMPROVEMENTS-2026-06-09.md §2.P2 + §3 Pakiet 2.
 *
 * Problem: lejek jedynej działającej reguły (Form 4 Insider BUY) głoduje u źródła —
 * 28-tickerowe uniwersum core daje 1-2 discretionary BUY/miesiąc. Podaż rynkowa
 * (zweryfikowana przez OpenInsider w badaniu 09.06): healthcare/biotech BUY >= $500K
 * ~50/30d → po filtrach ról/mcap realnie 2-5 kandydatów/tydzień = lejek ×8-20.
 *
 * Architektura:
 *   1. POLL: atom `getcurrent` co 5 min (cap 100 wpisów, paginacja nie działa —
 *      zweryfikowane na żywo; każdy filing = 2 wpisy Issuer+Reporting, dedup po
 *      accession, CIK emitenta z wpisu "(Issuer)").
 *   2. PRE-FILTER deterministyczny (zero LLM): SIC healthcare/biotech (submissions
 *      JSON, cache Redis 30d) → ticker poza obecnym uniwersum → XML Form 4:
 *      discretionary BUY (kod P, aff10b5One=0 — działa od fixu P1-00) >= $500K
 *      od C-suite/Director (czyści 10% ownerzy odrzucani — 86% szumu w all-market).
 *   3. ENRICH: Finnhub mcap >= $250M + ADV >= $1M (10d avg vol × cena).
 *   4. AUTO-REJESTRACJA: tickers INSERT z observationOnly=true,
 *      sector='healthcare_discovery' → standardowy Form4Pipeline (GPT analiza,
 *      DB-only alert z nonDeliveryReason='observation', ZERO correlation legs).
 *   5. RECONCILIATION: nightly daily-index form.YYYYMMDD.idx (łapie burst overflow
 *      ponad cap 100; ~1900 Form 4/dzień rynkowo).
 *
 * Delivery: NIE w tym wdrożeniu. Okno obserwacyjne 30-60d (przegląd ~25.07.2026),
 * potem top-N ranking (max 1-2/tydzień najwyższy conviction) — open gate odtworzyłby
 * problem szumu, który Pakiet 1 właśnie naprawił.
 */

/** Próg wartości BUY dla discovery (= APLS_MIN_BUY_VALUE; core zostaje na $100K) */
export const DISCOVERY_MIN_BUY_VALUE = 500_000;
/** Minimalna kapitalizacja (mln USD) — odcina pump-class micro-capy */
export const DISCOVERY_MIN_MCAP_MLN = 250;
/** Minimalny dzienny obrót USD (10d avg vol × cena) — płynność wykonywalna */
export const DISCOVERY_MIN_ADV_USD = 1_000_000;
/** Cap rejestracji/dzień — bezpiecznik na pump-storm (oczekiwane 2-5/TYDZIEŃ) */
export const DISCOVERY_MAX_REGISTRATIONS_PER_DAY = 5;

/**
 * SIC whitelist healthcare/biotech. Źródło: klasyfikacja SEC SIC.
 * 283x pharma/biologics, 384x+3851 devices, 3826 lab instruments, 5047/5122
 * dystrybucja medyczna, 6324 HMO (UNH/HUM/MOH-class), 80xx health services,
 * 8731 commercial biological research (pre-commercial biotech często tutaj).
 *
 * ŚWIADOME wykluczenia (weryfikacja adwersarialna 10.06.2026):
 *  - 7372 Prepackaged Software (health IT, VEEV-class) — teza insider-BUY
 *    dotyczy spółek product/clinical, nie SaaS; VEEV był soft-deleted z core.
 *  - 5912 Drug Stores (CVS/WBA-class retail) — CVS/WBA soft-deleted Sprint 16
 *    (backtest-production mismatch); retail apteczny to nie healthcare edge.
 */
export const HEALTHCARE_SICS = new Set([
  '2833', '2834', '2835', '2836',
  '3826', '3841', '3842', '3843', '3844', '3845', '3851',
  '5047', '5122',
  '6324',
  '8000', '8011', '8049', '8050', '8051', '8060', '8062', '8071',
  '8082', '8090', '8093', '8099',
  '8731',
]);

export function isHealthcareSic(sic: string | number | null | undefined): boolean {
  if (sic == null) return false;
  return HEALTHCARE_SICS.has(String(sic).trim());
}

export interface AtomFilingEntry {
  accession: string;
  issuerCik: string;
  issuerName: string;
  /** Data filingu z summary atomu (Filed: YYYY-MM-DD) — do SecFiling.filingDate */
  filedDate: string | null;
}

/**
 * Parsuje atom getcurrent — bierze TYLKO wpisy "(Issuer)" (dają CIK emitenta;
 * wpisy "(Reporting)" mają CIK insidera), dedup po accession.
 *
 * Form 4/A (amendmenty) ŚWIADOMIE wykluczone (weryfikacja 10.06.2026): amendment
 * może korygować filing sprzed miesięcy — bez recency-check zarejestrowałby
 * ticker na stęchłym sygnale BUY i wyemitował NEW_INSIDER_TRADE z historyczną
 * datą. Oryginalne Form 4 z getcurrent są świeże z natury (deadline T+2).
 * Spójne z parseDailyIndexForm4 (startsWith('4 ')) i core collectorem
 * (importantForms bez '4/A').
 */
export function parseGetCurrentAtom(xml: string): AtomFilingEntry[] {
  const out = new Map<string, AtomFilingEntry>();
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(xml)) !== null) {
    const entry = m[1];
    const titleM = entry.match(/<title>4 - (.*?) \((\d{10})\) \(Issuer\)<\/title>/);
    if (!titleM) continue;
    const accM = entry.match(/accession-number=(\d{10}-\d{2}-\d{6})/);
    if (!accM) continue;
    const filedM = entry.match(/Filed:&lt;\/b&gt;\s*(\d{4}-\d{2}-\d{2})/);
    if (!out.has(accM[1])) {
      out.set(accM[1], {
        accession: accM[1],
        issuerCik: titleM[2],
        issuerName: titleM[1],
        filedDate: filedM ? filedM[1] : null,
      });
    }
  }
  return [...out.values()];
}

/**
 * Parsuje daily-index form.YYYYMMDD.idx — wiersze z form type dokładnie "4".
 * Format fixed-width; bezpieczna ekstrakcja: ścieżka edgar/data/{cik}/{accession}.txt
 * na końcu wiersza.
 *
 * UWAGA (P1 z weryfikacji 10.06.2026, zmierzone na żywym form.20260608.idx:
 * 1888 wierszy '^4 ' = 890 unikalnych accessionów): każdy filing występuje
 * RAZ z CIK emitenta i RAZ+ z CIK reporting-ownera (osoby), posortowane
 * alfabetycznie po NAZWIE — w ~połowie przypadków wiersz osoby poprzedza
 * wiersz emitenta. NIE dedupujemy tutaj po accession (nie wiemy, który CIK
 * to emitent) — rozstrzyga processAccession: CIK osoby ma w submissions
 * sic='' i tickers=[] → zwraca false BEZ markSeen, więc wiersz emitenta
 * (ten sam accession, inny CIK) zostaje normalnie przetworzony.
 */
export function parseDailyIndexForm4(
  text: string,
): Array<{ accession: string; cik: string; dateFiled: string | null }> {
  const out: Array<{ accession: string; cik: string; dateFiled: string | null }> = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('4 ')) continue; // dokładnie '4' (nie 4/A, nie 424B5)
    const pathM = line.match(/(\d{8})?\s+edgar\/data\/(\d+)\/(\d{10}-\d{2}-\d{6})\.txt\s*$/);
    if (pathM) {
      const d = pathM[1];
      out.push({
        cik: pathM[2].padStart(10, '0'),
        accession: pathM[3],
        dateFiled: d ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null,
      });
    }
  }
  return out;
}

export interface PrefilterResult {
  pass: boolean;
  reason: string;
  /** Największa discretionary BUY grupa (per insider) w filingu */
  buyValue: number;
  insiderName: string | null;
  insiderRole: string | null;
}

/**
 * Deterministyczny pre-filter transakcji Form 4 (zero LLM):
 *   - discretionary BUY (kod P → transactionType 'BUY', is10b51Plan=false),
 *   - agregacja per insider w obrębie filingu (semantyka TASK-03),
 *   - max grupa >= DISCOVERY_MIN_BUY_VALUE,
 *   - rola: C-suite LUB Director; czyści 10% ownerzy bez roli wykonawczej
 *     odrzucani (badanie 09.06: 86% all-market BUY to 10% ownerzy = szum).
 */
export function prefilterForm4Buy(transactions: Form4Transaction[]): PrefilterResult {
  const buys = transactions.filter(
    (t) => t.transactionType === 'BUY' && !t.is10b51Plan,
  );
  if (buys.length === 0) {
    return { pass: false, reason: 'no_discretionary_buy', buyValue: 0, insiderName: null, insiderRole: null };
  }

  const byInsider = new Map<string, { value: number; role: string | null }>();
  for (const t of buys) {
    const cur = byInsider.get(t.insiderName) ?? { value: 0, role: t.insiderRole };
    cur.value += t.totalValue;
    byInsider.set(t.insiderName, cur);
  }

  let best: { name: string; value: number; role: string | null } | null = null;
  for (const [name, v] of byInsider) {
    // ROLA-only (bez insiderName!): isCsuiteRole z name matchowałby wzorce na
    // nazwie entity ("PRESIDENT AND FELLOWS OF HARVARD COLLEGE", "CSO CAPITAL LP"
    // — realni 10% ownerzy biotechów) i wpuszczał fund-BUY jako C-suite.
    // Weryfikacja adwersarialna 10.06.2026 wykazała tę dziurę wykonaniem.
    const hasExecRole = isCsuiteRole(v.role ?? '') || isDirectorRole(v.role ?? '');
    if (!hasExecRole) continue; // czysty 10% Owner / brak roli → odpada
    if (!best || v.value > best.value) best = { name, value: v.value, role: v.role };
  }

  if (!best) {
    return { pass: false, reason: 'no_exec_role_buy', buyValue: 0, insiderName: null, insiderRole: null };
  }
  if (best.value < DISCOVERY_MIN_BUY_VALUE) {
    return {
      pass: false,
      reason: 'below_value_threshold',
      buyValue: best.value,
      insiderName: best.name,
      insiderRole: best.role,
    };
  }
  return { pass: true, reason: 'ok', buyValue: best.value, insiderName: best.name, insiderRole: best.role };
}

const SEC_FETCH_TIMEOUT_MS = 15_000;
const SEC_DELAY_MS = 160; // ~4-5 req/s przy 2 fetchach per filing (limit SEC: 10/s)
const POLL_BUDGET_MS = 4 * 60_000; // < 5-min interwał — cykle się nie nakładają
const RECON_BUDGET_MS = 25 * 60_000;
const SEEN_TTL_S = 7 * 24 * 3600;
const SIC_CACHE_TTL_S = 30 * 24 * 3600;

@Injectable()
export class Form4DiscoveryService {
  private readonly logger = new Logger(Form4DiscoveryService.name);
  private readonly userAgent: string;

  constructor(
    @InjectRepository(Ticker)
    private readonly tickerRepo: Repository<Ticker>,
    @InjectRepository(SecFiling)
    private readonly filingRepo: Repository<SecFiling>,
    private readonly secEdgar: SecEdgarService,
    private readonly finnhub: FinnhubService,
    private readonly config: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(DISCOVERY_REDIS) private readonly redis: Redis,
  ) {
    this.userAgent = this.config.get<string>(
      'SEC_USER_AGENT',
      'StockPulse research contact@example.com',
    );
  }

  /**
   * POLL co 5 min: atom getcurrent → nowe accessiony → processAccession.
   */
  @Logged('collectors')
  async runDiscoveryCycle(): Promise<{
    collector: string;
    entries: number;
    fresh: number;
    registered: number;
    action?: string;
  }> {
    const budget = new AbortController();
    const budgetTimer = setTimeout(() => budget.abort(), POLL_BUDGET_MS);
    try {
      const xml = await this.fetchText(
        'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&company=&dateb=&owner=include&count=100&output=atom',
        budget.signal,
      );
      const entries = parseGetCurrentAtom(xml);
      if (entries.length === 0) {
        // HTTP OK ale 0 wpisów Issuer — struktura strony mogła się zmienić (wzorzec TASK-06 PARSER_EMPTY)
        this.logger.warn('Discovery: atom getcurrent zwrócił 0 wpisów Issuer — sprawdź format');
        return { collector: 'FORM4_DISCOVERY', entries: 0, fresh: 0, registered: 0, action: 'PARSER_EMPTY' };
      }

      let fresh = 0;
      let registered = 0;
      for (const entry of entries) {
        if (budget.signal.aborted) break;
        if (await this.isSeen(entry.accession)) continue;
        fresh++;
        const didRegister = await this.processAccession(
          entry.accession, entry.issuerCik, budget.signal, entry.filedDate,
        );
        if (didRegister) registered++;
      }
      return { collector: 'FORM4_DISCOVERY', entries: entries.length, fresh, registered };
    } finally {
      clearTimeout(budgetTimer);
    }
  }

  /**
   * RECONCILIATION nightly: daily-index form.YYYYMMDD.idx (dzień wg ET) —
   * łapie burst overflow ponad cap 100 wpisów atomu.
   */
  @Logged('collectors')
  async runReconciliation(): Promise<{
    collector: string;
    indexed: number;
    fresh: number;
    registered: number;
    action?: string;
  }> {
    const budget = new AbortController();
    const budgetTimer = setTimeout(() => budget.abort(), RECON_BUDGET_MS);
    try {
      // Data wg America/New_York — reconciliation odpala 22:40 ET tego samego dnia.
      // Fallback na poprzedni dzień: gdyby plik nie był jeszcze opublikowany
      // (timing/święto) — idempotentne dzięki seen-dedup, koszt ~zero.
      const candidates = [this.etDateOffset(0), this.etDateOffset(-1)];
      let text: string | null = null;
      let usedDate: string | null = null;
      for (const dateStr of candidates) {
        try {
          text = await this.fetchText(this.buildDailyIndexUrl(dateStr), budget.signal);
          usedDate = dateStr;
          break;
        } catch (err) {
          this.logger.debug(`Discovery reconciliation: brak daily-index ${dateStr} (${(err as Error).message})`);
        }
      }
      if (text === null) {
        return { collector: 'FORM4_DISCOVERY', indexed: 0, fresh: 0, registered: 0, action: 'NO_DAILY_INDEX' };
      }
      this.logger.log(`Discovery reconciliation: daily-index ${usedDate}`);

      const rows = parseDailyIndexForm4(text);
      let fresh = 0;
      let registered = 0;
      for (const row of rows) {
        if (budget.signal.aborted) {
          this.logger.warn(`Discovery reconciliation: budżet ${RECON_BUDGET_MS / 60000} min wyczerpany — ${fresh} fresh przetworzone`);
          break;
        }
        if (await this.isSeen(row.accession)) continue;
        fresh++;
        const didRegister = await this.processAccession(row.accession, row.cik, budget.signal, row.dateFiled);
        if (didRegister) registered++;
      }
      return { collector: 'FORM4_DISCOVERY', indexed: rows.length, fresh, registered };
    } finally {
      clearTimeout(budgetTimer);
    }
  }

  /**
   * Wspólna ścieżka kandydata. Zwraca true gdy ticker zarejestrowany + filing
   * przekazany do standardowego flow. Kolejność filtrów od najtańszego:
   * SIC (cache) → uniwersum → XML pre-filter → Finnhub mcap/ADV → rejestracja.
   * markSeen TYLKO przy deterministycznym wyniku — błędy HTTP zostawiają
   * accession do retry w następnym cyklu/reconciliation.
   */
  private async processAccession(
    accession: string,
    cik: string,
    signal: AbortSignal,
    filedDate?: string | null,
  ): Promise<boolean> {
    try {
      // 1. SIC + metadane emitenta (cache Redis 30d — submissions JSON jest ciężki)
      const meta = await this.getIssuerMeta(cik, signal);
      if (!meta) return false; // błąd HTTP → retry później (bez markSeen)

      // P1 z weryfikacji 10.06.2026: w daily-index ten sam accession występuje
      // też z CIK reporting-OWNERA (osoby) — submissions osoby mają sic='' i
      // tickers=[]. NIE markSeen: wiersz EMITENTA (ten sam accession, inny CIK)
      // musi zostać normalnie przetworzony. Bez tego guarda reconciliation
      // gubiła ~50% filingów (rzut monetą po alfabecie nazwisk).
      if (!meta.sic && !meta.ticker) {
        return false;
      }

      if (!isHealthcareSic(meta.sic)) {
        await this.markSeen(accession);
        return false;
      }
      // "Exchange-listed" ze spec: OTC/Pink nie przechodzi (płynność/jakość danych)
      if (!meta.ticker || !meta.exchange || /OTC|PINK/i.test(meta.exchange)) {
        await this.markSeen(accession);
        return false;
      }

      // 2. Ticker już w uniwersum (core/semi/APLS/discovery, też soft-deleted) →
      //    core collector go obsługuje albo świadomie wyłączyliśmy — nie ruszamy.
      const existing = await this.tickerRepo.findOne({ where: { symbol: meta.ticker } });
      if (existing) {
        await this.markSeen(accession);
        return false;
      }

      // 3. XML Form 4 → deterministyczny pre-filter
      const xmlUrl = await this.resolveRawXmlUrl(cik, accession, signal);
      if (!xmlUrl) {
        await this.markSeen(accession); // index.json bez XML = nietypowy filing, skip
        return false;
      }
      await this.delay(SEC_DELAY_MS);
      const xml = await this.fetchText(xmlUrl, signal);
      const transactions = parseForm4Xml(xml);
      const pre = prefilterForm4Buy(transactions);
      if (!pre.pass) {
        await this.markSeen(accession);
        return false;
      }

      this.logger.log(
        `Discovery kandydat: ${meta.ticker} (${meta.name ?? cik}, SIC ${meta.sic}) — ` +
          `${pre.insiderName} (${pre.insiderRole ?? '?'}) BUY $${Math.round(pre.buyValue).toLocaleString('en-US')}`,
      );

      // 4. Finnhub: mcap + ADV (3 calls per kandydat — kandydatów 2-5/tydzień).
      // TRANSIENT (null = błąd HTTP/rate-limit/brak danych) ≠ DETERMINISTYCZNY
      // reject (wartość poniżej progu). Null → BEZ markSeen, kandydat wraca
      // w następnym cyklu/reconciliation (weryfikacja 10.06: 429 Finnhuba
      // gubił kandydata permanentnie, łamiąc invariant retry).
      const profile = await this.finnhub.getCompanyProfile(meta.ticker);
      const mcap = profile?.marketCapMln ?? null;
      if (mcap === null) {
        this.logger.debug(`Discovery: ${meta.ticker} mcap n/a (transient?) — retry później`);
        return false;
      }
      if (mcap < DISCOVERY_MIN_MCAP_MLN) {
        this.logger.log(
          `Discovery odrzucony: ${meta.ticker} mcap ${Math.round(mcap)}M < ${DISCOVERY_MIN_MCAP_MLN}M`,
        );
        await this.markSeen(accession);
        return false;
      }
      const [avgVolMln, price] = await Promise.all([
        this.finnhub.get10DayAvgVolumeMlnShares(meta.ticker),
        this.finnhub.getQuote(meta.ticker),
      ]);
      if (avgVolMln === null || price === null) {
        this.logger.debug(`Discovery: ${meta.ticker} ADV/cena n/a (transient?) — retry później`);
        return false;
      }
      const advUsd = avgVolMln * 1_000_000 * price;
      if (advUsd < DISCOVERY_MIN_ADV_USD) {
        this.logger.log(
          `Discovery odrzucony: ${meta.ticker} ADV $${Math.round(advUsd).toLocaleString('en-US')} < $${DISCOVERY_MIN_ADV_USD.toLocaleString('en-US')}`,
        );
        await this.markSeen(accession);
        return false;
      }

      // 5. Cap rejestracji/dzień (bezpiecznik pump-storm) — licznik Redis po
      // DACIE ET (weryfikacja 10.06: doba UTC resetowała się o 20:00 ET, w środku
      // szczytu filingów 16-19 ET → efektywnie 2× cap). Cap hit → BEZ markSeen:
      // kandydat odroczony (retry następnego dnia jeśli nadal w oknie 7d),
      // nie permanentnie utracony.
      const regKey = `regcount:${this.etDateOffset(0)}`;
      const registeredToday = Number((await this.redis.get(regKey)) ?? 0);
      if (registeredToday >= DISCOVERY_MAX_REGISTRATIONS_PER_DAY) {
        this.logger.warn(
          `Discovery: cap ${DISCOVERY_MAX_REGISTRATIONS_PER_DAY} rejestracji/dzień (ET) osiągnięty — odraczam ${meta.ticker} ($${Math.round(pre.buyValue).toLocaleString('en-US')})`,
        );
        return false;
      }

      // 6. Rejestracja tickera (observation mode, playbook Sprint 17/APLS)
      const ticker = this.tickerRepo.create({
        symbol: meta.ticker,
        name: meta.name ?? meta.ticker,
        cik: cik.padStart(10, '0'),
        subsector: meta.sicDescription ?? `SIC ${meta.sic}`,
        priority: 'LOW',
        sector: 'healthcare_discovery',
        observationOnly: true,
        isActive: true,
        notes:
          `Auto-discovered ${new Date().toISOString().split('T')[0]} (Pakiet 2): ` +
          `${pre.insiderName} BUY $${Math.round(pre.buyValue).toLocaleString('en-US')}, ` +
          `mcap $${Math.round(mcap)}M, ADV $${Math.round(advUsd).toLocaleString('en-US')}`,
      });
      await this.tickerRepo.save(ticker);

      // 7. Filing + trades + eventy przez KANONICZNĄ ścieżkę core collectora
      //    (parseAndSaveForm4: agregacja TASK-03 + NEW_INSIDER_TRADE; Form4Pipeline
      //    zobaczy sector='healthcare_discovery' → GPT + DB-only observation alert).
      //    XML przekazany jako preloaded (pobrany w kroku 3) — krok jest
      //    deterministyczny, bez drugiego fetchu który mógłby paść w połowie
      //    (weryfikacja 10.06: transient błąd w re-fetchu gubił trigger trade
      //    bez możliwości retry, bo filing był już zdedupowany).
      const baseDir = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${accession.replace(/-/g, '')}`;
      const existingFiling = await this.filingRepo.findOne({ where: { accessionNumber: accession } });
      let filingId: number;
      if (existingFiling) {
        filingId = existingFiling.id; // retry po wcześniejszym częściowym przebiegu
      } else {
        const filing = this.filingRepo.create({
          symbol: meta.ticker,
          cik: cik.padStart(10, '0'),
          formType: '4',
          accessionNumber: accession,
          description: 'FORM 4 (discovery)',
          filingDate: filedDate ? new Date(filedDate) : new Date(),
          documentUrl: baseDir,
        });
        await this.filingRepo.save(filing);
        filingId = filing.id;
      }
      const traceId = randomUUID();
      this.eventEmitter.emit(EventType.NEW_FILING, {
        filingId,
        symbol: meta.ticker,
        formType: '4',
        traceId,
      });
      let savedTrades = await this.secEdgar.parseAndSaveForm4(meta.ticker, accession, xmlUrl, traceId, xml);
      if (savedTrades === 0) {
        // DB error w środku (XML preloaded i sparsowany w kroku 3 — to nie
        // parse-fail). Retry przez kolejny cykl NIE zadziała: ticker jest już
        // zarejestrowany, więc krok 2 (check uniwersum) odbije accession;
        // core collector też nie pomoże (filing row już istnieje → dedup skip).
        // Dlatego: 1 inline retry, a po nim ERROR z instrukcją manualną.
        await this.delay(1_000);
        savedTrades = await this.secEdgar.parseAndSaveForm4(meta.ticker, accession, xmlUrl, traceId, xml);
      }
      if (savedTrades === 0) {
        this.logger.error(
          `Discovery DATA GAP: ${meta.ticker} zarejestrowany, ale trades z ${accession} nie zapisane ` +
            `(2 próby). Manualnie: DELETE FROM sec_filings WHERE "accessionNumber"='${accession}' ` +
            `i poczekaj na cykl core collectora.`,
        );
      }

      await this.redis.incr(regKey);
      await this.redis.expire(regKey, 48 * 3600);
      await this.markSeen(accession);
      this.logger.log(
        `Discovery ZAREJESTROWANY: ${meta.ticker} (${meta.name}) — observation mode, ` +
          `przegląd okna obs ~25.07.2026`,
      );
      return true;
    } catch (err) {
      // Błąd → bez markSeen, accession wróci w następnym cyklu / reconciliation
      this.logger.warn(`Discovery processAccession ${accession}: ${(err as Error).message}`);
      return false;
    }
  }

  /** Metadane emitenta z data.sec.gov/submissions (cache Redis 30d). */
  private async getIssuerMeta(cik: string, signal: AbortSignal): Promise<{
    sic: string | null;
    sicDescription: string | null;
    ticker: string | null;
    exchange: string | null;
    name: string | null;
  } | null> {
    const cacheKey = `sic:${cik}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    try {
      await this.delay(SEC_DELAY_MS);
      const raw = await this.fetchText(
        `https://data.sec.gov/submissions/CIK${cik.padStart(10, '0')}.json`,
        signal,
      );
      const d = JSON.parse(raw);
      const meta = {
        sic: d.sic != null ? String(d.sic) : null,
        sicDescription: d.sicDescription ?? null,
        ticker: Array.isArray(d.tickers) && d.tickers.length > 0 ? String(d.tickers[0]).toUpperCase() : null,
        exchange: Array.isArray(d.exchanges) && d.exchanges.length > 0 ? (d.exchanges[0] ?? null) : null,
        name: d.name ?? null,
      };
      await this.redis.set(cacheKey, JSON.stringify(meta), 'EX', SIC_CACHE_TTL_S);
      return meta;
    } catch (err) {
      this.logger.debug(`Discovery getIssuerMeta CIK ${cik}: ${(err as Error).message}`);
      return null;
    }
  }

  /** Surowy XML Form 4 z index.json katalogu filingu. */
  private async resolveRawXmlUrl(cik: string, accession: string, signal: AbortSignal): Promise<string | null> {
    const baseDir = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${accession.replace(/-/g, '')}`;
    await this.delay(SEC_DELAY_MS);
    const raw = await this.fetchText(`${baseDir}/index.json`, signal);
    try {
      const items: Array<{ name: string }> = JSON.parse(raw)?.directory?.item ?? [];
      const xml = items.find(
        (i) => i.name.toLowerCase().endsWith('.xml') && !i.name.includes('/'),
      );
      return xml ? `${baseDir}/${xml.name}` : null;
    } catch {
      return null;
    }
  }

  private async isSeen(accession: string): Promise<boolean> {
    return (await this.redis.exists(`seen:${accession}`)) === 1;
  }

  private async markSeen(accession: string): Promise<void> {
    await this.redis.set(`seen:${accession}`, '1', 'EX', SEEN_TTL_S);
  }

  /** Fetch z User-Agent SEC + timeout per-request + cycle budget (AbortSignal.any). */
  private async fetchText(url: string, cycleSignal: AbortSignal): Promise<string> {
    const res = await fetch(url, {
      headers: { 'User-Agent': this.userAgent, 'Accept-Encoding': 'gzip, deflate' },
      signal: AbortSignal.any([AbortSignal.timeout(SEC_FETCH_TIMEOUT_MS), cycleSignal]),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return res.text();
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Data YYYY-MM-DD wg America/New_York z offsetem dni (0=dziś ET, -1=wczoraj ET) */
  private etDateOffset(days: number): string {
    const d = new Date(Date.now() + days * 24 * 3600_000);
    return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  }

  private buildDailyIndexUrl(etDate: string): string {
    const [y, mo, d] = etDate.split('-');
    const qtr = `QTR${Math.floor((Number(mo) - 1) / 3) + 1}`;
    return `https://www.sec.gov/Archives/edgar/daily-index/${y}/${qtr}/form.${y}${mo}${d}.idx`;
  }
}
