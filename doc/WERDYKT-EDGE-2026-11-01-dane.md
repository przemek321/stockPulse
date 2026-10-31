# Werdykt #2 — pełny wydruk przeliczenia (31.10.2026 22:40 CET, eksport prod)

Skrypt: `scripts/analysis/werdykt-2026-11-01.py` (Python 3.8 stdlib; wejście: CSV z `alerts`, `insider_trades` od 01.06, `tickers`). Omówienie: [WERDYKT-EDGE-2026-11-01.md](WERDYKT-EDGE-2026-11-01.md).

# Próbka: 96 alertów od 09.06, 93 z 7d, wykluczone price_frozen: [('SEM', 2441)]
# Ostatni alert z 7d: 2026-10-22 21:05:40.314526; bez 7d: [('ELV', '2524', '2026-10-23'), ('CNC', '2525', '2026-10-27'), ('HCA', '2526', '2026-10-27')]

## CAŁA PRÓBKA post-fix (od 09.06)
| Segment | A/E | signed 7d śr [CI] · med | hit | α XBI śr [CI] · **med** · α>0 | α IBB śr | XBI okno | REAL śr · **med** [CI] · NET med | chase>3% |
|---|---|---|---|---|---|---|---|---|
| Delivered (produkt) | 7/6 | +1.67 [-3.01,+7.90] · +0.65 | 67% | +4.36 [-0.78,+11.40] · **+2.67** · 83% | +4.78 | +3.00 | -2.03 · **med -1.10** [-5.40,+0.41] · NET med -2.10 | 3/7 |
| Delivered Form 4 BUY (grywalne wg REGUŁ) | 3/2 | +1.06 · +1.06 | 100% | +3.24 · **+3.24** · 100% | +2.33 | -2.18 | -0.70 · **med -0.70** · NET med -1.70 | 2/3 |
| **Form 4 BUY klasa (bez FUND)** | 37/29 | +2.00 [-0.91,+5.06] · +1.97 | 62% | +0.90 [-2.09,+3.85] · **+1.96** · 59% | +0.51 | +1.10 | -2.01 · **med -1.37** [-5.65,+1.68] · NET med -2.37 | 18/37 |
| ├ C-suite BUY | 19/18 | +3.58 [-0.25,+7.66] · +2.04 | 67% | +3.10 [-0.31,+6.77] · **+2.31** · 67% | +2.78 | +0.48 | -1.32 · **med -0.39** [-8.20,+4.16] · NET med -1.39 | 11/19 |
| ├ C-suite T1 (≥$500K) | 14/13 | +5.38 · +2.36 | 77% | +4.67 · **+2.45** · 77% | +4.16 | +0.71 | -0.71 · **med +1.68** · NET med +0.68 | 10/14 |
| ├ C-suite T2 ($100-500K) | 5/5 | -1.10 · -2.32 | 40% | -0.96 · **-0.19** · 40% | -0.79 | -0.14 | -2.93 · **med -1.37** · NET med -2.37 | 1/5 |
| └ Director/other-only BUY | 18/16 | -1.30 [-4.85,+1.85] · +0.52 | 50% | -2.85 [-6.26,+0.11] · **-1.90** · 38% | -3.57 | +1.55 | -4.11 · **med -3.50** [-6.37,-0.73] · NET med -4.50 | 7/18 |
| Discovery+APLS osobowa | 25/21 | +1.64 [-2.32,+5.90] · +0.89 | 52% | +0.98 [-2.76,+4.75] · **+0.03** · 52% | +0.44 | +0.66 | -3.09 · **med -5.33** [-7.95,+3.27] · NET med -6.33 | 14/25 |
| ├ discovery C-suite | 13/13 | +3.50 · +0.89 | 54% | +3.66 · **+2.18** · 62% | +3.26 | -0.16 | -2.54 · **med -5.68** · NET med -6.68 | 9/13 |
| └ discovery Director-only | 12/11 | -2.85 · -3.09 | 36% | -4.20 · **-2.22** · 27% | -5.02 | +1.35 | -5.86 · **med -5.33** · NET med -6.33 | 5/12 |
| Rdzeń+ tickery (PFE BSX COR ELAN COO SMMT), bez FUND | 9/6 | +3.54 · +3.31 | 83% | -0.18 · **+1.48** · 67% | +0.14 | +3.72 | +1.36 · **med +1.24** · NET med +0.24 | 2/9 |
| ├ rdzeń+ large-cap z sentAt ≥ 19.10 (po promocji) | 0/0 | — | — | — | — | — | — | — |
| Discovery FUNDUSZOWA | 7/7 | -0.67 · -0.60 | 43% | +1.61 · **+2.75** · 71% | -0.06 | -2.27 | -5.51 · **med -4.67** · NET med -5.67 | 5/7 |
| Form 4 SELL (short) | 12/10 | +0.92 · +2.26 | 70% | +3.63 · **+2.85** · 80% | +2.23 | +2.71 | +0.83 · **med +2.33** · NET med +1.33 | 0/12 |
| 8-K wszystkie | 36/35 | +0.87 · -0.23 | 49% | +0.13 · **-0.62** · 46% | +0.33 | +2.30 | -0.75 · **med -1.07** · NET med -2.07 | 10/36 |

## FORWARD po werdykcie #1 (sentAt ≥ 01.09)
| Segment | A/E | signed 7d śr [CI] · med | hit | α XBI śr [CI] · **med** · α>0 | α IBB śr | XBI okno | REAL śr · **med** [CI] · NET med | chase>3% |
|---|---|---|---|---|---|---|---|---|
| Delivered (produkt) | 0/0 | — | — | — | — | — | — | — |
| Delivered Form 4 BUY (grywalne wg REGUŁ) | 0/0 | — | — | — | — | — | — | — |
| **Form 4 BUY klasa (bez FUND)** | 17/12 | -0.26 [-5.84,+5.48] · -3.04 | 42% | +0.03 [-5.07,+4.94] · **+0.89** · 50% | -0.70 | -0.28 | -4.51 · **med -5.67** [-9.06,+2.03] · NET med -6.67 | 8/17 |
| ├ C-suite BUY | 10/10 | +1.09 [-4.23,+7.12] · -3.11 | 40% | +1.52 [-3.01,+6.55] · **+0.89** · 50% | +1.12 | -0.43 | -4.02 · **med -7.06** [-9.95,+3.27] · NET med -8.06 | 6/10 |
| ├ C-suite T1 (≥$500K) | 6/6 | +2.78 · -0.97 | 50% | +3.92 · **+2.07** · 67% | +3.05 | -1.14 | -4.17 · **med -7.10** · NET med -8.10 | 5/6 |
| ├ C-suite T2 ($100-500K) | 4/4 | -1.45 · -4.07 | 25% | -2.09 · **-1.28** · 25% | -1.76 | +0.63 | -3.81 · **med -4.91** · NET med -5.91 | 1/4 |
| └ Director/other-only BUY | 7/5 | -6.86 [-13.56,-0.07] · -7.83 | 20% | -6.82 [-14.00,-0.53] · **-3.79** · 20% | -8.35 | -0.04 | -9.29 · **med -7.82** [-19.70,+0.79] · NET med -8.82 | 2/7 |
| Discovery+APLS osobowa | 15/11 | -0.59 [-6.53,+5.59] · -3.77 | 36% | -0.19 [-5.78,+5.29] · **-0.19** · 45% | -0.85 | -0.40 | -4.99 · **med -5.68** [-9.60,+3.27] · NET med -6.68 | 8/15 |
| ├ discovery C-suite | 10/10 | +1.09 · -3.11 | 40% | +1.52 · **+0.89** · 50% | +1.12 | -0.43 | -4.02 · **med -7.06** · NET med -8.06 | 6/10 |
| └ discovery Director-only | 5/4 | -9.43 · -8.15 | 0% | -9.14 · **-8.04** · 0% | -10.69 | -0.29 | -11.81 · **med -11.76** · NET med -12.76 | 2/5 |
| Rdzeń+ tickery (PFE BSX COR ELAN COO SMMT), bez FUND | 2/1 | +3.42 · +3.42 | 100% | +2.45 · **+2.45** · 100% | +0.99 | +0.97 | +0.79 · **med +0.79** · NET med -0.21 | 0/2 |
| ├ rdzeń+ large-cap z sentAt ≥ 19.10 (po promocji) | 0/0 | — | — | — | — | — | — | — |
| Discovery FUNDUSZOWA | 2/2 | -6.61 · -6.61 | 0% | -2.58 · **-2.58** · 50% | -4.36 | -4.04 | -10.14 · **med -10.14** · NET med -11.14 | 2/2 |
| Form 4 SELL (short) | 3/3 | +3.38 · +2.58 | 100% | +2.80 · **+2.17** · 100% | +2.07 | -0.58 | +2.89 · **med +2.45** · NET med +1.45 | 0/3 |
| 8-K wszystkie | 10/9 | -2.62 · -3.28 | 44% | -2.87 · **-1.39** · 33% | -3.05 | -0.41 | -2.56 · **med -2.84** · NET med -3.84 | 1/10 |

## Per reguła × kierunek (cała próbka)
| Reguła · kierunek | A/E | s3d | s7d śr · med | hit | α śr · med | α IBB | XBI | REAL śr · med |
|---|---|---|---|---|---|---|---|---|
| Form 4 Insider BUY · BULL | 44/36 | +3.45 | +1.48 · +1.36 | 58% | +1.04 · +2.07 | +0.40 | +0.44 | -2.69 · -2.48 |
| 8-K Earnings Miss · BULL | 17/17 | +0.07 | -0.47 · +0.37 | 53% | -3.33 · -4.29 | -3.24 | +2.85 | -0.26 · +0.07 |
| Form 4 Insider Signal · BEAR | 12/10 | +0.50 | +0.92 · +2.26 | 70% | +3.63 · +2.85 | +2.23 | +2.71 | +0.83 · +2.33 |
| 8-K Material Event GPT · BULL | 8/7 | -0.00 | -0.12 · -0.87 | 43% | -0.80 · +1.69 | -0.35 | +0.67 | -0.57 · -0.05 |
| 8-K Earnings Miss · BEAR | 6/6 | +7.33 | +8.02 · +7.93 | 67% | +9.04 · +7.69 | +9.44 | +1.02 | -0.78 · -2.27 |
| 8-K Material Event GPT · BEAR | 4/4 | -2.45 | -2.13 · -2.06 | 25% | +1.55 · +1.76 | +1.95 | +3.68 | -2.53 · -1.86 |
| 8-K Leadership Change · BEAR | 1/1 | +3.74 | -0.23 · -0.23 | 0% | +6.26 · +6.26 | +4.56 | +6.49 | -3.04 · -3.04 |

## Bramki tłumiące (nonDeliveryReason, cała próbka) — forward od 01.09 w nawiasie
| powód | A/E (fwd) | s7d śr · med | hit (fwd) | α śr · med | REAL śr · med | XBI |
|---|---|---|---|---|---|---|
| observation | 41/34 (19) | +1.50 · +1.43 | 56% (5/14) | +0.91 · +1.97 | -2.80 · -3.19 | +0.60 |
| gpt_missing_data | 13/13 (4) | +0.55 · -0.23 | 46% (2/4) | +0.10 · -1.39 | -0.19 · -1.35 | +2.82 |
| sell_no_edge | 12/10 (3) | +0.92 · +2.26 | 70% (3/3) | +3.63 · +2.85 | +0.83 · +2.33 | +2.71 |
| bullish_8k_no_edge | 9/8 (6) | -1.10 · -2.07 | 38% (2/5) | -2.18 · -2.13 | -1.35 · -1.45 | +1.08 |
| delivered | 7/6 (0) | +1.67 · +0.65 | 67% (—) | +4.36 · +2.67 | -2.03 · -1.10 | +3.00 |
| bullish_no_consensus_data | 6/6 (0) | +6.36 · +5.23 | 83% (—) | +4.24 · +1.30 | +2.40 · +2.59 | +2.13 |
| consensus_miss | 4/4 (0) | -3.49 · -5.07 | 25% (—) | -6.10 · -6.73 | -4.15 · -4.66 | +0.03 |

## Reżim miesięczny (alerty bycze)
| Miesiąc | A | XBI okno | signed 7d | α XBI śr · med | REAL śr |
|---|---|---|---|---|---|
| 2026-06 | 6 | +8.60 | +4.25 | -4.35 · -5.10 | +1.90 |
| 2026-07 | 17 | +0.46 | -0.72 | -1.18 · -1.91 | -2.07 |
| 2026-08 | 18 | +1.85 | +4.48 | +2.64 · +2.72 | +1.12 |
| 2026-09 | 18 | -1.13 | -2.99 | -1.86 · -1.61 | -6.06 |
| 2026-10 | 10 | +0.64 | -0.28 | -0.93 · -0.85 | -2.54 |

## Teczki
- Reżim IX-X (α byczych med ≥+2pp przy N≥12): N=28 alertów, med α -1.12, śr -1.53
- Stale-filing trap (latencja >30d, próg ≥3): 0 → []
- 8-K Material Event obs (N≥10 → decyzja): N=0 od 01.09; łącznie 'Material Event GPT' z 7d: 12
- Gap-band C-suite: gap>7%: N=5 śr REAL -4.25 · ≤7%: N=13 śr REAL -0.20
- Bullish-8K pełne query (4 powody, positive): A/E 24/23, hit 48%, signed śr -0.43, α med -4.26

## Werdykt systemowy #2 — kryterium: klasa Form 4 BUY bez FUND, N≥20 zdarzeń: hit <60% LUB med REAL ≤ −1% → „bez edge”
N=29 zdarzeń (37 alertów), hit 62%, med REAL -1.37 (NET med -2.37), śr REAL -2.01, CI med REAL (-5.650213054745578, 1.6813758757219992)
→ BEZ EDGE (stop gry wg REGUŁ §5)

## Lista zdarzeń Form 4 BUY bez FUND (chronologicznie)
| first | symbol | ids | sektor | rola wyzwalacza | tier | CS | deliv | signed | α | gap | REAL |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 06-10 | EYE | 2432 | healthcare | Director | T1 | - | - | +2.86 | -3.04 | +6.01 | -2.98 |
| 06-12 | SMMT | 2434,2435 | healthcare/R+ | Co-Chief Executive Officer,  | T1 | C | - | +2.11 | -6.49 | +0.43 | +1.68 |
| 06-22 | COR | 2440 | healthcare/R+ | Director | T1 | - | - | +3.20 | -5.10 | +3.96 | -0.73 |
| 07-13 | CAI | 2443 | healthcare | ? | ? | - | - | -4.83 | -1.91 | +0.53 | -5.33 |
| 07-17 | ELV | 2446,2447 | healthcare | President and CEO, Director | T1 | C | D | +1.82 | +2.94 | +3.89 | -1.99 |
| 07-31 | IONS | 2465 | healthcare | Director | T1 | - | - | +9.06 | +1.96 | +3.25 | +5.63 |
| 08-05 | PFE | 2471,2477 | healthcare/R+ | Director | T1 | C | - | +4.30 | +0.51 | +1.05 | +3.22 |
| 08-05 | BSX | 2472 | healthcare/R+ | Chairman, President & CEO, D | T1 | C | - | +8.46 | +4.54 | +4.04 | +4.25 |
| 08-17 | KURA | 2479 | healthcare | President and CEO, Director | T1 | C | - | +16.22 | +10.90 | +10.90 | +4.80 |
| 08-17 | BFLY | 2480 | healthcare | Director | T1 | - | - | +3.10 | -2.22 | -2.11 | +5.32 |
| 08-18 | MOBI | 2481 | healthcare | Director | T1 | - | - | -7.33 | -12.65 | +2.21 | -9.33 |
| 08-21 | ELAN | 2483 | healthcare/R+ | Director | T1 | - | - | -0.25 | +2.99 | +0.83 | -1.08 |
| 08-24 | PODD | 2484 | healthcare | President and CEO, Director | T2 | C | D | +0.30 | +3.54 | -0.29 | +0.59 |
| 08-24 | ABCL | 2485 | healthcare | Director | T1 | - | - | +6.60 | +8.16 | +13.85 | -6.37 |
| 08-24 | KURA | 2486 | healthcare | President and CEO, Director | T1 | C | - | +0.89 | +2.45 | +9.60 | -7.95 |
| 08-25 | PRE | 2487 | healthcare | Chief Executive Officer, Dir | T1 | C | - | +17.51 | +19.07 | +6.51 | +10.33 |
| 08-27 | RGNX | 2491 | healthcare | Director | T1 | - | - | -3.09 | +0.03 | +1.07 | -4.12 |
| 09-05 | ENOV | 2496 | healthcare | Chief Executive Officer, Dir | T2 | C | - | -5.98 | -0.19 | +2.69 | -8.45 |
| 09-08 | INBX | 2497,2498 | healthcare | Chief Executive Officer, Dir | T1 | C | - | -7.83 | -3.79 | +9.35 | -15.71 |
| 09-10 | ALMS | 2499 | healthcare | Director | T1 | - | - | -19.29 | -18.61 | +0.51 | -19.70 |
| 09-11 | ATEC | 2500 | healthcare | CEO, Director | T1 | C | - | +17.76 | +17.76 | +14.03 | +3.27 |
| 09-11 | RLMD | 2501 | healthcare | Chief Financial Officer | T1 | C | - | +1.97 | +1.97 | +8.11 | -5.68 |
| 09-15 | NAMS | 2503 | healthcare | Chief Executive Officer, Dir | T2 | C | - | +8.32 | +4.38 | +2.22 | +5.96 |
| 09-15 | COO | 2504,2506 | healthcare/R+ | Director | T1 | - | - | +3.42 | +2.45 | +2.61 | +0.79 |
| 09-17 | INBX | 2508,2510,2512 | healthcare | Director | T1 | C | - | -3.77 | -3.09 | +2.03 | -5.65 |
| 09-28 | DMRA | 2511 | healthcare | Director, President and CEO, | T2 | C | - | -2.32 | -2.38 | -0.97 | -1.37 |
| 10-01 | XENE | 2514 | healthcare | Chief Financial Officer | T1 | C | - | -3.90 | +2.18 | +5.06 | -8.52 |
| 10-14 | INBX | 2518 | healthcare | Chief Executive Officer, Dir | T1 | C | - | +15.70 | +10.89 | +4.68 | +10.53 |
| 10-21 | RAPP | 2522,2523 | healthcare | Chief Financial Officer | T2 | C | - | -7.15 | -11.23 | +2.77 | -9.60 |

## FUND alerty: [('ARTV', 2451, 'RA CAPITAL MANAGEMENT, L.P. (co-filing z'), ('CBIO', 2452, 'Fairmount Funds Management LLC (co-filin'), ('PBLS', 2453, 'RA CAPITAL MANAGEMENT, L.P. (co-filing z'), ('REPL', 2476, 'BAKER BROS. ADVISORS LP (co-filing z Bak'), ('IMTX', 2490, 'PERCEPTIVE ADVISORS LLC (co-filing z EDE'), ('TYRA', 2507, 'RA CAPITAL MANAGEMENT, L.P. (co-filing z'), ('KOD', 2513, 'BAKER BROS. ADVISORS LP (co-filing z 667')]
## Form 4 BUY bez roli (brak dopasowania wyzwalacza): [('CAI', 2443, 'HALBERT JON')]
## Alerty Form 4 BUY poza sektorami healthcare*: []

## WRAŻLIWOŚĆ werdyktu systemowego (klasa Form 4 BUY bez FUND)
| wariant | E | hit | med REAL (śr) | kryterium |
|---|---|---|---|---|
| A: bazowy (zdarzenia symbol+kierunek ≤7d po sentAt) | 29 | 62% | -1.37 (śr -2.01) | BEZ EDGE |
| B: bez sklejania (każdy alert = zdarzenie) | 37 | 62% | -1.37 (śr -2.46) | BEZ EDGE |
| C: z FUND | 36 | 58% | -2.48 (śr -2.69) | BEZ EDGE |
| D: bez PRE (brak na XTB) | 28 | 61% | -1.68 (śr -2.45) | BEZ EDGE |
| E: tylko wchodzalne (gap ≤3%) | 15 | 40% | -1.37 (śr -2.95) | N<20 |
| F: tylko forward ≥01.09 | 12 | 42% | -5.67 (śr -4.51) | N<20 |
| G: tylko in-sample <01.09 | 17 | 76% | -0.73 (śr -0.24) | N<20 |
| H: bez discovery (core + rdzeń+) | 8 | 88% | +0.69 (śr +0.84) | N<20 |
| I: tylko T1 ≥$500K (rola dopasowana) | 24 | 67% | -1.23 (śr -1.97) | BEZ EDGE |
REAL posortowane: [-19.7, -15.7, -9.6, -9.3, -8.5, -8.4, -7.9, -6.4, -5.7, -5.7, -5.3, -4.1, -3.0, -2.0, -1.4, -1.1, -0.7, 0.6, 0.8, 1.7, 3.2, 3.3, 4.2, 4.8, 5.3, 5.6, 6.0, 10.3, 10.5]
suma PLN @2200 na zdarzenie (NET): -1918
Wilcoxon-ish: P(med REAL>0) bootstrap = 0.1724
