# Fix: GPT Override — EffectiveScore jako źródło prawdy

## Kontekst

Obecny problem: FinBERT zwraca score `-0.83` dla artykułu o ugodzie patentowej MRNA.
GPT analizuje ten sam tekst i zwraca `BULLISH conviction: +0.486`.
AlertEvaluator patrzy **tylko** na FinBERT score → odpala 🔴 Sentiment Crash mimo że GPT mówi bullish.

GPT conviction żyje tylko w wiadomości Telegram — nie trafia z powrotem do logiki ewaluacji.

## Cel

Wprowadzić pole `effectiveScore` jako "prawdziwy" score używany przez AlertEvaluator:
- Jeśli GPT przeanalizował → `effectiveScore = normalize(gptConviction)` (patrz: Normalizacja skal)
- Jeśli bez GPT → `effectiveScore = finbertScore` (fallback)

Dodać dwa nowe typy alertów: **Bullish Signal Override** i **Bearish Signal Override**.

---

## Kluczowa uwaga: normalizacja skal

Conviction ma zakres **[-2.0, +2.0]** (iloczyn: sentiment × relevance × novelty × authority × confidence × magnitude_multiplier).
FinBERT score ma zakres **[-1.0, +1.0]**.

Wrzucenie conviction bezpośrednio do `effectiveScore` bez normalizacji spowoduje:
- Próg `-0.5` dla Sentiment Crash = 50% skali FinBERT, ale tylko 25% skali conviction
- GPT-analyzed items będą 2× łatwiej triggerować alerty niż FinBERT-only

**Rozwiązanie: normalizacja przy zapisie.**

```typescript
// W sentiment-processor, przed zapisem do effectiveScore:
const CONVICTION_MAX = 2.0; // teoretyczne maximum przy wszystkich czynnikach = 1.0 i magnitude = high

function normalizeConviction(conviction: number): number {
  return Math.max(-1.0, Math.min(1.0, conviction / CONVICTION_MAX));
}

const effectiveScore: number =
  gptConviction !== null
    ? normalizeConviction(gptConviction)  // [-2,+2] → [-1,+1]
    : finbertScore;                        // już w [-1,+1]
```

Dzięki temu progi w AlertEvaluator (`-0.5`, `+0.5` itd.) mają to samo znaczenie niezależnie od źródła.

**Walidacja zakresu:** Jeśli GPT zwróci conviction poza oczekiwanym zakresem (bug w prompcie, halucynacja), `normalizeConviction` obetnie do [-1, +1], ale anomalia zostanie zalogowana:

```typescript
if (Math.abs(conviction) > this.CONVICTION_MAX) {
  this.logger.warn(
    `Conviction ${conviction} poza zakresem [-${this.CONVICTION_MAX}, +${this.CONVICTION_MAX}] — obcięte do [-1, +1]`,
  );
}
```

---

## Typ pomocniczy: SignalDirection

Aby uniknąć rozrzuconych stringów magicznych (`'BULLISH'` / `'BEARISH'`) po wielu plikach, dodaj typ w jednym miejscu i importuj:

```typescript
// src/common/types.ts (lub istniejący plik z typami)
export type SignalDirection = 'BULLISH' | 'BEARISH';
```

Używany w: `alert-evaluator.service.ts`, `telegram-formatter.service.ts`.

---

## Zmiany do wprowadzenia

### 1. `src/entities/sentiment-score.entity.ts`

Dodaj **dwa** nowe kolumny (nie trzy — `gptDirection` jest redundantne bo kierunek wynika ze znaku `gptConviction`):

```typescript
@Column({ type: 'float', nullable: true })
gptConviction: number | null;
// raw conviction z GPT, zakres [-2.0, +2.0]
// > 0 = BULLISH, < 0 = BEARISH, null = nie analizowano przez GPT
// UWAGA: denormalizacja — conviction jest też w enrichedAnalysis.conviction (JSONB).
// Osobna kolumna istnieje dla szybkich query SQL i indeksowania.

@Column({ type: 'float', nullable: true })
effectiveScore: number | null;
// znormalizowany score do [-1.0, +1.0] — jedyne pole używane przez AlertEvaluator
// = normalize(gptConviction) jeśli GPT analizował, = finbertScore jeśli FINBERT_ONLY
```

**Nie dodawaj** kolumny `gptDirection` — kierunek odczytujesz jako `Math.sign(gptConviction)`.

---

### 2. `src/sentiment/sentiment-processor.service.ts`

Dodaj helper `normalizeConviction` (metoda prywatna serwisu):

```typescript
private readonly CONVICTION_MAX = 2.0;

private normalizeConviction(conviction: number): number {
  if (Math.abs(conviction) > this.CONVICTION_MAX) {
    this.logger.warn(
      `Conviction ${conviction} poza zakresem [-${this.CONVICTION_MAX}, +${this.CONVICTION_MAX}] — obcięte`,
    );
  }
  return Math.max(-1.0, Math.min(1.0, conviction / this.CONVICTION_MAX));
}
```

#### Atomiczny zapis — KRYTYCZNE

**NIE rób osobnego `update()` po zapisie rekordu.** `effectiveScore` i `gptConviction` muszą być ustawione w tym samym `save()` co reszta pól — **przed** emisją eventu `SENTIMENT_SCORED`. W przeciwnym razie AlertEvaluator może zobaczyć rekord z `effectiveScore = null` (race condition).

Znajdź miejsce gdzie tworzony/zapisywany jest rekord `sentiment_scores` i dodaj pola do tego samego obiektu:

```typescript
// Dla itemów eskalowanych do GPT:
const gptConviction: number | null = aiResult?.conviction ?? null;
const effectiveScore = gptConviction !== null
  ? this.normalizeConviction(gptConviction)
  : finbertScore;

// PRZED save/emit — dodaj do tego samego obiektu rekordu:
sentimentScore.gptConviction = gptConviction;
sentimentScore.effectiveScore = effectiveScore;
await this.sentimentScoreRepo.save(sentimentScore);

// Dopiero TERAZ emituj event z nowymi polami:
this.eventEmitter.emit(EventType.SENTIMENT_SCORED, {
  scoreId, symbol, score, confidence, conviction,
  effectiveScore,       // ← NOWE
  gptConviction,        // ← NOWE
  enrichedAnalysis, model,
});
```

Dla itemów **FINBERT_ONLY** (nie eskalowanych do GPT) — analogicznie w tym samym save:
```typescript
sentimentScore.gptConviction = null;
sentimentScore.effectiveScore = finbertScore; // kopia FinBERT
await this.sentimentScoreRepo.save(sentimentScore);
```

`effectiveScore` musi być ustawiany dla **wszystkich** rekordów bez wyjątku.

---

### 3. `src/alerts/alert-evaluator.service.ts`

#### Dane z eventu — bez dodatkowego fetch

Event `SENTIMENT_SCORED` już niesie `score`, `confidence`, `conviction`, `enrichedAnalysis`. Po dodaniu `effectiveScore` i `gptConviction` do payloadu (krok 2) — **nie potrzebujesz** dodatkowego `findOne()` z bazy:

```typescript
// Dane bezpośrednio z eventu — zero dodatkowego roundtripa do DB:
const { score: finbertScore, effectiveScore, gptConviction, confidence, enrichedAnalysis } = event;

const scoreForEval = effectiveScore ?? finbertScore; // fallback dla starych rekordów bez effectiveScore
const hasGptAnalysis = gptConviction !== null;
```

#### Niezależne sprawdzanie reguł — zachowaj obecne zachowanie

Obecny kod sprawdza **3 reguły niezależnie** — jedno zdarzenie może odpalić jednocześnie Sentiment Crash i High Conviction Signal. **Nie zmieniaj tego na sekwencyjne `return`** — to byłaby fundamentalna zmiana zachowania.

Override i Sentiment Crash są wzajemnie wykluczające (effectiveScore nie może być jednocześnie < -0.5 i > 0.2), więc nie ma ryzyka podwójnego alertu między nimi. Ale Override + High Conviction Signal mogą współistnieć — i **powinny**, bo niosą różną informację.

```typescript
// === Reguła: Sentiment Crash ===
// effectiveScore < -0.5 oznacza: albo FinBERT negatywny (bez GPT), albo GPT potwierdza bearish
if (scoreForEval < -0.5 && confidence > 0.7) {
  await this.checkSentimentCrash(event);
}

// === Reguła: Bullish Signal Override ===
// FinBERT widzi intensywny negatywny tekst, GPT koryguje na BULLISH
if (hasGptAnalysis && finbertScore < -0.5 && scoreForEval > 0.1) {
  await this.checkSignalOverride(event, 'BULLISH');
}

// === Reguła: Bearish Signal Override ===
// FinBERT widzi pozytywny tekst, GPT koryguje na BEARISH
if (hasGptAnalysis && finbertScore > 0.5 && scoreForEval < -0.1) {
  await this.checkSignalOverride(event, 'BEARISH');
}

// === Reguła: High Conviction Signal (BEZ ZMIAN) ===
// UWAGA: używa RAW gptConviction (skala [-2, +2]), NIE effectiveScore
if (gptConviction !== null && Math.abs(gptConviction) > 1.5) {
  await this.checkHighConviction(event);
}

// === Reguła: Strong FinBERT Signal (BEZ ZMIAN) ===
// Fallback gdy VM offline — conviction jest null
if (!hasGptAnalysis && Math.abs(finbertScore) > 0.7 && confidence > 0.8) {
  await this.checkStrongFinbert(event);
}
```

**Próg Override obniżony do 0.1** (z 0.2) — eliminuje martwą strefę, w której konflikt modeli istnieje ale żaden alert go nie sygnalizuje. Przy progu 0.2 case `FinBERT=-0.8, GPT conviction=+0.3, normalized=+0.15` byłby cichy.

#### Usunięcie starej supresji AI w Sentiment Crash

Obecny kod Sentiment Crash ma logikę supresji:
- `conviction < 0.1 → suppress`
- `conviction < 0.3 AND urgency LOW → suppress`

Po wprowadzeniu `effectiveScore` ta logika staje się **redundantna** dla GPT-analyzed items — bo `scoreForEval` (= normalized conviction) i tak nie przejdzie progu `-0.5` gdy GPT mówi bullish/neutral.

**Usuń starą supresję** aby nie mylić przyszłego czytającego kod. `effectiveScore` przejmuje tę odpowiedzialność.

---

### 4. `src/alerts/telegram/telegram-formatter.service.ts`

Dodaj metodę `formatSignalOverrideAlert`:

```typescript
formatSignalOverrideAlert(
  ticker: string,
  tickerName: string,
  finbertScore: number,
  gptConviction: number,        // raw, nieznormalizowany — do wyświetlenia
  effectiveScore: number,       // znormalizowany — do wyświetlenia
  direction: SignalDirection,   // import z common/types.ts
  catalystType: string,
  summary: string,
  timestamp: Date,
): string {
  const emoji = direction === 'BULLISH' ? '🟢' : '🔴';
  const priority = 'HIGH';

  // Przykładowy output dla BULLISH override:
  // 🟢 *StockPulse Alert*
  // *HIGH* — $MRNA Bullish Signal Override
  // 📊 *MRNA* \(Moderna\)
  // • FinBERT: \-0\.83 \(negative framing\)
  // • GPT override: BULLISH \+0\.486
  // • Effective score: \+0\.24
  // • Katalizator: legal
  // • Moderna resolved patent litigation — $950M settlement
  // ⚠️ Konflikt modeli — wymaga weryfikacji
  // ⏰ 2026\-03\-03T22:10:57Z
}
```

Wzoruj się na istniejących metodach `formatSentimentAlert` i `formatInsiderTradeAlert` — szczególnie pod kątem escapowania MarkdownV2.

---

### 5. `src/database/seeds/seed.ts`

Dodaj dwie nowe reguły alertów:

```typescript
{
  name: 'Bullish Signal Override',
  condition: 'FinBERT score < -0.5 but GPT returns normalized conviction > 0.1',
  priority: 'HIGH',
  throttleMinutes: 60,
  isActive: true,
},
{
  name: 'Bearish Signal Override',
  condition: 'FinBERT score > 0.5 but GPT returns normalized conviction < -0.1',
  priority: 'HIGH',
  throttleMinutes: 60,
  isActive: true,
},
```

Po dodaniu: `npm run seed`

---

## Migracja bazy danych

TypeORM z `synchronize: true` (development) doda kolumny automatycznie przy restarcie.

Jeśli `synchronize: false` (production):

```sql
ALTER TABLE sentiment_scores ADD COLUMN IF NOT EXISTS gpt_conviction FLOAT;
ALTER TABLE sentiment_scores ADD COLUMN IF NOT EXISTS effective_score FLOAT;

-- Backfill 1: FINBERT_ONLY rekordy → effectiveScore = score
UPDATE sentiment_scores
SET effective_score = score
WHERE effective_score IS NULL AND gpt_conviction IS NULL;

-- Backfill 2: historyczne rekordy GPT (model LIKE '%gpt%') gdzie gpt_conviction IS NULL
-- Wykonaj osobnym skryptem Node.js analogicznym do backfill-sentiment.ts
-- Skrypt powinien dla każdego rekordu z modelem finbert+gpt odczytać conviction
-- z enrichedAnalysis->>'conviction' (JSONB) i uzupełnić:
--   gpt_conviction = enrichedAnalysis->>'conviction'
--   effective_score = GREATEST(-1.0, LEAST(1.0, gpt_conviction / 2.0))

-- Indeksy
CREATE INDEX IF NOT EXISTS idx_effective_score
  ON sentiment_scores (effective_score, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gpt_conviction
  ON sentiment_scores (gpt_conviction)
  WHERE gpt_conviction IS NOT NULL;
```

---

## Weryfikacja po wdrożeniu

### Test 1 — Bullish Override (case MRNA)
Rekord w `sentiment_scores` powinien mieć: `score < -0.5`, `gpt_conviction > 0`, `effective_score > 0.1`. Wiadomość Telegram ma emoji 🟢.

### Test 2 — Bearish Override (symetryczny)
Ręcznie wyślij tekst z wyraźnie pozytywnym FinBERT score (~+0.7) ale negatywnym GPT conviction. Sprawdź alert `Bearish Signal Override`.

### Test 3 — klasyczny Sentiment Crash bez zmian
ELV/HIMS-type alerty (oba modele negatywne) nadal generują `Sentiment Crash`.

### Test 4 — FINBERT_ONLY items
Losowe 10 rekordów z `gpt_conviction IS NULL`: `effective_score` powinien być równy `score`.

### Test 5 — normalizacja skal
Dla rekordu z `gpt_conviction = 1.458`: `effective_score` powinno wynosić `0.729`, nie `1.458`. Jeśli widzisz `effective_score > 1.0` — normalizacja nie działa.

### Test 6 — brak race condition
Sprawdź logi: event `SENTIMENT_SCORED` powinien zawierać `effectiveScore` w payload. Jeśli w logach AlertEvaluator widać `effectiveScore: undefined` — zapis nie jest atomiczny.

### Test 7 — walidacja zakresu
Wymuś ręcznie conviction = 3.5 (poza zakresem). Sprawdź: warning w logach + `effective_score` obcięte do 1.0.

---

## Czego NIE zmieniać

- Logika eskalacji do GPT (tier 1/2) — bez zmian
- FinBERT score w kolumnie `score` — zostaje jako raw value, nie nadpisywać
- Throttling w AlertEvaluator — działa na poziomie rule_name per ticker, wystarczy dodać nowe reguły
- Istniejące alerty Insider Trade / 8-K — nie dotykać
- High Conviction Signal — nadal używa raw `gptConviction` (skala [-2, +2]), NIE `effectiveScore`
