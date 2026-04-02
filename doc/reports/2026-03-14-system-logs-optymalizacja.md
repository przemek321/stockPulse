# Sprint 8.4 — Optymalizacja system_logs + Price Outcome analiza

**Data**: 2026-03-14

## Zmiany w system_logs

### 1. Usunięcie duplikacji logów (-35% wolumenu)
- Usunięto `@Logged('sentiment')` z `analyze()` w `finbert-client.service.ts`
- Dane i tak były dostępne w logach `process()` (który wywołuje `analyze()` wewnętrznie)

### 2. Return values dla void metod (6 metod)
Metody zwracające `void` generowały 930 wierszy/tydzień z `output: null` — bezużyteczne diagnostycznie.

| Metoda | Moduł | Przykładowe returny |
|--------|-------|-------------------|
| `onInsiderTrade` | alert-evaluator | `SKIP_LOW_VALUE`, `BATCHED`, `BATCH_STARTED` |
| `onFiling` | alert-evaluator | `SKIP_NOT_8K`, `ALERT_SENT`, `THROTTLED` |
| `onInsiderTrade` | form4.pipeline | `SKIP_DAILY_CAP`, `SKIP_VM_OFFLINE`, `ALERT_SENT` |
| `onFiling` | form8k.pipeline | `SKIP_ALREADY_ANALYZED`, `BANKRUPTCY_ONLY`, `ERROR` |
| `storeSignal` | correlation | `SKIP_LOW_CONVICTION`, `STORED` |
| `runPatternDetection` | correlation | `{ ticker, signals, patterns }` |

### 3. Nazwa kolektora w runCollectionCycle
- Zmiana return type z `Promise<number>` na `Promise<{ collector: string; count: number }>`
- Aktualizacja 5 procesorów BullMQ (stocktwits, finnhub, reddit, sec-edgar, pdufa-bio)

### 4. Fix progu highConviction
- Próg zmieniony z 1.5 na 0.7
- Stary próg był nieosiągalny (max conviction ever = 1.008)
- Reguła miała 0 wyzwoleń od początku systemu

### 5. Martwe reguły alertów
Zidentyfikowano 3 reguły z 0 wyzwoleniami:
- `highConviction` (naprawiona progiem 0.7)
- `strongFinbert` (wymaga |score|>0.7, conf>0.8 + VM offline)
- `sentimentCrash` (wymaga 5+ mentions w 2h z avg score<-0.7)

### 6. HIMS dominacja
- 77.3% wszystkich wywołań `process()` dotyczyło tickera HIMS
- StockTwits jest głównym źródłem — wycięcie z GPT pipeline (Sprint 8) zmniejszyło obciążenie

## Cleanup bazy
- Usunięto 31,751 starych logów (zachowano ostatni dzień)
- `VACUUM FULL system_logs`: 37 MB → 4.7 MB

---

## Price Outcome Tracker — analiza lifecycle

### Założenia projektowe
1. **Completion flag**: `priceOutcomeDone = true` gdy:
   - Wszystkie 4 sloty wypełnione (price1h, price4h, price1d, price3d), **LUB**
   - Hard timeout 7 dni (zamyka nawet z brakującymi slotami)
2. **CRON**: co 1h (`0 * * * *`), tylko gdy NYSE otwarta (pon-pt 9:30-16:00 ET)
3. **Rate limit**: max 30 zapytań Finnhub /quote na cykl (free tier = 60 req/min)
4. **Brak cleanup**: alerty z `priceOutcomeDone = true` zostają w bazie na zawsze

### Dashboard (Trafność Alertów)
- Endpoint: `GET /api/alerts/outcomes?limit=200`
- Filtr: tylko alerty z `priceAtAlert IS NOT NULL`
- Sortowanie: `sentAt DESC` (najnowsze najpierw)
- Brak paginacji, brak filtra czasowego
- Stare alerty naturalnie schodzą z listy gdy pojawiają się nowsze (limit 200)

### Problem weekendowy
- Piątkowe alerty (po 16:00 ET) dostają ceny dopiero w poniedziałek od 15:30 CET
- Sloty 1h, 4h, 1d mogą mieć identyczną wartość (wszystkie = cena otwarcia poniedziałku)

### Potencjalne ulepszenia
- Filtr czasowy na froncie (last 30/60/90 dni)
- Auto-archiwizacja alertów starszych niż N dni
- Paginacja z offset/limit
- Indeksy DB na `priceOutcomeDone` + `sentAt`
