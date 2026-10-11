#!/bin/bash
# ═══════════════════════════════════════════════════════
# StockPulse — autostart po restarcie Jetsona
#
# Co robi:
#   1. Czeka na Docker daemon i na synchronizację zegara (NTP)
#   2. git pull (pobiera zmiany z repo)
#   3. make up (startuje stack z autodetekcją środowiska)
#   3.5 restart app, jeśli Docker podniósł go sam przed NTP (zegar 1970)
#   4. Czeka na health
#
# Instalacja (jednorazowo):
#   crontab -e
#   @reboot /home/n1copl/stockPulse/scripts/autostart.sh
# ═══════════════════════════════════════════════════════

REPO_DIR="/home/n1copl/stockPulse"
LOG_FILE="$REPO_DIR/logs/autostart.log"

mkdir -p "$REPO_DIR/logs"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"
}

log "=== Autostart StockPulse ==="

# 1. Czekaj na Docker (max 60s)
for i in $(seq 1 30); do
    if docker info >/dev/null 2>&1; then
        log "Docker gotowy (po ${i}x2s)"
        break
    fi
    sleep 2
done

if ! docker info >/dev/null 2>&1; then
    log "BŁĄD: Docker nie wystartował po 60s"
    exit 1
fi

# 1.5 Czekaj na synchronizacje zegara (NTP).
#     RTC Jetsona wraca do 1970 po reboocie (brak podtrzymania bateryjnego) —
#     bez tego kontenery startuja z data 1970: "Up 56 years" w docker ps,
#     overflow duration_ms w system_logs, stemple 1970 w raporcie 8h.
log "Czekam na synchronizacje zegara (NTP)... (RTC: $(cat /sys/class/rtc/rtc0/date 2>/dev/null) $(cat /sys/class/rtc/rtc0/time 2>/dev/null))"
for i in $(seq 1 30); do
    if [ "$(timedatectl show -p NTPSynchronized --value 2>/dev/null)" = "yes" ]; then
        log "Zegar zsynchronizowany (po $((i*2))s): $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
        break
    fi
    sleep 2
done
NTP_OK="$(timedatectl show -p NTPSynchronized --value 2>/dev/null)"
if [ "$NTP_OK" != "yes" ]; then
    log "OSTRZEZENIE: zegar NIE zsynchronizowany po 60s — start mimo to (czas moze byc bledny)"
fi

# 2. Git pull
cd "$REPO_DIR" || exit 1
GIT_OUTPUT=$(git pull 2>&1)
log "git pull: $GIT_OUTPUT"

# 3. Sprawdź czy trzeba rebuild (czy zmienił się kod)
if echo "$GIT_OUTPUT" | grep -qE '\.(ts|tsx|py|txt|yml|Dockerfile)'; then
    log "Wykryto zmiany w kodzie — rebuild"
    make rebuild >> "$LOG_FILE" 2>&1
else
    log "Brak zmian w kodzie — start bez rebuildu"
    make up >> "$LOG_FILE" 2>&1
fi

# 3.5 Kontenery z `restart: unless-stopped` podnosi sam Docker — PRZED synchronizacja NTP,
#     wiec czekanie w kroku 1.5 ich nie obejmuje (incydent 04.10.2026: app wystartowal z zegarem
#     1970, "Up 56 years", nieudany raport 8h). Jesli app ma StartedAt sprzed 2000 r., a zegar
#     jest juz poprawny — restart, zeby CRON-y i raport 8h liczyly od prawdziwego czasu.
#     Postgres/Redis nie ruszamy (u nich zly StartedAt jest tylko kosmetyczny w `docker ps`).
APP_STARTED=$(docker inspect -f '{{.State.StartedAt}}' stockpulse-app 2>/dev/null)
APP_YEAR=${APP_STARTED:0:4}
if [ "$NTP_OK" = "yes" ] && [[ "$APP_YEAR" =~ ^[0-9]{4}$ ]] && [ "$APP_YEAR" -lt 2000 ]; then
    log "app wystartowal z zegarem $APP_STARTED (przed NTP) — restart kontenera"
    docker restart stockpulse-app >> "$LOG_FILE" 2>&1
    log "app po restarcie: StartedAt=$(docker inspect -f '{{.State.StartedAt}}' stockpulse-app 2>/dev/null)"
fi

# 4. Czekaj na health (max 90s — po restarcie app potrzebuje ~20-30s na start NestJS)
HEALTH=""
for i in $(seq 1 18); do
    sleep 5
    HEALTH=$(docker exec stockpulse-app node -e "
const http = require('http');
http.get('http://localhost:3000/api/health', res => {
    let d = '';
    res.on('data', c => d+=c);
    res.on('end', () => console.log(JSON.parse(d).status));
}).on('error', () => process.exit(1));" 2>/dev/null)
    [ -n "$HEALTH" ] && break
done

log "Health: ${HEALTH:-brak odpowiedzi po 90s}"
log "=== Autostart zakończony ==="
