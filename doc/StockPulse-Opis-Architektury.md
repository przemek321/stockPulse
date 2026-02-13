# StockPulse — Opis Architektury

> Intelligent Stock News & Sentiment Analysis Platform — Dokument Architektoniczny v1.0, Luty 2026
>
> Stack: NestJS + Event-Driven Architecture + AI/NLP

---

## 1. Co to jest StockPulse?

**StockPulse** to system, który automatycznie zbiera informacje z całego internetu (Twitter, Reddit, serwisy finansowe, SEC, Google Trends) i za pomocą sztucznej inteligencji analizuje nastrój rynku wobec konkretnych spółek giełdowych.

Wyobraź sobie, że masz tysiące osób, które 24/7 czytają każdy tweet, każdy post na Reddit, każdy artykuł i każdy filing w SEC — a potem w ciągu sekund mówią Ci: "Hej, nastrój wokół NVIDIA właśnie się załamał, 3x więcej negatywnych wzmianek niż normalnie, a insiderzy sprzedają." To właśnie robi StockPulse.

### Główny cel

**Wykrywać zmiany nastrojów ZANIM cena akcji się ruszy.** Rynek reaguje na news z opóźnieniem — często minuty do godzin. Ten system ma dawać Ci sygnał szybciej niż rynek zdoła zareagować.

### Dla kogo?

- Dla Ciebie — jako narzędzie wspomagające decyzje inwestycyjne
- Potencjalnie: SaaS dla daytraderów i swing traderów
- API dla botów tradingowych i algorytmów

---

## 2. Jak to działa? (4 warstwy)

System składa się z 4 warstw, które działają jak linia produkcyjna. Każda warstwa robi jedno zadanie i przekazuje dane dalej.

```
📡 ZBIERANIE  →  🧠 ANALIZA AI  →  💾 PRZECHOWYWANIE  →  📊 DOSTARCZENIE
   Warstwa 1        Warstwa 2          Warstwa 3              Warstwa 4
```

---

### Warstwa 1: Zbieranie danych

Ta warstwa to "uszy" systemu. Składa się z 4 kolektorów, z których każdy specjalizuje się w innym typie źródła danych.

#### Social Media Collector

**Co robi:** Podłącza się do Twittera/X (Filtered Stream API), Reddita (r/wallstreetbets, r/stocks, r/investing), StockTwits i Discorda. Szuka postów zawierających tickery ($AAPL, $TSLA itd.), nazwy spółek i kluczowe słowa jak "earnings", "FDA", "crash".

**Jak działa:** Twitter daje real-time stream (dane płyną ciągle). Reddit i StockTwits są odpytywane co 30-60 sekund. Każdy post dostaje timestamp, źródło, rozpoznane tickery i trafia do kolejki przetwarzania.

**Dlaczego ważne:** Social media często reaguje PRZED mediami tradycyjnymi. Tweet insajdera lub nagły spike wzmianek może sygnalizować ruch ceny na minuty-godziny wcześniej.

#### News Collector

**Co robi:** Zbiera artykuły z Finnhub, Benzinga, Yahoo Finance i Google News. Filtruje po tickerach i kategoriach (earnings, analyst ratings, M&A, FDA, macro).

**Jak działa:** Kombinacja RSS feedów (polling co 30s) i WebSocketów (real-time) tam gdzie API to oferuje. Artykuły są deduplikowane algorytmem SimHash — jeśli 10 serwisów puści tę samą wiadomość, system widzi ją raz, ale notuje, że pojawiła się w 10 źródłach (co samo w sobie jest sygnałem ważności).

#### SEC Filing Collector

**Co robi:** Monitoruje EDGAR (bazę danych SEC) pod kątem nowych filingów: Form 4 (insider trades — kiedy CEO kupuje/sprzedaje akcje), 8-K (istotne wydarzenia), 13F (co kupują duże fundusze), 10-K/10-Q (kwartalne/roczne raporty).

**Dlaczego ważne:** Insiderzy kupujący akcje własnej firmy to jeden z najsilniejszych sygnałów bullish. Kiedy CEO Molina sprzedaje przed katastrofą wynikową — ten system to wyłapie zanim gazety o tym napiszą.

#### Alternative Data Collector

**Co robi:** Zbiera dane, których większość traderów nie śledzi: Google Trends (czy ludzie nagle szukają "Molina Healthcare lawsuit"?), ilość ofert pracy firmy (firma zatrudnia = rośnie; zwalnia = problemy), aktywność na GitHubie (dla firm tech), nowe patenty.

**Jak działa:** To jest batch collection — zbiera dane raz dziennie lub raz w tygodniu, bo te źródła nie zmieniają się co sekundę. Ale trendy w tych danych mogą pokazać zwrot na tygodnie przed rynkiem.

---

### Warstwa 2: Analiza AI/NLP

To "mózg" systemu. Każdy zebrany tekst przechodzi przez 4 moduły analizy.

#### Sentiment Engine (Analiza nastrojów)

**Co robi:** Czyta tekst i ocenia czy jest pozytywny, negatywny czy neutralny wobec danej spółki. Daje score od -1.0 (ultra bearish) do +1.0 (ultra bullish) z poziomem pewności.

**Jak działa (2-etapowo):**

- **Etap 1 — FinBERT (szybki, darmowy):** Specjalizowany model AI wytrenowany na tekstach finansowych. Przetwarza tysiące tekstów na minutę lokalnie na Twoim RTX 6000 Ada. Pokrywa ~80% potrzeb.
- **Etap 2 — Claude Haiku (precyzyjny, płatny):** Wchodzi tylko dla ważnych itemów: earnings calls, SEC filings, anomalie. Rozumie kontekst, sarkazm, złożone zdania. Kosztuje grosze per request.

**Przykład:** Tweet "$MOH is done, management just torpedoed guidance" → FinBERT: score -0.82, confidence: HIGH. System natychmiast aktualizuje score Molina.

#### Entity Extractor (Rozpoznawanie entitów)

**Co robi:** Czyta tekst i automatycznie rozpoznaje: tickery ($AAPL, $MOH), osoby (CEO, analitycy), typy zdarzeń (earnings, FDA, M&A), liczby (ceny, procenty). Wie że "Google", "Alphabet" i "GOOGL" to ta sama firma.

#### Event Classifier (Klasyfikator zdarzeń)

**Co robi:** Kategoryzuje każdy news/post do typu zdarzenia i nadaje priorytet:

| Typ zdarzenia | Priorytet | Przykład |
|---------------|-----------|----------|
| Earnings beat/miss | **CRITICAL** | Molina obcina prognozę o 63% |
| Insider trade (duży) | **CRITICAL** | CEO sprzedaje $5M w akcjach |
| Analyst upgrade/downgrade | **HIGH** | Goldman obniża z Buy na Neutral |
| FDA decision | **HIGH** | FDA zatwierdza nowy lek |
| M&A / przejęcie | **HIGH** | EVTC przejmuje Dimensa |
| Guidance change | **MEDIUM** | Firma podnosi/obniża prognozy |
| Analyst note | **LOW** | Rutynowy research note |

#### Anomaly Detector (Detektor anomalii)

**Co robi:** Monitoruje "normalny" poziom aktywności każdego tickera i alarmuje gdy coś jest nietypowe. Używa statystyki (z-score) — jeśli ilość wzmianek przekracza 3 odchylenia standardowe od 30-dniowej średniej, to znaczy że coś się dzieje.

**Przykład z życia:** W normalny dzień Molina ma ~50 wzmianek. 6 lutego nagle wyskoczyło 2000+. System wykrywa to w ciągu minut i wysyła alert CRITICAL zanim większość traderów się zorientuje.

---

### Warstwa 3: Przechowywanie i eventy

Ta warstwa to "kręgosłup" systemu — Event-Driven Architecture, czyli dokładnie to, czego się teraz uczysz.

#### Event Bus (Redis Streams)

**Co to jest:** Centralny autobus zdarzeń. Każdy moduł "publikuje" eventy (np. `NewArticleEvent`, `SentimentScoreEvent`, `AnomalyDetectedEvent`), a inne moduły je "subskrybują" i reagują. To znaczy, że moduły nie wiedzą o sobie nawzajem — są luźne (loosely coupled).

**Dlaczego Redis a nie Kafka:** Redis Streams to prostszy odpowiednik Kafki. Wystarczający na start, łatwiejszy w konfiguracji, a jeśli scale wymusi — migracja do Kafki jest prosta bo architektura eventów pozostaje ta sama.

#### TimescaleDB (baza time-series)

**Co to jest:** PostgreSQL z dodaną supermocą do danych czasowych. Przechowuje sentiment scores, wolumeny wzmianek, korelacje z cenami — wszystko z timestampem. Automatyczne partycjonowanie i agregaty (np. średni sentiment GOOGL na każdą godzinę).

**Dlaczego nie Azure Data Explorer/Kusto:** Mógłbyś użyć Kusto (którego znasz z Unilevera), ale TimescaleDB jest tańszy na tym scale i możesz go self-hostować na home labie. Składnia SQL, którą dobrze znasz.

#### Elasticsearch (wyszukiwanie)

**Co to jest:** Silnik pełnotekstowego wyszukiwania. Indeksuje wszystkie artykuły i posty. Pozwala na błyskawiczne zapytania typu: "pokaż mi wszystkie negatywne wzmianki o PAGS z ostatnich 24h które wspominają Brazil albo currency".

#### Redis Cache

**Co to jest:** Pamięć podręczna. Trzyma aktualne "gorące" dane: bieżące sentiment scores, trending tickery, ostatnie alerty. Dashboard ładuje się w milisekundach zamiast odpytywać bazę za każdym razem.

---

### Warstwa 4: Dostarczenie (output)

Tu Twoje dane zamieniają się w konkretną wartość — dashboard, alerty i API.

#### Dashboard (React)

**Co to jest:** Ciemny interfejs webowy (trader-friendly) z real-time aktualizacjami przez WebSocket. Zawiera:

- **Heatmapę sentimentu** — kolorowa mapa Twoich tickerów od czerwonego (bearish) do zielonego (bullish)
- **Trending tickery** — które spółki mają nagły wzrost aktywności
- **Feed alertów** — live stream ważnych wydarzeń z klasyfikacją
- **Wykresy sentimentów w czasie** — jak nastroje zmieniały się w ostatnich godzinach/dniach
- **Customizable watchlisty** — śledzisz tylko spółki które Cię interesują

#### System alertów

**Co to jest:** Natychmiastowe powiadomienia na Telegram, Discord, email lub push. Konfigurowalne reguły per ticker. Przykład: "Wyślij mi alert na Telegram gdy sentiment PAGS spadnie poniżej -0.5 LUB gdy ilość wzmianek przekroczy 5x normalne."

**Throttling:** Max 1 alert per ticker per 15 minut — żeby Cię nie zaspamować.

#### REST/GraphQL API

**Co to jest:** Programistyczny interfejs, który pozwala podłączyć własne boty, skrypty, modele ML. Przykłady endpointów:

- `GET /api/sentiment/GOOGL` → bieżący score + historia
- `GET /api/anomalies?last=24h` → anomalie z ostatnich 24 godzin
- `GET /api/filings/MOH?type=form4` → insider trades dla Molina
- `POST /api/webhooks` → rejestracja webhooków dla external systemów

#### AI Scoring Engine

**Co to jest:** Kompozytowy score per ticker — ważona średnia z wielu źródeł:

| Składnik | Waga | Co mierzy |
|----------|------|-----------|
| News Sentiment | 30% | Nastrój w mediach i artykułach |
| Social Sentiment | 25% | Nastrój na Twitter/Reddit |
| Insider Activity | 20% | Czy insiderzy kupują czy sprzedają |
| Mention Momentum | 15% | Czy wzmianki rosną/spadają |
| Alt Data Signal | 10% | Google Trends, job postings itd. |

**Wynik końcowy:** score od -100 do +100 z etykietą: **STRONG SELL** / **SELL** / NEUTRAL / **BUY** / **STRONG BUY**

---

## 3. Stack technologiczny

Cały system opiera się na technologiach, które znasz lub które są naturalnym rozszerzeniem Twojego stacku.

| Kategoria | Technologia | Dlaczego |
|-----------|-------------|----------|
| Runtime | Node.js 20+ / TypeScript | Twój główny język, async/await idealny do I/O-heavy scraping |
| Framework | NestJS 10+ | Znasz go. DI, moduły, Bull queues, CQRS — wszystko out-of-box |
| Kolejki | BullMQ + Redis | Job scheduling, retry, concurrency — serce pipeline'u |
| AI (bulk) | FinBERT (Python sidecar) | Darmowy, specjalizowany model. Runs na Twoim RTX 6000 Ada |
| AI (nuanced) | Claude Haiku API | Tani, szybki, rozumie kontekst finansowy |
| Baza główna | PostgreSQL + TimescaleDB | SQL (znasz z SQL Server) + time-series extensions |
| Wyszukiwanie | Elasticsearch / Meilisearch | Pełnotekstowe szukanie artykułów i postów |
| Cache + Events | Redis 7+ (Streams) | Cache + Event Bus + Pub/Sub w jednym |
| Frontend | React + Recharts | Znasz React. Recharts do wykresów finansowych |
| Infra | Docker + Azure | Docker Compose local, Azure Container Apps prod |

**Jedyny Python w systemie** to FinBERT sidecar — osobny mikroserwis z REST API. NestJS wywołuje go jak każdy inny HTTP service. Zero mieszania języków w głównym kodzie.

---

## 4. Plan wdrożenia (Roadmap)

### Faza 1 — MVP (4-6 tygodni)

Minimum viable product — działający pipeline z 2 źródłami i podstawowym sentymentem.

- NestJS monorepo z modułami + BullMQ queues
- Twitter collector (Filtered Stream API) + Reddit collector
- FinBERT sentiment scoring (bulk, lokalnie na GPU)
- TimescaleDB schema + basic CRUD
- Proste REST API endpoints
- Telegram bot do alertów
- Docker Compose do lokalnego developmentu

### Faza 2 — Core (6-8 tygodni)

Pełny pipeline z wieloma źródłami i zaawansowaną analizą.

- News collectors (Finnhub, Benzinga, Yahoo Finance RSS)
- SEC EDGAR monitor (insider trades, 8-K filings)
- Claude Haiku integration (nuanced analysis na ważnych itemach)
- Event classification pipeline (kategoryzacja zdarzeń)
- Anomaly detection (z-score na mention volume)
- React dashboard v1 (sentiment heatmap + alert feed)
- WebSocket real-time updates

### Faza 3 — Advanced (8-12 tygodni)

Zaawansowane funkcje i pełny scoring.

- Alt data collectors (Google Trends, patents, job postings)
- Cross-source correlation engine (korelacja między źródłami)
- AI Scoring Engine (composite score per ticker)
- GraphQL API + Swagger dokumentacja
- Dashboard v2 (watchlisty, zaawansowane wykresy, filtrowanie)
- Backtesting — porównanie sygnałów z historycznymi ruchami cen
- Azure deployment + monitoring + CI/CD

### Faza 4 — Edge (ongoing)

Ciągłe ulepszenia i nowe funkcjonalności.

- Custom FinBERT fine-tuning na Twoich danych
- Options flow / dark pool integration
- Earnings call transcript analysis (pełna analiza tone CEO)
- Multi-language support (PL, PT-BR)
- Mobile app (React Native)
- ML-based signal generation (automatyczne sygnały buy/sell)

---

## 5. Szacowane koszty miesięczne

| Usługa | Koszt/msc | Uwagi |
|--------|-----------|-------|
| Twitter/X API (Basic) | $100 | Filtered Stream, 10K tweetów/msc |
| Reddit API | $0 | Darmowe z OAuth, 100 req/min |
| Finnhub | $0 | Free tier: 60 calls/min |
| SEC EDGAR | $0 | Darmowe, limit 10 req/sec |
| Benzinga News | $79 | Real-time news feed |
| Claude API (Haiku) | ~$50-150 | Zależnie od wolumenu, tylko high-priority |
| FinBERT | $0 | Self-hosted na Twoim RTX 6000 Ada |
| TimescaleDB | $0-29 | Self-hosted na home lab LUB cloud $29 |
| Redis | $0-7 | Self-hosted LUB cloud $7 |
| Azure (produkcja) | $50-100 | Container Apps, pay-per-use |
| **SUMA** | **~$280-465** | **Niższy koniec jeśli self-hostujesz na home labie** |

**Trik oszczędnościowy:** FinBERT (darmowy) przetwarza 80% tekstów. Claude Haiku wchodzi tylko dla ~20% najważniejszych itemów. Twoja karta RTX 6000 Ada z 49GB VRAM to idealny lokalny serwer AI — FinBERT, a nawet większe modele, chodzą na niej bez problemu.

---

## 6. Przykład z życia: Molina Healthcare (6 lutego 2026)

Zobaczmy jak StockPulse zareagowałby na katastrofalne wyniki Molina, które analizowaliśmy wcześniej.

### Czwartek wieczorem (5 lutego), po zamknięciu rynku:

| Czas | Event | Co robi StockPulse |
|------|-------|--------------------|
| 17:01 | SEC Filing | SEC Collector wykrywa 8-K filing Molina z wynikami Q4 |
| 17:02 | NER + Classifier | AI parsuje: strata -$2.75 vs oczekiwane +$0.34. Klasyfikacja: EARNINGS MISS, priorytet: CRITICAL |
| 17:03 | Anomaly Detector | Spike wzmianek $MOH: z 50/h do 800/h. Z-score: 15.2 (mega anomalia) |
| 17:03 | **ALERT** | Telegram: "⚠️ CRITICAL: $MOH earnings catastrophic miss. EPS: -$2.75 vs est. +$0.34. Guidance slashed 63%. Sentiment: -0.91" |
| 17:05 | Sentiment Engine | Twitter/Reddit eksploduje negatywem. Aggregate sentiment: -0.87. News sentiment: -0.93 |
| 17:10 | Scoring Engine | Composite score MOH: -89/100 (STRONG SELL). Korelacja z CNC (Centene): sentiment też spada |
| Piątek 9:30 | Rynek otwiera się | MOH otwiera -28%. Kto miał StockPulse, wiedział 12 godzin wcześniej. |

**Wnioski:** System dałby Ci alert o 17:03 — ponad 16 godzin przed otwarciem rynku. Nawet jeśli nie handlujesz after-hours, miałbyś całą noc na analizę i decyzję.

---

## 7. Podsumowanie

StockPulse to profesjonalny system intelligence rynkowego, który:

- **Zbiera** dane z 10+ źródeł automatycznie, 24/7
- **Analizuje** sentiment za pomocą specjalizowanej AI (FinBERT + Claude)
- **Wykrywa** anomalie i klasyfikuje zdarzenia według priorytetu
- **Alarmuje** Cię natychmiast przez Telegram/Discord/email
- **Scoruje** spółki kompozytowym wskaźnikiem od -100 do +100
- **Uczy się** — backtesting pozwala weryfikować jakość sygnałów vs realne ruchy cen

Zbudowany na **NestJS + Event-Driven Architecture** — technologiach które znasz i rozwijasz. Wykorzystuje Twój **RTX 6000 Ada** do lokalnego AI inference. Koszt startu: ~$280-465/msc z dużym potencjałem optymalizacji przez self-hosting.
