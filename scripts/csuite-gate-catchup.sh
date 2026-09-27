#!/usr/bin/env bash
# Catch-up dla licznika sub-gate'u C-suite (27.09.2026): cron 23:45 pn-pt pominął tick 26.09
# (Jetson pod obciążeniem rebuildów — syslog ma discovery-watch o 23:45:01, bez csuite-gate).
# Ten skrypt odpala co godzinę i uruchamia licznik, jeśli DZISIEJSZY dzienny wpis nie istnieje
# w logu (dni robocze). Idempotentny: gdy 23:45 zadziałało, nic nie robi.
set -u
REPO_DIR="/home/n1copl/stockPulse"
LOG_FILE="$REPO_DIR/logs/csuite-gate.log"
DOW=$(date +%u); [ "$DOW" -ge 6 ] && exit 0            # weekend: brak nowych slotów 7d
HOUR=$(date +%H); [ "$HOUR" -lt 23 ] && [ "$HOUR" -ge 1 ] && { [ "$HOUR" -ge 8 ] || exit 0; }
# okno catch-up: 00:xx–07:xx nie ma sensu (price outcome liczy w sesji NYSE), więc tylko 08–22 + po 23:45
TODAY=$(date +%F)
if grep -q "^$TODAY .* T1 N=" "$LOG_FILE" 2>/dev/null; then exit 0; fi
# brak wpisu z dziś → dogrywka (log dostaje znacznik, żeby odróżnić od regularnego 23:45)
echo "$(date '+%F %T') CATCH-UP (brak wpisu z $TODAY — cron 23:45 pominięty lub jeszcze nie odpalił)" >> "$LOG_FILE"
exec "$REPO_DIR/scripts/csuite-gate.sh"
