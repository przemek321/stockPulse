-- Sub-gate C-suite BUY — pre-rejestracja 01.09.2026 (doc/KALENDARZ-WALIDACJI-2026.md, wpis 01.11;
-- doc/WERDYKT-EDGE-2026-09-01.md §6). Wspólne CTE dla scripts/csuite-gate.sh.
--
-- Kohorta: alerty 'Form 4 Insider BUY' (delivered core + obserwacje discovery/APLS) od 09.06 z pełnym 7d,
-- bez sub-kohorty funduszowej (co-filer = encja), z co najmniej jednym BUY o roli C-suite wg whitelisty
-- isCsuiteRole (form4.pipeline.ts) — atrybucja WYŁĄCZNIE z insider_trades.insiderRole.
-- Zdarzenie = alerty tego samego symbolu w łańcuchu ≤7 dni (średnia metryk).
-- Metryki: hit = surowa cena 7d > wejścia; alpha = raw − XBI w oknie; REAL = price1h → price7d − 1% kosztów.
-- price_frozen (5 identycznych slotów — SEM #2441 delisting) wykluczony.
WITH buy_alerts AS (
  SELECT a.id, a.symbol, a."sentAt", a.delivered, t.sector,
         a."priceAtAlert", a."price1h", a."price7d", a."xbiAtAlert", a."xbi7d"
  FROM alerts a
  JOIN tickers t ON t.symbol = a.symbol
  WHERE a."ruleName" = 'Form 4 Insider BUY'
    AND a."sentAt" >= '2026-06-09'
    AND a."priceAtAlert" IS NOT NULL AND a."price1h" IS NOT NULL AND a."price7d" IS NOT NULL
    AND a."xbiAtAlert" IS NOT NULL AND a."xbi7d" IS NOT NULL
    AND t.sector IN ('healthcare', 'healthcare_discovery', 'biotech_apls')
    AND NOT (a."priceAtAlert" = a."price1h" AND a."price1h" = a."price4h" AND a."price4h" = a."price1d"
             AND a."price1d" = a."price3d" AND a."price3d" = a."price7d")
),
-- Agregacja per insider (semantyka TASK-03 / prefilterForm4Buy): wartość grupy = suma transakcji
-- jednego insidera w oknie; tier liczony z grupy C-suite, nie z pojedynczego wiersza.
per_insider AS (
  SELECT b.id, i."insiderName" AS insider, max(i."insiderRole") AS role, sum(i."totalValue") AS value,
    max(i."insiderRole") ~* '\mChief\s+(Executive|Financial|Operating|Technology|Information|Medical|Scientific|Legal|Accounting)\s+Officer\M'
      OR max(i."insiderRole") ~* '\m(CEO|CFO|COO|CTO|CIO|CMO|CSO|CLO)\M'
      -- "President" bez "Vice/Senior President" (Postgres nie ma lookbehind → wycinamy je przed testem)
      OR regexp_replace(max(i."insiderRole"), '(Vice|Senior)\s+President', '', 'gi') ~* '\mPresident\M'
      OR max(i."insiderRole") ~* '\mChair(man|woman|person)\M'
      OR max(i."insiderRole") ~* '\m(EVP|Executive\s+Vice\s+President)[\s,]+.*?(Finance|Operations?|Product|Strategy)\M'
      OR max(i."insiderRole") ~* '\mPrincipal\s+(Financial|Accounting)\s+Officer\M' AS csuite
  FROM buy_alerts b
  JOIN insider_trades i ON i.symbol = b.symbol AND i."transactionType" = 'BUY'
    AND i."transactionDate" BETWEEN b."sentAt"::date - 14 AND b."sentAt"::date
  GROUP BY b.id, i."insiderName"
),
roles AS (
  SELECT id,
    bool_or(insider ~* '(CAPITAL|FUND|\mLP\M|L\.P\.|LLC|PARTNERS|ADVISORS|MANAGEMENT|HOLDINGS|TRUST)') AS is_fund,
    bool_or(csuite) AS is_csuite,
    string_agg(DISTINCT role, ' | ') AS roles,
    max(value) FILTER (WHERE csuite) AS max_buy
  FROM per_insider
  GROUP BY id
),
cs AS (
  SELECT b.id, b.symbol, b."sentAt", b.delivered, b.sector, r.roles, r.max_buy,
    (b."price7d" - b."priceAtAlert") / b."priceAtAlert" * 100 AS raw7d,
    (b."price7d" - b."priceAtAlert") / b."priceAtAlert" * 100
      - (b."xbi7d" - b."xbiAtAlert") / b."xbiAtAlert" * 100 AS alpha7d,
    (b."price7d" - b."price1h") / b."price1h" * 100 - 1.0 AS real_net7d,
    (b."price1h" - b."priceAtAlert") / b."priceAtAlert" * 100 AS gap1h
  FROM buy_alerts b
  JOIN roles r ON r.id = b.id
  WHERE r.is_csuite AND NOT r.is_fund
),
seq AS (
  SELECT cs.*,
    CASE WHEN "sentAt" - lag("sentAt") OVER (PARTITION BY symbol ORDER BY "sentAt") <= interval '7 days'
         THEN 0 ELSE 1 END AS new_event
  FROM cs
),
numbered AS (
  SELECT seq.*, sum(new_event) OVER (PARTITION BY symbol ORDER BY "sentAt") AS ev_no FROM seq
),
events AS (
  SELECT symbol, ev_no, min("sentAt") AS first_at, count(*) AS n_alerts, bool_or(delivered) AS delivered,
         min(sector) AS sector, max(roles) AS roles,
         -- T1 = pre-zarejestrowany sub-gate (BUY ≥$500K); T2 = tier-2 C-suite $100-500K (od 01.09, osobno)
         CASE WHEN max(max_buy) >= 500000 THEN 'T1' ELSE 'T2' END AS tier,
         avg(raw7d) AS raw7d, avg(alpha7d) AS alpha7d, avg(real_net7d) AS real_net7d, avg(gap1h) AS gap1h
  FROM numbered
  GROUP BY symbol, ev_no
)
