#!/usr/bin/env bash
# Sub-gate C-suite BUY — licznik + ping (pre-rejestracja 01.09.2026, przegląd 01.11 lub wcześniej przy N>=10).
#
# Gate (KALENDARZ 01.11): N >= 10 zdarzeń C-suite BUY (core + discovery, bez FUND)
#   ∧ hit 7d >= 60%  ∧  mediana alpha XBI >= +2pp  ∧  mediana REAL (price1h→7d − 1%) > 0
#   → promocja TYLKO C-suite BUY z discovery do delivery (🎯). Director-only zostaje w obs.
#
# Użycie:  csuite-gate.sh            (tryb cron: log + jednorazowy ping Telegram gdy N>=10)
#          csuite-gate.sh --print    (pełna tabela zdarzeń na stdout)
# Cron:    45 23 * * 1-5 /home/n1copl/stockPulse/scripts/csuite-gate.sh   (po ostatnim slocie price outcome)
set -u
REPO_DIR="/home/n1copl/stockPulse"
SQL_CTE="$REPO_DIR/scripts/sql/csuite-gate.cte.sql"
LOG_FILE="$REPO_DIR/logs/csuite-gate.log"
STATE_FILE="$REPO_DIR/logs/csuite-gate.state"
GATE_N=10
mkdir -p "$REPO_DIR/logs"

psql_q() { docker exec -i stockpulse-postgres psql -U stockpulse -d stockpulse -t -A -F'|' 2>&1; }

SUMMARY=$( { cat "$SQL_CTE"; cat <<'EOSQL'
SELECT count(*),
       coalesce(round(avg((raw7d > 0)::int) * 100), 0),
       coalesce(round((percentile_cont(0.5) WITHIN GROUP (ORDER BY alpha7d))::numeric, 2), 0),
       coalesce(round(avg(alpha7d)::numeric, 2), 0),
       coalesce(round((percentile_cont(0.5) WITHIN GROUP (ORDER BY real_net7d))::numeric, 2), 0),
       coalesce(round(avg(raw7d)::numeric, 2), 0)
FROM events;
EOSQL
} | psql_q )

if ! [[ "$SUMMARY" =~ ^[0-9]+\| ]]; then
  echo "$(date '+%F %T') BŁĄD SQL: ${SUMMARY:0:300}" >> "$LOG_FILE"; exit 1
fi
IFS='|' read -r N HIT MED_ALPHA MEAN_ALPHA MED_REAL MEAN_RAW <<< "$SUMMARY"

PASS_HIT=$(( ${HIT%.*} >= 60 ))
PASS_ALPHA=$(python3 -c "print(1 if $MED_ALPHA >= 2.0 else 0)")
PASS_REAL=$(python3 -c "print(1 if $MED_REAL > 0 else 0)")
VERDICT="N=$N/$GATE_N hit=${HIT}% medα=${MED_ALPHA}pp (śr ${MEAN_ALPHA}) medREAL=${MED_REAL}% raw=${MEAN_RAW}% | progi: hit=$PASS_HIT α=$PASS_ALPHA REAL=$PASS_REAL"

if [ "${1:-}" = "--print" ]; then
  echo "SUB-GATE C-SUITE BUY — $VERDICT"
  { cat "$SQL_CTE"; cat <<'EOSQL'
SELECT symbol, to_char(first_at, 'MM-DD') AS d, n_alerts AS a, CASE WHEN delivered THEN 'DELIV' ELSE 'obs' END AS st,
       sector, round(raw7d::numeric, 2) AS raw7d, round(alpha7d::numeric, 2) AS alpha, round(gap1h::numeric, 2) AS gap1h,
       round(real_net7d::numeric, 2) AS real_net, left(roles, 60) AS roles
FROM events ORDER BY first_at;
EOSQL
  } | docker exec -i stockpulse-postgres psql -U stockpulse -d stockpulse 2>&1
  exit 0
fi

echo "$(date '+%F %T') $VERDICT" >> "$LOG_FILE"

# Ping raz, gdy licznik osiągnie próg (stan w pliku; reset = usuń STATE_FILE)
if [ "$N" -ge "$GATE_N" ] && [ ! -f "$STATE_FILE" ]; then
  TG_TOKEN=$(grep -E '^TELEGRAM_BOT_TOKEN=' "$REPO_DIR/.env" | cut -d= -f2-)
  TG_CHAT=$(grep -E '^TELEGRAM_CHAT_ID=' "$REPO_DIR/.env" | cut -d= -f2-)
  ALL_PASS=$(( PASS_HIT && PASS_ALPHA && PASS_REAL ))
  if [ "$ALL_PASS" -eq 1 ]; then HEAD="✅ progi spełnione → uruchom przegląd sub-gate'u (promocja C-suite BUY z discovery)"; else HEAD="❌ próg N osiągnięty, ale nie wszystkie kryteria → przegląd i decyzja"; fi
  TEXT="📐 Sub-gate C-suite BUY: N=$N osiągnięte (to NIE sygnał). $VERDICT. $HEAD. Szczegóły: scripts/csuite-gate.sh --print"
  curl -s -m 30 -o /dev/null -w '' -X POST "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TG_CHAT}" --data-urlencode "text=${TEXT}" \
    && echo "PINGED $(date '+%F %T') N=$N" > "$STATE_FILE" \
    && echo "$(date '+%F %T') PING wysłany (N=$N)" >> "$LOG_FILE"
fi
