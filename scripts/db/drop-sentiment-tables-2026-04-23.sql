-- FOLLOW-8 (23.04.2026): drop orphan tables po FinBERT cleanup (commit b3a2f2b, 22.04.2026).
--
-- Background:
--   Sprint 15 backtest (3Y SEC EDGAR) potwierdził zero edge na sentymencie:
--   962 alertów / 2 tygodnie / 55.5% hit rate. FinBERT sidecar + sentiment
--   pipeline + 5 checkerów AlertEvaluator usunięte 22.04.2026 (~2400 LoC),
--   ale tabele DB zachowane jako orphan do drop-migration w Sprint 18.
--
-- Pre-flight (zweryfikowane 23.04.2026 przed wykonaniem):
--   1. Zero @Entity references w src/ (grep dla SentimentScore/AiPipelineLog/
--      sentiment_scores/ai_pipeline_logs → No matches found). TypeORM
--      synchronize: true NIE odtworzy tabel po restarcie bo entity nie istnieje.
--   2. Zero FK references w obu kierunkach (information_schema check):
--      - Inbound: brak innych tabel referujących sentiment_scores/ai_pipeline_logs
--      - Outbound: brak FK z tych tabel do innych
--      → DROP bez CASCADE bezpieczny.
--   3. Backup wykonany: backups/sentiment-tables-drop-2026-04-23.sql.gz
--      (pełny pg_dump schema+data, 5 MB gzipped, restore via:
--       gunzip -c backups/sentiment-tables-drop-2026-04-23.sql.gz |
--         docker compose exec -T postgres psql -U stockpulse -d stockpulse)
--
-- Stan przed drop:
--   - sentiment_scores: 18 366 rows, 17 MB on disk
--   - ai_pipeline_logs: 21 616 rows, 19 MB on disk
--
-- IF EXISTS — idempotent (re-run nie wywali jeśli tabele już zniknęły).

DROP TABLE IF EXISTS public.ai_pipeline_logs;
DROP TABLE IF EXISTS public.sentiment_scores;
