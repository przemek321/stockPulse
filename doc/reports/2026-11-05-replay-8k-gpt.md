# Replay GPT dla 8-K z luki 27.10–05.11.2026 (NIE-sygnał, raport informacyjny)

📼 REPLAY 8-K z luki 27.10–05.11 (GPT padł — brak kredytów API)

Co GPT powiedziałby o filingach, które przepadły. TO NIE JEST SYGNAŁ — raport informacyjny, nic nie zapisane w bazie, ceny wejścia sprzed kilku dni. Odtworzone tym samym kodem co pipeline (bez konsensusu Alpha Vantage).

Filingów: 23 · system dostarczyłby na Telegram: 2 · trafność kierunku GPT vs kurs (α do XLV): 8/13

Tło: XLV (cały sektor) +5,5% od 28.10 do 04.11 — rajd, więc surowe wzrosty to w dużej części sektor.

⚠️ Przy okazji: pipeline nie znajduje Exhibit 99.1 o niestandardowej nazwie (np. LLY) → GPT dostaje sam wrapper, analiza odpada. Do decyzji — bug zgłoszony, nie naprawiany.

Skrypt: `scripts/analysis/replay-8k-gpt.js` (w kontenerze app, przez most `claude -p`, zero zapisu do bazy). Ceny: Polygon daily (close przed reakcją → pierwsze otwarcie po filingu → ostatnie zamknięcie), XLV w tym samym oknie.

### THC 29.10 07:05 ET · Item 2.02
- GPT: 🟢 positive, conviction +1.4, high
- System zrobiłby: bullish_no_consensus_data (w produkcji: deliver tylko przy udokumentowanym beacie ≥5%)
- Wniosek: Wyniki znacząco przekroczyły ubiegłoroczne poziomy — przychody operacyjne wzrosły o 6,5% do $5,631 mld, marża EBITDA skoczyła z 20,8% do 24,1%, a podniesienie prognozy rocznej potwierdza trwałość poprawy operacyjnej; należy…
- Kurs: przed 268.5 → otwarcie 259.01 (gap -3.5%) → 04.11 292.25: od newsa +8.8% (XLV +5.5%, α +3.3%), od otwarcia +12.8%

### LLY 29.10 07:05 ET · Item 2.02
- GPT: 🟢 positive, conviction +1.4, high
- System zrobiłby: SKIP_INVALID_JSON | z poprawionym exhibitem: bullish_no_consensus_data (w produkcji: deliver tylko przy udokumentowanym beacie ≥5%)
- Wniosek: Wyniki napędzane przez Mounjaro (+65% r/r do $10,7 mld) i Zepbound (+49% r/r do $5,4 mld) wraz z falą zatwierdzeń FDA i podniesieniem guidancu wskazują na wyraźnie pozytywny impuls cenowy; raportowany EPS $7,22 (+16% r/r) był…
- Kurs: przed 1288.3 → otwarcie 1332.73 (gap +3.5%) → 04.11 1417.99: od newsa +10.1% (XLV +5.5%, α +4.5%), od otwarcia +6.4%

### BMY 29.10 07:35 ET · Item 2.02
- GPT: 🔴 negative, conviction -0.6, medium
- System zrobiłby: DELIVERED? (bearish 2.02 — w produkcji najpierw consensus guard FIX-12)
- Wniosek: Rynek prawdopodobnie zareaguje umiarkowanie negatywnie ze względu na silne obniżenie guidance EPS (o ~40–45 centów) oraz istotną kompresję marży brutto (68,4% vs 72,9% non-GAAP r/r), mimo że podwyżka guidance przychodowego do…
- Kurs: przed 60.57 → otwarcie 61 (gap +0.7%) → 04.11 64.19: od newsa +6.0% (XLV +5.5%, α +0.5%), od otwarcia +5.2%

### DXCM 29.10 16:05 ET · Item 2.02
- GPT: 🟢 positive, conviction +1.2, high
- System zrobiłby: bullish_no_consensus_data (w produkcji: deliver tylko przy udokumentowanym beacie ≥5%)
- Wniosek: Silne wyniki Q3 2026 z ekspansją marży brutto GAAP o ~380 pb i marży operacyjnej o 420 pb r/r, połączone z podwyższeniem prognoz rocznych (przychody $5,20–5,25 mld, marża operacyjna Non-GAAP ~24%) oraz nowym programem odkupu…
- Kurs: przed 79.93 → otwarcie 81.52 (gap +2.0%) → 04.11 88.48: od newsa +10.7% (XLV +3.0%, α +7.6%), od otwarcia +8.5%

### GILD 29.10 16:05 ET · Item 2.02
- GPT: 🟢 positive, conviction +1.2, high
- System zrobiłby: bullish_no_consensus_data (w produkcji: deliver tylko przy udokumentowanym beacie ≥5%)
- Wniosek: Wyniki Q3 2026 są wyraźnie bycze – najsilniejszy wzrost organiczny od dekady, HIV +18% do 6,2 mld USD, Trodelvy +42% do 506 mln USD, Biktarvy +10% do 4,1 mld USD, prognoza przychodów podwyższona łącznie o 1,6 mld USD od początku…
- Kurs: przed 165.61 → otwarcie 170.25 (gap +2.8%) → 04.11 174.48: od newsa +5.4% (XLV +3.0%, α +2.3%), od otwarcia +2.5%

### REGN 30.10 07:05 ET · Item 2.02
- GPT: 🟢 positive, conviction +1.4, high
- System zrobiłby: bullish_no_consensus_data (w produkcji: deliver tylko przy udokumentowanym beacie ≥5%)
- Wniosek: Wyniki napędzane spłatą Salda Rozwojowego Sanofi (od Q3 2026 nie pomniejsza przychodów) oraz organicznym wzrostem Dupixentu (+35% do $6,540 mln), EYLEA HD (+62% do $699 mln w USA) i Libtayo (+51% do $550 mln) jednoznacznie…
- Kurs: przed 818.77 → otwarcie 869.43 (gap +6.2%) → 04.11 930.67: od newsa +13.7% (XLV +3.0%, α +10.6%), od otwarcia +7.0%

### ABBV 30.10 08:05 ET · Item 2.02
- GPT: 🟢 positive, conviction +1.1, medium
- System zrobiłby: bullish_no_consensus_data (w produkcji: deliver tylko przy udokumentowanym beacie ≥5%)
- Wniosek: Silny wzrost Skyrizi (+22,7% do $5,776 mld) i Rinvoq (+23,9% do $2,706 mld) z nawiązką kompensuje erozję Humiry (-31,2%), a podniesienie guidance oraz ogłoszenie wzrostu dywidendy o 5,2% powinny wywołać umiarkowanie pozytywną…
- Kurs: przed 290.79 → otwarcie 292 (gap +0.4%) → 04.11 294.83: od newsa +1.4% (XLV +3.0%, α -1.7%), od otwarcia +1.0%

### GDRX 02.11 16:35 ET · Item 4.02
- GPT: 🔴 negative, conviction -1.1, medium
- System zrobiłby: DELIVERED (Telegram)
- Wniosek: Pomimo że korekta jest pozytywna dla wyników (przychody i zyski wyższe niż raportowane), rynek prawdopodobnie zareaguje negatywnie w krótkim terminie z powodu zapowiedzianych material weaknesses w kontroli wewnętrznej oraz…
- Kurs: przed 3.55 → otwarcie 3.53 (gap -0.6%) → 04.11 3.72: od newsa +4.8% (XLV +2.7%, α +2.0%), od otwarcia +5.4%

### ISRG 02.11 16:35 ET · Item 5.02
- GPT: ⚪ neutral, conviction +0.0, low
- System zrobiłby: SKIP_LOW_PRIORITY (brak alertu)
- Wniosek: Mianowanie Aarona Martina to rutynowe poszerzenie składu Rady — brak zwolnień, brak kryzysu, standardowe wynagrodzenie dla dyrektora niewykonawczego. Rynek najprawdopodobniej zignoruje to wydarzenie, nie należy oczekiwać żadnej…
- Kurs: przed 436.87 → otwarcie 436.65 (gap -0.1%) → 04.11 482.1: od newsa +10.3% (XLV +2.7%, α +7.6%), od otwarcia +10.4%

### ABBV 02.11 16:35 ET · Item 5.02
- GPT: ⚪ neutral, conviction +0.0, low
- System zrobiłby: SKIP_LOW_PRIORITY (brak alertu)
- Wniosek: Odejście ma charakter czysto rutynowy i wynika wyłącznie z konfliktu interesów spowodowanego nową rolą zawodową Davis – nie jest następstwem żadnego sporu ani problemu operacyjnego; rynek prawdopodobnie zignoruje tę informację…
- Kurs: przed 288.84 → otwarcie 288.69 (gap -0.1%) → 04.11 294.83: od newsa +2.1% (XLV +2.7%, α -0.7%), od otwarcia +2.1%

### VRTX 02.11 16:35 ET · Item 2.02
- GPT: 🟢 positive, conviction +0.9, medium
- System zrobiłby: SKIP_INVALID_JSON | z poprawionym exhibitem: bullish_no_consensus_data (w produkcji: deliver tylko przy udokumentowanym beacie ≥5%)
- Wniosek: Solidny wzrost przychodów o 12% r/r oraz podniesienie guidance do 13,15–13,25 mld USD (poprzednio 13,1–13,2 mld USD) powinny wypchnąć kurs lekko w górę; dodatkowym katalizatorem jest zbliżająca się data PDUFA dla povetaciceptu w…
- Kurs: przed 553.15 → otwarcie 558.44 (gap +1.0%) → 04.11 549.04: od newsa -0.7% (XLV +2.7%, α -3.5%), od otwarcia -1.7%

### HCA 02.11 17:05 ET · Item 8.01
- GPT: ⚪ neutral, conviction +0.2, low
- System zrobiłby: SKIP_LOW_PRIORITY (brak alertu)
- Wniosek: Wydarzenie ma neutralny wpływ na cenę akcji — to standardowa operacja zarządzania zadłużeniem, która nie zmienia fundamentalnej siły zarobkowej spółki. Proaktywne refinansowanie zbliżającego się terminu wykupu może być…
- Kurs: przed 467.73 → otwarcie 463.72 (gap -0.9%) → 04.11 510.7: od newsa +9.2% (XLV +2.7%, α +6.4%), od otwarcia +10.1%

### PFE 03.11 08:35 ET · Item 2.02
- GPT: 🟢 positive, conviction +0.9, medium
- System zrobiłby: SKIP_INVALID_JSON | z poprawionym exhibitem: bullish_no_consensus_data (w produkcji: deliver tylko przy udokumentowanym beacie ≥5%)
- Wniosek: Wyniki są umiarkowanie pozytywne — podniesienie guidance przychodów do $62.0-$64.0 mld (z $60.5-$62.5 mld) oraz Adjusted EPS do $2.95-$3.05 (z $2.80-$3.00) sygnalizuje pewność zarządu co do dynamiki biznesowej poza COVID-em.…
- Kurs: przed 30.67 → otwarcie 30.68 (gap +0.0%) → 04.11 30.79: od newsa +0.4% (XLV +2.7%, α -2.4%), od otwarcia +0.4%

### ENSG 03.11 16:35 ET · Item 1.01
- GPT: ⚪ neutral, conviction +0.0, low
- System zrobiłby: SKIP_LOW_PRIORITY (brak alertu)
- Wniosek: Zgłoszenie to nie dotyczy spółki ENSG — jest to błędnie przypisany dokument opisujący transakcję zadłużenia Sands China Ltd. z branży kasyn/gamblingu. Brak jakiegokolwiek wpływu na wycenę akcji Ensign Group; zdarzenie należy…
- Kurs: przed 182.21 → otwarcie 185.47 (gap +1.8%) → 04.11 188.31: od newsa +3.4% (XLV +3.1%, α +0.3%), od otwarcia +1.5%

### AMGN 03.11 16:35 ET · Item 2.02
- GPT: 🟢 positive, conviction +0.9, medium
- System zrobiłby: SKIP_LOW_PRIORITY (brak alertu) | z poprawionym exhibitem: bullish_no_consensus_data (w produkcji: deliver tylko przy udokumentowanym beacie ≥5%)
- Wniosek: Wyniki operacyjne są silne — marża operacyjna non-GAAP wzrosła do 47,3%, a GAAP do 37,5% (+9,9 pp r/r) — przy czym pozytywne dane Phase 3 IMDELLTRA (58% redukcja ryzyka zgonu w pierwszej linii SCLC) i dynamicznie rozwijający się…
- Kurs: przed 461.26 → otwarcie 479.61 (gap +4.0%) → 04.11 478.48: od newsa +3.7% (XLV +3.1%, α +0.7%), od otwarcia -0.2%

### PFE 03.11 16:35 ET · Item 5.02
- GPT: ⚪ neutral, conviction +0.1, low
- System zrobiłby: SKIP_LOW_PRIORITY (brak alertu)
- Wniosek: Nominacja jest rutynowym potwierdzeniem już ogłoszonej zmiany przejściowej — oryginalne odejście poprzedniego CFO było znane rynkowi od czerwca 2026, a Guegan sprawuje tę rolę od ponad 2 miesięcy jako interim; brak elementu…
- Kurs: przed 30 → otwarcie 30.75 (gap +2.5%) → 04.11 30.79: od newsa +2.6% (XLV +3.1%, α -0.4%), od otwarcia +0.1%

### PODD 04.11 07:05 ET · Item 2.02
- GPT: 🟢 positive, conviction +1.2, high
- System zrobiłby: bullish_no_consensus_data (w produkcji: deliver tylko przy udokumentowanym beacie ≥5%)
- Wniosek: Wyniki Q3 2026 były wyraźnie powyżej oczekiwań: marża operacyjna wzrosła do 22.5% (+590 bps), adjusted EPS $1.99 wzrósł o 59.9% YoY, a spółka podniosła guidance marży operacyjnej z +100 bps do +150 bps oraz podwyższyła prognozę…
- Kurs: przed 154.86 → otwarcie 148.61 (gap -4.0%) → 04.11 165.02: od newsa +6.6% (XLV +3.1%, α +3.5%), od otwarcia +11.0%

### COR 04.11 07:05 ET · Item 2.02
- GPT: 🟢 positive, conviction +0.8, medium
- System zrobiłby: bullish_no_consensus_data (w produkcji: deliver tylko przy udokumentowanym beacie ≥5%)
- Wniosek: Wyniki za Q4 FY2026 i cały rok fiskalny były solidne — skorygowany EPS roczny wzrósł o 12,3% do $17,97, a marża operacyjna adjusted poprawiła się o 12 pb do 1,43% — co w połączeniu z nową strukturą segmentów, akwizycją…
- Kurs: przed 340.5 → otwarcie 342.2 (gap +0.5%) → 04.11 354: od newsa +4.0% (XLV +3.1%, α +0.9%), od otwarcia +3.5%

### COR 2026-11-04 14:35 · Item 7.01
- GPT: ⚪ neutral, conviction +0.2, low
- System zrobiłby: SKIP_LOW_PRIORITY (brak alertu)
- Wniosek: Wpływ na cenę akcji będzie minimalny, gdyż zmiana dotyczy wyłącznie struktury raportowania, a nie fundamentalnej działalności operacyjnej; jedynym potencjalnie istotnym sygnałem jest wzmianka o 'strategicznych alternatywach' dla…
- Kurs: za wcześnie (brak sesji po filingu w danych EOD)

### SMMT 2026-11-04 22:05 · Item 2.02
- GPT: brak analizy
- System zrobiłby: SKIP_INVALID_JSON | z poprawionym exhibitem: SKIP_INVALID_JSON
- Błąd: [   {     "code": "too_small",     "minimum": 1,     "type": "array",     "inclusive": true,     "exact": false,    …
- Kurs: za wcześnie (brak sesji po filingu w danych EOD)

### SMMT 2026-11-04 22:35 · Item 8.01
- GPT: 🔴 negative, conviction -0.3, low
- System zrobiłby: SKIP_LOW_PRIORITY (brak alertu)
- Wniosek: Emisja nowych akcji ma charakter rozwadniający dla dotychczasowych akcjonariuszy i typowo wywiera umiarkowanie negatywną presję na cenę, jednak brak informacji o wielkości oferty ogranicza precyzję oceny — dla spółek…
- Kurs: za wcześnie (brak sesji po filingu w danych EOD)

### CI 2026-11-05 11:35 · Item 2.02
- GPT: 🟢 positive, conviction +0.9, medium
- System zrobiłby: bullish_no_consensus_data (w produkcji: deliver tylko przy udokumentowanym beacie ≥5%)
- Wniosek: Wyniki są solidnie pozytywne — silny wzrost segmentu Cigna Healthcare (+15% zysk operacyjny pre-tax) i Specialty and Care Services (+15%) kompensuje znane, oczekiwane osłabienie Pharmacy Benefit Services (-22%), a podwyższona…
- Kurs: za wcześnie (brak sesji po filingu w danych EOD)

### OSCR 2026-11-05 11:35 · Item 2.02
- GPT: 🟢 positive, conviction +1.4, high
- System zrobiłby: gpt_missing_data | z poprawionym exhibitem: bullish_no_consensus_data (w produkcji: deliver tylko przy udokumentowanym beacie ≥5%)
- Wniosek: Wyniki są wyraźnie bycze: dramatyczna poprawa MLR z 88.5% do 84.0%, przychody wzrosły o ~72% r/r do $5.14 mld, a prognoza zysku operacyjnego na 2026 została podniesiona z $600-800 mln do $850-950 mln (środek +$200 mln).…
- Kurs: za wcześnie (brak sesji po filingu w danych EOD)
