# StockPulse — Status projektu i plan działania

> Ostatnia aktualizacja: 2026-02-11

## Gdzie jesteśmy

**Faza 0 — Setup i walidacja API** (prawie ukończona)

Repo jest na GitHubie, mamy działające integracje z Finnhub, SEC EDGAR, StockTwits i Telegram. Czekamy na dostęp do Reddit API.

## Co jest zrobione

- [x] Repo zainicjalizowane z `package.json` (jedyna zależność: `dotenv`)
- [x] Repo na GitHubie: github.com/przemek321/stockPulse
- [x] `.gitignore` chroni `.env` z kluczami API
- [x] Docker Compose z PostgreSQL + TimescaleDB i Redis (kontenery gotowe do startu)
- [x] `.env.example` z opisami wszystkich zmiennych środowiskowych
- [x] Dokumentacja architektury w `doc/` (opis warstw, healthcare universe, setup guide)
- [x] `CLAUDE.md` z kontekstem projektu
- [x] Skrypty testowe dla 5 API (Reddit, Finnhub, SEC EDGAR, StockTwits, Telegram)
- [x] **Finnhub API — działa** (quotes, news, profile, insider sentiment, financials)
- [x] **SEC EDGAR — skonfigurowane** (User-Agent ustawiony)
- [x] **Telegram Bot — działa** (@stockpulse_alerts_bot, alerty MarkdownV2 + plain text)
- [x] **StockTwits — gotowe** (publiczne, bez auth, 200 req/hour)

## Co czeka

- [ ] Reddit API — formularz wysłany, czekamy na zatwierdzenie dostępu
- [ ] Anthropic Claude API — płatny, potrzebny dopiero od Fazy 2

## Co robimy teraz (bieżące zadania)

1. Konfiguracja i walidacja pozostałych API jedno po drugim:
   - Reddit OAuth2 (rejestracja apki na reddit.com/prefs/apps)
   - SEC EDGAR (wystarczy ustawić User-Agent z emailem)
   - StockTwits (publiczny, wystarczy odpalić test)
   - Telegram (stworzyć bota przez @BotFather)
2. Uruchomienie `npm run test:all` żeby potwierdzić że wszystko działa
3. Odpalenie Docker Compose (`docker compose up -d`) i weryfikacja baz danych

## Co dalej (Faza 1 — MVP)

Po walidacji wszystkich API przechodzimy do budowy właściwej aplikacji:

- [ ] Inicjalizacja projektu NestJS (backend)
- [ ] Schematy bazy danych w TypeORM (tabele dla tickerów, sentymentu, alertów)
- [ ] Moduły kolektorów danych (cykliczne pobieranie z Reddit, Finnhub, EDGAR, StockTwits)
- [ ] Kolejki BullMQ do przetwarzania zadań
- [ ] System alertów Telegram (wysyłka na podstawie reguł)
- [ ] Podstawowy dashboard React

## Struktura plików

```
stockPulse/
├── scripts/
│   ├── test-all.js          # Orchestrator wszystkich testów
│   ├── test-finnhub.js      # ✅ DZIAŁA — quotes, news, profile, insider
│   ├── test-reddit.js       # ⏳ Czeka na klucze OAuth2
│   ├── test-sec-edgar.js    # ✅ Skonfigurowane
│   ├── test-stocktwits.js   # ✅ Gotowe (publiczne)
│   └── test-telegram.js     # ✅ DZIAŁA — alerty wysyłane
├── doc/
│   ├── PROGRESS-STATUS.md   # ← TEN PLIK
│   ├── stockpulse-architecture.jsx
│   ├── stockpulse-healthcare-universe.json
│   ├── StockPulse-Setup-README.md
│   ├── StockPulse-Opis-Architektury.docx
│   └── README.md
├── docker-compose.yml        # PostgreSQL + TimescaleDB, Redis
├── .env.example              # Szablon zmiennych środowiskowych
├── .env                      # Rzeczywiste klucze (git-ignored)
├── package.json
└── CLAUDE.md
```

## Kluczowe liczby

- **Tickery do monitorowania**: 32 (healthcare, zdefiniowane w healthcare-universe.json)
- **Słowa kluczowe**: 180+
- **Subreddity**: 18
- **Źródła danych**: 5 (Finnhub, Reddit, SEC EDGAR, StockTwits, Telegram jako output)
- **Finnhub free tier**: 60 req/min — wystarczające na MVP
