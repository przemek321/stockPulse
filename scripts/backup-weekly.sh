#!/bin/bash
# ═══════════════════════════════════════════════════════
# StockPulse — cotygodniowy backup (cron, niedziela 03:15)
#
# Zabezpiecza WSZYSTKO, czego nie ma w git:
#   1. baza PostgreSQL (pg_dump -Fc)      → stockpulse_<data>.dump
#   2. .env (klucze API, token Telegram)  → env_<data>.bak
#   3. pamięć projektowa Claude           → claude-memory_<data>.tar.gz
#   4. dane backtestu (CSV Form 4 + ceny) → backtest-data_<data>.tar.gz
#      (08.11.2026: przy migracji Jetson → Pi zginęły — są poza gitem, a ich ponowne pobranie trwa godziny)
# Retencja: 8 ostatnich zestawów (~2 miesiące).
#
# Off-site: zestaw pakowany w tar.gz, szyfrowany AES-256 (hasło:
# ~/.stockpulse-backup-pass — ZAPISZ JE POZA SERWEREM!) i wysyłany
# botem na Telegram (limit 50 MB). Baza + .env + pamięć idą zawsze; dane
# backtestu tylko, gdy zestaw mieści się w 45 MB (inaczej zostają lokalnie).
# Odzysk po padzie serwera:
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

# 3b. Dane backtestu (gitignored: form4_transactions*.csv, prices/, prices_ohlc/, cik_map.json, …)
BT_DATA="$REPO_DIR/scripts/backtest/data"
[ -d "$BT_DATA" ] && tar -czf "$BACKUP_DIR/backtest-data_${STAMP}.tar.gz" -C "$REPO_DIR/scripts/backtest" data 2>>"$LOG_FILE" \
  && log "BACKTEST DATA OK: backtest-data_${STAMP}.tar.gz ($(du -h "$BACKUP_DIR/backtest-data_${STAMP}.tar.gz" | cut -f1))"

# 4. Off-site: zaszyfrowany bundle na Telegram (caption jawnie mówi, że to NIE sygnał)
PASS_FILE="/home/n1copl/.stockpulse-backup-pass"
TG_TOKEN=$(grep -E '^TELEGRAM_BOT_TOKEN=' "$REPO_DIR/.env" | cut -d= -f2-)
TG_CHAT=$(grep -E '^TELEGRAM_CHAT_ID=' "$REPO_DIR/.env" | cut -d= -f2-)
if [ -s "$PASS_FILE" ] && [ -n "$TG_TOKEN" ] && [ -n "$TG_CHAT" ]; then
  BUNDLE="$BACKUP_DIR/stockpulse-offsite_${STAMP}.tar.gz.enc"
  LIMIT_B=47185920  # 45 MB — margines pod limit bota 50 MB
  SET_FILES=""
  SET_B=0
  for f in "stockpulse_${STAMP}.dump" "env_${STAMP}.bak" "claude-memory_${STAMP}.tar.gz"; do
    [ -f "$BACKUP_DIR/$f" ] && SET_FILES="$SET_FILES $f" && SET_B=$((SET_B + $(stat -c%s "$BACKUP_DIR/$f")))
  done
  # Dane backtestu dokładamy off-site tylko wtedy, gdy cały zestaw zmieści się w limicie (pliki są już
  # skompresowane, więc bundle ≈ suma rozmiarów; 1 MB zapasu). Inaczej zostają w lokalnym backtest-data_*.tar.gz,
  # a baza + .env + pamięć idą ZAWSZE. (08.11.2026: bundle 48 MB z danymi backtestu = pominięty CAŁY off-site, z bazą.)
  CONTENT="baza + .env + pamięć"
  BT_FILE="backtest-data_${STAMP}.tar.gz"
  if [ -f "$BACKUP_DIR/$BT_FILE" ]; then
    if [ $((SET_B + $(stat -c%s "$BACKUP_DIR/$BT_FILE"))) -le $((LIMIT_B - 1048576)) ]; then
      SET_FILES="$SET_FILES $BT_FILE"
      CONTENT="$CONTENT + dane backtestu"
    else
      log "OFF-SITE: dane backtestu ($(du -h "$BACKUP_DIR/$BT_FILE" | cut -f1)) nie mieszczą się w limicie — zostają lokalnie"
    fi
  fi
  # pipefail w podpowłoce: błąd tar-a też ma oblać pakowanie (bez tego liczył się tylko kod openssl)
  # shellcheck disable=SC2086
  if [ -n "$SET_FILES" ] && ( set -o pipefail; tar -czf - -C "$BACKUP_DIR" $SET_FILES 2>>"$LOG_FILE" \
      | openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:$PASS_FILE" -out "$BUNDLE" 2>>"$LOG_FILE" ); then
    SIZE_B=$(stat -c%s "$BUNDLE")
    if [ "$SIZE_B" -gt "$LIMIT_B" ]; then
      log "TELEGRAM POMINIĘTY: bundle $(du -h "$BUNDLE" | cut -f1) przekracza 45 MB"
    else
      RESP=$(mktemp)
      HTTP=$(curl -s -m 120 -o "$RESP" -w '%{http_code}' \
        -F chat_id="$TG_CHAT" \
        -F document=@"$BUNDLE" \
        -F caption="💾 Backup tygodniowy StockPulse (${STAMP}) — to NIE sygnał. Kopia off-site: ${CONTENT}. Odzysk: openssl enc -d -aes-256-cbc -pbkdf2 -in <plik> | tar -xz (hasło z Twoich notatek)" \
        "https://api.telegram.org/bot${TG_TOKEN}/sendDocument")
      if [ "$HTTP" = "200" ]; then
        log "TELEGRAM OK: $(basename "$BUNDLE") ($(du -h "$BUNDLE" | cut -f1); ${CONTENT})"
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
for pattern in 'stockpulse_*.dump' 'env_*.bak' 'claude-memory_*.tar.gz' 'backtest-data_*.tar.gz'; do
  ls -t $BACKUP_DIR/$pattern 2>/dev/null | tail -n +9 | xargs -r rm -f
done
log "retencja OK (8 zestawów)"
