# FIX-16 shadow review — 25.08.2026

**Werdykt: NIE deployujemy. Cap R1 zostaje, shadow przedłużony do 15.11.2026 (po Q3 earnings).**

## Gate (pre-zarejestrowany 09.06, doprecyzowany 02.07)

Deploy asymetrycznej drabinki (extreme miss → no cap) przy **N≥3 `would_uncap=true`
z kierunkiem zgodnym** (stock spadł po extreme missie). Przy N poniżej progu — „insufficient N",
przegląd przesunięty, decyzji nie forsujemy.

## Dane (query: `sec_filings.gptAnalysis.fix16_shadow`, stan 25.08)

| Symbol | Filing | would_uncap | precap | EPS surprise |
|---|---|---|---|---|
| HCA | 07-14 | false | −1.10 | −0.8% |
| ENSG | 07-22 | false | −0.70 | −0.2% |
| UHS | 07-28 | false | −0.70 | −0.6% |
| TDOC | 07-29 | false | −0.70 | −12.6% |
| CI | 07-30 | false | +0.70 | −0.6% |
| **HIMS** | **08-10** | **true** | **−1.10** | **−529.9%** |

**N = 1/6** — gate niespełniony (potrzeba 3).

## Ocena jakościowa

1. **Mechanizm detekcji działa**: HIMS 10.08 to dokładnie klasa zdarzenia, dla której shadow
   powstał (extreme miss z sign-flipem, GPT bearish zgodny) — i jedyny wpis, który przeszedł
   wszystkie warunki (extreme + sign-gate + bez anomalii). Kierunek POTWIERDZONY: −6.6% 1d /
   −9.5% 3d / −10.8% 7d (alert #2475). Precap −1.1 był słuszny, cap −0.3 stępiłby słuszny short.
2. **Pozostałe 5 capów zasadne**: małe missy (−0.2..−12.6%) bez kwalifikacji extreme; CI wręcz
   bullish precap (+0.7) — PODD-class, cap chroni. Shadow nie generuje fałszywych kwalifikacji.
3. **ALE niuans architektoniczny**: alert HIMS #2475 był stłumiony przez `gpt_missing_data`
   (priorytet suppression wyżej niż consensus). Samo zdjęcie capa NIE dostarczyłoby tego
   shorta — koszt „straconego shorta" jest hipotetyczny, realną bramką była missing-data.
   Wniosek: ewentualny przyszły deploy FIX-16 bez przeglądu interakcji z guardem missing-data
   nie zmieni zachowania w tej klasie przypadków.

## Decyzja

- Cap R1 (0.3) bez zmian. Shadow zbiera dalej — Q3 earnings (X-XI) dostarczy próbkę.
- **Review #2: 2026-11-15** (albo wcześniej przy N≥3) — wpis dodany do `VALIDATION_CALENDAR`.
- Do review #2 dołożyć: analizę interakcji uncap × missing-data guard (pkt 3) oraz
  hipotezę symetryczną z 10.08 (ekstremalne BEATY jako artefakt konsensusu — case OSCR,
  przegląd 07.09).

Tempo zbierania: 6 capów w 11 tygodni (~0.5/tydz.), z czego 1 extreme. Projekcja na 15.11:
N≈4-6 nowych capów, 1-2 extreme — gate może się domknąć, ale bez gwarancji.
