# Ocena skuteczności systemu StockPulse — czy mamy edge?

**Data analizy**: 09.06.2026
**Okno danych**: 98 alertów z produkcji, 09.04–08.06.2026 (33 dostarczone na Telegram, 65 stłumione), wszystkie z `priceAtAlert`, 97/98 z wypełnionym `price1d`. Dane: bezpośrednie zapytania do bazy produkcyjnej (tabele `alerts`, `insider_trades`, `tickers`).

**Metryka**: "signed return" = zwrot w kierunku alertu (dla `negative` znak odwrócony — dodatnia wartość oznacza, że alert miał rację). Hit rate = % alertów z poprawnym kierunkiem.

---

## TL;DR — werdykt

**System jako całość do tej pory NIE dał edge'u: 33 dostarczone alerty mają łączny signed return 3d = 0.00% i hit rate 52% (moneta).** Ale ten agregat ukrywa dwie różne epoki i bardzo różne reguły:

1. **Przed fixami Sprint 19 (do 02.05)**: system był *aktywnie zły* — 22 alerty, signed −1.51% 3d, hit 41%. Gdybyś handlował odwrotnie do alertów, zarabiałbyś.
2. **Po fixach (od 02.05)**: 11 alertów, signed **+3.03% 3d, hit 73%** — ale to tylko ~8 niezależnych zdarzeń, zdominowanych przez jeden ticker (HIMS).
3. **Jedyna reguła z potwierdzonym edge'em forward to Form 4 Insider BUY: 3/3 trafień, średnio +5.64% 3d** (OSCR +0.42, HIMS +12.16, PODD +4.34) — zgodnie z backtestem V5 (C-suite BUY d=+0.92). Problem: **strzela ~1×/miesiąc**, bo w obecnym uniwersum jest 0–2 discretionary BUY miesięcznie.
4. **Wszystkie bycze alerty 8-K dostarczone na Telegram są stratne: 0/4 trafień** (PODD −8.06%, MOH −6.23%, HUM −2.24%, +1 wcześniejszy). To jest największy aktywny generator strat w systemie — i guard konsensusu (FIX-12) go nie łapie, bo pokrywa tylko Item 2.02.

**Odpowiedź na pytanie "czy system da edge": tak, ale tylko jeśli (a) zatkasz byczą dziurę 8-K, (b) nakarmisz głodujący lejek Insider BUY (APLS Faza 3 ma decyzję GO z 23.05 i NIE jest wdrożona), (c) przeżyjesz kolejne 2–3 miesiące walidacji forward zanim uznasz post-fixowe +3% za realne.**

---

## 1. Wyniki forward — dostarczone alerty (produkt)

### 1.1 Agregat i podział czasowy

| Okres | N | signed 1d | signed 3d | hit 1d | hit 3d |
|---|---|---|---|---|---|
| **Cały okres** | 33 | −0.65% | **0.00%** | — | **52%** |
| Przed 02.05 (pre-FIX-05/07/12) | 22 | −1.70% | −1.51% | 36% | 41% |
| Po 02.05 (post-fix) | 11 | +1.45% | **+3.03%** | 64% | **73%** |

Fixy Sprint 19 (direction conflict guard, sell_no_edge backdoor, consensus injection, exhibit 99.1) **odwróciły znak systemu**. To najmocniejszy dowód, że poprzednie straty były bugami, nie brakiem sygnału. Ale N=11 po fixach to za mało na pewność — patrz sekcja 4.

### 1.2 Per reguła (cały okres, tylko dostarczone)

| Reguła | Kierunek | N | signed 3d | hit 3d | Ocena |
|---|---|---|---|---|---|
| **Form 4 Insider BUY** | positive | 3 | **+5.64%** | **100%** | ✅ jedyny potwierdzony edge |
| Correlated Signal | positive | 10 | +2.44% | 70% | ⚠️ zawyżone przez redundancję (patrz 2.2) |
| 8-K Material Event GPT | negative | 5 | +0.03% | 60% | ➖ szum, post-fix lepiej (BIIB −5.5%, PODD −4.0% trafione) |
| Form 4 Insider Signal | negative | 3 | −1.04% | 33%* | ❌ relikt pre-gate |
| Correlated Signal | negative | 7 | −2.56% | 29% | ❌ pre-FIX-05 (UNH false positives) — naprawione |
| **8-K Earnings Miss** | positive | 2 | **−7.14%** | **0%** | ❌ PODD + MOH |
| **8-K Material Event GPT** | positive | 2 | **−2.00%** | **0%** | ❌ HUM + 1 |
| 8-K Earnings Miss | negative | 1 | −1.98% | 0% | ❌ HUM 29.04 halucynacja (pre-FIX) |

*\*hit 1d=67%, 3d odwraca.*

**Wzorzec, który widać gołym okiem**: trafiają alerty oparte na **twardym zaangażowaniu (insider kupuje za własne pieniądze)** albo **twardych złych liczbach** (BIIB, PODD short post-fix). Przegrywają wszystkie alerty oparte na **byczej narracji GPT** — "publikacja celów 2029 *może* wywołać pozytywną reakcję, *pod warunkiem że*..." (MOH, Item 7.01, −6.23%), "transakcja *umiarkowanie pozytywna* bo wzmacnia płynność" (HUM, Item 1.01 umowa kredytowa, −2.24%). GPT spekuluje, rynek to już wycenił.

### 1.3 Bycza dziura 8-K — poza zasięgiem FIX-12

FIX-12 (consensus gap guard) działa tylko na **Item 2.02** (earnings). MOH przeszedł na **Item 7.01** (Reg FD), HUM na **Item 1.01** (umowa). Dla tych Itemów nie ma żadnego twardego kotwiczenia liczbowego — conviction pochodzi w 100% z interpretacji GPT. Forward dane: **0/4 trafień, średnio −4.4% 3d**. To nie jest "za mało N żeby ocenić" — to jest spójny mechanizm (priced-in + LLM optimism bias) potwierdzony czterema z czterech przypadków.

---

## 2. Wyniki forward — alerty stłumione (walidacja decyzji systemu)

To najbardziej niedoceniona część systemu: 65 stłumionych alertów z pełnym trackingiem cen pozwala sprawdzić, czy gate'y podejmują dobre decyzje.

### 2.1 Tłumienie SELL — potwierdzone słuszne ✅

| Powód | N | signed 3d (gdyby dostarczone) |
|---|---|---|
| `sell_no_edge` (Form 4 SELL) | 23 | −0.48% (byłyby stratne) |
| `observation` Form 4 negative | 10 | −2.84% (byłyby mocno stratne) |
| `observation` Correlated negative | 11 | −1.39% |
| `cluster_sell_no_edge` | 3 | −0.45% |

**47 stłumionych sygnałów SELL — wszystkie grupy miałyby ujemny signed return.** Decyzja z backtestu V5 (healthcare SELL = zero edge) jest w pełni potwierdzona forward. Gate'y działają.

### 2.2 Tłumienie, które kosztowało — stracone okazje ⚠️

| Powód | N | signed 3d | Komentarz |
|---|---|---|---|
| `gpt_missing_data` positive | 9 | +2.3% | Pre-FIX-10/10b: exhibit nie docierał do GPT. Po FIX-10b te alerty powinny przepływać — **monitoruj w lipcu (Q2 earnings)** |
| `consensus_miss` HIMS 11.05 | 1 | **+17.74%** (short) | Znany case FIX-16: extreme miss −507% EPS cap'nięty symetryczną regułą R1. Stracony short −19.7% 1d |
| `observation` 8-K positive | 2 | +12.14, +1.75 | Semi tickers — by design |

---

## 3. Problemy strukturalne (nie bugi — design)

### 3.1 Lejek Insider BUY głoduje — P0

Discretionary transakcje w całym uniwersum (42 tickery):

| Miesiąc | disc BUY | disc SELL |
|---|---|---|
| 03.2026 | **0** | 25 |
| 04.2026 | **1** | 81 |
| 05.2026 | **1** | 304 |
| 06.2026 (do 08) | **2** | 86 |

Jedyna reguła z edge'em dostaje **1–2 surowe sygnały miesięcznie**. System spala >95% swojej mocy obliczeniowej (GPT, korelacje, options flow) na sygnały SELL, które potem słusznie wyrzuca. Cel "3–5 alertów/tydzień z realnym edge" jest **matematycznie nieosiągalny** w obecnym uniwersum — insiderzy w dużych zwalidowanych spółkach healthcare prawie nie kupują discretionary.

**A rozwiązanie już masz zatwierdzone i nie wdrożone**: APLS Faza 3 (decyzja GO conservative z 23.05, checklist w `doc/APLS-FAZA-2-RESULTS-2026-05-23.md`) dodaje 6 biotechów (URGN/ARDX/MNKD/CRSP/AXSM/RCKT) z backtestowanym d=+0.75 dla BUY $500K+. Sprawdziłem tabelę `tickers`: **żaden z 6 nie jest zasiany**. To 2 tygodnie straconego okna obserwacyjnego.

### 3.2 Redundancja alertów zawyża statystyki i spamuje — P1

- **UNH: 5 alertów Correlated Signal w 4 dni** (27–30.04), ten sam klaster sygnałów.
- **HIMS: 4 alerty w 3 dni** (26–28.05): 1× Insider BUY + 3× Correlated CRITICAL na ten sam ruch.

10 dostarczonych Correlated positive to w rzeczywistości **3 niezależne epizody** (OSCR, UNH, HIMS). PATTERN_THROTTLE 2h + content-hash dedup 15 min nie łapią wzorca "codziennie nowy sygnał opcyjny odświeża ten sam pattern". Konsekwencje: (a) statystyki per-reguła liczą jeden ruch wielokrotnie, (b) odbiorca dostaje 4 powiadomienia o jednej okazji, (c) "+2.44% Correlated" w sekcji 1.2 to w ~połowie jeden ruch HIMS.

### 3.3 Reguły-zombie — P2

- **Unusual Options Activity: 0 alertów od początku okna danych** (wymaga pdufaBoost, który nigdy nie zaszedł). Options flow (cykl do 6h dziennie, Polygon API) istnieje wyłącznie jako wkład do korelacji — warto policzyć, ile korelowanych trafień faktycznie zależało od nogi opcyjnej.
- **8-K Leadership Change: 1 alert / 2 miesiące** (stłumiony).
- PDUFA collector zbiera dane, ale boost nigdy nie wpłynął na żaden dostarczony alert.

---

## 4. Zastrzeżenia statystyczne — dlaczego nie wolno jeszcze świętować

1. **N=11 post-fix to ~8 niezależnych zdarzeń** (HIMS ×3 to jeden ruch). Przy tak małej próbie signed +3.03% mieści się w przedziale szumu. Jeden zły CRITICAL (-8%) zmienia obraz.
2. **Wynik post-fix jest zdominowany przez HIMS** (+12.16% wnosi większość średniej). Bez epizodu HIMS post-fixowy agregat spada w okolice +1%.
3. **Brak korekty sektorowej dla 90% próby**: XBI/IBB alpha działa od 23.05, więc wcześniejsze "trafienia" mogą być betą sektora, nie alfą alertu. Maj był dobry dla biotechu — część +3% to może po prostu rynek.
4. **Zwroty 1d/3d bez kosztów transakcyjnych i slippage** — przy alertach po sesji (options flow 22:15 UTC) wejście jest realnie na otwarciu D+1, czyli część ruchu już ucieka.
5. **Backtest V5 jest solidny metodologicznie** (Welch, Cohen's d pooled, Bonferroni, winsoryzacja, control group) — to nie jest słabe ogniwo. Słabym ogniwem jest **przepustowość**: edge d=+0.92 na sygnale, który występuje 1–2×/miesiąc, daje za mało okazji, żeby się skumulował.

---

## 5. Rekomendacje

### P0 — zrób w tym tygodniu

1. **Bycze 8-K bez twardych liczb → observation mode.** Konkretnie: alerty 8-K z `alertDirection='positive'` dla Itemów **innych niż 2.02** (a dla 2.02 — tylko gdy R4 guard: oba beaty ≥+5%) kierowane do DB-only z `nonDeliveryReason='bullish_narrative'`. Dane: 0/4 trafień, śr. −4.4% 3d. To jest dziś jedyny aktywny, systematyczny generator strat. GPT analysis zostaje (forward validation jak przy C-suite SELL).
2. **Wdróż APLS Faza 3** (seed 6 tickerów, `sector='biotech_apls'`, `observationOnly=true`, threshold $500K — checklist gotowy w `doc/APLS-FAZA-2-RESULTS-2026-05-23.md`). Każdy tydzień zwłoki to tydzień mniej danych obserwacyjnych dla jedynej reguły, która działa.
3. **Cross-rule per-ticker direction throttle 72h**: jeden ticker + jeden kierunek = max 1 dostarczony alert na 72h niezależnie od reguły (UNH ×5, HIMS ×4). Kolejne trafienia tego samego wzorca → DB-only `nonDeliveryReason='direction_repeat'` (dane do analizy zostają).

### P1 — w ciągu 2–4 tygodni

4. **FIX-16 asymetryczny cap R1** — HIMS short +19.7% stracony to pojedynczy przypadek (N=1, słusznie nie deployowane), ale lipiec Q2 earnings to okno na zebranie ≥3 sampli. Przygotuj kod za feature flagą już teraz, włącz po walidacji.
5. **Tygodniowy automat "edge scorecard"**: jeden SQL/CRON liczący per reguła×kierunek: N, signed 1d/3d, hit rate, **XBI-alpha** (od 23.05 dane są), osobno delivered vs suppressed. To zapytanie, które wykonałem ręcznie do tego raportu — powinno być raportem cotygodniowym na Telegramie. Bez tego następna ocena edge'u znów zajmie sesję analizy.
6. **Monitoruj `gpt_missing_data` positive w lipcu**: 9 stłumionych alertów było kierunkowo trafnych (+2.3% 3d). Po FIX-10b powinny przepływać z pełnymi danymi — jeśli nadal lądują w guardzie, exhibit fetch ma kolejną dziurę.

### P2 — decyzje portfelowe (następny miesiąc)

7. **Policz ROI options flow**: cykl do 6h/dzień + Polygon API utrzymuje regułę, która nigdy nie wystrzeliła standalone, i nogę korelacyjną o niezweryfikowanym wkładzie. Test: ile z trafionych Correlated positive miało nogę opcyjną, której usunięcie zmieniłoby decyzję? Jeśli mało — kandydat do uproszczenia (np. EOD light albo wyłączenie).
8. **Semi supply chain — termin decyzji**: 14 tickerów w obserwacji od 09.04 (2 miesiące). Ustal datę backtestu wertykalnego (FIX-08/09) albo sunset — obserwacja bez planu analizy to koszt bez zwrotu.
9. **Zdefiniuj próg sukcesu systemu** zanim zobaczysz dane: np. "po 20 niezależnych dostarczonych alertach post-fix: signed XBI-alpha 3d > +1.5% i hit ≥60%, inaczej redukcja do samego Insider BUY". Bez prezarejestrowanego progu każdy wynik da się zracjonalizować.

---

## 6. Szczera odpowiedź na pytanie

**Czy system, który zbudowałeś, da Ci edge?**

- **Sygnał istnieje**: insider discretionary BUY ma edge potwierdzony backtestem (d=+0.75–0.92, Bonferroni) **i** forwardem (3/3, +5.64% 3d). To rzadka sytuacja — większość retailowych systemów sygnałowych nie przechodzi ani jednego z tych testów.
- **System przez większość życia tego edge'u nie dowoził** (agregat 0.00%), bo (a) bugi — w dużej mierze naprawione, co widać w odwróceniu znaku po 02.05; (b) bycza narracja GPT — nadal aktywna dziura; (c) lejek — jedyna działająca reguła dostaje 1–2 sygnały/miesiąc.
- **Realistyczny scenariusz po wdrożeniu P0**: system staje się niskoczęstotliwościowym (2–5 alertów/miesiąc po rozszerzeniu uniwersum), wysokoprecyzyjnym narzędziem na insider BUY + bearish hard-numbers 8-K. To może być realny edge — ale o charakterze "kilka dobrych okazji na kwartał", nie "3–5 alertów tygodniowo". Cel tygodniowy z CLAUDE.md warto oficjalnie zrewidować, bo popycha system w stronę reguł, które generują straty.
- **Werdykt odłóż do ~01.09.2026**: po Q2 earnings + 4 tygodniach APLS w obserwacji będzie ~20–30 niezależnych post-fixowych alertów z XBI-alpha — pierwsza próba, na której odpowiedź "tak/nie" będzie statystycznie uczciwa.

---

## Załącznik: zapytania źródłowe

Wszystkie liczby pochodzą z bazy produkcyjnej (09.06.2026). Kluczowe zapytanie (signed return / hit rate per reguła):

```sql
WITH o AS (
  SELECT "ruleName", "alertDirection" AS dir, delivered,
    ("price3d"-"priceAtAlert")/"priceAtAlert"*100 AS r3d
  FROM alerts WHERE "price1d" IS NOT NULL AND "alertDirection" IS NOT NULL
)
SELECT "ruleName", dir, delivered, count(*) AS n,
  round(avg(CASE WHEN dir='positive' THEN r3d ELSE -r3d END),2) AS signed_r3d,
  round(100.0*avg(CASE WHEN (dir='positive' AND r3d>0)
                    OR (dir='negative' AND r3d<0) THEN 1 ELSE 0 END),0) AS hit3d
FROM o GROUP BY 1,2,3 ORDER BY 1,2,3;
```
