# StockPulse — Slownik terminow i skrotow

> Wszystkie terminy, skroty i metryki uzywane na dashboardzie, w alertach Telegram i w kodzie.

## Metryki sygnalw — priorytet interpretacji

| Termin | Skrot | Znaczenie | Priorytet | Gdzie na froncie |
|--------|-------|-----------|-----------|------------------|
| **Conviction** | conv | Sila przekonania AI o kierunku ceny. Skala -2.0 do +2.0. Ujemna = bearish, dodatnia = bullish. Im wyzszy |conv|, tym silniejszy sygnal. | **KRYTYCZNY** | Signal Timeline (chip na karcie), alerty Telegram |
| **Hit Rate 1d** | hit rate, hit | % alertow gdzie przewidziany kierunek potwierdzil sie cena po 1 dniu handlowym. >70% = edge, <50% = moneta. | **KRYTYCZNY** | Signal Timeline (summary bar), Price Outcome |
| **Direction** | dir, ▲/▼ | Kierunek sygnalu: `positive` (bullish ▲) = oczekiwany wzrost, `negative` (bearish ▼) = oczekiwany spadek. | **WYSOKI** | Signal Timeline (strzalki), alerty Telegram |
| **Direction Consistency** | consistency | % alertow idacych w dominujacym kierunku na danym tickerze. 90% = silny trend, 50% = szum. | **WYSOKI** | Signal Timeline (summary bar, chip "75% bullish") |
| **Price at Alert** | priceAtAlert | Cena akcji w momencie wyslania alertu (z Finnhub /quote). Punkt odniesienia dla delt. | **WYSOKI** | Signal Timeline (karta), Price Outcome |
| **Delta 1h/4h/1d/3d** | +1h%, +4h%, +1d%, +3d% | Zmiana ceny w % od priceAtAlert po 1h, 4h, 1 dniu, 3 dniach handlowych. Zielony = wzrost, czerwony = spadek. | **WYSOKI** | Signal Timeline (karta), Price Outcome |
| **Gap** | gap, hoursSincePrev | Czas w godzinach miedzy kolejnymi alertami na tym samym tickerze. Krotki gap (24h) + ten sam kierunek = pattern. | **SREDNI** | Signal Timeline (separator miedzy kartami) |
| **Price Delta from Prev** | priceDeltaFromPrev | Zmiana ceny w % miedzy dwoma kolejnymi alertami. Pokazuje co rynek zrobil miedzy sygnalami. | **SREDNI** | Signal Timeline (separator) |
| **Same Direction** | zgodny/sprzeczny | Czy aktualny alert ma ten sam kierunek co poprzedni. Zielony = pattern, czerwony = mixed signal. | **SREDNI** | Signal Timeline (kolor separatora) |
| **Avg Gap** | avg gap | Sredni czas miedzy alertami na tickerze. Krotki avg gap = aktywny ticker, dlugi = sporadyczne sygnaly. | **NISKI** | Signal Timeline (summary bar) |

## Typy alertow (reguly)

| Regula | Skrot | Co wykrywa | Zrodlo danych | Priorytet |
|--------|-------|------------|---------------|-----------|
| **Form 4 Insider Signal** | Form4 | Insider (CEO/CFO/EVP) kupuje lub sprzedaje akcje. Tylko discretionary (bez planow 10b5-1). Claude Sonnet analizuje kontekst. | SEC EDGAR Form 4 | **WYSOKI** |
| **8-K Material Event GPT** | 8-K | Istotne zdarzenie korporacyjne (kontrakt, wyniki, zmiana CEO, bankructwo). Claude Sonnet analizuje tresc. | SEC EDGAR 8-K | **WYSOKI** |
| **8-K Earnings Miss** | 8-K Earnings | Wyniki kwartalne gorsze od oczekiwan. | SEC EDGAR 8-K Item 2.02 | **WYSOKI** |
| **8-K Leadership Change** | 8-K Leadership | Zmiana na kluczowym stanowisku (CEO, CFO, CLO). Claude rozroznia: planowa emerytura vs kryzys vs relief rally. | SEC EDGAR 8-K Item 5.02 | **WYSOKI** |
| **8-K Bankruptcy** | 8-K Bankruptcy | Wniosek o upadlosc (Item 1.03). Natychmiastowy alert CRITICAL bez czekania na AI. | SEC EDGAR 8-K Item 1.03 | **KRYTYCZNY** |
| **Correlated Signal** | Correlated | Dwa+ zrodla sygnalw potwierdzaja ten sam kierunek w krotkim oknie czasowym (insider + opcje, insider + 8-K, 2+ insiders). | CorrelationService (Redis) | **KRYTYCZNY** |
| **Unusual Options Activity** | Options | Anomalia wolumenu opcji: volume >= 3x sredniej 20-dniowej. Scoring heurystyczny (spike, OTM, DTE, call/put). Alert TYLKO z PDUFA boost. | Polygon.io (EOD) | **WYSOKI** |

## Wzorce korelacji

| Wzorzec | Skrot | Co wykrywa | Okno czasowe |
|---------|-------|------------|--------------|
| **INSIDER_CLUSTER** | cluster | 2+ insiders C-suite sprzedaje/kupuje ten sam ticker | 7 dni |
| **INSIDER_PLUS_8K** | insider+8K | Insider trade + filing 8-K na tym samym tickerze | 24h |
| **INSIDER_PLUS_OPTIONS** | insider+options | Insider trade + anomalia opcyjna na tym samym tickerze | 72h |

## Terminy opcyjne (Options Flow)

| Termin | Skrot | Znaczenie |
|--------|-------|-----------|
| **Spike Ratio** | spike | Stosunek dzisiejszego wolumenu opcji do sredniej 20-dniowej. 3x = minimalny spike, 10x = silny, >1000x = suspicious (anomalia danych). |
| **Call/Put Ratio** | call/put | Proporcja opcji call (bullish) do put (bearish). >0.65 = call dominance (bullish), <0.35 = put dominance (bearish), 0.35-0.65 = mixed. |
| **OTM Distance** | OTM% | Out-of-the-money — jak daleko strike od ceny aktuali. 2% = blisko (drogie, wazne), 25% = daleko (tanie, spekulacja). |
| **DTE** | DTE | Days to Expiration — ile dni do wygasniecia opcji. Krotsze DTE = pilniejszy sygnal, dlugie DTE = mniej istotny. |
| **PDUFA Boost** | PDUFA boost | Mnoznik x1.3 na conviction gdy ticker ma nadchodzaca date decyzji FDA w ciagu 30 dni. Standalone alert TYLKO z PDUFA boost. |

## Terminy insiderskie (Form 4)

| Termin | Znaczenie |
|--------|-----------|
| **Discretionary** | Transakcja z wlasnej woli insidera (realny sygnal). Przeciwienstwo planu 10b5-1. |
| **10b5-1 Plan** | Pre-zaplanowany automatyczny plan sprzedazy akcji. Niski sygnal — CEO moze miec plan sprzedazy $1M/miesiac niezaleznie od newsow. |
| **C-suite** | Kadra zarzadzajaca: CEO, CFO, COO, CMO, CTO, President, Chairman, EVP. Ich transakcje maja wyzszy priorytet. |
| **Cluster selling** | 2+ insiders sprzedaje ten sam ticker w 7 dni. Silniejszy sygnal bearish niz pojedyncza sprzedaz. |

## Terminy cenowe (Price Outcome)

| Termin | Znaczenie |
|--------|-----------|
| **Price at Alert** | Cena w momencie alertu. Punkt referencyjny. |
| **Effective Start** | Czas startu liczenia slotow cenowych. Alerty pre-market → start od otwarcia NYSE (9:30 ET), alerty w sesji → od momentu alertu. |
| **Price 1h/4h/1d/3d** | Cena akcji po 1 godzinie / 4 godzinach / 1 dniu / 3 dniach od effective start. |
| **Direction Correct** | Czy alert trafnie przewidzial kierunek: ▲ + cena wzrosla = trafny (✓), ▲ + cena spadla = nietrafny (✗). |
| **Price Outcome Done** | Czy CRON zakonczyl zbieranie cen (wszystkie 4 sloty wypelnione lub hard timeout 7d). |

## Panel Status Systemu

| Termin | Znaczenie |
|--------|-----------|
| **Overall: HEALTHY/WARNING/CRITICAL** | Ogolny status systemu. HEALTHY = zero bledow 24h. WARNING = 1-2 bledy. CRITICAL = 3+ bledy kolektora. |
| **Errors 24h** | Liczba bledow kolektora w ostatnich 24 godzinach. |
| **Failed jobs 7d** | Liczba nieudanych jobow BullMQ w ostatnich 7 dniach. |
| **Pipeline 24h: total (AI)** | Ile filingow SEC przetworzyc w 24h. "(89 AI)" = 89 wyslanych do Claude Sonnet. |
| **Delivered vs Silent** | Delivered = wyslany na Telegram. Silent = zapisany w DB ale nie wyslany (regula w SILENT_RULES). |
| **Daily limit** | Max 5 alertow Telegram per ticker per dzien (UTC). Zapobiega spamowi. |

## Ticker Profile (kontekst AI)

| Termin | Znaczenie |
|--------|-----------|
| **Signal Profile** | Profil historyczny tickera (90 dni) wstrzykiwany do promptu Claude. Zawiera hit rate, dominant direction, breakdown per regula, ostatnie 3 sygnaly. |
| **Calibration Rules** | Instrukcje dla Claude jak kalibrowac conviction na podstawie profilu: hit rate >70% → boost, <40% → reduce. |
| **Dominant Direction** | Dominujacy kierunek sygnalw na tickerze: bullish/bearish/mixed. |

## Priorytety alertow

| Priorytet | Kolor | Kiedy |
|-----------|-------|-------|
| **CRITICAL** | 🔴 Czerwony | Bankruptcy, korelacja multi-source, opcje z conv >= 0.7 |
| **HIGH** | 🟠 Pomaranczowy | Insider discretionary, 8-K z analizy Claude, opcje z PDUFA boost |
| **MEDIUM** | 🔵 Niebieski | Insider mniejszy, 8-K rutynowy |
| **LOW** | ⚪ Szary | Nie wysylany na Telegram (tylko DB) |

## Linki frontend

| Zakladka | URL | Co pokazuje |
|----------|-----|-------------|
| **Dashboard** | http://localhost:3001 (tab 0) | Status Systemu + Edge Signals (Form 4, 8-K, Insider, Options, PDUFA, Correlated) + Price Outcome |
| **Signal Timeline** | http://localhost:3001 (tab 1) | Sekwencja sygnalw per ticker z conviction, deltami, gapami, hit rate |
| **System Logs** | http://localhost:3001 (tab 2) | Logi systemowe z filtrowaniem po module i statusie |
