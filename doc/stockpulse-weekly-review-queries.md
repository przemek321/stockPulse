# StockPulse — Dane do przeglądu po tygodniu produkcji

> Uruchom te zapytania po 7 dniach zbierania danych i wklej wyniki do Claude.
> Okres: 2026-03-02 → 2026-03-09

---

## 1. Statystyki pipeline (status × tier)

Ile tekstów przeszło przez pipeline, jak się rozłożyły po tierach, średnie czasy.

```sql
SELECT
  status, tier, COUNT(*) as count,
  ROUND(AVG(finbert_duration_ms)) as avg_finbert_ms,
  ROUND(AVG(azure_duration_ms)) as avg_azure_ms
FROM ai_pipeline_logs
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY status, tier
ORDER BY count DESC;
```

---

## 2. Rozkład źródeł danych

Które kolektory dostarczają najwięcej materiału do analizy.

```sql
SELECT source, COUNT(*) as count
FROM ai_pipeline_logs
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY source
ORDER BY count DESC;
```

---

## 3. Top 20 conviction scores (pełne wymiary)

Najsilniejsze sygnały z tygodnia z rozbiciem na wymiary conviction.

```sql
SELECT
  symbol, score, confidence, source, model,
  enriched_analysis->>'conviction' as conviction,
  enriched_analysis->>'relevance' as relevance,
  enriched_analysis->>'novelty' as novelty,
  enriched_analysis->>'source_authority' as source_auth,
  enriched_analysis->>'confidence' as ai_confidence,
  enriched_analysis->>'catalyst_type' as catalyst,
  enriched_analysis->>'price_impact_magnitude' as magnitude,
  enriched_analysis->>'sentiment' as ai_sentiment,
  LEFT(raw_text, 120) as text_preview,
  timestamp
FROM sentiment_scores
WHERE enriched_analysis IS NOT NULL
  AND timestamp > NOW() - INTERVAL '7 days'
ORDER BY ABS((enriched_analysis->>'conviction')::numeric) DESC
LIMIT 20;
```

---

## 4. Flat conviction — rozkład wymiarów AI

Czy GPT nadal daje identyczne wartości. Grupowanie po zaokrąglonych wymiarach.

```sql
SELECT
  ROUND((enriched_analysis->>'relevance')::numeric, 1) as relevance,
  ROUND((enriched_analysis->>'novelty')::numeric, 1) as novelty,
  ROUND((enriched_analysis->>'source_authority')::numeric, 1) as source_auth,
  ROUND((enriched_analysis->>'confidence')::numeric, 1) as ai_conf,
  enriched_analysis->>'price_impact_magnitude' as magnitude,
  COUNT(*) as count,
  ROUND(AVG(ABS((enriched_analysis->>'conviction')::numeric)), 3) as avg_conviction
FROM sentiment_scores
WHERE enriched_analysis IS NOT NULL
  AND timestamp > NOW() - INTERVAL '7 days'
GROUP BY relevance, novelty, source_auth, ai_conf, magnitude
ORDER BY count DESC
LIMIT 20;
```

---

## 5. Sygnały per ticker per dzień — timeline

Ile sygnałów dziennie per ticker (do wykresu).

```sql
SELECT
  symbol,
  DATE(timestamp) as day,
  COUNT(*) as total_signals,
  COUNT(*) FILTER (WHERE model = 'finbert+gpt-4o-mini') as ai_signals,
  COUNT(*) FILTER (WHERE model = 'finbert') as finbert_only,
  ROUND(AVG(score), 3) as avg_score,
  ROUND(MAX(ABS((enriched_analysis->>'conviction')::numeric)), 3) as max_conviction
FROM sentiment_scores
WHERE timestamp > NOW() - INTERVAL '7 days'
GROUP BY symbol, day
ORDER BY symbol, day;
```

---

## 6. Cross-source: ten sam ticker w wielu źródłach (okno 1h)

Wykrywa sygnały pojawiające się na wielu platformach — potencjalnie ważniejsze.

```sql
WITH hourly_sources AS (
  SELECT
    symbol,
    DATE_TRUNC('hour', timestamp) as hour,
    source,
    COUNT(*) as mentions,
    ROUND(AVG(score), 3) as avg_score,
    MAX(ABS((enriched_analysis->>'conviction')::numeric)) as max_conviction
  FROM sentiment_scores
  WHERE timestamp > NOW() - INTERVAL '7 days'
  GROUP BY symbol, hour, source
)
SELECT
  h.symbol, h.hour,
  COUNT(DISTINCT h.source) as source_count,
  STRING_AGG(DISTINCT h.source::text, ', ') as sources,
  SUM(h.mentions) as total_mentions,
  ROUND(AVG(h.avg_score), 3) as avg_score,
  MAX(h.max_conviction) as max_conviction
FROM hourly_sources h
GROUP BY h.symbol, h.hour
HAVING COUNT(DISTINCT h.source) >= 2
ORDER BY source_count DESC, h.hour DESC;
```

---

## 7. Odstępy między sygnałami AI per ticker

Średni i minimalny czas między sygnałami AI — czy system spamuje jeden ticker.

```sql
WITH ai_signals AS (
  SELECT
    symbol, timestamp,
    LAG(timestamp) OVER (PARTITION BY symbol ORDER BY timestamp) as prev_ts
  FROM sentiment_scores
  WHERE model = 'finbert+gpt-4o-mini'
    AND timestamp > NOW() - INTERVAL '7 days'
)
SELECT
  symbol,
  COUNT(*) as ai_signal_count,
  ROUND(AVG(EXTRACT(EPOCH FROM (timestamp - prev_ts)) / 60)) as avg_gap_min,
  ROUND(MIN(EXTRACT(EPOCH FROM (timestamp - prev_ts)) / 60)) as min_gap_min,
  ROUND(MAX(EXTRACT(EPOCH FROM (timestamp - prev_ts)) / 60)) as max_gap_min
FROM ai_signals
WHERE prev_ts IS NOT NULL
GROUP BY symbol
ORDER BY ai_signal_count DESC;
```

---

## 8. Ścieżka eskalacji: FinBERT → AI per ticker

Ile sygnałów FinBERT-only vs AI-eskalowanych per ticker — pokazuje które tickery generują „złote" sygnały.

```sql
SELECT
  symbol,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE model = 'finbert') as finbert_only,
  COUNT(*) FILTER (WHERE model = 'finbert+gpt-4o-mini') as ai_escalated,
  ROUND(100.0 * COUNT(*) FILTER (WHERE model = 'finbert+gpt-4o-mini') / COUNT(*), 1) as ai_pct,
  ROUND(AVG(ABS((enriched_analysis->>'conviction')::numeric))
    FILTER (WHERE enriched_analysis IS NOT NULL), 3) as avg_conviction,
  ROUND(MAX(ABS((enriched_analysis->>'conviction')::numeric)), 3) as max_conviction
FROM sentiment_scores
WHERE timestamp > NOW() - INTERVAL '7 days'
GROUP BY symbol
ORDER BY total DESC;
```

---

## 9. Alerty per ticker per dzień + typy reguł

```sql
SELECT
  DATE(sent_at) as day,
  symbol,
  rule_name,
  priority,
  catalyst_type,
  COUNT(*) as alert_count
FROM alerts
WHERE sent_at > NOW() - INTERVAL '7 days'
GROUP BY day, symbol, rule_name, priority, catalyst_type
ORDER BY day, alert_count DESC;
```

---

## 10. Ticker „gorący" — dużo sygnałów StockTwits, potem AI

Wykrywa wzorzec: dużo wzmianek na StockTwits → eskalacja do AI.

```sql
WITH stocktwits_volume AS (
  SELECT
    symbol,
    DATE_TRUNC('hour', timestamp) as hour,
    COUNT(*) as st_count
  FROM sentiment_scores
  WHERE source = 'STOCKTWITS' AND timestamp > NOW() - INTERVAL '7 days'
  GROUP BY symbol, hour
),
ai_escalations AS (
  SELECT
    symbol,
    DATE_TRUNC('hour', timestamp) as hour,
    (enriched_analysis->>'conviction')::numeric as conviction,
    enriched_analysis->>'catalyst_type' as catalyst
  FROM sentiment_scores
  WHERE model = 'finbert+gpt-4o-mini' AND timestamp > NOW() - INTERVAL '7 days'
)
SELECT
  sv.symbol, sv.hour,
  sv.st_count as stocktwits_mentions,
  COUNT(ae.*) as ai_escalations,
  ROUND(MAX(ABS(ae.conviction)), 3) as max_conviction,
  STRING_AGG(DISTINCT ae.catalyst, ', ') as catalysts
FROM stocktwits_volume sv
LEFT JOIN ai_escalations ae ON sv.symbol = ae.symbol AND sv.hour = ae.hour
WHERE sv.st_count >= 3
GROUP BY sv.symbol, sv.hour, sv.st_count
ORDER BY sv.st_count DESC, sv.hour DESC;
```

---

## 11. PDUFA context impact

Czy teksty z kontekstem PDUFA dostają wyższe relevance/conviction niż bez.

```sql
SELECT
  symbol,
  pdufa_context IS NOT NULL as had_pdufa,
  ROUND(AVG(ABS((response_payload->>'relevance')::numeric)), 3) as avg_relevance,
  ROUND(AVG(ABS((response_payload->>'conviction')::numeric)), 3) as avg_conviction,
  COUNT(*) as count
FROM ai_pipeline_logs
WHERE status = 'AI_ESCALATED'
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY symbol, had_pdufa
ORDER BY symbol, had_pdufa;
```

---

## 12. Status scrapera PDUFA

```sql
SELECT COUNT(*) as total_events,
  COUNT(*) FILTER (WHERE outcome IS NOT NULL) as resolved,
  COUNT(*) FILTER (WHERE outcome IS NULL AND pdufa_date > NOW()) as upcoming
FROM pdufa_catalysts;
```

---

## 13. Sygnały które wyglądały na ważne ale nie przeszły do AI

Tier 1/2 z wysokim FinBERT score, ale AI_FAILED lub AI_DISABLED.

```sql
SELECT
  symbol, source, tier, status,
  finbert_score, finbert_confidence,
  error_message,
  LEFT(input_text, 120) as text_preview,
  created_at
FROM ai_pipeline_logs
WHERE status IN ('AI_FAILED', 'AI_DISABLED')
  AND tier IN (1, 2)
  AND created_at > NOW() - INTERVAL '7 days'
ORDER BY ABS(finbert_score) DESC
LIMIT 20;
```

---

## 14. Conviction przed i po fixie source kalibracji (porównanie)

Porównanie wymiarów AI sprzed i po deployu nowego prompta (zmiana ~2026-03-08).

```sql
SELECT
  CASE WHEN timestamp < '2026-03-08 10:00:00' THEN 'przed_fix' ELSE 'po_fix' END as okres,
  source,
  COUNT(*) as count,
  ROUND(AVG((enriched_analysis->>'relevance')::numeric), 3) as avg_relevance,
  ROUND(AVG((enriched_analysis->>'novelty')::numeric), 3) as avg_novelty,
  ROUND(AVG((enriched_analysis->>'source_authority')::numeric), 3) as avg_source_auth,
  ROUND(AVG((enriched_analysis->>'confidence')::numeric), 3) as avg_ai_conf,
  ROUND(AVG(ABS((enriched_analysis->>'conviction')::numeric)), 3) as avg_conviction
FROM sentiment_scores
WHERE enriched_analysis IS NOT NULL
  AND timestamp > NOW() - INTERVAL '7 days'
GROUP BY okres, source
ORDER BY source, okres;
```

---

## 15. Screenshoty z Telegrama

Wklej screenshoty alertów które przyszły w ciągu tygodnia:

- Alerty conviction > 1.5
- Alerty FinBERT (strong signal)
- Raporty 2-godzinne (podsumowania)
- Sekcja PDUFA w raportach

---

## Jak interpretować wyniki

| Co sprawdzamy | Dobry wynik | Zły wynik |
|---------------|-------------|-----------|
| Tier distribution | 70-80% Tier 3, 15-25% Tier 2, 5-10% Tier 1 | 90%+ jednego tiera = bramka źle kalibrowana |
| AI escalation rate | 10-25% tekstów trafia do GPT | <5% = za agresywny filtr, >50% = za luźny |
| Conviction > 1.5 | 3-10 tygodniowo | 0 = system nie widzi sygnałów, 50+ = inflacja |
| PDUFA impact | avg_conviction z PDUFA > bez PDUFA | Brak różnicy = context nie działa |
| Alerty | 2-5 dziennie | 0 = martwy system, 20+ = spam |
| Źródła | Finnhub + StockTwits dominują | Jedno źródło = 90%+ to ryzyko |
| Cross-source (§6) | 2+ źródła w tym samym oknie = silny sygnał | Brak = źródła nie korelują |
| Flat conviction (§4) | Zróżnicowane wymiary wg source | 90%+ z identycznym relevance/novelty/auth |
| Przed/po fix (§14) | StockTwits source_auth spadł z 0.9 → 0.2 | Bez zmiany = fix nie działa |
| Stracone sygnały (§13) | 0-2 AI_FAILED na tydzień | 10+ = VM niestabilna |

### Brak danych cenowych

System nie zbiera OHLC — nie da się policzyć „jak się cena zmieniła po sygnale".
Opcje na przyszłość:
- Dodać kolektor Finnhub `/quote` lub `/candle` przy każdym alercie
- Finnhub free tier: 60 req/min, wystarczy na snapshot ceny przy alercie
