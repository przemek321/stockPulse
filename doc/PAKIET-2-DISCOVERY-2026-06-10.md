# Pakiet 2 — event-driven discovery Form 4 sector-wide (10.06.2026)

> Wdrożenie planu [PLAN-EDGE-IMPROVEMENTS-2026-06-09.md](PLAN-EDGE-IMPROVEMENTS-2026-06-09.md)
> §2.P2 + §3. Commit `1d9b85d`. Poprzedzone Pakietem 1 (7 fixów, [SESJA-2026-06-09-PAKIET-1.md](SESJA-2026-06-09-PAKIET-1.md))
> — prerequisite fix parsera aff10b5One był warunkiem twardym (bez niego filtr
> discretionary w pre-filtrze byłby no-opem).

## Po co

Jedyna reguła z dowiedzionym edge (Form 4 Insider BUY, V5 d=+0.75..0.92) głodowała
u źródła: 28 tickerów core = **1-2 discretionary BUY/miesiąc**. Podaż rynkowa
healthcare/biotech BUY ≥$500K to ~50/30d → po ostrych filtrach **2-5 kandydatów/tydzień
= lejek ×8-20**. Oczekiwany efekt po walidacji: ~4-5 delivered/mies. = dokładnie cel
1/tydzień (dolny przedział V5 ≥$500K: hit 80.5%, +4.49% śr.).

## Jak działa

```
atom getcurrent (co 5 min, 2-57/5 6-22 ET pn-pt)     daily-index form.idx (22:40 ET)
        │ wpisy (Issuer) — dedup po accession                │ wiersze '4 ' (dual-row!)
        ▼                                                     ▼
              processAccession (wspólna ścieżka, markSeen TYLKO deterministyczne)
   1. SIC z submissions JSON (cache Redis 30d) — nie-healthcare → seen
      └ CIK OSOBY (sic='' tickers=[]) → bez markSeen (wiersz emitenta przetworzy)
   2. ticker w uniwersum (core/semi/APLS/soft-deleted) → seen (core obsługuje)
   3. XML Form 4 → pre-filter: discretionary BUY ≥$500K (aff10b5One z P1-00),
      rola C-suite/Director ROLE-only (Harvard hole zamknięty), agregacja TASK-03
   4. Finnhub: mcap ≥$250M + ADV ≥$1M (10d vol × cena); null=transient → retry
   5. cap 5 rejestracji/dzień (data ET, licznik Redis); hit → odroczenie
   6. INSERT ticker: observationOnly=true, sector='healthcare_discovery', priority=LOW
   7. SecFiling + parseAndSaveForm4 (kanoniczna ścieżka, preloaded XML)
        → NEW_INSIDER_TRADE → Form4Pipeline → GPT → alert DB-only 'observation'
```

**Twarde filtry** (wszystkie z weryfikacji adwersarialnej badania 09.06):
SIC healthcare/biotech (283x/384x/3826/3851/5047/5122/6324/80xx/8731; **świadomie bez**
7372 health-IT i 5912 drug-stores — CVS/WBA/VEEV soft-deleted z core), exchange-listed
(OTC/Pink odpada), bez czystych 10% ownerów (86% szumu all-market), bez 4/A (stęchłe
sygnały), bez planów 10b5-1.

**Czego discovery NIE robi**: zero Telegrama (observation mode), zero nóg korelacji
(storeSignal skip kluczowany na **sektorze** — obowiązuje też po przyszłej promocji),
zero SELL (BUY-only jak APLS).

## Weryfikacja adwersarialna przed commitem (4 soczewki, 3× block → naprawione)

Najważniejsze znaleziska (wszystkie zaadresowane + testy):

| Problem | Fix |
|---|---|
| **P1: dual-row w daily-index** — każdy filing ma wiersz emitenta ORAZ reporting-ownera (osoby); wiersz osoby (sic='') markSeen-ował accession → reconciliation gubiła ~50% filingów rzutem monetą po alfabecie (zmierzone na żywym form.20260608.idx: 1888 wierszy = 890 accessionów) | CIK z pustym sic+tickers → `return false` BEZ markSeen |
| **P1: transient Finnhub = permanent loss** — 429/null nieodróżnialny od "poniżej progu", markSeen gubił kandydata | null → retry bez markSeen; tylko zmierzona wartość poniżej progu = deterministyczny reject |
| **P1: partial failure kroku 7** — błąd zapisu trades PO rejestracji tickera blokował retry (krok 2 odbija, core dedupuje filing) | preloaded XML (bez 2. fetchu) + inline retry + ERROR z instrukcją manualną |
| P2: "Harvard hole" — `isCsuiteRole(role, name)` matchował wzorce na NAZWIE entity („PRESIDENT AND FELLOWS OF HARVARD COLLEGE" jako 10% owner przechodził) | pre-filter woła role-only |
| P2: `*/5` kolidował ze slotami :05/:35 core collectora (razem 9-11 req/s vs limit SEC 10/s) | pattern `2-57/5` (offset +2 min) |
| P2: cap/dzień po dobie UTC = reset 20:00 ET w środku szczytu filingów | licznik Redis po dacie ET; cap hit = odroczenie, nie utrata |
| P2: 4/A w atomie (stęchły amendment rejestrowałby ticker) | 4/A wykluczone w obu ścieżkach |

## Walidacja i co dalej

- **Okno obserwacyjne 30-60d**: przegląd ~**25.07.2026** — jakość kandydatów, rozkład
  mcap/ról, zero pump-class. Wtedy też decyzja o przycinaniu uniwersum discovery
  (brak auto-expiry — celowo, cap 5/dzień ogranicza wzrost; koszt core collectora
  rośnie liniowo z liczbą zarejestrowanych).
- **Delivery top-N** (max 1-2/tydzień najwyższy conviction) — PO walidacji okna, nie teraz.
- **Monitoring**: `system_logs` decision_reason dla `runDiscoveryCycle` (entries/fresh/
  registered), `PARSER_EMPTY` warn gdy atom zmieni format; zarejestrowane tickery:
  `SELECT * FROM tickers WHERE sector='healthcare_discovery'`.
- **Znane ograniczenia** (udokumentowane decyzje): brak panelu discovery na dashboardzie
  (kandydat na follow-up); cache 30d submissions może przegapić IPO w oknie; DailyCap
  GPT konsumuje slot przed gate'ami (pre-existing, dotyczy wszystkich ścieżek obs).
