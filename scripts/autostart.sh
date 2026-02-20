#!/bin/bash
# ═══════════════════════════════════════════════════════
# StockPulse — autostart po restarcie Jetsona
#
# Co robi:
#   1. Czeka na Docker daemon
#   2. git pull (pobiera zmiany z repo)
#   3. make up (startuje stack z autodetekcją środowiska)
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

# 4. Czekaj na health
sleep 15
HEALTH=$(docker exec stockpulse-app node -e "
const http = require('http');
http.get('http://localhost:3000/api/health', res => {
    let d = '';
    res.on('data', c => d+=c);
    res.on('end', () => console.log(JSON.parse(d).status));
});" 2>/dev/null)

log "Health: $HEALTH"
log "=== Autostart zakończony ==="
