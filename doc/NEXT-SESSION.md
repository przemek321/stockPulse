# Next Session — pierwsze 3 zadania (od rana 05.05.2026)

Stan zamknięcia 04.05 wieczór: Sprint 19 P0 9/12 done (FIX-01..05/07/10/10b), FIX-11 zamknięte przez FIX-10b, FIX-06 deprioritized. Pozostają FIX-08 + FIX-09. Commit HEAD: `03fc89b` (gitignore housekeeping), poprzedni `77770fb` (FIX-10b).

## Kolejność

1. **Warmup (30 min) — out-of-scope housekeeping z 04.05**:
   - `src/collectors/options-flow/options-flow.scheduler.ts` zostawione untracked świadomie — rano otwórz świeżą głową, zdecyduj czy to in-progress logika czy do `git checkout`.
   - `git stash list` — frontend WIP "collector status UI Sprint 19" czeka. Decyzja: pop + commit albo drop.
   - `frontend/package-lock.json` untracked od FOLLOW-3 23.04 — domknij decyzję tracking (commit z notą "lock file dla reproducible npm install na Jetson" albo dodaj do gitignore).

2. **Deploy lag fix (1h) — Sprint 19 P1 promoted z out-of-scope**:
   FIX-10 commit→rebuild 38h gap zaważył na walidacji. Memory feedback istnieje ale ad-hoc zawodzi. Dodaj `make ship` target: `git push && docker compose build app && docker compose up -d app`. Albo post-commit hook ostrzegający > 4h bez rebuild. Walidacja-blocking dla całej forward strategii prompt fixes.

3. **FIX-08 subsidiary executive detection (2-3h, świeża głowa potrzebna)**:
   Conway "CEO, Optum" ≠ UNH parent CEO → conviction multiplier ×0.5. Edge cases do rozstrzygnięcia ZANIM kodujesz: Optum (division), CVS Caremark (segment), Anthem→Elevance (rebrand), Roche→Genentech (subsidiary), J&J→Janssen (segment). Definicja "subsidiary executive" jest nietrywialna. Najpierw 30min na kartce: kiedy ×0.5, kiedy ×1.0, kiedy hard skip.

## NIE rób tego rano (decyzje architektoniczne — wymagają większego okna)

- **FIX-09 managed care vertical** — decyzja A (obs mode 30d, low risk) vs B (per-sector prompts w Form4PromptService). B to nowa abstrakcja wpływająca na każdy ticker. Czeka aż masz minimum 2h niezakłóconego myślenia + decision log na piśmie.
- **Backtest V6 re-run** — uzasadniony dopiero po 30d produkcji z FIX-10b (czerwiec 2026 najwcześniej).
- **TickerProfileService dimension expansion** — connected do FIX-09 decyzji A vs B.

## Forward validation kalendarz

- **Lipiec 2026 Q2 earnings season**: pierwszy real test FIX-10b (Item 2.02 z exhibit). Kryteria sukcesu w `doc/FIX-10b-VALIDATION-CRITERIA.md`.
- **Czerwiec 2026** (po 30 dni produkcji): rate `gpt_missing_data` w raporcie 8h dla 8-K Item 2.02 — powinien być <10% (vs ~100% pre-FIX-10/10b w okresie 29.04-01.05 gdy 4/4 healthcare earnings wpadły w guard).
- **FOLLOW-9 weekly report decision breakdown** — 7d okno post-04.05 (czyli 11.05+).
