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
# Off-site: zestaw pakowany w tar.gz, szyfrowany AES-256 (hasło:
# ~/.stockpulse-backup-pass — ZAPISZ JE POZA SERWEREM!) i wysyłany
# botem na Telegram (limit 50 MB). Odzysk po padzie serwera:
#   openssl enc -d -aes-256-cbc -pbkdf2 -in <plik.enc> | tar -xz
# Fallback ręczny z laptopa: scp -r jetson:~/stockPulse/backups ~/stockpulse-backups
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

# 4. Off-site: zaszyfrowany bundle na Telegram (caption jawnie mówi, że to NIE sygnał)
PASS_FILE="/home/n1copl/.stockpulse-backup-pass"
TG_TOKEN=$(grep -E '^TELEGRAM_BOT_TOKEN=' "$REPO_DIR/.env" | cut -d= -f2-)
TG_CHAT=$(grep -E '^TELEGRAM_CHAT_ID=' "$REPO_DIR/.env" | cut -d= -f2-)
if [ -s "$PASS_FILE" ] && [ -n "$TG_TOKEN" ] && [ -n "$TG_CHAT" ]; then
  BUNDLE="$BACKUP_DIR/stockpulse-offsite_${STAMP}.tar.gz.enc"
  SET_FILES=""
  for f in "stockpulse_${STAMP}.dump" "env_${STAMP}.bak" "claude-memory_${STAMP}.tar.gz"; do
    [ -f "$BACKUP_DIR/$f" ] && SET_FILES="$SET_FILES $f"
  done
  if [ -n "$SET_FILES" ] && tar -czf - -C "$BACKUP_DIR" $SET_FILES 2>>"$LOG_FILE" \
      | openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:$PASS_FILE" -out "$BUNDLE" 2>>"$LOG_FILE"; then
    SIZE_B=$(stat -c%s "$BUNDLE")
    if [ "$SIZE_B" -gt 47185920 ]; then  # 45 MB — margines pod limit bota 50 MB
      log "TELEGRAM POMINIĘTY: bundle $(du -h "$BUNDLE" | cut -f1) przekracza 45 MB"
    else
      RESP=$(mktemp)
      HTTP=$(curl -s -m 120 -o "$RESP" -w '%{http_code}' \
        -F chat_id="$TG_CHAT" \
        -F document=@"$BUNDLE" \
        -F caption="💾 Backup tygodniowy StockPulse (${STAMP}) — to NIE sygnał. Kopia off-site: baza + .env + pamięć. Odzysk: openssl enc -d -aes-256-cbc -pbkdf2 -in <plik> | tar -xz (hasło z Twoich notatek)" \
        "https://api.telegram.org/bot${TG_TOKEN}/sendDocument")
      if [ "$HTTP" = "200" ]; then
        log "TELEGRAM OK: $(basename "$BUNDLE") ($(du -h "$BUNDLE" | cut -f1))"
      else
        log "TELEGRAM BŁĄD: HTTP $HTTP $(head -c 300 "$RESP")"
      fi
      rm -f "$RESP"
    fi
  else
    log "TELEGRAM BŁĄD: pakowanie/szyfrowanie bundle nie powiodło się"
  fi
  rm -f "$BUNDLE"
else
  log "TELEGRAM POMINIĘTY: brak hasła ($PASS_FILE) lub tokenów w .env"
fi

# Retencja: zostaw 8 najnowszych z każdego typu
for pattern in 'stockpulse_*.dump' 'env_*.bak' 'claude-memory_*.tar.gz'; do
  ls -t $BACKUP_DIR/$pattern 2>/dev/null | tail -n +9 | xargs -r rm -f
done
log "retencja OK (8 zestawów)"
