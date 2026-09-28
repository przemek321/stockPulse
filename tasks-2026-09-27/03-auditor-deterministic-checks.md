# 03 — audytor: warstwa deterministyczna (czyste funkcje, zero LLM, zero DB)

## Scope (3 pliki)
- `src/agents/auditor/checks.ts` — każdy check jako czysta funkcja `(ctx: AuditContext) => FindingDraft | 'AMBIGUOUS' | null`
- `src/agents/auditor/audit-context.ts` — typ wejścia: `{ alert: Alert; filing: SecFiling | null; trades: InsiderTrade[]; now: Date }`
  (dane dostarcza orkiestrator w 05; checki nie dotykają repozytoriów — testowalne bez NestJS)
- `test/unit/auditor-checks.spec.ts` — testy na **realnych** alertach z DB (fixture `test/fixtures/auditor/*.json`
  wg wzorca `HUM-2026-04-29.json`: `_meta{alertId, sentAt, expectedFindings[]}, alert, filing, trades`)

## Checki (z 00-README §Checki — checkId, severity, dokładna reguła)
1. `PRICE_FROZEN` P1 — `price1h..price7d` wszystkie non-null i równe. Fixture: **SEM #2441** (jedyny realny).
2. `ENTRY_GAP_UNENTERABLE` P2 — `alertDirection='positive' && price1h && (price1h−priceAtAlert)/priceAtAlert > 0.03`.
   Fixture: **KURA #2479** (gap +10.9%), kontrprzykład **PFE #2471** (+0.5%). Evidence: `{gapPct, priceAtAlert, price1h, threshold: 0.03}`.
3. `ALERT_TEXT_TRUNCATED` P2 — ostatnia linia `message` nie zaczyna się od `⏰` (stopka) → urwane. Fixture: dowolny pełny alert (negatywny) + syntetyczny urwany (**oznaczyć `// FIXTURE SYNTETYCZNA`**).
4. `GPT_CONCLUSION_TRUNCATED` P2 — `filing.gptAnalysis.conclusion` nie kończy się `[.!?)]`. Sprawdzić realne: zapytanie SQL niżej.
5. `ESCAPE_MISSING` P1 — na `message` po usunięciu par `*…*` i `_…_`: regex `(?<!\\)[()[\]~\`>#+=|{}.!-]` daje trafienie.
   Fixture: **historyczny bug 02-05.07** (raport 8h z `\(`→`(`) jeśli zachowany w `system_logs`; inaczej syntetyczny.
6. `TRANSACTION_TYPE_MISMATCH` P1/AMBIGUOUS — `ruleName='Form 4 Insider BUY'`; insider z nagłówka `👤 *Imię*`;
   `trades` (symbol, `transactionDate ∈ [sentAt−14d, sentAt]`) dla tego insidera: jeśli brak → `AMBIGUOUS`;
   jeśli `is10b51Plan=true` lub żaden `transactionType='BUY'` → finding. Fixture: VRTX #2431 (alert `sell_no_edge`
   z samych planów — realny, choć to SELL; dla BUY szukać w DB, jeśli brak → oznaczyć brak przypadku w raporcie).
7. `STALE_TEMPLATE_DATE` INFO — regex `przegląd (okna obs )?~?(\d{2}\.\d{2}\.\d{4})` w `message`; data < `sentAt − 30d`.
   Fixture: ping discovery z „~25.07.2026" wysłany po 25.08 (sprawdzić `system_logs` TelegramService).
8. `PREVIOUSLY_ANNOUNCED_8K` P2 — `ruleName LIKE '8-K%' && priceAtAlert != null` && regex
   `/previously (announced|disclosed)/i` w `message` lub `gptAnalysis.summary`. Realne przypadki: SQL niżej (dziś 0/8 ostatnich).
9. `POST_CLOSE_8K_ENTRY_PRICE` P2 — `ruleName LIKE '8-K%' && priceAtAlert != null && !isNyseOpen(sentAt)`.
   Fixture: **THC #2509** (00:35 NY), **UHS #2478**, kontrprzykład **OSCR #2505** (14:05 NY). Uwaga: `isNyseOpen`
   z `market-hours.util.ts:55` — używać jej, nie pisać własnej.
10. `PRICE_LABEL_AMBIGUOUS` INFO — globalny (`alertId=null`), evidence `{formatterLine: 264, example: alertId}`; raz.
11. `PIPELINE_VERSION_UNKNOWN` INFO — globalny; raz.

## Inwarianty
- Checki są **czyste**: brak importów z `alerts/telegram`, `sec-filings/pipelines`, `correlation`, repozytoriów.
- Żaden check nie modyfikuje `ctx`.
- Import z ścieżki decyzyjnej dozwolony TYLKO read-only helperów bez efektów: `market-hours.util.ts`, typy encji.

## Zapytania do zbudowania fixture (realne dane)
```sql
-- kandydaci GPT_CONCLUSION_TRUNCATED
SELECT id, symbol, right("gptAnalysis"->>'conclusion', 40) FROM sec_filings WHERE "gptAnalysis" IS NOT NULL AND ("gptAnalysis"->>'conclusion') !~ '[.!?)]$' ORDER BY id DESC LIMIT 10;
-- kandydaci PREVIOUSLY_ANNOUNCED
SELECT id, symbol FROM alerts WHERE "ruleName" LIKE '8-K%' AND (message ~* 'previously (announced|disclosed)') LIMIT 10;
-- realne alerty do fixture (pełny wiersz + filing + trades):
SELECT row_to_json(a) FROM alerts a WHERE id IN (2441, 2479, 2471, 2509, 2478, 2505, 2431, 2511);
```
Anonimizacja: fixture zawierają symbole i nazwiska z publicznych filingów SEC — nie wymagają anonimizacji;
usunąć tylko `message` dłuższe niż potrzebne (zostawić pełne dla checków tekstowych).

## Weryfikacja
`npx jest test/unit/auditor-checks.spec.ts` — każdy check: ≥1 pozytyw (realny gdzie istnieje) + ≥1 negatyw;
`npx tsc --noEmit`; `npm run lint` 0 nowych; grep na zakazane importy:
`grep -rn "telegram\|pipelines/\|correlation\|Repository" src/agents/auditor/checks.ts` → 0 trafień.

## Exit criteria
- [ ] 11 checków, każdy z testem na realnym alercie (lub jawnie oznaczoną syntetyczną fixture)
- [ ] 0 importów ze ścieżki decyzyjnej poza `market-hours.util` i typami encji
- [ ] raport w commit message: które checki mają realny pozytyw w DB, które tylko syntetyczny
