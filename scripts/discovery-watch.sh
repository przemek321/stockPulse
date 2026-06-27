#!/bin/bash
# ═══════════════════════════════════════════════════════
# StockPulse — watcher discovery (cron, reboot-proof)
#
# Co robi:
#   Co uruchomienie sprawdza bazę pod kątem NOWYCH zdarzeń discovery:
#     - nowy ticker sektora 'healthcare_discovery'
#     - nowy alert obserwacyjny (nonDeliveryReason='observation')
#   Gdy coś nowego → wysyła ping na Telegram (bezpośrednio Bot API).
#   Stan (co już zgłoszone) trzyma w logs/discovery-watch.state.
#   Pierwsze uruchomienie = inicjalizacja stanu BEZ pingu (nie spamuje backlogiem).
#
# Instalacja (cron, przeżywa restart):
#   crontab -e
#   */5 * * * * /home/n1copl/stockPulse/scripts/discovery-watch.sh
# ═══════════════════════════════════════════════════════

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
REPO_DIR="/home/n1copl/stockPulse"
STATE_FILE="$REPO_DIR/logs/discovery-watch.state"
LOG_FILE="$REPO_DIR/logs/discovery-watch.log"
PG_CONTAINER="stockpulse-postgres"

cd "$REPO_DIR" || exit 1
mkdir -p "$REPO_DIR/logs"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"; }

# --- Telegram config z .env ---
TOKEN=$(grep -E '^TELEGRAM_BOT_TOKEN=' .env | cut -d= -f2- | tr -d '"'"'"' \r')
CHAT=$(grep -E '^TELEGRAM_CHAT_ID=' .env | cut -d= -f2- | tr -d '"'"'"' \r')

# --- helper SQL (kontener po nazwie — bez zależności od plików compose) ---
q() { docker exec -i "$PG_CONTAINER" psql -U stockpulse -d stockpulse -t -A -c "$1" 2>/dev/null; }

# kontener żyje?
if ! docker exec -i "$PG_CONTAINER" true 2>/dev/null; then
  log "postgres niedostępny — pomijam cykl"
  exit 0
fi

send_telegram() {
  local msg="$1"
  [ -z "$TOKEN" ] || [ -z "$CHAT" ] && { log "BŁĄD: brak TELEGRAM_BOT_TOKEN/CHAT_ID"; return 1; }
  curl -s --max-time 15 -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${CHAT}" \
    --data-urlencode "text=${msg}" \
    -d "disable_web_page_preview=true" >/dev/null
}

# --- aktualny stan z bazy ---
CUR_TICKERS=$(q "SELECT symbol FROM tickers WHERE sector='healthcare_discovery' ORDER BY symbol" | tr '\n' ' ' | sed 's/ *$//')
CUR_MAX_ALERT=$(q "SELECT COALESCE(max(id),0) FROM alerts WHERE \"nonDeliveryReason\"='observation'")
[ -z "$CUR_MAX_ALERT" ] && { log "pusta odpowiedź z bazy — pomijam"; exit 0; }

# --- pierwsze uruchomienie: zainicjuj stan, nie pinguj ---
if [ ! -f "$STATE_FILE" ]; then
  { echo "MAX_ALERT=$CUR_MAX_ALERT"; echo "TICKERS=$CUR_TICKERS"; } > "$STATE_FILE"
  log "init stanu: MAX_ALERT=$CUR_MAX_ALERT TICKERS=[$CUR_TICKERS] (bez pingu)"
  exit 0
fi

# --- wczytaj poprzedni stan ---
PREV_MAX_ALERT=$(grep -E '^MAX_ALERT=' "$STATE_FILE" | cut -d= -f2-)
PREV_TICKERS=$(grep -E '^TICKERS=' "$STATE_FILE" | cut -d= -f2-)
PREV_MAX_ALERT=${PREV_MAX_ALERT:-0}

# --- wykryj nowe tickery ---
NEW_TICKERS=""
for t in $CUR_TICKERS; do
  echo " $PREV_TICKERS " | grep -q " $t " || NEW_TICKERS="$NEW_TICKERS $t"
done
NEW_TICKERS=$(echo "$NEW_TICKERS" | sed 's/^ *//')

# --- wykryj nowe alerty obserwacyjne ---
NEW_ALERTS=""
if [ "$CUR_MAX_ALERT" -gt "$PREV_MAX_ALERT" ]; then
  NEW_ALERTS=$(q "SELECT '  • '||symbol||' @\$'||\"priceAtAlert\"||'  (id '||id||', '||\"sentAt\"::timestamp(0)||')' FROM alerts WHERE id>$PREV_MAX_ALERT AND \"nonDeliveryReason\"='observation' ORDER BY id")
fi

# --- jeśli coś nowego → ping ---
if [ -n "$NEW_TICKERS" ] || [ -n "$NEW_ALERTS" ]; then
  MSG="🔭 StockPulse — nowe w discovery"
  [ -n "$NEW_TICKERS" ] && MSG="$MSG"$'\n\nNowe tickery healthcare_discovery:\n  '"$NEW_TICKERS"
  [ -n "$NEW_ALERTS" ]  && MSG="$MSG"$'\n\nNowe alerty obserwacyjne:\n'"$NEW_ALERTS"
  MSG="$MSG"$'\n\nWszystkie discovery: '"$CUR_TICKERS"
  send_telegram "$MSG" && log "PING wysłany: new_tickers=[$NEW_TICKERS] new_alerts>${PREV_MAX_ALERT}" \
                       || log "PING NIEUDANY (curl/Telegram)"
fi

# --- zapisz aktualny stan ---
{ echo "MAX_ALERT=$CUR_MAX_ALERT"; echo "TICKERS=$CUR_TICKERS"; } > "$STATE_FILE"
exit 0
