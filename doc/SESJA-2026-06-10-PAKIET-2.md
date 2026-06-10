# Sesja 10.06.2026 — domknięcie planu 09.06: backfill, options off, Pakiet 2, kalendarz

> Kontynuacja [SESJA-2026-06-09-PAKIET-1.md](SESJA-2026-06-09-PAKIET-1.md) (7 fixów
> Pakietu 1). Dziś wykonana RESZTA planu [PLAN-EDGE-IMPROVEMENTS-2026-06-09.md](PLAN-EDGE-IMPROVEMENTS-2026-06-09.md)
> — po tej sesji **cały plan z badania 09.06 jest wdrożony**. 8 commitów
> (`e17c947..754d453`), wszystko na produkcji, **695/695 unit testów**.

## Chronologia

| Commit | Co |
|---|---|
| `e17c947` | **Backfill 10b5-1** wykonany (zgoda Przemka „rob backfill") |
| `03a784e` | **Options flow CRON off** (zgoda: „ok zostaw wylaczone") + weryfikacja retencji Polygon |
| `a59b191` | docs options off (CLAUDE.md kolektory/scheduler) |
| `b5af710` | **Frontend dogoniony**: kolumny +7d/α7d, etykiety bullish-8K, panel opcji „OFF" |
| `1d9b85d` | **Pakiet 2: discovery Form 4 sector-wide** (po adwersarialnej weryfikacji 3× block → fix) |
| `6f72f32` `d5094df` | docs Pakiet 2 ([PAKIET-2-DISCOVERY-2026-06-10.md](PAKIET-2-DISCOVERY-2026-06-10.md)) |
| `754d453` | **Kalendarz walidacji** w raporcie 8h Telegram + [KALENDARZ-WALIDACJI-2026.md](KALENDARZ-WALIDACJI-2026.md) |

## 1. Backfill 10b5-1 (752 + 1246 wierszy)

Po zgodzie Przemka. Pierwsze wykonanie skryptu złapało tylko **488/752** — diagnoza:
**1512 starych wierszy miało NULL** w `is10b51Plan` (kolekcje sprzed defaulta kolumny),
a warunek SQL `= false` pomija NULL-e. Dograne `IS DISTINCT FROM true` (+264) +
normalizacja NULL→false dla audytowanych filingów discretionary (1246). Stan końcowy:
**plan 758** (552 SELL / **0 BUY**), NULL tylko 2 artefakty `Aggregate MSPR` (nie-SEC).
Od teraz 30-dniowa historia w promptach GPT pokazuje poprawne flagi.
Log wykonania: `scripts/db/backfill-10b51-2026-06-09.sql`.

## 2. Options flow CRON off (odwracalnie)

Przemek potwierdził free tier Polygona i dał zgodę. **Warunek z planu sprawdzony przed
wyłączeniem na żywym kluczu**: Polygon zwraca dzienne agregaty wstecz także dla
WYGASŁYCH kontraktów (test O:CVS260320C00075000 — 34 bary) → spike detection
rekonstruowalny retroaktywnie, przerwa nic nie traci. Scheduler w trybie cleanup-only
(wzorzec Sprint 11), kod/dane/API/frontend zostają. INSIDER_PLUS_OPTIONS de facto
martwy (akceptowalne — jego 3 winnery były re-broadcastami standalone Form 4 BUY);
korelacje = INSIDER_PLUS_8K. Zysk: koniec 6h zombie-cyklu/dzień.

## 3. Frontend dogoniony po sprintach (pytanie Przemka „na widoku mam 3d max")

- **PriceOutcomePanel**: kolumny `+7d` i `α7d` (XBI-alpha 7d, fallback IBB) — horyzont,
  na którym walidujemy APLS Fazę 4 i werdykt edge; legacy alerty pokazują „—".
- **nonDeliveryLabel**: 2 nowe reasony z P1-02 (`bullish_8k_no_edge`,
  `bullish_no_consensus_data`) — bez tego chip pokazywałby surowy snake_case.
- **Panel Options Flow** oznaczony „kolektor OFF 10.06.2026 — dane historyczne".

## 4. Pakiet 2 — discovery Form 4 sector-wide (główna praca dnia)

Zgoda Przemka: „robimy pakiet 2". Szczegóły architektury:
[PAKIET-2-DISCOVERY-2026-06-10.md](PAKIET-2-DISCOVERY-2026-06-10.md). W skrócie:
zamiast czekać, aż insider kupi jedną z 28 spółek z listy, system skanuje **wszystkie
Form 4 z EDGAR** (~1900/dzień): poll atomu getcurrent co 5 min (stagger +2 min vs core)
→ lejek SIC healthcare/biotech → discretionary BUY ≥$500K C-suite/Director → mcap
≥$250M + ADV ≥$1M → **auto-rejestracja w observation mode** (`healthcare_discovery`)
→ standardowy Form4Pipeline (GPT, alert DB-only, zero korelacji). Nightly
reconciliation z daily-index 22:40 ET. Cap 5 rejestracji/dzień (data ET).

**Weryfikacja adwersarialna przed commitem dała 3× block** — najgroźniejszy P1:
daily-index ma **dwa wiersze per filing** (emitent + osoba raportująca, sortowane
alfabetycznie po nazwie) — wiersz osoby oznaczałby accession jako obejrzany zanim
wiersz emitenta zostałby przetworzony → reconciliation gubiłaby ~50% filingów
(zmierzone na żywym pliku: 1888 wierszy = 890 accessionów). Naprawione + 10 innych
problemów (transient Finnhub ≠ deterministyczny reject, „Harvard hole" w filtrze ról,
cap po złej strefie, 4/A, kolizja slotów cron, partial-failure kroku 7...).

**Pierwszy żywy cykl** (19:07 ET): `entries=42, fresh=42, registered=0` w 15s —
wszystkie filingi odrzucone deterministycznie (prawidłowo: kwalifikujący sygnał
pojawia się 2-5×/tydzień), cache SIC zaczął się grzać (24 CIK-i).

**Delivery NIE włączone** — okno obserwacyjne 30-60d, przegląd **25.07**, potem
top-N (1-2/tydzień).

## 5. Kalendarz walidacji (prośba Przemka o przypomnienia)

Crony harnessu okazały się session-only → przypomnienia wbudowane w **raport 8h
Telegram**: sekcja „📅 Kalendarz walidacji" od 7 dni przed terminem do 3 dni po
(`⚠️ ZALEGŁY`). Daty: 09.07 APLS Faza 4 · 25.07 discovery obs · 25.08 FIX-16 shadow ·
01.09 werdykt edge · 07.09 bullish-8K revisit. Kryteria per data:
[KALENDARZ-WALIDACJI-2026.md](KALENDARZ-WALIDACJI-2026.md).
Po wykonaniu przeglądu: usuń wpis z `VALIDATION_CALENDAR` (summary-scheduler).

## Stan systemu po dwóch dniach (09-10.06)

- **Cały plan z badania 09.06 wdrożony**: Pakiet 1 (7 fixów) + backfill + options off
  + Pakiet 2 + kalendarz. 15 commitów kodu/docs, każdy kodowy z rebuildem produkcji.
- **Testy**: 595 → **695 unit** (+100 w dwa dni), `tsc` czysty, pre-push hook za każdym razem.
- **Aktywne kolektory**: SEC EDGAR (core, :05/:35) + Form4 Discovery (co 5 min, 6-22 ET)
  + PDUFA.bio. Wyłączone: Options Flow (10.06), StockTwits, Finnhub news.
- **System czeka teraz na dane**: APLS (6 tickerów) + discovery (auto-rejestracje)
  budują próbkę obserwacyjną; FIX-16 shadow zbiera przypadki przez Q2 earnings;
  pierwsze decyzje w lipcu wg kalendarza.

## Health-check po 24h (10.06 wieczór, na prośbę Przemka)

**Działa:**
- Kontenery up, app healthy, **zero ERROR-level logów w 16h**; autostart po reboocie
  Jetsona (~05:00 UTC) wstał z najnowszym obrazem.
- Core SEC EDGAR: 48 cykli SUCCESS, PDUFA 15 cykli.
- Discovery: **182 cykle poll** (4830 wpisów atomu, 636 fresh) + reconciliation 02:44
  (1574 wiersze idx, 930 fresh). PARSER_EMPTY ×4 (11:47-12:02 UTC — EDGAR przejściowo
  pusty 15 min, samo się odbudowało, warn-y zadziałały).
- **Pierwszy auto-odkryty ticker: EYE** (National Vision Holdings, SIC 3851) — złapany
  przez RECONCILIATION, nie poll (dokładnie scenariusz, dla którego istnieje — i który
  działa tylko dzięki dual-row fixowi z weryfikacji). Pełen łańcuch: rejestracja →
  kanoniczny persist → Form4Pipeline → GPT → alert id 2432 CRITICAL observation
  (Director Nicholson BUY, priceAtAlert $16.46, DB-only). Uwaga do przeglądu 25.07:
  National Vision to retail optyczny — czy SIC 3851 nie jest za szeroki.
- **Bullish-8K gate (P1-02) złapał żywy case**: MOH 10.06 20:35, bullish 8-K →
  `bullish_8k_no_edge` DB-only (dokładnie klasa 0/4 śr. −4.4% z forward-oceny).

**Znalezione i naprawione (3c8f62c):**
- Stray run POLYGON 05:04 UTC (30 kontraktów) — `removeRepeatableByKey` usuwa konfig
  repeatu, ale NIE zmaterializowane delayed instancje; jedna przeżyła wyłączenie
  i odpaliła po reboocie. Fix: `queue.drain(true)` przy starcie; zweryfikowane
  delayed=0/waiting=0. Stray run nieszkodliwy (dane options dopisane, zero alertów,
  zero correlated).
