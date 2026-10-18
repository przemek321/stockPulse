# StockPulse — podsumowanie tygodnia 11–18.10.2026

> Liczby z zapytań SELECT do bazy prod, logów kontenera i `logs/*.log`, 18.10.2026 ~14:30 UTC.
> Poprzedni punkt odniesienia: [raport statusu 11.10](2026-10-11-status-report.md).
> **Żadna pozycja poniżej nie jest sygnałem do gry** — tydzień bez dostarczonego alertu.

## 1. Sygnały

| | ten tydzień (11–18.10) | poprzedni (04–11.10) | 30 dni |
|---|---|---|---|
| alerty w bazie | **2** | 2 | 10 |
| dostarczone na Telegram | **0** | 0 | 0 |

Ostatni dostarczony alert: **PODD 24.08** (55 dni). Dwa alerty tygodnia:

- **#2517 HUM 13.10 10:35 UTC** — 8-K Item 7.01 (nowe JV z BlackRock/HPS zamiast WCAS), GPT: umiarkowanie pozytywny
  → stłumiony `bullish_8k_no_edge` (bramka P1-02, bez zmian). DB-only.
- **#2518 INBX 14.10 23:05 UTC** — Form 4 Insider BUY, CEO Mark Lappe, 6 transakcji, razem **$849K** @ 84,07–85,76.
  INBX = `healthcare_discovery` → `observation`, DB-only. To **czwarta runda zakupów CEO od 08.09**
  (08.09 $2,65M · 25.09 $545K · 28.09 $453K · 14.10 $849K ≈ $4,5M), a kurs w tym czasie 114 → 85 (−25%).
  Poprzednie trzy wejścia INBX w gate C-suite: REAL −16,7% / −9,9% (i 17.09/23.09 to Director Kayyem, nie C-suite).
  Obserwacja, nie sygnał.

**Rdzeń (27 tickerów)**: 65 transakcji insiderów zebranych w tygodniu — 33 SELL, 20 EXERCISE, 9 TAX, 3 GRANT,
**0 BUY**. Dyskrecjonalny BUY ≥$100K w rdzeniu: nadal **0 od 21.08** (8 tygodni). Susza po stronie insiderów trwa;
pytanie „poszerzyć rdzeń czy zaakceptować ~1 sygnał/mies." zostaje na 01.11.

## 2. Domknięte outcome'y (7d) — dane do przeglądów, nie sygnały

Oba to stłumione bycze 8-K (`bullish_8k_no_edge`), oba trafione kierunkowo — ale popatrz na kolumnę REAL:

| alert | wysłany (NY) | priceAtAlert | 1h (otwarcie) | 7d | raw 7d | α vs XBI | REAL od otwarcia |
|---|---|---|---|---|---|---|---|
| #2515 REGN 8-K | 06.10 | 726,47 | 735,03 | 747,83 | +2,9% | +7,7 pp | **+1,7%** |
| #2516 HUM 8-K | 09.10 06:05 (pre-market) | 387,12 | 432,09 | 424,29 | +9,6% | +11,8 pp | **−1,8%** |

HUM: cały „zysk" +9,6% to gap na otwarciu (+11,6%, audytor: `ENTRY_GAP_UNENTERABLE` P2 + `POST_CLOSE_8K_ENTRY_PRICE`);
od pierwszej osiągalnej ceny pozycja byłaby na minusie. To dokładnie wniosek z audytu 29.09 — metryka dla przeglądu
bullish-8K **15.11** musi liczyć od otwarcia. Przegląd #1 (07.09) miał N=16 hit 50% — te dwa dochodzą do N.

## 3. Sub-gate C-suite #2 (`logs/csuite-gate.log`, 16.10)

Bez zmian: **T1 N=5/10** (hit 40%, med α +1,97 pp, med REAL −9,5%, wchodzalne 1/5), **T2 N=2/10** (hit 0%,
med REAL −5,9%). INBX 14.10 (Lappe, T1) wejdzie do licznika po domknięciu 7d (~22–23.10) → T1 6/10.
Cron działa pn–pt 23:45 + catch-up 08:10 (ten loguje codziennie „brak wpisu z dziś" — kosmetyka, wynik ten sam).

## 4. Agent-audytor

719 ticków CRON w 7 dni, **0 błędów**. Zaudytowane **65/65** (0 czeka). Nowe findingi tygodnia: REGN #2515
`POST_CLOSE_8K_ENTRY_PRICE` INFO; HUM #2516 `ENTRY_GAP_UNENTERABLE` P2 (gap +11,6%) + `POST_CLOSE` INFO.
Sprawdzone ręcznie w tabeli wyżej — oba TRUE. Bilans od 29.09: 0 false positives.

## 5. Infrastruktura

| element | stan |
|---|---|
| kontenery | app Up 7d (restart 11.10 = test fixu autostartu), postgres/redis/frontend healthy, **restarts 0**; host up 14 d |
| health | `healthy`; SEC_EDGAR ostatnia kolekcja 14:05 UTC dziś; REDDIT/PDUFA `isHealthy=false` to stan znany (placeholder / wyłączony 21.06) |
| Anthropic API | działa: 4 analizy GPT w tygodniu (HUM, UNH 8-K 13.10; INBX Form 4 14.10; ABBV 8-K 15.10), 0 błędów |
| kolektory | 57 Form 4, 7 8-K, 2 Form 3 zebrane; discovery: 9 ostrzeżeń (6 `FETCH_TIMEOUT`, 3 `PARSER_EMPTY`) na ~640 polli = 1,4%, każdy następny poll OK |
| system_logs 7d | 2524 info, 9 warn (wyżej), **0 error**; 0 wierszy z datą 1970 |
| backup | nd 18.10 03:15 OK: bundle 4,7 MB na Telegram, retencja 8 zestawów |
| dysk | 67/116 GB (61%); do odzyskania ~10,5 GB Dockera (build cache 8,1 + obrazy 2,0 + wolumeny 0,4) — czeka na zgodę |
| kod | 1 commit (`9417240` fix autostartu, tylko skrypt hosta — rebuild niepotrzebny); `main` = `origin/main`; pełny test fixu dopiero przy następnym odcięciu zasilania |
| gra real (XTB) | dziennik bez zmian od 24.09, seria 0, brak transakcji — brak sygnałów kwalifikujących |

## 6. Co dalej

Nic do zmiany przed **01.11** (werdykt #2 + discovery #2 + decyzje: rdzeń, etap 2 agentów, migracja na Pi).
Jedyna rzecz, która może się wydarzyć sama do tego czasu: INBX wchodzi do gate'u C-suite (~23.10).

## Czego NIE zweryfikowałem
- CI na GitHubie dla `9417240` (brak `gh` na Jetsonie; pre-push hook lokalnie zielony).
- Czy 7-dniowy wynik INBX 14.10 wyląduje w gate jako osobne zdarzenie (okno grupowania 7 dni od 28.09 — powinno, bo 16 dni).
