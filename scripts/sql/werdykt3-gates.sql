-- Liczniki pre-zarejestrowane przy werdykcie #2 (01.11.2026, doc/KALENDARZ-WALIDACJI-2026.md, wpis 01.02.2027).
-- Wynik: jedna linia per licznik:  tag|zdarzenia|alerty|hit%|med_alpha|med_real|med_net|mean_net|pln_suma|wchodzalne
--
-- W3   = werdykt #3 „core + rdzeń+": 'Form 4 Insider BUY' na tickerach sector='healthcare' (core zwalidowany + rdzeń+
--        + auto-promowane large-capy), sentAt >= 01.11.2026 (forward), bez FUND (co-filer = encja), bez price_frozen.
--        Progi (01.02.2027 lub N>=10): hit >= 60% ∧ med NET > 0 ∧ śr NET > 0 ∧ wchodzalne >= 50%; N<5 do 01.02 → sunset gry.
-- ME8K = '8-K Material Event GPT' od 01.09.2026 (obie strony; decyzja obs/sunset przy N>=10). Liczone po ruleName, NIE po
--        nonDeliveryReason — priorytet tłumienia (bullish_8k > material_event_obs) maskuje powód (werdykt #2 §6).
-- Konwencje jak werdykt #2: zdarzenie = symbol + kierunek w łańcuchu <=7 dni po sentAt (średnia metryk); hit = surowa
-- cena 7d w kierunku alertu; alpha = vs XBI; REAL = price1h→price7d w kierunku alertu; NET = REAL − 1%; wchodzalne =
-- gap price1h vs priceAtAlert <= +3% (chase guard REGUŁ §2).
WITH base AS (
  SELECT a.id, a.symbol, a."ruleName", a."sentAt", a."alertDirection", t.sector,
         CASE WHEN a."alertDirection" = 'negative' THEN -1 ELSE 1 END AS d,
         a."priceAtAlert", a."price1h", a."price7d", a."xbiAtAlert", a."xbi7d"
  FROM alerts a JOIN tickers t ON t.symbol = a.symbol
  WHERE a."priceAtAlert" IS NOT NULL AND a."price1h" IS NOT NULL AND a."price7d" IS NOT NULL
    AND NOT (a."price1h" = a."price4h" AND a."price4h" = a."price1d"
             AND a."price1d" = a."price3d" AND a."price3d" = a."price7d")
),
tagged AS (
  SELECT b.*, 'W3' AS tag FROM base b
  WHERE b."ruleName" = 'Form 4 Insider BUY' AND b.sector = 'healthcare' AND b."sentAt" >= '2026-11-01'
    AND NOT EXISTS (
      SELECT 1 FROM insider_trades i
      WHERE i.symbol = b.symbol AND i."transactionType" = 'BUY'
        AND i."transactionDate" BETWEEN b."sentAt"::date - 14 AND b."sentAt"::date
        AND i."insiderName" ~* '(CAPITAL|FUND|\mLP\M|L\.P\.|LLC|PARTNERS|ADVISORS|MANAGEMENT|HOLDINGS|TRUST)')
  UNION ALL
  SELECT b.*, 'ME8K' AS tag FROM base b
  WHERE b."ruleName" = '8-K Material Event GPT' AND b."sentAt" >= '2026-09-01'
),
m AS (
  SELECT tag, symbol, d, "sentAt",
    (price7d - "priceAtAlert") / "priceAtAlert" * 100 * d AS signed7d,
    ((price7d - "priceAtAlert") / "priceAtAlert" - (xbi7d - "xbiAtAlert") / nullif("xbiAtAlert", 0)) * 100 * d AS alpha7d,
    (price7d - price1h) / price1h * 100 * d AS real7d,
    (price1h - "priceAtAlert") / "priceAtAlert" * 100 * d AS gap1h
  FROM tagged
),
seq AS (
  SELECT m.*, CASE WHEN "sentAt" - lag("sentAt") OVER (PARTITION BY tag, symbol, d ORDER BY "sentAt") <= interval '7 days'
                   THEN 0 ELSE 1 END AS ne
  FROM m
),
num AS (SELECT seq.*, sum(ne) OVER (PARTITION BY tag, symbol, d ORDER BY "sentAt") AS ev FROM seq),
events AS (
  SELECT tag, symbol, d, ev, count(*) AS n_alerts, avg(signed7d) AS signed7d, avg(alpha7d) AS alpha7d,
         avg(real7d) AS real7d, bool_or(gap1h <= 3.0) AS enterable
  FROM num GROUP BY tag, symbol, d, ev
)
SELECT t.tag, coalesce(e.n, 0), coalesce(e.alerts, 0), coalesce(e.hit, 0), coalesce(e.med_alpha, 0),
       coalesce(e.med_real, 0), coalesce(e.med_net, 0), coalesce(e.mean_net, 0), coalesce(e.pln, 0), coalesce(e.enterable, 0)
FROM (VALUES ('W3', 1), ('ME8K', 2)) AS t(tag, ord)
LEFT JOIN (
  SELECT tag, count(*) AS n, sum(n_alerts) AS alerts,
         round(avg((signed7d > 0)::int) * 100) AS hit,
         round((percentile_cont(0.5) WITHIN GROUP (ORDER BY alpha7d))::numeric, 2) AS med_alpha,
         round((percentile_cont(0.5) WITHIN GROUP (ORDER BY real7d))::numeric, 2) AS med_real,
         round((percentile_cont(0.5) WITHIN GROUP (ORDER BY real7d - 1.0))::numeric, 2) AS med_net,
         round(avg(real7d - 1.0)::numeric, 2) AS mean_net,
         round(sum(real7d - 1.0)::numeric * :pos_pln / 100, 0) AS pln,
         sum(enterable::int) AS enterable
  FROM events GROUP BY tag
) e ON e.tag = t.tag
ORDER BY t.ord;
