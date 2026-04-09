# Plan: Semi Supply Chain — warstwa obserwacyjna

## Kontekst

Artykuł o wzroście cen pamięci/helu ujawnił katalizator w łańcuchu dostaw półprzewodników. Healthcare zostaje jako core (zwalidowany backtest, d=0.43). Semi dochodzi jako **osobna warstwa obserwacyjna** — zbieramy dane Form4/8-K, liczymy price outcomes, ale NIE wysyłamy na Telegram dopóki backtest nie potwierdzi edge'u.

14 nowych tickerów w 3 koszykach:
- **Memory producers** (upstream): MU, WDC, STX
- **Equipment & packaging** (picks & shovels): KLIC, AMKR, ONTO, CAMT, NVMI, ASX
- **OEM anti-signal** (margin squeeze): DELL, HPQ, HPE, SMCI, NTAP

---

## Faza 1 — Setup obserwacyjny (Sprint 16, ~2 dni)

### 1.1 Ticker entity — nowe kolumny

**Plik**: `src/entities/ticker.entity.ts`

Dodaj 2 kolumny:
```typescript
@Column({ length: 50, default: 'healthcare' })
sector: string;

// TODO: jeśli pierwszy go/no-go decision wymaga split na poziomie koszyka,
// refactor do ticker_categories table (sector + subsector + observation_only).
@Column({ default: false })
observationOnly: boolean;
```

TypeORM `synchronize: true` → kolumny dodadzą się automatycznie. Istniejące healthcare tickery dostaną `sector='healthcare'`, `observationOnly=false`.

### 1.2 Alert entity — kolumna `nonDeliveryReason`

**Plik**: `src/entities/alert.entity.ts`

Dodaj kolumnę do śledzenia **powodu niedostarczenia** alertu:
```typescript
@Column({ type: 'varchar', length: 32, nullable: true })
nonDeliveryReason: 'observation' | 'silent_hour' | 'daily_limit' | null;
```

**Uzasadnienie**: Bez tej kolumny `delivered=false` łączy 3 różne powody — observation mode, silent hour, daily limit. W analizie backtestowej nie da się odróżnić "alert nie poszedł bo semi observation" od "alert nie poszedł bo była 3 w nocy". Krytyczne dla forward analysis.

### 1.3 JSON config — semi supply chain

**Nowy plik**: `doc/stockpulse-semi-supply-chain.json`

Struktura identyczna z `stockpulse-healthcare-universe.json`:
```json
{
  "meta": { "name": "StockPulse Semi Supply Chain", "sector": "semi_supply_chain", "observation_mode": true },
  "tickers": {
    "memory_producers": { "priority": "MEDIUM", "companies": [...] },
    "equipment_packaging": { "priority": "MEDIUM", "companies": [...] },
    "oem_anti_signal": { "priority": "LOW", "companies": [...] }
  }
}
```

Wymagane: CIK lookup z SEC EDGAR dla 14 tickerów.

### 1.4 Seed script — obsługa wielu plików JSON

**Plik**: `src/database/seeds/seed.ts`

Zmiany:
1. Nowy `GROUP_PRIORITY` dla semi grup (`memory_producers: 'MEDIUM'`, `equipment_packaging: 'MEDIUM'`, `oem_anti_signal: 'LOW'`)
2. Wyciągnij wspólną logikę seedowania do funkcji `seedTickers(tickerRepo, groups, priority, sector, observationOnly)`
3. Healthcare: `sector='healthcare'`, `observationOnly=false`
4. Semi: `sector='semi_supply_chain'`, `observationOnly=true`
5. Dodaj `sector` i `observationOnly` do listy `orUpdate`
6. Bez reguł alertów z semi (używa tych samych Form4/8-K rules)

### 1.5 Healthcare boost guard — fix

**Plik**: `src/sec-filings/pipelines/form4.pipeline.ts` (linia 222-224)

```diff
- // Healthcare boost: ticker?.subsector istnieje tylko dla healthcare tickerów
- if (ticker?.subsector) {
+ // Healthcare boost: tylko dla sektora healthcare (nie semi)
+ if (ticker?.sector === 'healthcare') {
```

**KRYTYCZNE**: Bez tego fixa semi tickery dostałyby healthcare ×1.2 boost — fałszywą konwikcję.

### 1.6 Gate Telegram — Form4Pipeline

**Plik**: `src/sec-filings/pipelines/form4.pipeline.ts` (linia 269)

```diff
- const delivered = await this.telegram.sendMarkdown(message);
+ const isObservation = ticker?.observationOnly === true;
+ const delivered = isObservation
+   ? false
+   : await this.telegram.sendMarkdown(message);
+ if (isObservation) {
+   this.logger.debug(`OBSERVATION MODE: ${payload.symbol} — alert zapisany, Telegram pominięty`);
+ }
```

Alert zapisuje się do DB z `delivered=false`, `nonDeliveryReason='observation'` → PriceOutcomeService liczy outcome'y normalnie.

### 1.7 Gate Telegram — Form8kPipeline

**Plik**: `src/sec-filings/pipelines/form8k.pipeline.ts` (linie 207 i 292)

Identyczny pattern jak 1.6 — sprawdź `ticker?.observationOnly` przed `sendMarkdown`. Dwa miejsca: normalne 8-K alerty + Item 1.03 Bankruptcy. Ustaw `nonDeliveryReason='observation'` gdy pominięty.

### 1.8 Gate Telegram — AlertEvaluator (bez dodatkowego DB query)

**Plik**: `src/alerts/alert-evaluator.service.ts` — metoda `sendAlert()`

Przekaż `ticker` jako parametr zamiast odpytywać DB:

```typescript
async sendAlert(payload: AlertPayload, ticker?: TickerEntity): Promise<boolean> {
  const isObservation = ticker?.observationOnly === true;
  // ...
}
```

Pipeline'y (Form4Pipeline, Form8kPipeline) już mają `ticker` w kontekście — wystarczy go przekazać dalej do `sendAlert()`. **Zero dodatkowych queries** w hot path.

Ustaw `nonDeliveryReason` w trzech gating pointach:
```typescript
// W sendAlert():
let nonDeliveryReason: string | null = null;
if (isObservation) nonDeliveryReason = 'observation';
else if (isSilent) nonDeliveryReason = 'silent_hour';
else if (dailyLimitHit) nonDeliveryReason = 'daily_limit';

// Zapisz do alertu:
alert.nonDeliveryReason = nonDeliveryReason;
```

### 1.9 Sanity check po 7 dniach

SQL query + `make` target do weryfikacji czy pipeline generuje dane dla semi tickerów:

```sql
SELECT
  t.symbol,
  COUNT(DISTINCT f.id) AS filings_collected,
  COUNT(DISTINCT a.id) FILTER (WHERE a.id IS NOT NULL) AS alerts_generated,
  COUNT(DISTINCT a.id) FILTER (WHERE a.non_delivery_reason = 'observation') AS observation_blocked
FROM tickers t
LEFT JOIN sec_filings f ON f.cik = t.cik AND f.created_at > NOW() - INTERVAL '7 days'
LEFT JOIN alerts a ON a.ticker_symbol = t.symbol AND a.created_at > NOW() - INTERVAL '7 days'
WHERE t.sector = 'semi_supply_chain'
GROUP BY t.symbol
ORDER BY filings_collected DESC;
```

**Cel**: lejek filings → przetworzone → alerty → zablokowane observation. Jeśli któryś etap = 0, poprawka konfiguracji **przed** rozpoczęciem właściwego okna obserwacji. Bez tego = data-collection na ślepo.

**Koszt**: SQL query + Makefile target, ~30 min.

### 1.10 Brak zmian wymaganych

- **PriceOutcomeService** — działa na alertach z `priceAtAlert != null`, niezależnie od `delivered`. OK.
- **CorrelationService** — sygnały rejestrowane normalnie (Form4Pipeline zapisuje do Redis). OK.
- **SEC EDGAR collector** — CIK z tabeli `tickers`, nowe tickery automatycznie monitorowane. OK.

---

## Faza 2 — Backtest historyczny (Sprint 16-17, ~3-5 dni)

### 2.0 Price data backfill (BLOCKER)

**Wymagane przed uruchomieniem backtestów.** Weryfikacja dostępności danych cenowych 2018-2025 dla 14 tickerów. Backfill jeśli brak.

Pragmatyczna ścieżka — yfinance (darmowe, EOD do 2018 dla US-listed):
```python
import yfinance as yf
tickers = ["MU", "WDC", "STX", "KLIC", "AMKR", "ONTO", "CAMT", "NVMI", "ASX",
           "DELL", "HPQ", "HPE", "SMCI", "NTAP"]
data = yf.download(tickers, start="2018-01-01", end="2025-12-31")
data.to_parquet("scripts/backtest/data/semi_prices_2018_2025.parquet")
```

Alternatywa: Polygon (z Sprint 10 Options Flow) — sprawdź czy ten sam klucz ma EOD historical dla tych nazw. Jeśli tak, użyj go dla spójności z resztą systemu.

**Koszt**: 1-2h.

### 2.1 Nowy skrypt backtestowy

**Nowy plik**: `scripts/backtest/semi_supply_chain_v1.py`

Reużywa: `edgar_fetcher.py`, `price_fetcher.py`, `analyzer.py` (klasy `HypothesisResult`, baseline computation).

Konfiguracja:
```python
MEMORY_PRODUCERS = ["MU", "WDC", "STX"]
EQUIPMENT_PACKAGING = ["KLIC", "AMKR", "ONTO", "CAMT", "NVMI", "ASX"]
OEM_ANTI_SIGNAL = ["DELL", "HPQ", "HPE", "SMCI", "NTAP"]

TRAIN = (2018-01-01, 2023-12-31)
VALIDATE = (2024-01-01, 2025-12-31)
```

### 2.2 Hipotezy do testowania

| # | Hipoteza | Koszyk | Metryka |
|---|----------|--------|---------|
| H1 | C-suite discretionary BUY ≥$100K | Memory | 1d/3d/7d hit rate vs dip baseline |
| H2 | C-suite discretionary BUY ≥$100K | Equipment | j.w. |
| H3 | Cluster BUY (≥3 insiderów w 7d) per firma | Oba | Cohen's d vs random-date baseline |
| H4 | **Cross-sector cluster** (BUY w 2+ firm z memory+equipment w 14d) | Memory + Equipment (bez OEM) | Cohen's d vs random-date baseline — nowy pattern |
| H5 | C-suite SELL w OEMach | OEM | anti-signal test (d < -0.2?) |

**H4 — zmiana definicji**: cross-firm cluster na **cały sektor semi** (memory + equipment razem = 9 firm), nie per-koszyk. Uzasadnienie: memory producer i equipment maker widzą ten sam shock z różnych perspektyw (pricing vs bookings). Cross-koszyk sygnał **wzmacnia** thesis. OEM wykluczony (margin squeeze → inna semantyka BUY). Na koszyku 3-firmowym (memory) N będzie za małe na jakąkolwiek statystykę (5-10 zdarzeń w 5 lat → bezwartościowy effect size).

### 2.3 Kontrole metodologiczne

- Mean reversion per-ticker (semi ma wyższą betę niż healthcare)
- Winsoryzacja 2.5/97.5 percentyla
- Per-ticker-week deduplikacja
- Out-of-sample: train 2018-2023, validate 2024-2025

---

## Faza 3 — 8-K SUPPLY_DISRUPTION classifier (Sprint 16 równolegle z Fazą 1, ~2 dni)

**Przesunięta z Sprint 17 do Sprint 16** — realizacja równoległa z Fazą 1.

Uzasadnienie:
1. **Sektor-agnostyczność**: supply disruption classifier działa dla healthcare też (CDMO, contract manufacturing). Wartość niezależna od decyzji semi go/no-go — nawet jeśli semi thesis nie działa, classifier zostaje.
2. **Dodatkowy datapoint do go/no-go**: włączony wcześniej daje dłuższe okno forward observation. Niezależny test mechaniki.

### 3.1 Nowy prompt

**Nowy plik**: `src/sec-filings/prompts/form8k-supply-disruption.prompt.ts`

Sektor-agnostyczny prompt dla supply disruption language. Catalyst types: `supply_disruption`, `force_majeure`, `capacity_constraint`.

### 3.2 Detekcja w parserze (regex pre-filter + LLM classifier)

**Plik**: `src/sec-filings/parsers/form8k.parser.ts`

Dwuetapowa detekcja:
1. **Regex pre-filter** (cheap, bez kosztu LLM) — `detectSupplyDisruption(text: string): boolean` skanuje tekst na:
   - "material supply constraints", "component shortages", "extended lead times"
   - "production capacity adjustments", "force majeure", "input cost pressure"
   - "supply chain disruption", "unable to meet.*demand"
2. **LLM classifier** (expensive, accurate) — tylko na trafienia regex. Pattern zgodny z istniejącą architekturą pipeline.

Sama lista keywordów ma false negatives. Regex jako pre-filter + LLM na hits = najlepsza proporcja koszt/accuracy.

### 3.3 Routing w pipeline

**Plik**: `src/sec-filings/pipelines/form8k.pipeline.ts`

Przed `selectPromptBuilder`: jeśli `detectSupplyDisruption(text) === true`, użyj supply disruption promptu zamiast standardowego per-Item promptu. Priorytet: supply disruption > Item-specific.

---

## Faza 4 — Decyzja go/no-go (Sprint 18)

Kryteria pre-committed (nie kodowe — procesowe):
1. Backtest: d ≥ 0.30, p < 0.05 na out-of-sample (2024-2025)
2. Forward observation: ≥5 sygnałów z hit rate zgodnym z backtestem
3. Wymagane wyjaśnienie ekonomiczne ("dlaczego działa")

Jeśli GO: zmień `observationOnly=false` w JSON + `make seed`.
Jeśli NO-GO: `isActive=false` dla tych tickerów.

---

## Kolejność implementacji

1. **Ticker entity** (1.1) — nowe kolumny `sector` + `observationOnly`
2. **Alert entity** (1.2) — kolumna `nonDeliveryReason`
3. **JSON config** (1.3) — `stockpulse-semi-supply-chain.json` z 14 tickerami + CIK lookup
4. **Seed script** (1.4) — obsługa wielu plików JSON
5. **Healthcare boost fix** (1.5) — `subsector` → `sector === 'healthcare'`
6. **Gate Telegram** (1.6, 1.7, 1.8) — Form4Pipeline + Form8kPipeline + AlertEvaluator + `nonDeliveryReason` w 3 gating pointach
7. **8-K classifier** (3.1-3.3) — **równolegle z Fazą 1** (sektor-agnostyczny, niezależna wartość)
8. **Rebuild + seed + test** — weryfikacja end-to-end
9. **Sanity check 7d** (1.9) — SQL lejek po tygodniu obserwacji
10. **Price data backfill** (2.0) — **BLOCKER** przed backtestem
11. **Backtest script** (2.1-2.3) — niezależnie, Python standalone

---

## Weryfikacja

1. `docker compose exec app npm run build` — kompilacja TS bez błędów
2. `docker compose exec app npm run test` — istniejące testy przechodzą
3. `make seed` (w kontenerze) — 14 nowych tickerów z `sector='semi_supply_chain'`, `observationOnly=true`
4. `psql`: `SELECT symbol, sector, "observationOnly" FROM tickers WHERE sector != 'healthcare'` — 14 wierszy
5. Sprawdź logi: SEC EDGAR collector zaczyna zbierać filingi dla nowych CIK
6. Sprawdź że healthcare tickery mają `sector='healthcare'` (domyślna wartość)
7. Symulacja: ręczny insert insider trade dla MU → alert w DB z `delivered=false`, `nonDeliveryReason='observation'`, brak Telegramu
8. `psql`: `SELECT non_delivery_reason, COUNT(*) FROM alerts WHERE non_delivery_reason IS NOT NULL GROUP BY 1` — weryfikacja że reason się zapisuje

---

## Pliki do modyfikacji/utworzenia

| Plik | Akcja | Opis |
|------|-------|------|
| `src/entities/ticker.entity.ts` | EDIT | +2 kolumny: `sector`, `observationOnly` |
| `src/entities/alert.entity.ts` | EDIT | +1 kolumna: `nonDeliveryReason` |
| `doc/stockpulse-semi-supply-chain.json` | NEW | Config 14 tickerów semi z CIK |
| `src/database/seeds/seed.ts` | EDIT | Multi-file seed + nowe pola |
| `src/sec-filings/pipelines/form4.pipeline.ts` | EDIT | Healthcare boost fix + observation gate |
| `src/sec-filings/pipelines/form8k.pipeline.ts` | EDIT | Observation gate (2 miejsca) |
| `src/alerts/alert-evaluator.service.ts` | EDIT | Observation gate w `sendAlert()` — ticker jako param, bez DB query |
| `src/sec-filings/prompts/form8k-supply-disruption.prompt.ts` | NEW | Supply disruption prompt (Faza 3, równolegle z Fazą 1) |
| `src/sec-filings/parsers/form8k.parser.ts` | EDIT | `detectSupplyDisruption()` regex pre-filter (Faza 3) |
| `src/sec-filings/pipelines/form8k.pipeline.ts` | EDIT | Routing do supply disruption (Faza 3) |
| `scripts/backtest/semi_supply_chain_v1.py` | NEW | Backtest 5 hipotez (Faza 2) |
| `scripts/backtest/fetch_semi_prices.py` | NEW | Price data backfill 2018-2025 (Faza 2, blocker) |
