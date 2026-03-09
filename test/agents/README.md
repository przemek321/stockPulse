# Agenci testowi — StockPulse

Każdy agent jest specjalistą od jednego pipeline'u systemu.
Potrafi:
1. **Uruchomić testy jednostkowe** swojego pipeline'u
2. **Zweryfikować założenia** (progi, guardy, stałe) wyciągnięte z kodu
3. **Sprawdzić spójność z dokumentacją** (`doc/stockpulse-logic-check.md`)

## Uruchamianie

```bash
# Wszystkie agenty
npm run test:agents

# Konkretny agent
npx jest test/agents/sentiment-agent.spec.ts
npx jest test/agents/sec-filings-agent.spec.ts
npx jest test/agents/correlation-agent.spec.ts
npx jest test/agents/alert-evaluator-agent.spec.ts
npx jest test/agents/price-outcome-agent.spec.ts
npx jest test/agents/collectors-agent.spec.ts
```

## Struktura

| Agent | Pipeline | Pliki źródłowe |
|-------|----------|----------------|
| sentiment-agent | Sentiment (FinBERT + GPT) | `src/sentiment/` |
| sec-filings-agent | SEC Filing GPT (Form8k + Form4) | `src/sec-filings/` |
| correlation-agent | Correlation Service | `src/correlation/` |
| alert-evaluator-agent | Alert Evaluator (6 reguł) | `src/alerts/` |
| price-outcome-agent | Price Outcome Tracker | `src/price-outcome/` |
| collectors-agent | Kolektory danych | `src/collectors/` |
