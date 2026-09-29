# Audytor — shadow-run #1 (29.09.2026)

Etap 1 planu agentów ([tasks-2026-09-27/](../tasks-2026-09-27/00-README-plan.md)), commity
`a623d84` (00 zod) → `f9b4f88` (01 encja) → `f3b0ba2` (03 checki) → `a1a2756` (05 orkiestrator+CRON) →
`4d8780c` (06 CLI). Prod po rebuildzie: `AgentsModule: audytor WYŁĄCZONY (AUDITOR_ENABLED=false — CRON
zarejestrowany, zero zapisów)`, restarts=0, `\d alerts` identyczne, jedyny zapis = `agent_findings`.

**Przebiegi** (CLI w minimalnym kontekście Nest — bez kolejek, kolektorów, Telegrama, CRON-ów):
1. `--limit 30` → **#2483–#2512** (ORDER BY id DESC, niezależnie od `priceOutcomeDone`): 30 alertów, 48 wierszy,
   0 błędów, 0 AMBIGUOUS, 437 ms.
2. `--ids 2441` (SEM, poza oknem): PRICE_FROZEN + marker.
3. powtórny `--limit 30` — zamiast no-opa zeskanował **kolejne 30 starszych** (#2452–#2482; NOT EXISTS marker =
   „pending", nie „te same") → 57 wierszy. Zachowanie poprawne (tak działa CRON), ale rozszerzyło próbkę do **61 alertów**.
   Idempotencja per alert potwierdzona inaczej: 0 duplikatów per (alertId, checkId) — unique partial + `orIgnore()`.
- `grep -i telegram` w logach runów: tylko własny log „bez … Telegrama" i ścieżki `telegram-formatter` w evidence.

## 1. checkId × severity × count (61 alertów: #2452–#2512 + SEM #2441)

| checkId | severity | n | uwagi |
|---|---|---|---|
| `_AUDITED` (marker) | INFO | 61 | |
| `ENTRY_GAP_UNENTERABLE` | P2 | 20 | 12× Form 4 BUY (obserwacyjne), 8× 8-K (w tym dostarczony PODD #2470 SHORT −18,4%) |
| `POST_CLOSE_8K_ENTRY_PRICE` | P2 (delivered) | 4 | BMY #2461 07:35 NY, AMGN #2464 16:35, PODD #2470 07:35, UHS #2478 16:35 |
| `POST_CLOSE_8K_ENTRY_PRICE` | INFO (stłumione) | 17 | 21/25 8-K z ceną w próbce poza sesją (84%) |
| `PREVIOUSLY_ANNOUNCED_8K` | P2 | 1 | ABBV #2494 |
| `PRICE_FROZEN` | **P1** | 1 | SEM #2441 |
| `PRICE_LABEL_AMBIGUOUS` / `CONCLUSION_CUT_AT_300` / `PIPELINE_VERSION_UNKNOWN` | INFO, globalne | 1 / 1 / 1 | przykład #2512 |

Zero trafień: `ESCAPE_MISSING`, `ALERT_TEXT_TRUNCATED`, `GPT_CONCLUSION_TRUNCATED`, `TRANSACTION_TYPE_MISMATCH`
(0 AMBIGUOUS na 61 — okno trades po `collectedAt` dopasowało każdego insidera), `STALE_TEMPLATE_DATE`, `OUTCOME_DONE_EMPTY`.
Przegląd adwersarialny 29.09 (180 alertów all-time) potwierdza 0 false positives tych checków.

## 2. Ręczna weryfikacja P1 (1/1)

- **SEM #2441 PRICE_FROZEN — TRUE.** price1h=4h=1d=3d=7d=16.51=priceAtAlert; SEM zdelistowany (usunięty z `tickers`
  01.09, Finnhub c=0, guard >7d wdrożony). Wykryty ręcznie w werdykcie 01.09 — dziś audytor łapie to automatycznie.
  Po guardzie ten tryb już nie wystąpi; następca (puste sloty + hard-timeout) = `OUTCOME_DONE_EMPTY` (0 dziś). Status `ACKED`.

## 3. Weryfikacja P2 (25/25 — całość, nie próbka)

| alerty | check | evidence | werdykt |
|---|---|---|---|
| KURA #2479 +10,9% / #2486 +9,6%, INBX #2497/#2498 +9,3%, ATEC #2500 +14,0%, RLMD #2501 +8,1% | ENTRY_GAP (obs. BUY) | `sentInSession=false`, `price1hAt` = 11:00 NY następnej sesji | **TRUE** — „REAL gap" z werdyktu 23.09 (0 wchodzalnych); oczekiwanie z 06 spełnione |
| ABCL #2485 +13,9%, PRE #2487 +6,5%, IMTX #2490 +5,1%, REPL #2476 +12,6%, BSX #2472 +4,0%, IONS #2465 +3,2%, TYRA #2507 +3,5%, INBX #2508 +3,2% | ENTRY_GAP (obs. BUY) | jw. | TRUE (ostatnie 3 tuż nad progiem — niska wartość informacyjna) |
| TDOC #2459 +27,6%, DXCM #2462 +10,2%, AMGN #2467 +5,9%, BIIB #2457 +4,4%, LLY #2469 +3,1% | ENTRY_GAP (8-K stłumione) | pre/post-market, kurs uciekł do 11:00 NY | TRUE — te alerty i tak nie wyszły (missing-data / no-consensus) |
| **PODD #2470 (delivered, SHORT)** | ENTRY_GAP + POST_CLOSE | 07:35 NY, priceAtAlert 166,82 → price1h 136,07 (**−18,4%**) | TRUE — dostarczony short, którego nie dało się zająć: cena „wejścia" to poprzednie zamknięcie, gap na otwarciu zjadł cały ruch |
| BMY #2461, AMGN #2464, UHS #2478 (delivered) | POST_CLOSE | 07:35 / 16:35 / 16:35 NY | TRUE — „Wejście: $X" w Telegramie = ostatnie zamknięcie |
| ABBV #2494 | PREVIOUSLY_ANNOUNCED_8K | `gptAnalysis.summary`: „finalizacja **wcześniej zapowiedzianej** transakcji M&A (Apogee)" | TRUE — 8-K to zamknięcie ogłoszonego przejęcia; stłumiony (`bullish_8k_no_edge`) |

**False-positive rate P2: 0/25.** Dostarczonych alertów w próbce: 4 (wszystkie 8-K: BMY, AMGN, PODD, UHS) — każdy
ma finding POST_CLOSE, PODD dodatkowo ENTRY_GAP. Status w DB: `ACKED` (26 wierszy: 25 P2 + 1 P1).

## 4. Bugi / obserwacje w ścieżce decyzyjnej (bez fixu — zasada 1 briefu)

1. **Dostarczone 8-K mają nieosiągalną cenę wejścia** — 4/4 w próbce (§3), all-time 48/53 8-K z ceną wysłane poza
   sesją (CRON :05/:35 → 06:05–09:05 i 16:05–17:05 NY). `priceAtAlert` = ostatnie zamknięcie; PODD #2470 pokazuje
   skalę: „SHORT @ 166,82", a pierwsza osiągalna cena 136,07. Dla werdyktu #2: metryka REAL dla 8-K musi startować
   od otwarcia, nie od `priceAtAlert` (reguły gry real są long-only i Form 4-only, więc nie dotyka gry usera).
2. **`price1h` dla alertów W SESJI po ~15:00 NY to kurs następnej sesji** — CRON price-outcome liczy sloty od
   `getEffectiveStartTime` i odpala co pełną godzinę tylko w sesji; pierwszy otwarty tick ≥ sentAt+1h wypada nazajutrz
   10:00 NY. Dotyczy obu dostarczonych **ELV #2446/#2447 (17.07, 14:05 i 15:35 NY)**: „+3,8% po 1h" = poniedziałek
   10:00 NY. Audytor oznacza takie przypadki `AMBIGUOUS` (0 w próbce 61). „Gap 1h" alertów w sesji po 15:00 NY zawiera overnight.
3. **Wniosek GPT w Telegramie ucinany do 300 znaków w pół zdania** (`telegram-formatter.service.ts:274,340`,
   `conclusion.substring(0, 300)`) — 109/144 realnych alertów z wnioskiem; #2512: „…historyczna skuteczność
   sygnałów BUY dla INB". Projektowe, ale czytelnik nie widzi końca argumentu.
4. **Etykieta „akcji @ $X" pokazuje wartość łączną, nie cenę/akcję** (`:264`; #2512: „BUY 10,000 akcji @ $998,783.69").
5. **Ping discovery nadal mówi „przegląd 25.07"** (`form4-discovery.service.ts:572`, literał) — wysyłany przy każdej
   nowej obserwacji, 2 miesiące po dacie. Poza `alerts`, więc `STALE_TEMPLATE_DATE` tego nie widzi.
6. **Brak git SHA w runtime** → `pipelineVersion` zawsze null.
7. **INBX 08.09 — klaster C-suite bez sygnału klastra**: #2497 Lappe Mark (CEO, $2,6M, 6 wypełnień) i #2498 Kayyem
   Jon Faiz ($0,57M) + Forsyth Douglas BUY (20:35, bez alertu) tego samego dnia; `INSIDER_CLUSTER` martwy (audyt 02.07).
   Obserwacja pod wątek C-suite, nie bug.
8. Historyczne: 28 alertów „Form 4 Insider Signal" (SELL) sprzed 10.06 mają w treści „Plan 10b5-1: NIE", a w DB
   `is10b51Plan=true` po backfillu aff10b5One — znany incydent; audytor klasyfikuje jako INFO (`_PRE_BACKFILL`).

## 5. Werdykt: **(a) — audytor daje wartość, etap 2 (02 MCP, 04 LLM) po 01.11**

Kryterium z 06: ≥1 P1 TRUE niewykrywany dziś inaczej **LUB** FP-rate P2 < 30% → oba spełnione (SEM P1, dotąd
tylko ręcznie; P2 0/25). Nowe względem werdyktów 01.09/23.09: §4.1 z liczbami dla dostarczonych 8-K (PODD −18,4%),
§4.2 (ELV), §4.3, §4.5 — i przegląd adwersarialny, który sam wyprodukował §4.1–4.2. Zastrzeżenie: warstwa LLM (04)
miałaby dziś **0 przypadków** `AMBIGUOUS` — jej wartość zależy od danych po 01.11.

**Decyzje właściciela** (nic nie robię bez nich):
- `AUDITOR_ENABLED` zostaje **false**. Włączenie = `AUDITOR_ENABLED=true` w `.env` + restart `app`; koszt ~0,5 s
  co 15 min, ≤50 alertów/przebieg, zapis tylko `agent_findings`. Bez włączenia findingi przybywają tylko z ręcznych
  shadow-runów (`docker exec stockpulse-app node dist/agents/cli/auditor-shadow-run.js --limit N`).
- Czy §4.3 (cięcie 300 zn.) i §4.5 (literał 25.07) wchodzą jako małe fixy poza oknem walidacji — do rozstrzygnięcia 01.11.

## Weryfikacja techniczna
tsc 0 · jest test/unit 808/808 (59 auditor-checks + 17 orchestrator + 6 entity) · lint 0 nowych ·
`make rebuild-app` (restarts=0, health healthy) · `\d alerts` bez zmian · `agent_findings`: 107 wierszy
(61 markerów, 26 ACKED, reszta INFO OPEN) · przegląd adwersarialny 29.09: 15 agentów, 7/8 werdyktów potwierdzonych i wdrożonych.
