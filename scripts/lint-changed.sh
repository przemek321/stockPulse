#!/usr/bin/env bash
# Lint pojedynczego pliku BEZ baseline suppressions (27.09.2026, przegląd ESLint).
# Baseline liczy błędy per plik/reguła — naprawisz jeden no-unsafe-*, dodasz nowy, bilans zero, lint zielony.
# Ten skrypt pokazuje WSZYSTKIE błędy w pliku, który właśnie dotykasz. Używany przez hook PostToolUse
# (Edit/Write) w .claude/settings.json; ręcznie: scripts/lint-changed.sh <plik>.
# Exit 0 zawsze (informacyjny — nie blokuje edycji), wynik na stdout.
set -u
REPO_DIR="/home/n1copl/stockPulse"
FILE="${1:-}"
[ -z "$FILE" ] && { echo "użycie: lint-changed.sh <plik.ts|.tsx>"; exit 0; }
case "$FILE" in *.ts|*.tsx|*.mts|*.cts) ;; *) exit 0 ;; esac
[ -f "$FILE" ] || exit 0
EMPTY=$(mktemp); echo '{}' > "$EMPTY"
if [[ "$FILE" == "$REPO_DIR/frontend/"* || "$FILE" == frontend/* ]]; then
  cd "$REPO_DIR/frontend" && REL="${FILE#"$REPO_DIR/frontend/"}"
else
  cd "$REPO_DIR" && REL="${FILE#"$REPO_DIR/"}"
fi
OUT=$(npx eslint "$REL" --suppressions-location "$EMPTY" --format stylish 2>/dev/null)
rm -f "$EMPTY"
if [ -n "$OUT" ]; then
  echo "ESLint (pełny, bez baseline) — $REL:"; echo "$OUT" | tail -n +1 | head -60
else
  echo "ESLint (pełny, bez baseline) — $REL: czysto"
fi
exit 0
