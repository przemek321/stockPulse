# Sesja 09.06.2026 (wieczór) — Pakiet 1: "tydzień napraw" wykonany w jeden wieczór

> Kontynuacja sesji z 09.06 (rano/popołudnie): [REPORT-2026-06-09-EDGE-ASSESSMENT.md](REPORT-2026-06-09-EDGE-ASSESSMENT.md)
> (forward-ocena: system netto 0.00%), [PLAN-EDGE-IMPROVEMENTS-2026-06-09.md](PLAN-EDGE-IMPROVEMENTS-2026-06-09.md)
> (badanie 11 agentów + plan), APLS Faza 3 seed (commit e4bfd85).
> Ta sesja: Przemek powiedział **"naprawiamy system, po kolei"** → wdrożone wszystkie
> 7 fixów Pakietu 1. Każdy fix: implementacja → testy → commit → push → rebuild
> produkcji na Jetsonie. Stan końcowy: **646/646 unit testów**, produkcja działa
> na najnowszym kodzie.

## Chronologia — 7 commitów

| # | Commit | Fix | Skala zmiany |
|---|---|---|---|
| 0 | `682b13d` | **aff10b5One parser (P0)** + audyt 1248 filingów | parser TS+Py, 12 plików |
| 1 | `bfbc8fd` | Floor priority dla Director BUY ≥$100K | form4.pipeline + 5 testów |
| 2 | `44732fc` | Bullish 8-K gate → observation | form8k + dispatcher + 21 testów |
| 3 | `b42c07d` | PATTERN_THROTTLE 8K/OPTIONS 2h → 72h | 1 stała + komentarze |
| 4 | `08597cf` | FIX-16 shadow mode (HIMS case) | nowy util + 13 testów |
| 5 | `06145a5` | Telegram actionable (akcja/horyzont/wejście) | 3 formattery + 3 pipeline'y |
| 6 | `09f958e` | PriceOutcome slot 7d | entity + serwis + API + frontend |

---

## Fix #0 — parser 10b5-1 czytał tag, który nie istnieje (P0)

**Co się stało**: zweryfikowałem na żywych filingach SEC odkrycie z badania — parser
(`form4-parser.ts`) czytał per-transaction tag `Rule10b5-1Transaction`, który w realnych
filingach **nie występuje**. Prawdziwy znacznik planu to doc-level `<aff10b5One>`
(między `</reportingOwner>` a `<nonDerivativeTable>`, obowiązkowy od kwietnia 2023).
Na żywo: URGN (wczorajsza kolekcja) ma `aff10b5One=0`, **GILD O'Day 29.04 ma
`aff10b5One=1`** — sprzedaż, która wywołała S19-FIX-07, była planowa, a system
alertował ją jako discretionary CRITICAL.

**Fix**: oba parsery (TS produkcja + Python backtest) czytają doc-level tag
(wartości `1/true/y` case-insensitive, **spójne TS↔Python**), per-transaction
zostaje jako fallback. Prompt GPT: 30-dniowa historia insiderów anotuje
`[10b5-1 plan — pre-scheduled, low signal]`.

**Weryfikacja adwersarialna (ultracode)**: workflow 3 soczewki (parser-correctness /
downstream-impact / tests-and-audit) — wszystkie **approve_with_nits**. Soczewka A
pobrała 7 realnych filingów (GILD/MRNA/BMY) i empirycznie przetestowała fast-xml-parser:
casing, brak namespace, warianty wartości — premisa potwierdzona. Wdrożone poprawki
z weryfikacji: ujednolicenie zbioru wartości TS↔Python, anotacja planów w prompcie,
naprawa fałszywego komentarza w summary-scheduler.

**Audyt backfill (1248 filingów vs SEC EDGAR, read-only)**:

| Typ | Plan | Discretionary | % plan | $ plan |
|---|---|---|---|---|
| **SELL** | **550** | **135** | **80%** | **$403M** |
| EXERCISE | 139 | 905 | 13% | $57M |
| **BUY** | **0** | **18** | **0%** | — |

**Wnioski**: (1) **BUY edge jest czysty z konstrukcji** — 0 planów wśród BUY, więc
V5/APLS d-values dla BUY nie wymagają korekty, a obawa o "mieszane filingi" = 0 przypadków.
(2) **80% SELL to plany** — wszystkie wnioski o SELL mierzone na populacji 4:1 zdominowanej
przez plany; po fixie do GPT trafi ~5× mniej SELL. (3) Pilność re-run V5 spadła —
wartość głównie dla H3 (w V5 grupa plan miała n=0 przez ten sam bug!).
Szczegóły: [AUDIT-10B51-2026-06-09.md](AUDIT-10B51-2026-06-09.md).

**⏳ DECYZJA DLA PRZEMKA — backfill DB**: UPDATE 752 historycznych wierszy
(`is10b51Plan` false→true wg audytu) przygotowany w
`scripts/db/backfill-10b51-2026-06-09.sql` (idempotentny, odwracalny w 1 zapytaniu).
**NIE wykonany** — klasyfikator uprawnień zablokował masową modyfikację produkcyjnej
bazy bez wyraźnej zgody. Bez backfillu 30-dniowa historia w promptach GPT przez
~30 dni miesza źle oznaczone stare wiersze z poprawnymi nowymi. Wykonanie:
`docker compose exec -T postgres psql -U stockpulse -d stockpulse < scripts/db/backfill-10b51-2026-06-09.sql`

## Fix #1 — GPT nie wetuje już backtest-backed BUY

PODD Weatherman 03.06 (Director BUY $497K) dostał od GPT magnitude='low' → null
priority → **brak alertu**; bliźniaczy Stonesifer $400K dzień później delivered +4.3% 3d.
Odkrycie przy implementacji: **C-suite BUY miał już floor** (null→HIGH) — luka dotyczyła
tylko Director. Fix: Director BUY ≥$100K + GPT null → floor MEDIUM. GPT zostaje jako
enrichment treści, nie bramkarz. Test: replay Weatherman przechodzi.

## Fix #2 — bullish 8-K idzie do obserwacji (delivered bullish: 0/4, śr. −4.4%)

Gate kluczowany na **mainItem z detectItems()** (nie catalystType — MOH Item 7.01
dostał etykietę 'earnings'). Jedyna bullish ścieżka na Telegram: **Item 2.02
z udokumentowanym beatem** (`isDocumentedBeat` = warunek R4: oba surprise ≥+5%,
eksport z consensus-gap-guard żeby nie dryfował). Brak/partial danych konsensusu →
osobny reason `bullish_no_consensus_data` (forward analysis odróżnia "nie mogliśmy
sprawdzić" od "to nie beat"); narrative → `bullish_8k_no_edge`. Gated bullish **nie
zasila correlation Redis** (anty-backdoor jak FIX-07). Bearish i Item 1.03 nietknięte.
**Revisit: 90d od deploy LUB N≥10 suppressed** — jeśli hit >55% i śr. dodatnia, zawęzić.

## Fix #3 — PATTERN_THROTTLE 72h

INSIDER_PLUS_8K + INSIDER_PLUS_OPTIONS: 2h → 72h. Tnie 2/3 redundantnych re-broadcastów
(HIMS ×3), zero utraconych winnerów w 50d sample. Semantyka S20-T02 zachowana:
suppressed pattern trzyma 15-min TTL, pełne 72h dopiero po delivered.

## Fix #4 — FIX-16 w shadow mode (nie deployujemy progów z N=1)

HIMS 11.05: extreme miss (EPS -507%), GPT bearish -1.6, cap FIX-12 → DB-only →
stracony short -19.7% 1d. Zamiast zmieniać progi z N=1 (powtórka błędu FIX-12 R1):
**cap zostaje, shadow liczy proponowane progi** przy każdym capie i persystuje
w `sec_filings.gptAnalysis.fix16_shadow` (trwałe — system_logs z retencją by nie
przeżyły do review). Definicja extreme odporna na niestabilny mianownik:
|epsSurprise|>30% AND (sign-flip LUB |actual−estimate|≥$0.10). Sign-gate: tylko GPT
bearish. Anomaly exclusion (|eps|>50, rev<1M — klasa GILD). Drabinka `proposed_cap`
gradowana po wielkości missu. **Review 25.08.2026 przy N≥3** — query:
`SELECT "gptAnalysis"->'fix16_shadow' FROM sec_filings WHERE "gptAnalysis" ? 'fix16_shadow'`.

## Fix #5 — Telegram mówi, co zrobić

Nowa linia we wszystkich 3 formatterach: **`📌 Akcja: LONG | Horyzont: 3-7d | Wejście: $310.60`**.
Horyzonty = statyczna mapa backtest-backed (form4 BUY 3-7d bo na 30d edge znika;
8-K bearish 1-3d bo PEAD front-loaded; bez LLM). Wymagało przeniesienia
`captureAlertSnapshot` PRZED dispatch w 3 pipeline'ach (wcześniej cena pobierana PO
wysyłce — nie mogła być w wiadomości); snapshot reużywany przy save, zero dodatkowych
HTTP. Bonus: Correlated pokazuje teraz **kto i za ile** w nodze form4
("Dudum Andrew (CEO) BUY $1,038,000" zamiast "insider_sell") — nowe pole
`StoredSignal.label`, stare sygnały w Redis mają fallback.

## Fix #6 — PriceOutcome mierzy wreszcie 7d

Backtest mierzy edge na 7d (V5 C-suite BUY d=+0.92), a tracker kończył na 3d —
APLS Faza 4 (09.07) i werdykt systemu (~01.09) nie widziałyby właściwego horyzontu.
Nowe kolumny `price7d/xbi7d/ibb7d` (TypeORM synchronize dodał przy rebuildzie,
zweryfikowane w DB), slot 7d w CRON, hard timeout 7d → **11d** (slot 7d wypadał
dokładnie na starym timeoucie; weekend przesuwa wypełnienie do dnia 8-10).
API `/outcomes`: `delta7d`, `xbiAlpha7d`, `ibbAlpha7d`. Legacy alerty: null gracefully.

---

## Stan po sesji

- **Produkcja (Jetson)**: wszystkie 7 fixów wdrożone (rebuild po każdym commicie),
  app healthy, kolumny 7d w DB.
- **Testy**: 595 → **646 unit** (+51: parser 8, floor 5, gate 21, shadow 13,
  actionable 11, mapper 2 — minus modyfikacje) + 16 pytest (+6). Wszystko zielone,
  `tsc --noEmit` czysty.
- **GitHub**: 7 commitów wypchniętych (`682b13d..09f958e`), pre-push hook za każdym razem.

## Co dalej (z planu, nie zaczęte)

1. **Decyzja Przemka: backfill 752 wierszy** (skrypt gotowy, patrz Fix #0).
2. **Options flow CRON off** (plan §P4) — wymaga 1 zapytania do Polygon o retencję
   historii options aggregates; celowo NIE zrobione w tej sesji.
3. **Pakiet 2: pivot discovery sector-wide** (M, 3-5 dni) — prerequisite (fix parsera) ✅.
4. Kalendarz walidacji bez zmian: APLS Faza 4 **09.07**, FIX-16 review **25.08**,
   bullish-8K gate revisit **~07.09** (90d), werdykt edge **~01.09**.
