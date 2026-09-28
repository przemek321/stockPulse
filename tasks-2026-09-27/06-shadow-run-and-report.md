# 06 — shadow-run na ostatnich 30 alertach z produkcji + raport

## Cel
Dowód wartości audytora PRZED budową MCP (02) i warstwy LLM (04). Wynik decyduje, czy etap 2 ma sens.

## Scope (2 pliki + raport)
- `scripts/auditor-shadow-run.ts` — jednorazowe uruchomienie orkiestratora na `alerts ORDER BY id DESC LIMIT 30`
  (niezależnie od `priceOutcomeDone`), bez CRON, `AUDITOR_ENABLED` bez znaczenia; wynik do `agent_findings` +
  stdout tabela. Uruchamiany w kontenerze: `docker exec stockpulse-app node dist/scripts/auditor-shadow-run.js`
  (sprawdzić, czy `scripts/` jest w `tsconfig.build.json` — dziś `exclude: ["scripts"]` → dodać do `include` TYLKO ten plik albo umieścić w `src/agents/cli/`).
- `doc/AUDITOR-SHADOW-RUN-2026-10-XX.md` — raport.

## Materiał (stan 28.09)
Ostatnie 30 alertów: 22 tickery, **1 delivered** (reszta observation/suppressed) — checki tekstowe działają na
`message` niezależnie od delivered. Oczekiwane trafienia na dziś (z SQL w 00-README): `ENTRY_GAP_UNENTERABLE`
~8-10/30, `POST_CLOSE_8K_ENTRY_PRICE` ~5/30, `PRICE_FROZEN` 0/30 (SEM jest starszy), `STALE_TEMPLATE_DATE` ≥1.

## Raport — obowiązkowe sekcje
1. Tabela `checkId × severity × count` + lista alertów per check.
2. **Ręczna weryfikacja każdego findingu P1** (oczekiwane <10): TRUE / FALSE_POSITIVE z uzasadnieniem; status w DB.
3. Próbka 10 findingów P2 zweryfikowana ręcznie → szacunek false-positive rate.
4. **Bugi w ścieżce decyzyjnej znalezione przy okazji** — opis, bez fixu (zasada 1 z briefu).
5. Werdykt: (a) audytor daje wartość → 02/04 po 01.11; (b) nie daje → zamknąć etap 1, zostawić tabelę i CRON off.
   Kryterium: ≥1 finding P1 TRUE, którego dziś nie wykrywamy inaczej, LUB false-positive rate P2 < 30%.

## Inwarianty
- Shadow-run NIE zmienia żadnego alertu ani `nonDeliveryReason`; NIE wysyła nic; NIE woła LLM.
- Po runie `AUDITOR_ENABLED` zostaje `false` do decyzji z raportu.

## Weryfikacja
```sql
SELECT status, count(*) FROM agent_findings GROUP BY 1;
SELECT a.id, f."checkId", f.severity FROM agent_findings f JOIN alerts a ON a.id=f."alertId" ORDER BY a.id DESC;
```
Porównanie z ręcznymi ustaleniami z werdyktów: SEM #2441 → `PRICE_FROZEN` (jeśli w oknie 30 — nie; sprawdzić
osobnym runem na id=2441), KURA/INBX/ATEC/RLMD → `ENTRY_GAP_UNENTERABLE` musi być TRUE dla wszystkich 4.

## Exit criteria
- [ ] 30 alertów zaudytowanych, raport w `doc/`, findingi P1 wszystkie z ręcznym statusem
- [ ] werdykt (a)/(b) zapisany + wpis w `KALENDARZ-WALIDACJI` (nie w VALIDATION_CALENDAR raportu 8h — to nie jest gate systemu)
- [ ] `AUDITOR_ENABLED=false` na prod do decyzji właściciela
