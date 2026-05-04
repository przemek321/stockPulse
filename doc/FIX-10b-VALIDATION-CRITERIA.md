# FIX-10b Forward Validation — pre-committed criteria

**Pre-commitment data**: 04.05.2026 (commit `77770fb`).
**Pierwsza walidacja możliwa**: lipiec 2026 (Q2 earnings season healthcare core).

## Kryterium sukcesu (1 zdanie, no wiggle room)

**FIX-10b uznajemy za "działa w produkcji"** jeśli w **20 kolejnych 8-K Item 2.02 alertach** od ticker'ów healthcare core (28 healthcare universe) zachodzą **łącznie wszystkie trzy warunki**:

1. **≥17/20** (≥85%) ma `gptAnalysis.key_facts` z **co najmniej 2 specific numbers** (EPS, Revenue, MLR, guidance range, lub inny konkretny financial metric — `/\$[\d.,]+\s*(mln|bln|mld|million|billion|%)/i` count ≥ 2).

2. **0/20** (zero, hard) ma `nonDeliveryReason='gpt_missing_data'` z key_fact zawierającym frazę "**niedostępn**" / "**not available**" / "**nie udostępniony**" / "**not provided**" w odniesieniu do Exhibit 99.1 (czyli MRNA-class regression).

3. **≥15/20** (≥75%) ma `conviction != 0` AND `direction != 'neutral'` (czyli model faktycznie produkuje analizę, nie collapse na neutral z powodu missing data).

## Co NIE jest kryterium

- **Conviction sign accuracy** (positive vs negative direction correctness vs market move) — to jest test prompt quality, nie FIX-10b. FIX-10b dostarcza dane, prompt decyduje co z nimi zrobić.
- **Single case "wow"** — pierwszy MRNA-class alert w lipcu nie zamyka walidacji. Wymagamy 20 sample size dla statistical confidence.
- **Subjective "Sonnet output looks good"** — jeśli za 2 miesiące zaczniesz racjonalizować "no widziałem 3 alerty i wyglądały OK" → wracasz tutaj i czytasz te 3 warunki.

## Failure scenario (co robić jeśli nie spełnione)

- **Warunek 1 nie spełniony (<85% ma 2+ numbers)**: prompt nie wyciąga liczb z exhibit. Issue prompt design, nie FIX-10b. → osobny FIX (np. structured EPS/Revenue/MLR pre-LLM extraction = FIX-06 reactivated).
- **Warunek 2 nie spełniony (jakikolwiek MRNA-class regression)**: FIX-10b nie pokrywa nowego edge case (inny boundary, inny exhibit naming, inny wrapper structure). → diagnose + patch.
- **Warunek 3 nie spełniony (≥6/20 conviction=0/neutral)**: defense in depth FIX-01 cap'uje za agresywnie albo prompt produkuje hedged outputs. → recalibrate FIX-01 threshold albo prompt rewrite.

## Telemetria do zebrania automatycznie

```sql
-- Po lipcu 2026 odpalić:
SELECT
  symbol,
  "filingDate",
  ("gptAnalysis"->>'conviction')::numeric AS conviction,
  "gptAnalysis"->'price_impact'->>'direction' AS direction,
  "gptAnalysis"->'key_facts' AS facts,
  EXISTS (
    SELECT 1 FROM jsonb_array_elements_text("gptAnalysis"->'key_facts') AS fact
    WHERE fact ~ '\$[\d.,]+\s*(mln|bln|mld|million|billion|%)'
  ) AS has_numbers,
  EXISTS (
    SELECT 1 FROM jsonb_array_elements_text("gptAnalysis"->'key_facts') AS fact
    WHERE fact ~* '(niedostępn|not available|nie udostępniony|not provided)'
      AND fact ~* 'exhibit'
  ) AS mrna_class_regression
FROM sec_filings
WHERE "formType" = '8-K'
  AND "filingDate" >= '2026-07-01'
  AND symbol IN (SELECT symbol FROM tickers WHERE sector = 'healthcare' AND "isActive" = true)
  AND "gptAnalysis" IS NOT NULL
ORDER BY "filingDate" DESC
LIMIT 20;
```

Zapisz wynik tej query w `doc/FIX-10b-VALIDATION-RESULTS-2026-07.md` (lub pierwszy miesiąc gdzie N≥20). Decyzja działania na podstawie tabeli, nie wibracji.

## Anti-rationalization clause

Jeśli za 2 miesiące zaczniesz pisać "ale ten case był specjalny bo X" — STOP. Specyficzne case'y to feature, nie bug. Walidacja sprawdza jak FIX-10b radzi sobie z **rozkładem produkcji**, nie z hand-picked best cases. Jeśli 4/20 ma MRNA-class regression z różnych powodów ("ale każdy był z innym edge case") → FIX-10b nadal failed.

Pre-commitment dziś chroni Cię przed sobą za 2 miesiące.
