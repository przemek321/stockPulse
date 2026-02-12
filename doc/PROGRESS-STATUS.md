# StockPulse — Status projektu i plan działania

> Ostatnia aktualizacja: 2026-02-12

## Gdzie jesteśmy

**Faza 1 — Backend NestJS MVP** (ukończona)

Pełny backend NestJS działa w kontenerze Docker. Mamy kolektory danych, kolejki BullMQ, alerty Telegram i REST API. Baza PostgreSQL z 9 tabelami, Redis dla kolejek.

## Faza 0 — Setup i walidacja API (ukończona)

- [x] Repo na GitHubie: github.com/przemek321/stockPulse
- [x] `.gitignore` chroni `.env` z kluczami API
- [x] Docker Compose z PostgreSQL + TimescaleDB i Redis
- [x] `.env.example` z opisami zmiennych środowiskowych
- [x] Dokumentacja architektury w `doc/`
- [x] `CLAUDE.md` z kontekstem projektu
- [x] Skrypty testowe dla 5 API w `scripts/`
- [x] **Finnhub API** — działa (quotes, news, profile, insider sentiment, financials)
- [x] **SEC EDGAR** — działa (filings, Form 4, 8-K, CIK lookup)
- [x] **StockTwits** — działa (publiczne API, 200 req/hour)
- [x] **Telegram Bot** — działa (@stockpulse_alerts_bot, MarkdownV2)
- [ ] **Reddit API** — formularz wysłany, czekamy na zatwierdzenie

## Faza 1 — Backend NestJS MVP (ukończona)

### Krok 1: Szkielet NestJS
- [x] `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`
- [x] `src/main.ts` — bootstrap aplikacji, port z .env, prefix `/api`
- [x] `src/app.module.ts` — główny moduł
- [x] `src/config/` — ładowanie .env z walidacją Joi
- [x] `Dockerfile` + serwis `app` w docker-compose.yml

### Krok 2: Baza danych + encje TypeORM
- [x] `src/database/database.module.ts` — połączenie TypeORM z PostgreSQL
- [x] 9 encji w `src/entities/` (ticker, sentiment_score, raw_mention, news_article, sec_filing, insider_trade, alert, alert_rule, collection_log)
- [x] Tabele tworzone automatycznie przez `synchronize: true`

### Krok 3: Kolejki BullMQ
- [x] `src/queues/` — 6 kolejek (4 kolektory + sentiment + alerts)
- [x] Połączenie z Redis, domyślne retry (3 próby, exponential backoff)

### Krok 4: Kolektory danych
- [x] **StockTwits** — stream wiadomości per ticker, wbudowany sentyment, co 5 min
- [x] **Finnhub** — newsy spółek + insider sentiment (MSPR), co 10 min
- [x] **SEC EDGAR** — filingi (10-K, 10-Q, 8-K, Form 4), co 30 min
- [x] **Reddit** — OAuth2 + ekstrakcja tickerów, placeholder (czeka na API access)
- [x] `BaseCollectorService` — bazowa klasa z logowaniem cykli do collection_logs

### Krok 5: Alerty Telegram
- [x] `TelegramService` — wysyłka wiadomości (MarkdownV2 + plain text)
- [x] `TelegramFormatterService` — formatowanie alertów (sentyment, insider trade, filing)
- [x] `AlertEvaluatorService` — nasłuchuje eventów, ewaluuje reguły, throttling

### Krok 6: REST API
- [x] `GET /api/health` — status zdrowia kolektorów i systemu
- [x] `GET /api/tickers` — lista tickerów (filtrowanie po subsector)
- [x] `GET /api/tickers/:symbol` — szczegóły tickera
- [x] `GET /api/sentiment/:ticker` — wyniki sentymentu, wzmianki, newsy
- [x] `GET /api/alerts` — historia alertów (filtrowanie po symbol)
- [x] `GET /api/alerts/rules` — lista reguł alertów

## Co czeka — Następne kroki

### Faza 1.5 — Uruchomienie zbierania danych
- [ ] **Seed tickerów** — import 32 spółek healthcare z `healthcare-universe.json` do tabeli `tickers`
- [ ] **Seed reguł alertów** — import reguł z `healthcare-universe.json`
- [ ] Weryfikacja że kolektory zbierają dane do bazy
- [ ] Weryfikacja że alerty Telegram wysyłają się przy spełnionych regułach

### Faza 2 — Analiza AI (planowana)
- [ ] FinBERT sidecar (Python) — szybki sentyment
- [ ] Claude Haiku API — analiza niuansowa
- [ ] spaCy NER — ekstrakcja encji

### Faza 3 — Frontend React (planowana)
- [ ] Dashboard z wykresami sentymentu (Recharts)
- [ ] WebSocket do real-time updates
- [ ] TanStack Query do zarządzania stanem

### Oczekujące
- [ ] Reddit API — czeka na zatwierdzenie formularza
- [ ] Anthropic Claude API — płatny, potrzebny od Fazy 2
- [ ] TimescaleDB hypertable — konwersja `sentiment_scores` na hypertable
- [ ] Migracje TypeORM (zamiast synchronize w produkcji)

## Komendy

```bash
# Infrastruktura — start / stop / rebuild
docker compose up -d              # Start (postgres, redis, app)
docker compose down               # Stop
docker compose up -d --build app  # Rebuild po zmianach w src/
docker compose logs app --tail 50 # Logi aplikacji

# Weryfikacja
curl http://localhost:3000/api/health       # Status systemu
curl http://localhost:3000/api/tickers      # Lista tickerów
curl http://localhost:3000/api/alerts       # Historia alertów
curl http://localhost:3000/api/alerts/rules # Reguły alertów

# Testy integracji API (Faza 0)
npm run test:all
```

## Kluczowe liczby

- **Tickery do monitorowania**: 32 (healthcare, zdefiniowane w healthcare-universe.json)
- **Słowa kluczowe**: 180+
- **Subreddity**: 18
- **Pliki źródłowe**: 49 plików TypeScript w `src/`
- **Encje bazy danych**: 9 tabel
- **Kolejki BullMQ**: 6
- **Endpointy REST**: 6
- **Źródła danych**: 4 kolektory (StockTwits, Finnhub, SEC EDGAR, Reddit)
