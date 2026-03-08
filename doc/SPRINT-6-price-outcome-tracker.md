# Sprint 6 — Price Outcome Tracker

## Cel

Automatyczne mierzenie trafności alertów przez porównanie ceny w momencie alertu z ceną po 1h, 4h, 1d i 3d. Dane zbierane przez BullMQ delayed jobs. Wynik widoczny w nowym panelu na dashboardzie.

**Nie zmieniamy istniejącej logiki alertów.** Tylko dodajemy warstwę pomiaru na wyjściu.

---

## Kontekst istniejącego kodu

- Encja `Alert` → tabela `alerts` — `src/entities/alert.entity.ts`
- `AlertEvaluatorService` → `src/alerts/alert-evaluator.service.ts` — tu wywoływane `sendAlert()`, tu dodajemy pobieranie ceny
- `FinnhubService` → `src/collectors/finnhub/finnhub.service.ts` — już posiada HTTP klienta do Finnhub API z kluczem z `.env` (`FINNHUB_API_KEY`)
- Kolejki BullMQ zarejestrowane w `src/queues/queues.module.ts` i `queue-names.const.ts` — dodajemy nową kolejkę `price-outcome`
- `synchronize: true` w TypeORM — nowe kolumny tworzone automatycznie przy starcie

---

## Zadania

### 1. Rozszerzenie encji `Alert`

Plik: `src/entities/alert.entity.ts`

Dodaj kolumny (nullable, żeby nie łamać istniejących rekordów):

```typescript
@Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
priceAtAlert: number | null;

@Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
price1h: number | null;

@Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
price4h: number | null;

@Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
price1d: number | null;

@Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
price3d: number | null;

@Column({ type: 'boolean', default: false })
priceOutcomeFetched: boolean;
```

---

### 2. Metoda `getQuote()` w FinnhubService

Plik: `src/collectors/finnhub/finnhub.service.ts`

Sprawdź czy metoda już istnieje. Jeśli nie — dodaj:

```typescript
async getQuote(symbol: string): Promise<number | null> {
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${this.apiKey}`;
    const response = await axios.get(url, { timeout: 5000 });
    const price = response.data?.c; // 'c' = current price w Finnhub API
    return price && price > 0 ? price : null;
  } catch (err) {
    this.logger.warn(`getQuote failed for ${symbol}: ${err.message}`);
    return null;
  }
}
```

`FinnhubService` musi być wyeksportowany z `FinnhubModule` żeby `AlertsModule` mógł go użyć. Sprawdź eksporty i dodaj jeśli brakuje.

---

### 3. Nowa kolejka `price-outcome`

Plik: `src/queues/queue-names.const.ts`

```typescript
export const PRICE_OUTCOME_QUEUE = 'price-outcome';
```

Plik: `src/queues/queues.module.ts`

Dodaj `PRICE_OUTCOME_QUEUE` do listy rejestrowanych kolejek (analogicznie do innych).

---

### 4. Nowy moduł `PriceOutcomeModule`

Utwórz folder: `src/price-outcome/`

#### `src/price-outcome/price-outcome.module.ts`

```typescript
@Module({
  imports: [
    TypeOrmModule.forFeature([Alert]),
    BullModule.registerQueue({ name: PRICE_OUTCOME_QUEUE }),
    FinnhubModule, // żeby móc wstrzyknąć FinnhubService
  ],
  providers: [PriceOutcomeProcessor],
})
export class PriceOutcomeModule {}
```

#### `src/price-outcome/price-outcome.processor.ts`

BullMQ Worker nasłuchujący na joby z kolejki `price-outcome`.

Job payload: `{ alertId: number, field: 'price1h' | 'price4h' | 'price1d' | 'price3d', symbol: string }`

Logika:
1. Pobierz `Alert` z bazy po `alertId`
2. Wywołaj `finnhubService.getQuote(symbol)`
3. Zapisz cenę do odpowiedniego pola (np. `alert.price1d = price`)
4. Jeśli wszystkie 4 pola wypełnione → ustaw `priceOutcomeFetched = true`
5. `alertRepository.save(alert)`

Obsługa błędów: jeśli Finnhub zwróci null (np. weekend, market closed) — zapisz `null`, nie rzucaj błędu. Job nie powinien się retryować bez sensu.

---

### 5. Wiring w `AlertEvaluatorService`

Plik: `src/alerts/alert-evaluator.service.ts`

Wstrzyknij `FinnhubService` i `PriceOutcomeQueue`.

Po każdym `await this.alertRepository.save(alert)` (kiedy alert zostaje faktycznie wysłany) dodaj:

```typescript
// Pobierz cenę w momencie alertu
const currentPrice = await this.finnhubService.getQuote(alert.symbol);
if (currentPrice) {
  alert.priceAtAlert = currentPrice;
  await this.alertRepository.save(alert);
}

// Zaplanuj delayed jobs do enrichmentu
const delays = [
  { field: 'price1h', delay: 60 * 60 * 1000 },
  { field: 'price4h', delay: 4 * 60 * 60 * 1000 },
  { field: 'price1d', delay: 24 * 60 * 60 * 1000 },
  { field: 'price3d', delay: 72 * 60 * 60 * 1000 },
];

for (const { field, delay } of delays) {
  await this.priceOutcomeQueue.add(
    'fetch-price',
    { alertId: alert.id, field, symbol: alert.symbol },
    { delay, attempts: 2, backoff: { type: 'fixed', delay: 5 * 60 * 1000 } },
  );
}
```

Ważne: ten kod otocz try/catch — błąd pobierania ceny nie może przerywać głównego flow alertu.

---

### 6. Rejestracja `PriceOutcomeModule` w `AppModule`

Plik: `src/app.module.ts`

Dodaj `PriceOutcomeModule` do tablicy `imports`.

---

### 7. Nowy endpoint REST

Plik: `src/api/alerts/alerts.controller.ts`

```
GET /api/alerts/outcomes?limit=100&symbol=UNH
```

Zwraca alerty gdzie `priceAtAlert IS NOT NULL`, posortowane od najnowszych. Wylicz i zwróć dodatkowo:

```typescript
// wyliczone po stronie backendu
delta1d: number | null  // ((price1d - priceAtAlert) / priceAtAlert) * 100
delta3d: number | null
directionCorrect1d: boolean | null  // czy kierunek alertu zgadza się z ruchem ceny
```

Kierunek alertu odczytaj z `alert.message` lub dodaj pole `alertDirection: 'bullish' | 'bearish'` do encji (jeśli łatwiej). Porównaj ze znakiem `delta1d`.

---

### 8. Panel na dashboardzie

Plik: `frontend/src/components/PriceOutcomePanel.tsx`

Tabela MUI z kolumnami:

| Ticker | Reguła | Conviction | Cena alertu | +1h | +4h | +1d Δ% | +3d Δ% | Trafny? | Data |
|--------|--------|------------|-------------|-----|-----|---------|---------|---------|------|

Kolorowanie:
- `delta1d > 0` i alert bullish → zielony ✓
- `delta1d < 0` i alert bearish → zielony ✓
- pozostałe → czerwony ✗
- komórki z `null` (brak danych, market closed) → szary `-`

Dodaj panel do `frontend/src/App.tsx` — jako nowy Accordion w zakładce Dashboard, nazwa: **"Trafność Alertów (Price Outcome)"**.

Nowa funkcja w `frontend/src/api.ts`:

```typescript
export async function fetchAlertOutcomes(limit = 100, symbol?: string): Promise<AlertOutcome[]>
```

---

## Kolejność implementacji

1. `alert.entity.ts` — nowe kolumny
2. `finnhub.service.ts` — metoda `getQuote()`
3. `queue-names.const.ts` + `queues.module.ts` — nowa kolejka
4. `price-outcome/` — moduł + processor
5. `alert-evaluator.service.ts` — wiring po sendAlert
6. `app.module.ts` — rejestracja
7. `alerts.controller.ts` — nowy endpoint
8. Frontend — panel + api.ts

---

## Czego NIE robimy w tym sprincie

- Nie zmieniamy logiki generowania alertów
- Nie zmieniamy formatu alertów Telegram
- Nie dodajemy backfillu historycznych alertów (tylko nowe od teraz)
- Nie agregujemy statystyk trafności (to sprint 7)

---

## Definicja ukończenia

- [ ] Po wysłaniu alertu w tabeli `alerts` pojawia się `priceAtAlert`
- [ ] Po 1h, 4h, 1d, 3d pola `price1h/4h/1d/3d` są wypełniane automatycznie
- [ ] `GET /api/alerts/outcomes` zwraca dane z wyliczonym `delta1d` i `delta3d`
- [ ] Panel "Trafność Alertów" widoczny na dashboardzie z kolorowaniem
- [ ] Błąd Finnhub quota / market closed nie crashuje pipeline alertów
