# 00 — zod 3.23 → 3.25 (warunek wstępny MCP SDK)

## Dlaczego osobny task
`@modelcontextprotocol/sdk@1.30.1` wymaga `zod ^3.25 || ^4.0`; repo ma `^3.23.0`. Jedyny konsument zod to
`src/sec-filings/types/sec-filing-analysis.ts` (`SecFilingAnalysisSchema`, `parseGptResponse`) — **ścieżka decyzyjna**.
Bump minor, ale dotyka walidacji każdego wyniku GPT → osobny commit, osobna weryfikacja, PRZED czymkolwiek innym.

## Scope (1 plik + lock)
- `package.json`: `"zod": "^3.25.76"` (wersja z `npm view zod@3.25 version` = 3.25.76, sprawdzić ponownie przed instalacją)
- `package-lock.json`
- **Zero zmian w `sec-filing-analysis.ts`** — jeśli tsc/testy wymagałyby zmiany, STOP i raport (to znaczy, że bump nie jest minor).

## Inwarianty
- `parseGptResponse()` zwraca identyczny obiekt dla identycznego wejścia (testy: `test/unit/form8k-*.spec.ts`,
  `sec-filings-agent.spec.ts`, fixture `HUM-2026-04-29.json`).
- Odrzuca to samo, co odrzucał (min(1), enum, zakres conviction −2..2).

## Weryfikacja
```bash
npm install zod@^3.25.76 && node -p "require('zod/package.json').version"
npx tsc --noEmit && npx jest test/unit          # 726+ passed
npx jest test/agents/sec-filings-agent.spec.ts
npm run lint                                    # 0 nowych
# replay realnego JSON-a GPT z DB przez parseGptResponse (stary vs nowy zod — wynik identyczny):
docker exec stockpulse-postgres psql -U stockpulse -d stockpulse -t -A -c "SELECT \"gptAnalysis\"::text FROM sec_filings WHERE \"gptAnalysis\" IS NOT NULL ORDER BY id DESC LIMIT 20" > /tmp/gpt-samples.jsonl
# → skrypt w scratchpadzie: dla każdej linii parseGptResponse(JSON.stringify(row)) === deepEqual z HEAD
```
Po commicie: `make rebuild-app` → `restarts=0`, log „Anthropic Claude aktywny", pierwszy realny 8-K/Form 4 z GPT
przechodzi (`system_logs` `Form4Pipeline`/`Form8kPipeline` status success, `sec_filings.gptAnalysis` wypełnione).

## Exit criteria
- [ ] zod 3.25.x w `node_modules`, `sec-filing-analysis.ts` nietknięty
- [ ] tsc 0, jest 726+, lint 0 nowych, CI zielone
- [ ] 20 realnych odpowiedzi GPT z DB parsuje się identycznie jak przed bumpem
- [ ] prod: pierwszy alert z GPT po rebuildzie bez błędu walidacji
