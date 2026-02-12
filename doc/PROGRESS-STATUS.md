# StockPulse — Status projektu i plan działania

> Ostatnia aktualizacja: 2026-02-11

## Gdzie jesteśmy

**Faza 0 — Setup i walidacja API** (w trakcie)

Projekt jest na samym początku. Mamy szkielet repo z dokumentacją, infrastrukturę Docker i skrypty testowe do integracji z zewnętrznymi API. Na razie skonfigurowaliśmy i przetestowaliśmy **tylko Finnhub API** — działa poprawnie.

## Co jest zrobione

- [x] Repo zainicjalizowane z `package.json` (jedyna zależność: `dotenv`)
- [x] Docker Compose z PostgreSQL + TimescaleDB i Redis (kontenery gotowe do startu)
- [x] `.env.example` z opisami wszystkich zmiennych środowiskowych
- [x] Dokumentacja architektury w `doc/` (opis warstw, healthcare universe, setup guide)
- [x] `CLAUDE.md` z kontekstem projektu
- [x] Skrypty testowe dla 5 API (Reddit, Finnhub, SEC EDGAR, StockTwits, Telegram)
- [x] **Finnhub API — skonfigurowane i działa** (quotes, news, profile, insider sentiment, financials)

## Co jeszcze nie działa / nie skonfigurowane

- [ ] Reddit API — skrypt gotowy, brak kluczy OAuth2 w `.env`
- [ ] SEC EDGAR — skrypt gotowy, brak User-Agent w `.env`
- [ ] StockTwits — skrypt gotowy, nie testowane (publiczne, bez auth)
- [ ] Telegram Bot — skrypt gotowy, brak tokena bota w `.env`
- [ ] Anthropic Claude API — klucz potrzebny dopiero od Fazy 2

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
│   ├── test-sec-edgar.js    # ⏳ Czeka na User-Agent
│   ├── test-stocktwits.js   # ⏳ Nie testowane
│   └── test-telegram.js     # ⏳ Czeka na token bota
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
