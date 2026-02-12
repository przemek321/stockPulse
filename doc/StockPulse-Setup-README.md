# ⚡ StockPulse — Krok 0: Setup API

## Quick Start

```bash
# 1. Skopiuj env
cp .env.example .env

# 2. Uzupełnij klucze (patrz instrukcje poniżej)
nano .env

# 3. Zainstaluj zależności
npm init -y && npm install dotenv

# 4. Testuj po kolei lub wszystko naraz
node scripts/test-all.js
```

---

## 📋 Kolejność zakładania kont

| #  | Serwis       | Koszt   | Czas | Priorytet |
|----|-------------|---------|------|-----------|
| 1  | SEC EDGAR   | $0      | 2min | ⭐⭐⭐⭐⭐ |
| 2  | Finnhub     | $0      | 5min | ⭐⭐⭐⭐⭐ |
| 3  | StockTwits  | $0      | 0min | ⭐⭐⭐⭐⭐ |
| 4  | Reddit      | $0      | 10min| ⭐⭐⭐⭐  |
| 5  | Telegram    | $0      | 5min | ⭐⭐⭐⭐  |
| 6  | Anthropic   | ~$5 min | 5min | ⭐⭐⭐   |
| 7  | Twitter/X   | $200/msc| 10min| ⭐⭐ (later) |

**Łączny koszt MVP: $0-5** (bez Twittera)

---

## 1️⃣ SEC EDGAR (0 minut, $0)

**Nie wymaga rejestracji!** Jedyne co potrzebujesz to User-Agent.

```
SEC_USER_AGENT=StockPulse twoj.email@gmail.com
```

Wpisz powyższe w `.env` — gotowe.

- Docs: https://www.sec.gov/search-filings/efts/efts-search-api
- Limit: 10 req/sec
- Test: `node scripts/test-sec-edgar.js`

---

## 2️⃣ Finnhub (5 minut, $0)

1. Otwórz: https://finnhub.io/register
2. Zarejestruj się (email + hasło)
3. Po zalogowaniu → Dashboard → API Key jest na głównej stronie
4. Wklej do `.env`:
   ```
   FINNHUB_API_KEY=cXXXXXXXXXXXXXXXXX
   ```

- Free tier: 60 calls/min, real-time US quotes, news, fundamentals
- Test: `node scripts/test-finnhub.js`

---

## 3️⃣ StockTwits (0 minut, $0)

**Oficjalna rejestracja API jest zamknięta!** Ale publiczne endpointy działają bez tokena.

Nie musisz nic konfigurować — skrypt testowy użyje publicznych URL-i.

- Public endpoint: `https://api.stocktwits.com/api/2/streams/symbol/AAPL.json`
- Limit: ~200 req/hour
- Bonus: wbudowany sentiment (Bullish/Bearish) per wiadomość!
- Test: `node scripts/test-stocktwits.js`

---

## 4️⃣ Reddit (10 minut, $0)

1. Zaloguj się na Reddit
2. Otwórz: https://www.reddit.com/prefs/apps
3. Kliknij **"create another app..."** na dole
4. Wypełnij:
   - **name**: StockPulse
   - **type**: ✅ script
   - **description**: Stock sentiment analysis
   - **redirect uri**: `http://localhost:3000/callback`
5. Kliknij **"create app"**
6. Zanotuj:
   - **client_id** — pod nazwą apki (krótki string)
   - **client_secret** — obok "secret"
7. Wklej do `.env`:
   ```
   REDDIT_CLIENT_ID=xxxxxxxxxx
   REDDIT_CLIENT_SECRET=yyyyyyyyyyyyyyyy
   REDDIT_USERNAME=twoj_username
   REDDIT_PASSWORD=twoje_haslo
   ```

⚠️ **Ważne**: Jeśli masz 2FA na Reddit, musisz je **wyłączyć** dla script apps lub użyć web app flow zamiast tego.

- Free: 100 req/min z OAuth2
- Test: `node scripts/test-reddit.js`

---

## 5️⃣ Telegram Bot (5 minut, $0)

1. Otwórz Telegram → szukaj **@BotFather**
2. Wyślij: `/newbot`
3. Podaj nazwę wyświetlaną: `StockPulse Alerts`
4. Podaj username: `stockpulse_alerts_bot` (musi być unikalne)
5. BotFather da Ci **token** — skopiuj go
6. Napisz cokolwiek do swojego nowego bota
7. Otwórz w przeglądarce:
   ```
   https://api.telegram.org/bot<TWOJ_TOKEN>/getUpdates
   ```
8. Znajdź `"chat":{"id": XXXXXXXX}` — to Twój Chat ID
9. Wklej do `.env`:
   ```
   TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
   TELEGRAM_CHAT_ID=987654321
   ```

- Test: `node scripts/test-telegram.js`

---

## 6️⃣ Anthropic / Claude API (5 minut, ~$5 minimum)

Potrzebne dopiero w **Fazie 2** (Sprint 6). Możesz założyć teraz lub później.

1. Otwórz: https://console.anthropic.com/
2. Zarejestruj się
3. Dodaj billing (min. $5 credit)
4. Settings → API Keys → Create Key
5. Wklej do `.env`:
   ```
   ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxx
   ```

- Model: Claude Haiku (najtańszy)
- Koszt: ~$0.25/1M input tokens, ~$1.25/1M output tokens

---

## 7️⃣ Twitter/X API (odłożone na później)

**Rekomendacja: NIE zakładaj teraz.** Free tier jest write-only (bezużyteczny dla StockPulse). Basic = $200/msc za zaledwie 10K tweetów.

Alternatywy na Fazę 2:
- Poczekaj na pay-per-use (closed beta)
- 3rd-party: TwitterAPI.io ($49/msc), RapidAPI wrappers
- Scraping publicznych danych (ryzykowne)

---

## 🧪 Testowanie

```bash
# Testuj pojedynczo:
node scripts/test-stocktwits.js    # Nie wymaga nic — od razu!
node scripts/test-sec-edgar.js     # Tylko User-Agent w .env
node scripts/test-finnhub.js       # Wymaga FINNHUB_API_KEY
node scripts/test-reddit.js        # Wymaga Reddit OAuth2
node scripts/test-telegram.js      # Wymaga Bot Token + Chat ID

# Testuj wszystko naraz:
node scripts/test-all.js
```

Każdy skrypt sprawdza czy masz odpowiednie zmienne w `.env` i daje jasny error message co brakuje.

---

## ✅ Checklist

- [ ] `.env.example` skopiowany jako `.env`
- [ ] SEC EDGAR — User-Agent dodany
- [ ] Finnhub — API key z dashboard
- [ ] StockTwits — nic (publiczne endpointy)
- [ ] Reddit — App created, client_id + secret w .env
- [ ] Telegram — Bot created, token + chat_id w .env
- [ ] `node scripts/test-all.js` — wszystko zielone
- [ ] (Opcjonalnie) Anthropic API key dla Fazy 2

**Po ukończeniu → gotowy na Sprint 1!** 🚀
