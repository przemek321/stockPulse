# Bullish-8K gate revisit — 07.09.2026 (90d od P1-02)

**Werdykt: bramka ZOSTAJE bez zawężenia. Kolejny przegląd 15.11 (razem z FIX-16 #2, po Q3 earnings).**

## Gate (pre-rejestracja 09.06, doprecyzowanie 02.07)

Query MUSI objąć wszystkie bycze stłumione (`alertDirection='positive'`) z 4 powodów:
`bullish_8k_no_edge`, `bullish_no_consensus_data`, `gpt_missing_data`, `consensus_miss` — bo priorytet
suppression maskuje klasę bullish. **Zawęzić bramkę tylko gdy hit 7d >55% ORAZ średnia dodatnia.**

## Dane (alerty od 09.06 z pełnym 7d; stan 07.09 — bez zmian od werdyktu 01.09)

| Klasa | N | hit 7d | signed 7d | α XBI med · śr | REAL med (po 1%) |
|---|---|---|---|---|---|
| **RAZEM (pre-zarejestrowane query)** | **16** | **50%** | **+0.95%** | −4.0 · −2.3 | −0.1% |
| bullish_no_consensus_data | 6 | 83% | +6.36% | +1.3 · +4.2 | +1.6% |
| gpt_missing_data (positive) | 6 | 33% | −3.25% | −5.3 · −6.2 | −1.0% |
| bullish_8k_no_edge | 3 | 33% | +1.82% | −6.0 · −3.7 | +1.5% |
| consensus_miss (positive) | 1 | 0% | −8.92% | −14.2 | −7.2% |

Hit 50% ≤ 55% → **gate zawężenia NIE odpala**. Alpha ujemna na medianie i średniej; REAL ≈ 0.

## Wnioski

1. **Tłumienie byczych 8-K jako całość jest zasadne** — po wejściu z pierwszej dostępnej ceny klasa daje
   −0.1% netto; gdyby te 16 alertów poszło na Telegram z 🎯-podobnym statusem, byłby to rzut monetą po kosztach.
2. **`bullish_no_consensus_data` (6) to jedyna wygrywająca podklasa** (hit 83%, +6.4%, REAL +1.6%) — ale
   N=6 z jednym outlierem (THC +27%; bez niego +2.2%, α med ≈ 0). **Sub-hipoteza do teczki**, nie decyzja.
   Kryterium na 15.11: N≥10, hit ≥60%, med α ≥+2, REAL >0 → rozważyć wyjątek „2.02 beat bez danych
   konsensusu = deliver z etykietą niepewności". Poniżej progu → zamknąć.
3. **`gpt_missing_data` positive odwróciło się** wobec analogii z 09.06 („6/9, +2.1%"): teraz hit 33%,
   α −6.2. Guard missing-data uratował ISRG −16.9%, HUM −6.2%, OSCR −12.1% 1d. Zostaje.
4. **Tagowanie `bullish_8k_no_edge` po `catalystType`** (wymóg 02.07): contract 2, ma 2, regulatory 1.
   Kategoria `ma`: ABBV #2439 (+16.1%) i ABBV #2494 (03.09, w pomiarze) — **N=2 <3 → decyzja o wyjątku
   M&A odłożona** (kryterium: przy N≥3 `ma` hit ≥2/3 → rozważyć).
5. Od 01.09 reguła `8-K Material Event GPT` idzie do `material_event_obs` (oba kierunki) — bycze miękkie 8-K
   nadal trafiają najpierw w bullish gate (pierwszeństwo), więc ciągłość klasy dla 15.11 zachowana.

## Decyzja
- Bramka bez zmian. Wpis 07.09 zdjęty z `VALIDATION_CALENDAR`; przegląd #2 dopisany do wpisu 15.11.
- Teczka: (a) sub-hipoteza `bullish_no_consensus_data` (kryterium wyżej), (b) wyjątek `ma` przy N≥3.
