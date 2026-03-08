# Agent: Audyt spójności logiki StockPulse

## Jak użyć

Wklej poniższy prompt do Claude Code jako komendę:

```
Uruchom agenta Explore z poniższym kontekstem. Raportuj po polsku.
Przeczytaj doc/agent/consistency-check.md i wykonaj pełny audyt.
```

Albo bezpośrednio:

```
@agent Explore — przeczytaj doc/agent/consistency-check.md i wykonaj audyt spójności
```

---

## Kontekst systemu

StockPulse to system analizy sentymentu rynku akcji (healthcare). Pipeline:

```
Kolektory (StockTwits, Finnhub, SEC EDGAR, PDUFA.bio)
  → eventy (NEW_MENTION, NEW_ARTICLE, NEW_FILING, NEW_INSIDER_TRADE)
  → SentimentListenerService → BullMQ (sentiment-analysis)
  → SentimentProcessorService (Worker):
      1. FinBERT sidecar (GPU, score [-1,+1], confidence)
      2. classifyTier(confidence, absScore) → Tier 1/2/3
      3. Tier 1+2 → Azure OpenAI gpt-4o-mini (enrichedAnalysis, conviction [-2,+2])
      4. effectiveScore = normalize(conviction) lub finbertScore
      5. save() atomicznie → emit SENTIMENT_SCORED
  → AlertEvaluator (5 reguł niezależnych)
  → Telegram alerts + Frontend dashboard
```

### Kluczowe koncepty

- **effectiveScore** [-1,+1] — znormalizowany score używany przez AlertEvaluator
  - GPT: `effectiveScore = conviction / 2.0` (clamp [-1,+1])
  - FINBERT_ONLY: `effectiveScore = finbertScore`
- **gptConviction** [-2,+2] — raw conviction z Azure (null jeśli nie eskalowano)
- **5 reguł alertów** (niezależne, jedno zdarzenie może odpalić wiele):
  1. Sentiment Crash: effectiveScore < -0.5 AND confidence > 0.7
  2. Bullish Signal Override: FinBERT < -0.5, GPT → effectiveScore > 0.1
  3. Bearish Signal Override: FinBERT > 0.5, GPT → effectiveScore < -0.1
  4. High Conviction Signal: |gptConviction| > 1.5 (RAW, nie effectiveScore!)
  5. Strong FinBERT Signal: bez GPT, |score| > 0.7, confidence > 0.8

---

## Checklist audytu

Sprawdź każdy punkt. Dla każdej niespójności podaj plik:linia i opis.

### A. Pipeline — przepływ danych

- [ ] Kolektory emitują poprawne eventy z wymaganymi polami (mentionId/articleId, symbol, source)
- [ ] SentimentListenerService nasłuchuje wszystkich typów eventów
- [ ] Job BullMQ zawiera kompletne dane (mentionId/articleId, symbol, source, type)
- [ ] SentimentProcessorService pobiera tekst z DB na podstawie jobData
- [ ] Delay między emisją eventu a jobem (zapobiega race condition na zapis encji)

### B. FinBERT → Tier → GPT

- [ ] Wywołanie FinBERT sidecar zwraca {label, score, confidence}
- [ ] classifyTier() używa confidence + absScore do klasyfikacji
- [ ] Tier 1 (conf>0.7 AND abs>0.5) → ZAWSZE do GPT
- [ ] Tier 2 (conf>0.3 OR abs>0.2) → do GPT jeśli VM aktywna
- [ ] Tier 3 → skip GPT, tylko FinBERT
- [ ] PDUFA context injection — nadchodzące daty FDA wstrzykiwane do prompta
- [ ] Azure OpenAI zwraca enrichedAnalysis z polami: sentiment, relevance, novelty, source_authority, confidence, catalyst_type, price_impact, conviction, summary

### C. effectiveScore — normalizacja i zapis

- [ ] Entity `sentiment-score.entity.ts` ma pola: gptConviction (float, nullable), effectiveScore (float, nullable)
- [ ] normalizeConviction(): conviction / 2.0, clamp do [-1.0, +1.0]
- [ ] Warning log gdy |conviction| > 2.0
- [ ] effectiveScore ustawiany dla WSZYSTKICH rekordów (GPT i FINBERT_ONLY)
- [ ] Zapis atomiczny — effectiveScore w tym samym save() co reszta pól
- [ ] Event SENTIMENT_SCORED zawiera effectiveScore i gptConviction w payload

### D. AlertEvaluator — reguły

- [ ] Używa effectiveScore (nie raw score) do ewaluacji Sentiment Crash
- [ ] Sentiment Crash: effectiveScore < -0.5 AND confidence > 0.7
- [ ] Bullish Override: hasGptAnalysis AND finbertScore < -0.5 AND effectiveScore > 0.1
- [ ] Bearish Override: hasGptAnalysis AND finbertScore > 0.5 AND effectiveScore < -0.1
- [ ] High Conviction: |gptConviction| > 1.5 (RAW conviction, NIE effectiveScore)
- [ ] Strong FinBERT: !hasGptAnalysis AND |finbertScore| > 0.7 AND confidence > 0.8
- [ ] Reguły są niezależne — brak wczesnego return/else-if między nimi
- [ ] Stara supresja (conviction<0.1) usunięta z Sentiment Crash
- [ ] Throttling per (rule_name, symbol) działa dla nowych reguł Override

### E. Telegram — formatowanie alertów

- [ ] Metoda formatSignalOverrideAlert() istnieje i jest wywoływana
- [ ] Przyjmuje: ticker, finbertScore, gptConviction, effectiveScore, direction, catalystType, summary
- [ ] Emoji: 🟢 dla BULLISH, 🔴 dla BEARISH
- [ ] Escapowanie MarkdownV2 spójne z innymi metodami (escapeMarkdown helper)
- [ ] Wszystkie metody format* używają tego samego helpera do escapowania

### F. Frontend — interface i wyświetlanie

- [ ] Interface SentimentScore w api.ts zawiera gptConviction i effectiveScore
- [ ] Panel AI Analysis wyświetla dane z enrichedAnalysis
- [ ] API endpoint /sentiment/scores zwraca nowe pola
- [ ] Wykres sentymentu — fioletowe kropki dla AI-eskalowanych wyników

### G. Seed — reguły alertów

- [ ] JSON (stockpulse-healthcare-universe.json) zawiera "Bullish Signal Override" i "Bearish Signal Override"
- [ ] seed.ts importuje reguły z JSON i robi upsert
- [ ] Throttle dla Override = 60 minut
- [ ] Priority dla Override = HIGH

### H. Typy i czystość kodu

- [ ] Brak nieużywanych importów w zmienionych plikach
- [ ] Brak martwego kodu (zakomentowane bloki, nieużywane zmienne)
- [ ] Komentarze odzwierciedlają aktualny stan kodu
- [ ] Brak typów `any` w kluczowych serwisach (processor, evaluator)

---

## Format raportu

```
## RAPORT AUDYTU SPÓJNOŚCI — [data]

### Wynik: [X/100]

### Niespójności znalezione: [N]

| # | Plik:linia | Opis | Ważność |
|---|-----------|------|---------|
| 1 | ... | ... | Krytyczna/Średnia/Niska |

### Szczegóły per sekcja:

#### A. Pipeline — [✅/⚠️/❌]
[opis]

#### B. FinBERT → Tier → GPT — [✅/⚠️/❌]
[opis]

... (każda sekcja A-H)

### Rekomendacje
1. ...
2. ...
```

---

## Historia audytów

| Data | Wynik | Niespójności | Notatki |
|------|-------|-------------|---------|
| 2026-03-08 | 85/100 | 3 (kosmetyczne) | Pierwszy audyt. Brak krytycznych bugów. |
| 2026-03-08 | 92/100 | 6 (3 naprawione) | Audyt CorrelationService: bug detectInsiderPlus8K (form4 w złym zbiorze), za wysokie progi (MIN_CONVICTION 0.15→0.05, MIN_CORRELATED_CONVICTION 0.35→0.20), catalyst_type 'unknown' blokował matching. Naprawione w commit f8d564b. |
