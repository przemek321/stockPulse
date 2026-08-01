#!/bin/bash
# ═══════════════════════════════════════════════════════
# StockPulse — cotygodniowy backup (cron, niedziela 03:15)
#
# Zabezpiecza WSZYSTKO, czego nie ma w git:
#   1. baza PostgreSQL (pg_dump -Fc)      → stockpulse_<data>.dump
#   2. .env (klucze API, token Telegram)  → env_<data>.bak
#   3. pamięć projektowa Claude           → claude-memory_<data>.tar.gz
# Retencja: 8 ostatnich zestawów (~2 miesiące).
#
# UWAGA: backups/ jest na TYM SAMYM dysku — chroni przed błędem,
# nie przed padem serwera. Kopię off-site rób z laptopa:
#   scp -r jetson:~/stockPulse/backups ~/stockpulse-backups
#
# Instalacja: crontab -e →  15 3 * * 0 /home/n1copl/stockPulse/scripts/backup-weekly.sh
# ═══════════════════════════════════════════════════════

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
REPO_DIR="/home/n1copl/stockPulse"
BACKUP_DIR="$REPO_DIR/backups"
MEMORY_DIR="/home/n1copl/.claude/projects/-home-n1copl-stockPulse/memory"
LOG_FILE="$REPO_DIR/logs/backup-weekly.log"
STAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR" "$REPO_DIR/logs"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"; }

# 1. Baza
if docker exec stockpulse-postgres pg_dump -U stockpulse -Fc stockpulse > "$BACKUP_DIR/stockpulse_${STAMP}.dump" 2>>"$LOG_FILE"; then
  log "DB OK: stockpulse_${STAMP}.dump ($(du -h "$BACKUP_DIR/stockpulse_${STAMP}.dump" | cut -f1))"
else
  log "DB BŁĄD: pg_dump nie powiódł się"
  rm -f "$BACKUP_DIR/stockpulse_${STAMP}.dump"
fi

# 2. .env
[ -f "$REPO_DIR/.env" ] && cp "$REPO_DIR/.env" "$BACKUP_DIR/env_${STAMP}.bak" && log "ENV OK"

# 3. Pamięć projektowa Claude
[ -d "$MEMORY_DIR" ] && tar -czf "$BACKUP_DIR/claude-memory_${STAMP}.tar.gz" -C "$(dirname "$MEMORY_DIR")" memory 2>>"$LOG_FILE" && log "MEMORY OK"

# Retencja: zostaw 8 najnowszych z każdego typu
for pattern in 'stockpulse_*.dump' 'env_*.bak' 'claude-memory_*.tar.gz'; do
  ls -t $BACKUP_DIR/$pattern 2>/dev/null | tail -n +9 | xargs -r rm -f
done
log "retencja OK (8 zestawów)"
