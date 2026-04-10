# P0 + P0.5 Findings — krytyczne odkrycia

> 2026-04-10 | po survivorship check

## P0: Koncentracja C-suite BUY signals (N=39)

### Wynik

| Metryka | Wartość |
|---------|---------|
| Top-3 tickery (BMY+RPRX+LLY) | **35.9%** sygnałów |
| Top-5 tickerów | **51.3%** |
| Unique tickerów | 21 z 39 sygnałów |
| Unique insiderów | 30 z 39 sygnałów |
| **Top insider** (Pablo Legorreta RPRX) | **10.3%** sam (4 zakupy) |
| Top-3 insiderzy | 25.7% |

### Hit rate per ticker (top 8)

```
BMY     N=6  hit=83%  avg=+2.9%   ← Boerner CEO + Hirawat (3+3)
RPRX    N=4  hit=50%  avg= 0.0%   ← Legorreta CEO (sam)
LLY     N=4  hit=100% avg=+7.2%   ← GLP-1 narrative (Mounjaro/Zepbound 2023-24)
CNC     N=3  hit=67%  avg=+4.1%
PODD    N=3  hit=67%  avg=+1.7%
UNH     N=2  hit=100% avg=+1.3%
HUM     N=2  hit=50%  avg=-0.7%
OSCR    N=2  hit=100% avg=+15.8%
```

### Top-3 vs Reszta

| Grupa | N | Hit rate 7d | Avg return |
|-------|---|-------------|-----------|
| **TOP-3** (BMY+RPRX+LLY) | 14 | **78.6%** | +3.32% |
| **RESZTA** (18 tickerów) | 25 | **68.0%** | +2.53% |
| **Razem** | 39 | 71.8% | +2.81% |

### Interpretacja

- **Top-3 koncentracja 35.9%** — wysokie ryzyko, ale **NIE single narrative** (próg drugi AI: >50%)
- **LLY 100% hit rate** = czysty GLP-1 trade. Wszystkie 4 LLY BUY w okresie 2023-2024 hossy GLP-1
- **Legorreta (RPRX) 50% hit rate** — flagowy aktywny insider w danych miał coin flip results
- **Edge survives top-3 removal**: reszta 18 tickerów wciąż ma **68% hit rate** i +2.53% avg
- **Asymetria**: bez LLY (4× 100% hit) i BMY (5/6 hit) reszta ma ~63% hit rate

### Wniosek

Edge jest **osłabiony, nie zniszczony**. d=0.83 dla C-suite BUY była zawyżona przez:
1. LLY GLP-1 narrative (4 sygnały, 100% hit)
2. BMY Boerner streak (3 sygnały, 100% hit)

Po odjęciu tych 2 narratives, realny C-suite BUY edge wynosi prawdopodobnie d=0.4-0.5 (nie d=0.83).

---

## P0.5: Backtest config vs Production config — POWAŻNY MISMATCH

### Diff

| | Liczba |
|---|---|
| Backtest config (`scripts/backtest/config.py`) | 42 |
| Production config (`doc/stockpulse-healthcare-universe.json`) | 37 |
| **Overlap** | **28** |
| Tylko w backteście | 14 |
| Tylko w production | 9 |

### Tylko w backteście (14 — testowane ale nie monitorowane)

`ABC, ACCD, AZN, CAH, INSP, IRTC, JNJ, MCK, MRK, NVO, PFE, RPRX, SNY, SWAV`

Z tych:
- ABC, ACCD, SWAV — **delisted** (nie istnieją w current SEC list)
- AZN, NVO, SNY — foreign (nie filują Form 4 — nie są w danych backtesta i tak)
- JNJ, PFE, MRK — large pharma których production NIE monitoruje

### Tylko w production (9 — alertowane ale NIETESTOWANE w backteście)

| Ticker | SIC | Healthcare? | Form 4 Q1 2023? | Komentarz |
|--------|-----|-------------|-----------------|-----------|
| ALHC | 6324 | ✗ Insurance | ✓ | Alignment Healthcare |
| CERT | 7372 | ✗ Software | ✓ | Certara |
| CVS | 5912 | ✗ Drug retail | ✓ | CVS Health |
| CYH | 8062 | ✓ Hospitals | ✓ | Community Health Sys |
| DVA | 8090 | ✓ Health svc | ✓ | DaVita |
| GSK | 2834 | ✓ Pharma | ✗ | Foreign |
| HCAT | 7370 | ✗ Software | ✓ | Health Catalyst |
| VEEV | 7372 | ✗ Software | ✓ | Veeva Systems |
| WBA | — | — | — | Brak w SEC list |

**5 z 9 production-only tickerów to NIE-healthcare SIC** (insurance, software, drug retail).

### Tickery w production które backtest TESTOWAŁ jako NIE-healthcare

Production ma 10 tickerów które backtest validation wykazał jako nie-healthcare SIC:

`UNH, ELV, HUM, CNC, MOH, CI, OSCR` (insurance SIC=6324)
`DOCS, GDRX` (computer services)
`ENSG` (skilled nursing)

Te tickery są monitorowane na żywo z regułą "Form 4 Insider BUY" (×1.2 healthcare boost), ale **healthcare boost guard** (`sector === 'healthcare'`) **stosuje się do nich w production**, mimo że SEC klasyfikuje je jako insurance/software.

### Krytyczna konsekwencja

Production live trading na **9 tickerach których backtest nigdy nie widział**:
- 5 z nich to nie-healthcare (insurance, software, drug retail)
- d=0.43 edge dla nich = **czysta ekstrapolacja**
- Healthcare boost ×1.2 dla insurance tickers nie ma podstaw w backteście

---

## Live vs Backtest hit rate

**N=3** — niemożliwe do porównania.

Po hard delete 344 alertów (06.04 czysty start) zostały tylko 3 alerty z 09.04 z price1d:
- Form 4 Insider BUY (OSCR): 100% hit, +0.42%
- Form 4 Insider Signal: 0% hit, +3.32% (kierunek negative ale cena +3.32%)
- Correlated Signal: 100% hit, +0.56%

**Krytyczna lekcja**: hard delete 344 alertów 06.04 zniszczył 6 miesięcy danych live do walidacji backtestu. **Nie do odzyskania.**

---

## Rekomendacje natychmiastowe

### 1. Dokumentacja: production-only tickery są UNTESTED

W `doc/PROGRESS-STATUS.md` i CLAUDE.md dodać:
> "Production monitoruje 9 tickerów których backtest Sprint 15 nie testował: ALHC, CERT, CVS, CYH, DVA, GSK, HCAT, VEEV, WBA. Edge insider BUY d=0.43 dla nich = ekstrapolacja, nie walidacja."

### 2. Healthcare boost guard należy zrewidować

Production ma 7 insurance tickerów (UNH, ELV, HUM, CNC, MOH, CI, OSCR) klasyfikowanych jako 'healthcare' w `sector` column. Ale SEC ma je jako SIC=6324 (insurance). Healthcare boost ×1.2 dla nich może zawyżać conviction.

**Nie zmieniaj teraz** (kod zamrożony, brak danych do walidacji), ale zaplanuj re-test w Sprint 16.

### 3. NIE kasuj więcej alertów

Każdy delete = utrata danych live do walidacji. Lepiej dodać kolumnę `archived` lub `valid_from` niż delete.

### 4. Ujednolicić backtest config z production

Albo dodać do backteste 9 production-only tickerów (i re-run), albo usunąć z production 5 nie-healthcare. Najprościej: re-run backtestu na production-actual list (37 tickerów + tych 5 dodanych przez HPE/SMCI itp.).

---

## Co znaleźliśmy w sumie (P0 + P0.5 + Live)

1. ✅ **Top-3 koncentracja 35.9%** — umiarkowanie wysoka, ale edge survives
2. ⚠️ **LLY GLP-1 narrative** — 4 sygnały 100% hit, single bull market specific
3. ⚠️ **BMY Boerner streak** — 3 z 6 sygnałów od 1 CEO, 100% hit
4. 🚨 **Backtest ≠ Production**: 14 tickerów mismatch, 5 production-only nie-healthcare
5. 🚨 **Live walidacja niemożliwa**: hard delete 06.04 zniszczył historię
6. ⚠️ **Healthcare boost dla insurance tickerów**: UNH/ELV/HUM/CNC/MOH/CI/OSCR mają SIC=6324 ale dostają ×1.2 healthcare boost

**Najważniejsza lekcja**: System działa, ale jego własne metryki walidacyjne (Sprint 15 backtest) **nie pokrywają się z tym co live trading robi**. To jest fundamentalny problem do naprawy w Sprint 16.
