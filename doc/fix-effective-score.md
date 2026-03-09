# Fix: GPT Override — EffectiveScore jako źródło prawdy

## Kontekst

Obecny problem: FinBERT zwraca score `-0.83` dla artykułu o ugodzie patentowej MRNA.
GPT analizuje ten sam tekst i zwraca `BULLISH conviction: +0.486`.
AlertEvaluator patrzy **tylko** na FinBERT score → odpala 🔴 Sentiment Crash mimo że GPT mówi bullish.

GPT conviction żyje tylko w wiadomości Telegram — nie trafia z powrotem do logiki ewaluacji.

## Cel

Wprowadzić pole `effectiveScore` jako "prawdziwy" score używany przez AlertEvaluator:
- Jeśli GPT przeanalizował → `effectiveScore = gptConviction` (signed, GPT ma pierwszeństwo)
- Jeśli bez GPT → `effectiveScore = finbertScore` (fallback)

Dodać nowy typ alertu: **Bullish Signal Override** (FinBERT negative, GPT BULLISH).

---

## Zmiany do wprowadzenia (3 pliki + 1 seed)

### 1. `src/entities/sentiment-score.entity.ts`

Dodaj trzy nowe kolumny po istniejących polach:

```typescript
@Column({ type: 'float', nullable: true })
gptConviction: number | null;

@Column({ type: 'varchar', length: 10, nullable: true })
gptDirection: string | null; // 'BULLISH' | 'BEARISH' | 'NEUTRAL'

@Column({ type: 'float', nullable: true })
effectiveScore: number | null;
```

`effectiveScore` to kluczowe pole — zastępuje surowy FinBERT score w całej logice alertów i analityce.

---

### 2. `src/sentiment/sentiment-processor.service.ts`

Znajdź miejsce gdzie zapisywany jest wynik GPT (po otrzymaniu `aiOverride` lub analogicznej struktury z Azure OpenAI). Dodaj obliczanie i zapis `effectiveScore`.

Logika:

```typescript
// Po otrzymaniu odpowiedzi GPT (aiResult):
const gptConviction: number | null = aiResult?.conviction ?? null;
const gptDirection: string | null = aiResult?.sentiment ?? null; // 'BULLISH'/'BEARISH'/'NEUTRAL'

// effectiveScore: GPT ma pierwszeństwo gdy przeanalizował
const effectiveScore: number =
  gptConviction !== null
    ? gptConviction          // signed: +0.486 bullish, -0.378 bearish
    : finbertScore;          // fallback na FinBERT jeśli item nie był eskalowany

// Zapisz do rekordu sentiment_scores:
await this.sentimentScoreRepo.update(sentimentScoreId, {
  gptConviction,
  gptDirection,
  effectiveScore,
});
```

Dla itemów które **nie przeszły** przez GPT (FINBERT_ONLY):
- `gptConviction = null`
- `gptDirection = null`
- `effectiveScore = finbertScore` (kopia FinBERT — żeby zawsze mieć jedno pole do zapytań)

Upewnij się że `effectiveScore` jest ustawiane dla **wszystkich** rekordów, nie tylko tych z GPT.

---

### 3. `src/alerts/alert-evaluator.service.ts`

Znajdź handler nasłuchujący na `SENTIMENT_SCORED`. Zastąp logikę ewaluacji:

```typescript
// Pobierz pełny rekord z nowymi polami:
const sentimentScore = await this.sentimentScoreRepo.findOne({
  where: { id: event.sentimentScoreId }
});

const scoreForEval = sentimentScore.effectiveScore ?? sentimentScore.score;
const { gptDirection, gptConviction } = sentimentScore;

// Case 1: klasyczny Sentiment Crash
// STARY warunek działał na sentimentScore.score — zamień na scoreForEval
if (scoreForEval < -0.5 && sentimentScore.confidence > 0.7) {
  // istniejąca logika triggera — bez zmian
  await this.triggerSentimentCrashAlert(sentimentScore);
  return;
}

// Case 2: NOWY — Bullish Signal Override
// FinBERT widzi coś "ważnego" (intensywny tekst) ale GPT mówi że to bullish
if (
  sentimentScore.score < -0.5 &&          // FinBERT wykrył intensywny tekst
  gptDirection === 'BULLISH' &&
  gptConviction !== null &&
  gptConviction > 0.2
) {
  await this.triggerBullishOverrideAlert(sentimentScore);
  return;
}
```

Dodaj metodę `triggerBullishOverrideAlert` analogicznie do `triggerSentimentCrashAlert`, używającą reguły `'Bullish Signal Override'` z `alert_rules`.

---

### 4. `src/alerts/telegram/telegram-formatter.service.ts`

Dodaj metodę `formatBullishOverrideAlert`:

```typescript
formatBullishOverrideAlert(
  ticker: string,
  tickerName: string,
  finbertScore: number,
  gptConviction: number,
  catalystType: string,
  summary: string,
  timestamp: Date,
): string {
  // Użyj 🟢 zamiast 🔴
  // Wyraźnie pokaż konflikt FinBERT vs GPT
  // Przykład wiadomości:
  // 🟢 *StockPulse Alert*
  // *HIGH* — $MRNA Bullish Signal Override
  // 📊 *MRNA* (Moderna)
  // • FinBERT: -0.83 (negative framing)
  // • GPT override: BULLISH +0.486
  // • Katalizator: legal
  // • Moderna resolved patent litigation — $950M settlement
  // ⚠️ Wymaga ręcznej weryfikacji — konflikt modeli
}
```

Wzoruj się na istniejących metodach `formatSentimentAlert` / `formatInsiderTradeAlert` w tym samym pliku.

---

### 5. `src/database/seeds/seed.ts`

Dodaj nową regułę alertu w tablicy reguł (razem z "Insider Trade Large", "8-K Material Event" itd.):

```typescript
{
  name: 'Bullish Signal Override',
  condition: 'FinBERT score < -0.5 but GPT returns BULLISH conviction > 0.2',
  priority: 'HIGH',
  throttleMinutes: 60,
  isActive: true,
}
```

Po dodaniu uruchom: `npm run seed`

---

## Migracja bazy danych

TypeORM z `synchronize: true` (development) doda kolumny automatycznie przy restarcie.

Jeśli `synchronize: false` (production), dodaj ręcznie:

```sql
ALTER TABLE sentiment_scores ADD COLUMN IF NOT EXISTS gpt_conviction FLOAT;
ALTER TABLE sentiment_scores ADD COLUMN IF NOT EXISTS gpt_direction VARCHAR(10);
ALTER TABLE sentiment_scores ADD COLUMN IF NOT EXISTS effective_score FLOAT;

-- Backfill: dla istniejących rekordów bez GPT, effectiveScore = score
UPDATE sentiment_scores
SET effective_score = score
WHERE effective_score IS NULL;

-- Indeks dla analityki
CREATE INDEX IF NOT EXISTS idx_effective_score ON sentiment_scores (effective_score, created_at DESC);
```

---

## Weryfikacja po wdrożeniu

### Test 1 — MRNA-like case (FinBERT negative, GPT BULLISH)

Sprawdź w bazie czy dla alertów z `rule_name = 'Bullish Signal Override'` rekordy w `sentiment_scores` mają:
- `score < -0.5` (FinBERT)
- `gpt_direction = 'BULLISH'`
- `effective_score > 0` (GPT value)

### Test 2 — klasyczny Sentiment Crash nadal działa

Sprawdź że dla ELV/HIMS alerty `Sentiment Crash` nadal są generowane — `effectiveScore` powinien być ujemny gdy GPT też jest BEARISH.

### Test 3 — FINBERT_ONLY items

Sprawdź że `effective_score = score` dla rekordów gdzie `gpt_conviction IS NULL`.

---

## Czego NIE zmieniać

- Logika eskalacji do GPT (tier 1/2) — bez zmian
- FinBERT score w kolumnie `score` — zostaje jako raw value, nie nadpisywać
- Throttling w AlertEvaluator — działa na poziomie rule_name per ticker, wystarczy dodać nową regułę
- Istniejące alerty Insider Trade / 8-K — nie dotykać
