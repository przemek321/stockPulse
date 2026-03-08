# Nowy Pipeline: SEC 8-K i Form 4 z analizą GPT

## Kontekst

Obecny `sec-edgar.service.ts` traktuje wszystkie filingi SEC jednakowo — wysyła alert
"Formularz: 8-K" bez analizy treści i bez oceny wpływu na cenę. Form 4 jest alertowany
na podstawie samej wartości transakcji bez kontekstu (czy to plan 10b5-1? czy CEO kupuje
czy sprzedaje po słabych wynikach?).

Cel tego pipeline'u: każdy filing trafia do GPT z dedykowanym promptem per typ dokumentu,
GPT zwraca strukturalną ocenę wpływu na cenę akcji, system alertuje na podstawie
tej oceny — nie na podstawie samego faktu że filing istnieje.

---

## Architektura

### Nowe moduły NestJS (osobne od istniejącego sec-edgar)

```
src/
  sec-filings/
    sec-filings.module.ts
    pipelines/
      form4.pipeline.ts        ← Form 4 (insider trades)
      form8k.pipeline.ts       ← 8-K (material events)
    prompts/
      form4.prompt.ts          ← prompt dla Form 4
      form8k-1-01.prompt.ts    ← umowa materialna
      form8k-2-02.prompt.ts    ← wyniki kwartalne
      form8k-5-02.prompt.ts    ← zmiana CEO/CFO
      form8k-other.prompt.ts   ← Items 7.01, 8.01 i inne
    parsers/
      form4.parser.ts          ← XML → structured data
      form8k.parser.ts         ← Item extractor z SGML/HTML
    scoring/
      price-impact.scorer.ts   ← conviction → alert threshold
```

Nie modyfikuj istniejącego `sec-edgar.service.ts` — nowy moduł działa równolegle,
subskrybuje ten sam event `NEW_FILING` z Event Bus.

---

## Wspólna struktura odpowiedzi GPT (wszystkie typy)

GPT zawsze zwraca ten sam JSON — niezależnie od typu dokumentu:

```typescript
interface SecFilingAnalysis {
  // Najważniejsze pole — używane przez AlertEvaluator
  price_impact: {
    direction: 'positive' | 'negative' | 'neutral';
    magnitude: 'high' | 'medium' | 'low';
    confidence: number;        // 0.0–1.0, jak pewny jest GPT swojej oceny
    time_horizon: 'immediate' | 'short_term' | 'medium_term';
    // immediate = dziś/jutro, short_term = tydzień, medium_term = miesiąc+
  };

  // Conviction do AlertEvaluator (signed, [-2.0, +2.0])
  // positive = bullish price impact, negative = bearish
  conviction: number;

  // Ludzkie wnioski — to co idzie do Telegrama
  summary: string;             // 1 zdanie co się stało
  conclusion: string;          // 1-2 zdania: jaki wpływ na cenę i dlaczego
  key_facts: string[];         // 2-4 bullet points z konkretnymi liczbami/faktami

  // Metadane
  catalyst_type: 'earnings' | 'legal' | 'leadership' | 'contract' |
                 'regulatory' | 'ma' | 'bankruptcy' | 'other';
  requires_immediate_attention: boolean;  // true → pomija throttling
}
```

---

## Form 4 Pipeline

### Parser (`form4.parser.ts`)

Przed wysłaniem do GPT wyciągnij ze struktury XML pola:

```typescript
interface Form4Parsed {
  insider_name: string;
  insider_role: string;          // CEO, CFO, Director, 10% Owner itd.
  transaction_type: string;      // P = purchase, S = sale, A = award, D = disposition
  shares: number;
  price_per_share: number;
  total_value: number;
  shares_owned_after: number;
  is_10b5_1_plan: boolean;       // kluczowe — zaplanowana vs spontaniczna
  transaction_date: string;
  filing_date: string;
}
```

Pole `is_10b5_1_plan` odczytaj z atrybutu `<transactionCoding>` → `<Rule10b5-1Transaction>`.
Wartość `Y` = plan istnieje = niższy priorytet sygnału.

### Prompt (`form4.prompt.ts`)

```typescript
export function buildForm4Prompt(
  ticker: string,
  companyName: string,
  parsed: Form4Parsed,
  recentFilings: Form4Parsed[],  // ostatnie 30 dni tego samego tickera
): string {
  return `You are a financial analyst specializing in insider trading signals for US healthcare stocks.

Analyze this SEC Form 4 insider transaction and assess its price impact.

COMPANY: ${companyName} (${ticker})
SECTOR: Healthcare

TRANSACTION:
- Insider: ${parsed.insider_name} (${parsed.insider_role})
- Type: ${parsed.transaction_type === 'P' ? 'PURCHASE' : parsed.transaction_type === 'S' ? 'SALE' : parsed.transaction_type}
- Shares: ${parsed.shares.toLocaleString()}
- Price: $${parsed.price_per_share}
- Total value: $${parsed.total_value.toLocaleString()}
- Shares owned after: ${parsed.shares_owned_after.toLocaleString()}
- Is 10b5-1 plan (pre-scheduled): ${parsed.is_10b5_1_plan ? 'YES' : 'NO'}
- Transaction date: ${parsed.transaction_date}

RECENT INSIDER ACTIVITY (last 30 days, same company):
${recentFilings.length === 0 
  ? 'No other insider transactions in past 30 days.'
  : recentFilings.map(f => 
      `- ${f.insider_name} (${f.insider_role}): ${f.transaction_type} ${f.shares.toLocaleString()} shares ($${f.total_value.toLocaleString()})`
    ).join('\n')
}

ANALYSIS GUIDELINES:
- Purchases are generally bullish, especially by CEO/CFO using personal funds
- Sales are less informative UNLESS: no 10b5-1 plan, large % of holdings, cluster selling
- 10b5-1 pre-scheduled plans reduce signal value significantly
- Role hierarchy: CEO/Founder > CFO > Director > VP
- Cluster selling (2+ insiders in 7 days) amplifies bearish signal
- Consider % of total holdings sold/bought, not just absolute value

Respond with JSON only, no preamble:
{
  "price_impact": {
    "direction": "positive|negative|neutral",
    "magnitude": "high|medium|low",
    "confidence": 0.0-1.0,
    "time_horizon": "immediate|short_term|medium_term"
  },
  "conviction": -2.0 to +2.0,
  "summary": "one sentence what happened",
  "conclusion": "1-2 sentences: price impact assessment and reasoning",
  "key_facts": ["fact1", "fact2", "fact3"],
  "catalyst_type": "insider",
  "requires_immediate_attention": true|false
}`;
}
```

---

## 8-K Pipeline

### Item Router (`form8k.parser.ts`)

Przed wywołaniem GPT, wyciągnij numer Item z nagłówka 8-K i wybierz prompt:

```typescript
export function detectItem(filingText: string): string {
  // EDGAR 8-K zawiera sekcje "Item X.XX"
  const match = filingText.match(/Item\s+(\d+\.\d+)/i);
  return match ? match[1] : 'other';
}

export function selectPromptBuilder(item: string): Function {
  const map = {
    '1.01': buildForm8k101Prompt,   // Material Definitive Agreement
    '1.03': null,                    // Bankruptcy — CRITICAL bez GPT
    '2.02': buildForm8k202Prompt,   // Results of Operations
    '5.02': buildForm8k502Prompt,   // CEO/CFO change
    '7.01': buildForm8kOtherPrompt,
    '8.01': buildForm8kOtherPrompt,
  };
  return map[item] ?? buildForm8kOtherPrompt;
}
```

### Item 1.01 — Umowa materialna (`form8k-1-01.prompt.ts`)

```typescript
export function buildForm8k101Prompt(ticker: string, companyName: string, text: string): string {
  return `You are a financial analyst specializing in US healthcare stocks.

Analyze this SEC 8-K Item 1.01 (Material Definitive Agreement) filing.

COMPANY: ${companyName} (${ticker})
SECTOR: Healthcare

FILING TEXT:
${text.slice(0, 4000)}

Focus on extracting:
1. Contract value (total, annual, or milestone-based)
2. Counterparty (who is the other party)
3. Contract duration and renewal terms
4. Termination conditions (can either party exit easily?)
5. Strategic significance (does this open new markets, create dependency, etc.)

Price impact assessment:
- Large long-term contracts with established partners = bullish
- Short-term or easily terminable contracts = neutral
- Contracts creating customer concentration risk = bearish long-term
- Healthcare-specific: Medicare/Medicaid contracts carry regulatory risk

Respond with JSON only, no preamble:
{
  "price_impact": {
    "direction": "positive|negative|neutral",
    "magnitude": "high|medium|low",
    "confidence": 0.0-1.0,
    "time_horizon": "immediate|short_term|medium_term"
  },
  "conviction": -2.0 to +2.0,
  "summary": "one sentence what happened",
  "conclusion": "1-2 sentences: price impact assessment and reasoning",
  "key_facts": ["include contract value", "counterparty", "duration", "key terms"],
  "catalyst_type": "contract",
  "requires_immediate_attention": true|false
}`;
}
```

### Item 2.02 — Wyniki kwartalne (`form8k-2-02.prompt.ts`)

```typescript
export function buildForm8k202Prompt(ticker: string, companyName: string, text: string): string {
  return `You are a financial analyst specializing in US healthcare stocks.

Analyze this SEC 8-K Item 2.02 (Results of Operations) earnings filing.

COMPANY: ${companyName} (${ticker})
SECTOR: Healthcare

FILING TEXT:
${text.slice(0, 4000)}

Focus on extracting:
1. EPS: reported vs analyst consensus (if mentioned)
2. Revenue: reported vs guidance/consensus
3. Full-year guidance: raised, lowered, or maintained
4. Medical Loss Ratio (MLR) — critical for managed care companies
5. Membership/enrollment changes — critical for insurers
6. Any one-time items distorting results

Price impact assessment:
- Beat on EPS + raised guidance = strongly bullish
- Miss on EPS + lowered guidance = strongly bearish
- MLR above 90% for managed care = severe bearish signal
- Guidance cut is more impactful than earnings miss

Respond with JSON only, no preamble:
{
  "price_impact": {
    "direction": "positive|negative|neutral",
    "magnitude": "high|medium|low",
    "confidence": 0.0-1.0,
    "time_horizon": "immediate|short_term|medium_term"
  },
  "conviction": -2.0 to +2.0,
  "summary": "one sentence: EPS beat/miss and guidance direction",
  "conclusion": "1-2 sentences: price impact with key numbers",
  "key_facts": ["EPS reported vs estimate", "revenue reported vs estimate", "guidance change", "MLR if applicable"],
  "catalyst_type": "earnings",
  "requires_immediate_attention": true
}`;
}
```

### Item 5.02 — Zmiana CEO/CFO (`form8k-5-02.prompt.ts`)

```typescript
export function buildForm8k502Prompt(ticker: string, companyName: string, text: string): string {
  return `You are a financial analyst specializing in US healthcare stocks.

Analyze this SEC 8-K Item 5.02 (Departure/Appointment of Officers) filing.

COMPANY: ${companyName} (${ticker})
SECTOR: Healthcare

FILING TEXT:
${text.slice(0, 4000)}

Focus on:
1. Who is departing and who is arriving (CEO, CFO, or other)
2. Reason for departure: resignation, retirement, termination, or not stated
3. Is the departure effective immediately or with transition period?
4. Background of incoming executive (internal promotion vs external hire)
5. Pattern: is this part of broader leadership changes?

Price impact assessment:
- Sudden unexplained CEO departure = bearish (uncertainty premium)
- Planned retirement with successor named = neutral to slightly negative
- New CEO with turnaround track record = potentially bullish
- CFO departure before earnings = strong bearish signal
- "Effective immediately" language = higher uncertainty = more negative

Respond with JSON only, no preamble:
{
  "price_impact": {
    "direction": "positive|negative|neutral",
    "magnitude": "high|medium|low",
    "confidence": 0.0-1.0,
    "time_horizon": "immediate|short_term|medium_term"
  },
  "conviction": -2.0 to +2.0,
  "summary": "one sentence: who left/joined and in what capacity",
  "conclusion": "1-2 sentences: circumstances and likely price reaction",
  "key_facts": ["role", "departure reason", "effective date", "successor if named"],
  "catalyst_type": "leadership",
  "requires_immediate_attention": true|false
}`;
}
```

### Items 7.01 / 8.01 / inne (`form8k-other.prompt.ts`)

```typescript
export function buildForm8kOtherPrompt(ticker: string, companyName: string, text: string, itemNumber: string): string {
  return `You are a financial analyst specializing in US healthcare stocks.

Analyze this SEC 8-K Item ${itemNumber} filing for its potential price impact.

COMPANY: ${companyName} (${ticker})
SECTOR: Healthcare

FILING TEXT:
${text.slice(0, 4000)}

This is an open-ended material event. Assess it freely.

Healthcare-specific events to watch for:
- FDA approval/rejection/CRL (Complete Response Letter)
- CMS rate changes (Medicare Advantage, Medicaid)
- DOJ/FTC investigation or settlement
- Clinical trial results (phase 2/3)
- M&A announcement or termination
- Major litigation settlement or judgment
- Restatement of financials

For each event type, the key question is always:
Does this change the fundamental earnings power of the company?

Respond with JSON only, no preamble:
{
  "price_impact": {
    "direction": "positive|negative|neutral",
    "magnitude": "high|medium|low",
    "confidence": 0.0-1.0,
    "time_horizon": "immediate|short_term|medium_term"
  },
  "conviction": -2.0 to +2.0,
  "summary": "one sentence what happened",
  "conclusion": "1-2 sentences: price impact and reasoning",
  "key_facts": ["fact1", "fact2", "fact3"],
  "catalyst_type": "fda|cms_rate|legal|ma|regulatory|earnings|other",
  "requires_immediate_attention": true|false
}`;
}
```

---

## Alert Logic (`price-impact.scorer.ts`)

Przekształć wynik GPT na alert. Używaj `effectiveScore` (znormalizowany conviction / 2.0)
spójnie z resztą systemu.

```typescript
export function scoreToAlertPriority(
  analysis: SecFilingAnalysis,
  formType: '8-K' | 'Form4',
): 'CRITICAL' | 'HIGH' | 'MEDIUM' | null {

  const { price_impact, conviction, requires_immediate_attention } = analysis;

  // Item 1.03 Bankruptcy — zawsze CRITICAL, obsługiwany przed GPT
  // (to sprawdź w routerze przed wywołaniem GPT)

  // Natychmiastowa uwaga wymagana przez GPT
  if (requires_immediate_attention && Math.abs(conviction) >= 0.4) {
    return price_impact.magnitude === 'high' ? 'CRITICAL' : 'HIGH';
  }

  // Wysoka magnitude + wysoka confidence
  if (price_impact.magnitude === 'high' && price_impact.confidence >= 0.7) {
    return 'CRITICAL';
  }

  // Średnia magnitude LUB wysoka magnitude z niską confidence
  if (price_impact.magnitude === 'medium' && price_impact.confidence >= 0.6) {
    return 'HIGH';
  }

  if (price_impact.magnitude === 'high' && price_impact.confidence < 0.7) {
    return 'HIGH';
  }

  // Niska magnitude lub niska confidence — nie alertuj
  return null;
}
```

### Throttling dla nowych reguł

W `seed.ts` dodaj reguły:

```typescript
{ name: '8-K Material Event GPT', throttleMinutes: 120, priority: 'CRITICAL', isActive: true },
{ name: '8-K Earnings Miss',      throttleMinutes: 240, priority: 'CRITICAL', isActive: true },
{ name: '8-K Leadership Change',  throttleMinutes: 240, priority: 'HIGH',     isActive: true },
{ name: 'Form 4 Insider Signal',  throttleMinutes: 60,  priority: 'HIGH',     isActive: true },
{ name: '8-K Bankruptcy',         throttleMinutes: 0,   priority: 'CRITICAL', isActive: true },
```

`throttleMinutes: 0` dla bankruptcy — throttling wyłączony, każda instancja alertuje.

---

## Telegram formatter

Dla każdego alertu z tego pipeline'u wiadomość Telegram zawiera pole `conclusion` z GPT
jako główną treść — nie suche dane z formularza.

Przykład dla Form 4:
```
📋 *StockPulse Alert*
*HIGH* — $MRNA Insider Signal

👤 *Noubar Afeyan* (Founder/Director)
• Transakcja: SELL 45,000 shares @ $15.60 = $702,000
• Udziały po transakcji: 2,340,000 shares
• Plan 10b5-1: NIE ← kluczowe

🤖 *Wniosek GPT:*
Spontaniczna sprzedaż przez foundera bez planu 10b5-1, zbieżna
z 4 formularzami 8-K złożonymi tego samego dnia. Bearish signal —
insider redukuje ekspozycję przed potencjalnie istotnym wydarzeniem.

• Conviction: -0.52 | Wpływ: negative / medium
⏰ 2026-03-02T22:35Z
```

---

## Kolejność implementacji

1. `form4.parser.ts` — parser XML, wyciągnięcie `is_10b5_1_plan`
2. `form8k.parser.ts` — Item router, ekstrakcja tekstu sekcji
3. Pliki promptów (5 plików) — gotowe do wklejenia z tego dokumentu
4. `price-impact.scorer.ts` — logika alertów
5. `sec-filings.module.ts` — NestJS moduł spinający całość
6. `seed.ts` — nowe reguły alertów
7. Telegram formatter — nowe szablony wiadomości

## Czego NIE zmieniać

- Istniejący `sec-edgar.service.ts` — działa równolegle, nie usuwaj
- Istniejące reguły alertów — nowe reguły dodaj, stare zostaw
- Encja `sec_filings` — dodaj kolumny `gpt_analysis JSONB` i `price_impact_direction VARCHAR(10)`,
  nie twórz nowej tabeli

---

## CorrelationService — korelacja między źródłami

### Problem który rozwiązuje

MRNA 02.03: system wysłał 3 osobne alerty (news, 4× 8-K, insider sell) bez świadomości
że to jeden złożony sygnał. Founder sprzedający spontanicznie $1.4M w ciągu 24h przy
jednoczesnym składaniu 4 formularzy 8-K to conviction ~1.8 — nie trzy osobne alerty HIGH.

CorrelationService obserwuje sygnały ze wszystkich pipeline'ów i wykrywa wzorce
które są silniejsze niż suma części.

---

### Nowy plik: `src/correlation/correlation.service.ts`

Utwórz nowy moduł NestJS `src/correlation/correlation.module.ts`.

#### Typy danych

```typescript
// Sygnał przechowywany w Redis po każdym alercie
interface StoredSignal {
  id: string;                  // uuid — do deduplikacji
  ticker: string;
  source_category:             // kategoria źródła — klucz do agregacji
    'social' |                 // StockTwits, Reddit
    'news' |                   // Finnhub, RSS
    'form4' |                  // Form 4 insider trade
    '8k';                      // 8-K filing
  conviction: number;          // znormalizowany [-1.0, +1.0] (effectiveScore)
  direction: 'positive' | 'negative' | 'neutral';
  catalyst_type: string;       // 'legal', 'earnings', 'insider', 'leadership' itd.
  timestamp: number;           // unix ms
}

// Wzorzec wykryty przez detektor
interface DetectedPattern {
  type:
    'INSIDER_PLUS_8K' |        // Form 4 + 8-K w ciągu 24h
    'FILING_CONFIRMS_NEWS' |   // news → potem 8-K tego samego catalyst_type
    'MULTI_SOURCE_CONVERGENCE' | // 3+ kategorie źródeł, ten sam kierunek, 24h
    'INSIDER_CLUSTER' |        // 2+ Form 4 tego samego tickera w ciągu 7 dni
    'ESCALATING_SIGNAL';       // rosnąca conviction przez 3+ sygnały w 72h
  signals: StoredSignal[];     // sygnały które złożyły się na wzorzec
  correlated_conviction: number; // zagregowana conviction [-1.0, +1.0]
  direction: 'positive' | 'negative';
  description: string;         // opis dla Telegrama
}
```

#### Redis — struktura przechowywania

Używaj **dwóch osobnych Sorted Set** per ticker ze względu na różne okna czasowe:

```typescript
// Okno 48h — dla większości wzorców
// Key: signals:short:{TICKER}
// Score: timestamp (unix ms)
// TTL na całym secie: 172800s (48h)

// Okno 14 dni — dla insider cluster
// Key: signals:insider:{TICKER}
// Score: timestamp (unix ms)
// TTL na całym secie: 1209600s (14 dni)
```

Przechowuj tylko sygnały które **wygenerowały alert** lub miały `|conviction| > 0.15`.
Nie zapisuj każdego StockTwits posta — tylko te które przeszły próg.

#### Zapis sygnału po alercie

```typescript
async storeSignal(signal: StoredSignal): Promise<void> {
  const json = JSON.stringify(signal);
  const redisKey = signal.source_category === 'form4'
    ? `signals:insider:${signal.ticker}`
    : `signals:short:${signal.ticker}`;
  const ttl = signal.source_category === 'form4' ? 1209600 : 172800;

  await this.redis.zadd(redisKey, signal.timestamp, json);
  await this.redis.expire(redisKey, ttl);

  // Przytnij do max 50 sygnałów per ticker per set — ochrona pamięci
  await this.redis.zremrangebyrank(redisKey, 0, -51);
}
```

Wywołaj `storeSignal()` z każdego pipeline'u PO wysłaniu alertu:
- `alert-evaluator.service.ts` → po `triggerSentimentCrashAlert` / `triggerBullishOverrideAlert`
- `form4.pipeline.ts` → po wysłaniu alertu Form 4
- `form8k.pipeline.ts` → po wysłaniu alertu 8-K

#### Debounce — nie sprawdzaj natychmiast

Form 4 i 8-K mogą przybyć w tej samej partii SEC EDGAR (co 30 min).
Gdyby correlation check odpalał się event-driven, sprawdziłby wzorzec przed
przybyciem drugiego sygnału z tej samej partii.

Rozwiązanie: **10-sekundowy debounce per ticker**.

```typescript
private readonly pendingChecks = new Map<string, NodeJS.Timeout>();

async schedulePatternCheck(ticker: string): Promise<void> {
  // Anuluj poprzedni zaplanowany check dla tego tickera
  if (this.pendingChecks.has(ticker)) {
    clearTimeout(this.pendingChecks.get(ticker));
  }
  // Zaplanuj nowy check za 10 sekund
  const timeout = setTimeout(
    () => this.runPatternDetection(ticker),
    10_000,
  );
  this.pendingChecks.set(ticker, timeout);
}
```

Każdy pipeline po zapisie sygnału wywołuje `schedulePatternCheck(ticker)` zamiast
bezpośrednio `runPatternDetection`.

---

### Detekcja wzorców (`runPatternDetection`)

```typescript
async runPatternDetection(ticker: string): Promise<void> {
  const now = Date.now();

  // Pobierz sygnały z ostatnich 48h (short window)
  const shortSignals = await this.getSignalsInWindow(
    `signals:short:${ticker}`, now - 172800_000, now
  );

  // Pobierz sygnały z ostatnich 14 dni (insider window)
  const insiderSignals = await this.getSignalsInWindow(
    `signals:insider:${ticker}`, now - 1209600_000, now
  );

  const patterns: DetectedPattern[] = [];

  // Sprawdź każdy wzorzec
  const p1 = this.detectInsiderPlus8K(shortSignals, now);
  const p2 = this.detectFilingConfirmsNews(shortSignals, now);
  const p3 = this.detectMultiSourceConvergence(shortSignals, now);
  const p4 = this.detectInsiderCluster(insiderSignals, now);
  const p5 = this.detectEscalatingSignal(shortSignals, now);

  for (const pattern of [p1, p2, p3, p4, p5]) {
    if (pattern) patterns.push(pattern);
  }

  // Uruchom alert dla każdego wykrytego wzorca (z deduplikacją)
  for (const pattern of patterns) {
    await this.triggerCorrelatedAlert(ticker, pattern);
  }
}
```

#### Pattern 1: INSIDER_PLUS_8K

```typescript
private detectInsiderPlus8K(
  signals: StoredSignal[],
  now: number,
): DetectedPattern | null {
  const window24h = now - 86400_000;

  const form4 = signals.filter(
    s => s.source_category === 'form4' && s.timestamp > window24h
  );
  const filing8k = signals.filter(
    s => s.source_category === '8k' && s.timestamp > window24h
  );

  if (form4.length === 0 || filing8k.length === 0) return null;

  // Sprawdź zgodność kierunku — oba bearish LUB oba bullish
  const dominantDirection = this.getDominantDirection([...form4, ...filing8k]);
  if (!dominantDirection) return null; // sygnały sprzeczne — nie koreluj

  const allSignals = [...form4, ...filing8k];
  return {
    type: 'INSIDER_PLUS_8K',
    signals: allSignals,
    correlated_conviction: this.aggregateConviction(allSignals),
    direction: dominantDirection,
    description: `Insider transaction + ${filing8k.length} 8-K filing(s) within 24h`,
  };
}
```

#### Pattern 2: FILING_CONFIRMS_NEWS

```typescript
private detectFilingConfirmsNews(
  signals: StoredSignal[],
  now: number,
): DetectedPattern | null {
  const window48h = now - 172800_000;

  const newsSignals = signals.filter(
    s => (s.source_category === 'news' || s.source_category === 'social')
      && s.timestamp > window48h
  );
  const filingSignals = signals.filter(
    s => s.source_category === '8k' && s.timestamp > window48h
  );

  if (newsSignals.length === 0 || filingSignals.length === 0) return null;

  // News musi przyjść PRZED filingiem
  const earliestNews = Math.min(...newsSignals.map(s => s.timestamp));
  const earliestFiling = Math.min(...filingSignals.map(s => s.timestamp));
  if (earliestNews >= earliestFiling) return null;

  // Sprawdź czy catalyst_type się zgadza (np. oba 'legal')
  const newsCatalysts = new Set(newsSignals.map(s => s.catalyst_type));
  const filingCatalysts = new Set(filingSignals.map(s => s.catalyst_type));
  const sharedCatalyst = [...newsCatalysts].some(c => filingCatalysts.has(c));
  if (!sharedCatalyst) return null;

  const allSignals = [...newsSignals, ...filingSignals];
  const dominantDirection = this.getDominantDirection(allSignals);
  if (!dominantDirection) return null;

  const lagMinutes = Math.round((earliestFiling - earliestNews) / 60_000);

  return {
    type: 'FILING_CONFIRMS_NEWS',
    signals: allSignals,
    correlated_conviction: this.aggregateConviction(allSignals),
    direction: dominantDirection,
    description: `News preceded official 8-K by ${lagMinutes} minutes`,
  };
}
```

#### Pattern 3: MULTI_SOURCE_CONVERGENCE

```typescript
private detectMultiSourceConvergence(
  signals: StoredSignal[],
  now: number,
): DetectedPattern | null {
  const window24h = now - 86400_000;
  const recent = signals.filter(s => s.timestamp > window24h);

  // Grupuj po kategorii źródła — weź najsilniejszy sygnał z każdej kategorii
  const byCategory = new Map<string, StoredSignal>();
  for (const sig of recent) {
    const existing = byCategory.get(sig.source_category);
    if (!existing || Math.abs(sig.conviction) > Math.abs(existing.conviction)) {
      byCategory.set(sig.source_category, sig);
    }
  }

  // Potrzebujemy min. 3 różnych kategorii
  if (byCategory.size < 3) return null;

  const bestPerCategory = [...byCategory.values()];
  const dominantDirection = this.getDominantDirection(bestPerCategory);
  if (!dominantDirection) return null;

  // Wszystkie kategorie muszą potwierdzać ten sam kierunek
  const confirming = bestPerCategory.filter(s => s.direction === dominantDirection);
  if (confirming.length < 3) return null;

  return {
    type: 'MULTI_SOURCE_CONVERGENCE',
    signals: confirming,
    correlated_conviction: this.aggregateConviction(confirming),
    direction: dominantDirection,
    description: `${confirming.length} independent source types confirm ${dominantDirection} signal`,
  };
}
```

#### Pattern 4: INSIDER_CLUSTER

```typescript
private detectInsiderCluster(
  signals: StoredSignal[],
  now: number,
): DetectedPattern | null {
  const window7d = now - 604800_000;

  const recentInsiders = signals.filter(
    s => s.source_category === 'form4' && s.timestamp > window7d
  );

  // Potrzebujemy min. 2 transakcji insiderów
  if (recentInsiders.length < 2) return null;

  const dominantDirection = this.getDominantDirection(recentInsiders);
  if (!dominantDirection) return null;

  const confirming = recentInsiders.filter(s => s.direction === dominantDirection);
  if (confirming.length < 2) return null;

  return {
    type: 'INSIDER_CLUSTER',
    signals: confirming,
    correlated_conviction: this.aggregateConviction(confirming),
    direction: dominantDirection,
    description: `${confirming.length} insider transactions in 7 days, all ${dominantDirection}`,
  };
}
```

#### Pattern 5: ESCALATING_SIGNAL

```typescript
private detectEscalatingSignal(
  signals: StoredSignal[],
  now: number,
): DetectedPattern | null {
  const window72h = now - 259200_000;

  // Weź sygnały z ostatnich 72h, posortuj chronologicznie
  const recent = signals
    .filter(s => s.timestamp > window72h)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (recent.length < 3) return null;

  const dominantDirection = this.getDominantDirection(recent);
  if (!dominantDirection) return null;

  const directionSign = dominantDirection === 'positive' ? 1 : -1;

  // Sprawdź czy conviction rośnie (absolutnie) przez ostatnie 3 sygnały
  const last3 = recent.slice(-3);
  const isEscalating =
    Math.abs(last3[1].conviction) > Math.abs(last3[0].conviction) &&
    Math.abs(last3[2].conviction) > Math.abs(last3[1].conviction);

  if (!isEscalating) return null;

  // Sprawdź że wszystkie 3 mają ten sam kierunek
  if (!last3.every(s => s.direction === dominantDirection)) return null;

  return {
    type: 'ESCALATING_SIGNAL',
    signals: last3,
    correlated_conviction: Math.min(1.0, Math.abs(last3[2].conviction) * 1.3) * directionSign,
    direction: dominantDirection,
    description: `Conviction escalating over 3 signals: ${last3.map(s => s.conviction.toFixed(2)).join(' → ')}`,
  };
}
```

---

### Agregacja conviction

```typescript
private aggregateConviction(signals: StoredSignal[]): number {
  if (signals.length === 0) return 0;

  // Weź najsilniejszy sygnał per kategoria źródła
  const byCategory = new Map<string, StoredSignal>();
  for (const sig of signals) {
    const existing = byCategory.get(sig.source_category);
    if (!existing || Math.abs(sig.conviction) > Math.abs(existing.conviction)) {
      byCategory.set(sig.source_category, sig);
    }
  }

  const best = [...byCategory.values()];

  // Bazowy = najsilniejszy pojedynczy sygnał
  const strongest = best.reduce((a, b) =>
    Math.abs(a.conviction) > Math.abs(b.conviction) ? a : b
  );

  // Boost = +20% za każdą dodatkową kategorię potwierdzającą ten sam kierunek
  const sameDirection = best.filter(s => s.direction === strongest.direction);
  const boost = 1 + 0.2 * (sameDirection.length - 1);

  // Kierunek dominujący
  const sign = strongest.direction === 'positive' ? 1 : -1;

  // Cap na 1.0 (skala effectiveScore)
  return Math.min(1.0, Math.abs(strongest.conviction) * boost) * sign;
}

private getDominantDirection(
  signals: StoredSignal[],
): 'positive' | 'negative' | null {
  const pos = signals.filter(s => s.direction === 'positive').length;
  const neg = signals.filter(s => s.direction === 'negative').length;
  // Wymagaj wyraźnej przewagi (66%) — przy remisie nie koreluj
  if (pos >= signals.length * 0.66) return 'positive';
  if (neg >= signals.length * 0.66) return 'negative';
  return null;
}
```

---

### Deduplikacja — nie wysyłaj tego samego wzorca dwa razy

```typescript
private async triggerCorrelatedAlert(
  ticker: string,
  pattern: DetectedPattern,
): Promise<void> {
  // Minimalna conviction dla correlated alertu — wyższy próg niż pojedyncze alerty
  if (Math.abs(pattern.correlated_conviction) < 0.35) return;

  // Sprawdź czy ten wzorzec nie był już alertowany w oknie throttlingu
  const dedupKey = `corr:fired:${ticker}:${pattern.type}`;
  const alreadyFired = await this.redis.get(dedupKey);
  if (alreadyFired) return;

  // Throttling per pattern type (sekundy)
  const throttle: Record<string, number> = {
    INSIDER_PLUS_8K:          7200,   // 2h
    FILING_CONFIRMS_NEWS:     14400,  // 4h
    MULTI_SOURCE_CONVERGENCE: 7200,   // 2h
    INSIDER_CLUSTER:          86400,  // 24h (rzadki wzorzec)
    ESCALATING_SIGNAL:        21600,  // 6h
  };

  // Wyślij alert
  const priority = Math.abs(pattern.correlated_conviction) >= 0.6
    ? 'CRITICAL'
    : 'HIGH';

  await this.telegramService.sendMarkdown(
    this.formatCorrelatedAlert(ticker, pattern, priority)
  );

  // Zapisz że alert wysłany
  await this.redis.set(dedupKey, '1', 'EX', throttle[pattern.type]);

  // Zapisz do tabeli alerts
  await this.alertRepository.save({
    symbol: ticker,
    ruleName: 'Correlated Signal',
    priority,
    channel: 'TELEGRAM',
    message: pattern.description,
    delivered: true,
    sentAt: new Date(),
  });
}
```

---

### Telegram formatter dla correlated alertów

```typescript
formatCorrelatedAlert(
  ticker: string,
  pattern: DetectedPattern,
  priority: 'CRITICAL' | 'HIGH',
): string {
  const emoji = pattern.direction === 'positive' ? '🟢' : '🔴';
  const patternLabel = {
    INSIDER_PLUS_8K:          'Insider + SEC Filing',
    FILING_CONFIRMS_NEWS:     'News Confirmed by Filing',
    MULTI_SOURCE_CONVERGENCE: 'Multi-Source Convergence',
    INSIDER_CLUSTER:          'Insider Cluster',
    ESCALATING_SIGNAL:        'Escalating Signal',
  }[pattern.type];

  // Przykład dla INSIDER_PLUS_8K bearish:
  // 🔴 *StockPulse Alert*
  // *CRITICAL* — $MRNA Insider + SEC Filing
  //
  // 🔗 *Skorelowane sygnały (ostatnie 24h):*
  // • Form 4: Noubar Afeyan SELL $703k (no 10b5-1) — conviction -0.52
  // • 8-K × 4: material events filed same evening — conviction -0.48
  // • News: BioNTech lawsuit — conviction -0.38
  //
  // 📊 Zagregowana conviction: -0.74 | negative / high
  // ℹ️ Insider + 4 filings 8-K w ciągu 24h — founder redukuje ekspozycję
  //    przy jednoczesnych zgłoszeniach materialnych zdarzeń
  // ⏰ 2026-03-02T22:45Z

  const signalLines = pattern.signals
    .map(s => `• ${s.source_category.toUpperCase()}: ${s.catalyst_type} — conviction ${s.conviction.toFixed(2)}`)
    .join('\n');

  // Escapowanie MarkdownV2 — wzoruj się na istniejących formatterach w telegram-formatter.service.ts
}
```

---

### Seed — nowa reguła alertu

Dodaj w `seed.ts`:

```typescript
{
  name: 'Correlated Signal',
  condition: 'Multiple source types confirm same direction within time window',
  priority: 'CRITICAL',
  throttleMinutes: 120,
  isActive: true,
},
```

---

### Kolejność implementacji (uzupełnienie do głównej listy)

Po ukończeniu kroków 1-7 z sekcji głównej:

8. `correlation.service.ts` — storage, pattern detection, aggregation
9. `correlation.module.ts` — NestJS moduł
10. Wpięcie `storeSignal()` w `alert-evaluator.service.ts`, `form4.pipeline.ts`, `form8k.pipeline.ts`
11. Wpięcie `schedulePatternCheck()` w tych samych miejscach
12. Telegram formatter — metoda `formatCorrelatedAlert`
13. `seed.ts` — reguła 'Correlated Signal'

### Czego NIE robić w CorrelationService

- Nie koreluj sygnałów `social` z `social` wzajemnie — ta sama kategoria źródła,
  agregacja jest już zrobiona w sentiment pipeline
- Nie uruchamiaj correlation check dla sygnałów z `|conviction| < 0.15` — to szum
- Nie zastępuj istniejących alertów correlated alertem — ADD on top, nie REPLACE
- Nie przechowuj pełnego tekstu sygnału w Redis — tylko metadane (StoredSignal interface)
- Nie sprawdzaj wzorców dla tickerów gdzie w Redis jest tylko 1 sygnał
