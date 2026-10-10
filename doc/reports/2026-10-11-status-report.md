# StockPulse — raport statusu 11.10.2026

> Każda liczba poniżej pochodzi z zapytań do bazy prod (SELECT), logów kontenera lub `git log`
> z 11.10.2026 ~23:00 UTC. Gdzie czegoś nie dało się zweryfikować, jest to napisane wprost.
> **To nie jest sygnał do gry.**

## 1. Gdzie jesteśmy

Faza **walidacji forward**. Werdykt #1 (01.09): edge nie wykazany (insufficient N). Od tego czasu
żaden przegląd nie zmienił reguł sygnałowych. Następny punkt decyzyjny: **01.11 — werdykt #2**.

| obszar | stan | źródło |
|---|---|---|
| Alerty all-time | 184, dostarczonych 40 | `alerts` |
| Dostarczone od 01.07 | **7** (ELV×2 17.07, BMY 30.07, AMGN 31.07, PODD 05.08, UHS 17.08, PODD 24.08) | `alerts` |
| Ostatnie 30 dni | 17 alertów, **0 dostarczonych**: 12 Form 4 BUY discovery (observation), 4 stłumione 8-K (`bullish_8k_no_edge` 3, `gpt_missing_data` 1), 1 SELL (`sell_no_edge`) | `alerts` |
| Rdzeń delivery | 27 aktywnych tickerów (28 − SEM − WBA) | `tickers`, JSON uniwersum |
| Dyskrecjonalne BUY ≥$100K w rdzeniu | **0 od 21.08** (PODD CEO) — susza po stronie insiderów, nie systemu | `insider_trades` |
| Discovery | 30 tickerów obs, 11 dodanych od 01.09 (ENOV INBX ALMS ATEC RLMD NAMS COO TYRA DMRA KOD XENE) | `tickers` |
| Sub-gate C-suite #2 (≥02.09) | T1 N=5/10: hit 40%, med REAL −9,5%, wchodzalne 1/5; T2 N=2/10: hit 0%, med REAL −5,9% — oba poniżej progów | `logs/csuite-gate.log` 09.10 |
| Gra real (XTB) | licznik serii strat **0**, brak zamkniętych transakcji po 24.09; brak sygnałów kwalifikujących od 24.08 | `doc/DZIENNIK-TRANSAKCJI.md` |

Wynik 7 dostarczonych alertów z lipca–sierpnia (raw 7d / alpha vs XBI, pp):
ELV +2,4 / +4,6 · ELV +1,3 / +1,3 · BMY +1,0 / −4,3 · AMGN (short) +6,0 / −1,1 · PODD (short) −15,8 / −20,5 ·
UHS (short) +2,9 / −2,4 · PODD +0,3 / +3,5. Dla shortów ruch ujemny = trafienie; PODD 05.08 (−15,8%) był
trafiony kierunkowo, ale audytor pokazał, że cena wejścia (166,82, poprzednie zamknięcie) była nieosiągalna —
pierwsza realna cena 136,07.

## 2. Co robimy (od 29.09)

**Agent-audytor shadow-mode — etap 1 wykonany i włączony** (commity `a623d84`…`4d8780c`, raport
[AUDITOR-SHADOW-RUN-2026-09-29.md](../AUDITOR-SHADOW-RUN-2026-09-29.md)). Deterministyczny: 13 reguł, zero LLM,
zero Telegrama, zapis tylko do `agent_findings`. CRON co 15 min: 672 ticki w 7 dni, 0 błędów.
Stan: 63 alerty zaudytowane, 2 czekają na domknięcie 7d (REGN 06.10, HUM 09.10).

| finding | n | ocena |
|---|---|---|
| ENTRY_GAP_UNENTERABLE (P2) | 22 (20 ACKED, 2 nowe: KOD +4,3%, XENE +5,1%) | wszystkie sprawdzone ręcznie TRUE |
| POST_CLOSE_8K_ENTRY_PRICE | 21 (4 P2 na dostarczonych, 17 INFO) | TRUE — 8-K prawie zawsze poza sesją |
| PRICE_FROZEN (P1) | 1 (SEM) | TRUE |
| PREVIOUSLY_ANNOUNCED_8K (P2) | 1 (ABBV) | TRUE |
| globalne INFO | 3 (wniosek GPT cięty do 300 zn. w 109/144 alertów; etykieta „akcji @ $X" = wartość, nie cena; brak SHA w runtime) | do decyzji 01.11 |

Wniosek z audytu, najważniejszy dla werdyktu #2: **metryka REAL dla sygnałów powstających poza sesją musi
startować od otwarcia, nie od `priceAtAlert`**. Dotyczy wszystkich 8-K i większości Form 4.

**Etap 2 (MCP read-only dla Claude Code + warstwa LLM dla przypadków niejasnych)**: odłożony do 01.11 decyzją
usera. Od 29.09 nie wystąpił ani jeden przypadek, który warstwa LLM miałaby rozstrzygać.

## 3. Infrastruktura

| element | stan |
|---|---|
| Kontenery | app, frontend, postgres, redis — healthy, restarts 0, uptime hosta 6 dni |
| Anthropic API | działa, kredyty nie wyczerpane: 6 analiz GPT w 7 dni (ostatnia 09.10 CI), 0 błędów 402/429, 0 `SKIP_VM_OFFLINE` |
| Jetson | tryb mocy **15W** od 03.10 (było MAXN; stack nie używa GPU od 22.04); obraz FinBERT 2,93 GB usunięty; dysk 66/116 GB |
| Incydent 04.10 | odcięcie zasilania → kontenery wstały z zegarem 1970 (Jetson bez baterii RTC). Przyczyna: `restart: unless-stopped` podnosi kontenery przed NTP, więc czekanie w `scripts/autostart.sh` (fix `c20e7de` z 27.06) nie działa. Skutek: 1 nieudany raport 8h przy starcie, „Up 56 years" w `docker ps`. **Dane w DB nienaruszone** (0 wierszy z 1970 w alerts/insider_trades/sec_filings/system_logs/agent_findings). Przestój ~30 min |
| Kod | tsc 0, jest 808/808 (43 suity), lint strict 0 nowych; `main` = `origin/main` |
| Decyzja usera 03.10 | migracja stacku na Raspberry Pi 5 16 GB po 01.11; warunek: SSD na USB zamiast pendrive'a (Postgres/Redis) |

## 4. Dokumentacja — co było nieaktualne i co poprawiono (11.10)

- `CLAUDE.md`: sekcja „Stan obecny" opisywała czerwiec i kalendarz z datami, które minęły → przepisana na
  październik (werdykt #1, 01.11/15.11, stan 11.10); testy „~709" → 808; „12 entities" → 13 (`agent_findings`);
  „28 zwalidowanych tickerów" → 27 aktywnych + PUŁAPKA o 8 nieaktywnych wierszach `healthcare` (ALHC, CERT,
  CVS, CYH, DVA, GSK, HCAT, VEEV — seed z lutego, `isActive=false`, kolektor ich nie czyta); dopisek o 15W i RTC.
- `doc/CHANGELOG.md`: brakowało czterech miesięcy (lipiec–październik) → dodana sekcja z hashami z `git log`.
- `doc/PROGRESS-STATUS.md`: deklarował się jako „główny plik śledzący", ostatni wpis 23.05 → oznaczony jako
  archiwum ze wskazaniem, gdzie żyje bieżący stan.
- `doc/stockpulse-healthcare-universe.json`: `total_tickers` 28 → 27 z notą o SEM/WBA.
- Aktualne bez zmian: `KALENDARZ-WALIDACJI-2026.md` (wszystkie przeglądy odhaczone), `REGULY-GRY-REAL`,
  `DZIENNIK-TRANSAKCJI`, `tasks-2026-09-27/00-README-plan.md` (ma nagłówek o stanie etapu 1).

## 5. Otwarte sprawy (nic nie robię bez decyzji)

1. **Autostart vs zegar 1970** — propozycja: po synchronizacji NTP skrypt restartuje kontener `app`, jeśli jego
   `StartedAt` jest sprzed 2000 r. Zmiana w `scripts/autostart.sh` (host), nie w aplikacji.
2. **Sprzątanie Dockera**: ~10 GB (build cache 8,1 GB, nieotagowane obrazy 2,0 GB, wolumeny po FinBERT/pgAdmin 0,4 GB).
3. **Na 01.11** razem z werdyktem #2: poszerzyć rdzeń o duże spółki spoza listy (typ PFE — dwa Director BUY ~$1M
   w sierpniu trafiły do discovery i zostały stłumione) vs zaakceptować ~1 sygnał/miesiąc; etap 2 agentów;
   migracja na Pi; dwa małe fixy formattera wskazane przez audytora (cięcie 300 zn., etykieta ceny).

## Czego NIE zweryfikowałem
- Statusu CI na GitHubie po ostatnich pushach (brak `gh` na Jetsonie) — lokalnie pre-push hook przepuścił testy.
- Faktycznego poboru mocy przed/po zmianie na 15W (czujniki wymagają sudo; szacunek: różnica ~0,5–1,5 W na jałowym).
