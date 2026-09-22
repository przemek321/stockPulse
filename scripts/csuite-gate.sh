#!/usr/bin/env bash
# Sub-gate C-suite BUY — licznik + ping (pre-rejestracja 01.09.2026, przegląd 01.11 lub wcześniej przy N>=10).
#
# Gate (KALENDARZ 01.11), liczony OSOBNO per tier:
#   T1 = grupa wyzwalacza ≥$500K (pre-zarejestrowany sub-gate #1)   T2 = tier-2 C-suite $100-500K (od 01.09)
#   N >= 10 zdarzeń ∧ hit 7d >= 60% ∧ mediana alpha XBI >= +2pp ∧ mediana REAL (price1h→7d − 1%) > 0
#   → przegląd sub-gate'u (decyzja o promocji C-suite BUY danego tieru z discovery do delivery 🎯).
#
# 23.09.2026 (audyt): obok mediany REAL pokazujemy ŚREDNIĄ, sumę PLN przy pozycji 2 200 PLN i liczbę
# zdarzeń wchodzalnych wg chase guardu (+3%) — gate na medianie przeszedł 18.09 przy średniej REAL ujemnej.
# Atrybucja roli = transakcja wyzwalająca alert (fix fantomowych zdarzeń, patrz csuite-gate.cte.sql).
#
# Użycie:  csuite-gate.sh            (tryb cron: log + ping Telegram per tier gdy N>=10, ponawiany aż ok:true)
#          csuite-gate.sh --print    (pełna tabela zdarzeń na stdout)
# Cron:    45 23 * * 1-5 /home/n1copl/stockPulse/scripts/csuite-gate.sh   (po ostatnim slocie price outcome)
set -u
REPO_DIR="/home/n1copl/stockPulse"
SQL_CTE="$REPO_DIR/scripts/sql/csuite-gate.cte.sql"
LOG_FILE="$REPO_DIR/logs/csuite-gate.log"
STATE_DIR="$REPO_DIR/logs"
GATE_N=10
POS_PLN=2200
# 23.09.2026 (przegląd sub-gate'u, doc/CSUITE-SUBGATE-REVIEW-2026-09-23.md): gate #1 przeszedł 18.09 na
# zdarzeniach in-sample (7/10 sprzed pre-rejestracji) → BEZ PROMOCJI. Gate #2 liczy WYŁĄCZNIE zdarzenia
# z first_at >= GATE2_FROM (czysty forward) i wymaga dodatkowo śr REAL > 0 oraz ≥30% wchodzalnych.
# Sekcja „historia" w --print pokazuje pełną kohortę dla porównania.
GATE2_FROM="2026-09-02"
mkdir -p "$STATE_DIR"

psql_q() { docker exec -i stockpulse-postgres psql -U stockpulse -d stockpulse -t -A -F'|' 2>&1; }

# Jedna linia per tier: tier|N|hit%|med_alpha|mean_alpha|med_real|mean_real|pln_suma|wchodzalne|mean_raw
SUMMARY=$( { cat "$SQL_CTE"; cat <<EOSQL
SELECT t.tier, coalesce(e.n, 0), coalesce(e.hit, 0), coalesce(e.med_alpha, 0), coalesce(e.mean_alpha, 0),
       coalesce(e.med_real, 0), coalesce(e.mean_real, 0), coalesce(e.pln_suma, 0), coalesce(e.enterable, 0), coalesce(e.mean_raw, 0)
FROM (VALUES ('T1'), ('T2')) AS t(tier)
LEFT JOIN (
  SELECT tier, count(*) AS n,
         round(avg((raw7d > 0)::int) * 100) AS hit,
         round((percentile_cont(0.5) WITHIN GROUP (ORDER BY alpha7d))::numeric, 2) AS med_alpha,
         round(avg(alpha7d)::numeric, 2) AS mean_alpha,
         round((percentile_cont(0.5) WITHIN GROUP (ORDER BY real_net7d))::numeric, 2) AS med_real,
         round(avg(real_net7d)::numeric, 2) AS mean_real,
         round(sum(real_net7d)::numeric * $POS_PLN / 100, 0) AS pln_suma,
         sum(enterable::int) AS enterable,
         round(avg(raw7d)::numeric, 2) AS mean_raw
  FROM events WHERE first_at >= '$GATE2_FROM' GROUP BY tier
) e ON e.tier = t.tier
ORDER BY t.tier;
EOSQL
} | psql_q )

if ! [[ "$SUMMARY" =~ ^T1\| ]]; then
  echo "$(date '+%F %T') BŁĄD SQL: ${SUMMARY:0:300}" >> "$LOG_FILE"; exit 1
fi

fmt_line() {  # $1..$10 = pola SUMMARY
  echo "$1 N=$2/$GATE_N hit=$3% medα=$4pp (śr $5) medREAL=$6% (śr $7, suma ${8} PLN @${POS_PLN}) wchodzalne=$9/$2 raw=${10}%"
}

if [ "${1:-}" = "--print" ]; then
  echo "SUB-GATE #2 C-SUITE BUY — zdarzenia od $GATE2_FROM (próg N=$GATE_N; hit≥60%, med α≥+2pp, med REAL>0, śr REAL>0, wchodzalne ≥30%)"
  echo "$SUMMARY" | while IFS='|' read -r T N H MA MEANA MR MEANR PLN ENT RAW; do echo "  $(fmt_line "$T" "$N" "$H" "$MA" "$MEANA" "$MR" "$MEANR" "$PLN" "$ENT" "$RAW")"; done
  { cat "$SQL_CTE"; cat <<EOSQL
SELECT CASE WHEN first_at >= '$GATE2_FROM' THEN 'GATE2' ELSE 'hist' END AS okres, tier, symbol, to_char(first_at, 'MM-DD') AS d,
       n_alerts AS a, CASE WHEN delivered THEN 'DELIV' ELSE 'obs' END AS st,
       left(trigger_name, 18) AS trigger, left(trigger_role, 22) AS trig_role,
       round(raw7d::numeric, 2) AS raw7d, round(alpha7d::numeric, 2) AS alpha, round(gap1h::numeric, 2) AS gap1h,
       round(real_net7d::numeric, 2) AS real_net, enterable AS enter
FROM events ORDER BY okres, tier, first_at;
EOSQL
  } | docker exec -i stockpulse-postgres psql -U stockpulse -d stockpulse 2>&1
  exit 0
fi

echo "$SUMMARY" | while IFS='|' read -r TIER N HIT MA MEANA MR MEANR PLN ENT RAW; do
  PASS_HIT=$(( ${HIT%.*} >= 60 ))
  PASS_ALPHA=$(python3 -c "print(1 if $MA >= 2.0 else 0)")
  # gate #2: mediana ORAZ średnia REAL > 0 (mediana maskowała ujemną wartość oczekiwaną 18.09)
  PASS_REAL=$(python3 -c "print(1 if ($MR > 0 and $MEANR > 0) else 0)")
  PASS_ENTER=$(python3 -c "print(1 if ($N > 0 and $ENT / $N >= 0.3) else 0)")
  VERDICT="$(fmt_line "$TIER" "$N" "$HIT" "$MA" "$MEANA" "$MR" "$MEANR" "$PLN" "$ENT" "$RAW") | progi: hit=$PASS_HIT α=$PASS_ALPHA REAL=$PASS_REAL wchodz=$PASS_ENTER"
  echo "$(date '+%F %T') $VERDICT" >> "$LOG_FILE"

  STATE_FILE="$STATE_DIR/csuite-gate.$TIER.state"   # ping raz per tier; reset = usuń plik
  if [ "$N" -ge "$GATE_N" ] && [ ! -f "$STATE_FILE" ]; then
    TG_TOKEN=$(grep -E '^TELEGRAM_BOT_TOKEN=' "$REPO_DIR/.env" | cut -d= -f2-)
    TG_CHAT=$(grep -E '^TELEGRAM_CHAT_ID=' "$REPO_DIR/.env" | cut -d= -f2-)
    if [ $(( PASS_HIT && PASS_ALPHA && PASS_REAL && PASS_ENTER )) -eq 1 ]; then
      HEAD="✅ progi spełnione → uruchom przegląd sub-gate'u #2 (promocja C-suite BUY $TIER z discovery)"
    else
      HEAD="❌ próg N osiągnięty, ale nie wszystkie kryteria → przegląd i decyzja"
    fi
    TEXT="📐 Sub-gate #2 C-suite BUY $TIER (zdarzenia od $GATE2_FROM): N=$N osiągnięte (to NIE sygnał). $VERDICT. $HEAD. Szczegóły: scripts/csuite-gate.sh --print"
    # 22.09.2026: pierwszy ping (18.09) „wysłany" wg logu, ale nie dotarł — curl -o /dev/null gubił odpowiedź
    # API, a exit 0 curla ≠ ok:true Telegrama. Teraz: log kodu HTTP + treści, state tylko przy ok:true,
    # inaczej ponowna próba następnego wieczoru.
    RESP=$(curl -s -m 30 -w '\nHTTP:%{http_code}' -X POST "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TG_CHAT}" --data-urlencode "text=${TEXT}")
    if echo "$RESP" | grep -q '"ok":true'; then
      echo "PINGED $(date '+%F %T') N=$N" > "$STATE_FILE"
      echo "$(date '+%F %T') PING $TIER wysłany OK (N=$N)" >> "$LOG_FILE"
    else
      echo "$(date '+%F %T') PING $TIER BŁĄD: $(echo "$RESP" | tr '\n' ' ' | head -c 300) — ponowię jutro" >> "$LOG_FILE"
    fi
  fi
done
