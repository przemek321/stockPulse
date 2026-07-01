# Discovery funnel — archiwum odrzutów z logów kontenera (zgrane 02.07.2026)

**Po co ten plik**: odrzuty pre-filtra discovery (mcap/ADV) istnieją WYŁĄCZNIE w logach
kontenera (`logger.log`, nie `system_logs`/DB — `form4-discovery.service.ts`). Bez archiwizacji
przegląd okna obserwacyjnego **25.07** nie miałby grupy kontrolnej do oceny progów
mcap ≥$250M / ADV ≥$1M (hipoteza small-cap: Lakonishok & Lee lokują największy
insider-BUY edge w small-capach). Audyt 02.07 (workflow edge-analysis) zalecił zgranie
przed rotacją logów.

**Pokrycie**: 22.06.2026 20:07 UTC → 01.07.2026 (restart kontenera 22.06 uciął wcześniejsze
logi). Okres **10–21.06 jest nierekonstruowalny** — z tego okna znamy tylko rejestracje
z `tickers.createdAt`: **EYE 10.06** i **SMMT 12.06** (bez informacji o odrzuconych
kandydatach). Retencja `system_logs`: info 7d, debug 2d — liczniki cykli też przepadają.

## Zdarzenia funnela (kandydat = przeszedł SIC + rola + BUY ≥$500K; dalej bramka mcap/ADV)

| Data (UTC) | Ticker | Spółka (SIC) | Insider (rola) | BUY | Wynik |
|---|---|---|---|---|---|
| 22.06 20:07 | COR | Cencora, Inc. (5122) | DURCAN DERMOT MARK (Director) | $1 096 760 | **ZAREJESTROWANY** (mcap $52 888M, ADV $384.7M) |
| 23.06 20:57 | TPST | Tempest Therapeutics (2834) | Angel Matthew (CEO and President, Director, 10% Owner) | $500 001 | **ODRZUCONY**: mcap 19M < 250M |
| 24.06 20:12 | AMS | American Shared Hospital Services (8071) | Stachowiak Raymond C (Executive Chairman, Director, 10% Owner) | $1 337 147 | **ODRZUCONY**: mcap 10M < 250M |

Rejestracje all-time (z `tickers.createdAt`): EYE 10.06, SMMT 12.06, COR 22.06 — 3 w 22 dni ≈ 1/tydz.

## Wnioski na przegląd 25.07 (stan na 02.07)

- Kandydaci po pre-filtrze: ~2/tydz. (projekt zakładał 2–5/tydz. — dolna granica, w normie).
- **Jedyne odrzuty na mcap to mikrocapy $10–19M** — ponad rząd wielkości pod progiem $250M.
  Na tej próbce luzowanie progu do np. $100M nie wpuściłoby ŻADNEGO dodatkowego tickera;
  strefa $100–250M jest po prostu pusta (N=2 odrzutów, 9 dni — próbka mała).
- Oba odrzucone BUY pochodzą od insiderów z flagą **10% Owner** w roli łączonej — przy
  ewentualnej dyskusji o mikrocapach pamiętać o wątku controlling-owner (SMMT case).
- Brak liczników per-etap (SIC → wartość → mcap/ADV) — pula rynkowa $200–500K niemierzalna;
  ewentualna decyzja o licznikach = przegląd 25.07 (zmiana observability, nie teraz).
- Szum operacyjny w oknie (nie funnel): sporadyczne `fetch timeout` (samonaprawiające),
  2× HTTP 503 `processAccession` (26.06, 01.07 — transient SEC), klastry
  `atom getcurrent zwrócił 0 wpisów Issuer` 25.06 i 30.06 ok. 13:00–14:00 UTC (pre-open ET;
  jeśli wzorzec się utrwali, sprawdzić czy to pusty atom w godzinach porannych, nie błąd).

## Surowe linie (grep `Form4DiscoveryService`, bez SQL i rutynowych polli)

```
06/22 20:07:03 LOG  Discovery kandydat: COR (Cencora, Inc., SIC 5122) — DURCAN DERMOT MARK (Director) BUY $1,096,760
06/22 20:07:04 LOG  Discovery ZAREJESTROWANY: COR (Cencora, Inc.) — observation mode, przegląd okna obs ~25.07.2026
06/23 02:40:00 LOG  Discovery reconciliation: daily-index 2026-06-22
06/23 14:52:15 WARN Discovery poll: fetch timeout — retry za 5 min
06/23 20:57:01 LOG  Discovery kandydat: TPST (Tempest Therapeutics, Inc., SIC 2834) — Angel Matthew (CEO and President, Director, 10% Owner) BUY $500,001
06/23 20:57:02 LOG  Discovery odrzucony: TPST mcap 19M < 250M
06/24 02:40:00 LOG  Discovery reconciliation: daily-index 2026-06-23
06/24 16:52:15 WARN Discovery poll: fetch timeout — retry za 5 min
06/24 17:12:15 WARN Discovery poll: fetch timeout — retry za 5 min
06/24 20:12:05 LOG  Discovery kandydat: AMS (AMERICAN SHARED HOSPITAL SERVICES, SIC 8071) — Stachowiak Raymond C (Executive Chairman, Director, 10% Owner) BUY $1,337,147
06/24 20:12:05 LOG  Discovery odrzucony: AMS mcap 10M < 250M
06/24 20:52:15 WARN Discovery poll: fetch timeout — retry za 5 min
06/25 02:40:00 LOG  Discovery reconciliation: daily-index 2026-06-24
06/25 13:47–14:02 WARN ×4 Discovery: atom getcurrent zwrócił 0 wpisów Issuer — sprawdź format
06/25 20:27:15 WARN Discovery poll: fetch timeout — retry za 5 min
06/26 02:40:00 LOG  Discovery reconciliation: daily-index 2026-06-25
06/26 17:32:15, 18:57:15 WARN Discovery poll: fetch timeout — retry za 5 min
06/26 20:07:07 WARN Discovery processAccession 0001193125-26-285449: HTTP 503 (index.json)
06/27 02:40:01 LOG  Discovery reconciliation: daily-index 2026-06-26
06/27 16:17:43 DEBUG Discovery reconciliation: brak daily-index 2026-06-27 (HTTP 403, sobota) → fallback 2026-06-26
06/29 17:32:15, 18:02:15, 20:47:15 WARN Discovery poll: fetch timeout — retry za 5 min
06/30 02:40:00 LOG  Discovery reconciliation: daily-index 2026-06-29
06/30 12:07:15 WARN Discovery poll: fetch timeout — retry za 5 min
06/30 13:07–14:07 WARN ×5 Discovery: atom getcurrent zwrócił 0 wpisów Issuer — sprawdź format
06/30 14:52:15, 17:32:15, 18:57:15 WARN Discovery poll: fetch timeout — retry za 5 min
07/01 02:40:00 LOG  Discovery reconciliation: daily-index 2026-06-30
07/01 13:42–19:22 WARN ×6 Discovery poll: fetch timeout — retry za 5 min
07/01 20:32:09 WARN Discovery processAccession 0001193125-26-292640: HTTP 503 (index.json)
```
