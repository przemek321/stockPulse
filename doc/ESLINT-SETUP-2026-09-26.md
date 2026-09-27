# ESLint — konfiguracja strict type-checked (26.09.2026)

> Cel: linter, który wyłapuje **błędy typów i logiki**, nie styl. Istniejący dług trafił do baseline
> (`eslint-suppressions.json`) — `npm run lint` blokuje wyłącznie **nowe** błędy, więc nadaje się do CI od razu.
> Zero zmian w kodzie źródłowym w tym zadaniu. Commit: `d1c6243`.

## 1. Co zostało zrobione

| Krok | Backend (NestJS) | Frontend (React 18 / Vite 4) |
|---|---|---|
| Config | `eslint.config.mjs` (flat, ESLint 9) | `frontend/eslint.config.mjs` |
| Presety | `strictTypeChecked` + `stylisticTypeChecked` | j.w. |
| Zakres typów | `tsconfig.eslint.json` (src + test) | `tsconfig.json` (src) + `allowDefaultProject` dla `vite.config.ts` |
| Dodatki | perfectionist `sort-imports`, `eslint-config-prettier` (na końcu) | `@eslint-react` (react-x + react-dom), `react-hooks`, `react-refresh` |
| Testy | `*.spec.ts` / `*.e2e-spec.ts`: złagodzone **tylko** `no-unsafe-*` + `no-explicit-any` | brak testów FE |
| Baseline | `eslint-suppressions.json` — 129 plików | `frontend/eslint-suppressions.json` — 17 plików |
| Skrypty | `lint`, `lint:fix`, `lint:baseline-prune` | j.w. (z `--suppressions-location ./eslint-suppressions.json`) |

Reguły wymuszone na `error` niezależnie od presetu (obie części): `no-floating-promises`, `no-misused-promises`,
`no-unnecessary-condition`, `switch-exhaustiveness-check`, cała rodzina `no-unsafe-*` (argument / assignment /
call / member-access / return / enum-comparison / unary-minus / declaration-merging / function-type),
`no-explicit-any`, `strict-boolean-expressions`, `prefer-nullish-coalescing`, `no-non-null-assertion`.

## 2. Wersje

| Pakiet | Backend | Frontend |
|---|---|---|
| eslint | 9.39.5 | 9.39.5 |
| typescript-eslint | 8.70.1 | 8.70.1 |
| @eslint/js | 9.39.5 | 9.39.5 |
| typescript (istniejący) | 5.9.3 | 4.9.5 |
| eslint-plugin-perfectionist | 5.12.1 | — |
| eslint-config-prettier | 10.1.8 | — |
| @eslint-react/eslint-plugin | — | 5.20.8 |
| eslint-plugin-react-hooks | — | 7.1.1 |
| eslint-plugin-react-refresh | — | 0.5.7 |

Pin na ESLint 9 (nie 10): `@eslint/js@10` wymaga `eslint@^10`, a bez pinu npm próbował mieszać wersje
(konflikt peer-deps przy pierwszej instalacji).

## 3. Wynik pierwszego przelotu (stan baseline)

### Backend — 1768 błędów, 0 warningów, w 129/165 plikach

| # | Reguła | % |
|---|---|---|
| 260 | `strict-boolean-expressions` | 14.7 |
| 255 | `no-unsafe-member-access` | 14.4 |
| 237 | `restrict-template-expressions` | 13.4 |
| 168 | `perfectionist/sort-imports` | 9.5 |
| 144 | `no-unsafe-assignment` | 8.1 |
| 116 | `require-await` | 6.6 |
| 102 | `no-unnecessary-type-assertion` | 5.8 |
| 81 | `prefer-nullish-coalescing` | 4.6 |
| 51 | `no-unnecessary-type-conversion` | 2.9 |
| 50 | `no-non-null-assertion` | 2.8 |
| 49 | `no-explicit-any` | 2.8 |
| 33 | `no-unsafe-call` | 1.9 |
| 32 | `no-unnecessary-condition` | 1.8 |
| 31 | `no-unsafe-argument` | 1.8 |
| 24 | `no-unused-vars` | 1.4 |

### Frontend — 491 błędów + 8 warningów, w 17/18 plikach

| # | Reguła | % |
|---|---|---|
| 78 | `strict-boolean-expressions` | 15.6 |
| 77 | `no-unsafe-member-access` | 15.4 |
| 46 | `restrict-template-expressions` | 9.2 |
| 39 | `no-confusing-void-expression` | 7.8 |
| 37 | `no-explicit-any` | 7.4 |
| 33 | `no-unsafe-assignment` | 6.6 |
| 26 | `@eslint-react/static-components` | 5.2 |
| 17 | `prefer-nullish-coalescing` | 3.4 |
| 17 | `@eslint-react/no-missing-key` | 3.4 |
| 14 | `no-unsafe-argument` | 2.8 |
| 13 | `no-unnecessary-condition` | 2.6 |
| 13 | `react-hooks/static-components` | 2.6 |
| 12 | `no-unnecessary-type-conversion` | 2.4 |
| 12 | `no-misused-promises` | 2.4 |
| 11 | `no-unsafe-return` | 2.2 |

**Próg 30 %**: żadna pojedyncza reguła go nie przekracza (max 14.7 % BE, 15.6 % FE). Rodzina `no-unsafe-*`
łącznie: 481 (27 %) BE, 135 (27 %) FE — również poniżej. 8 warningów FE to `react-refresh/only-export-components`.

## 4. Dwie decyzje podjęte bez wzorca (RBAC nie istnieje na tym hoście)

1. **Backend: `project` zamiast `projectService`.** `projectService: true` bierze najbliższy `tsconfig.json`,
   a ten wyklucza `test/` → 46 błędów parsera („not found by the project service"). Rozwiązanie: nowy
   `tsconfig.eslint.json` (rozszerza główny, dodaje `test/**`) wskazany jawnie przez
   `parserOptions.project`. Plik służy **tylko** linterowi — `tsc --noEmit`, build i Jest nietknięte.
2. **Frontend: `--suppressions-location`.** ESLint zapisuje i czyta baseline względem korzenia repo, więc
   `--suppress-all` uruchomiony w `frontend/` nadpisywał baseline backendu. Flaga jest wpisana do wszystkich
   trzech skryptów FE.

## 5. Jak używać

```bash
npm run lint                  # 0 nowych błędów = exit 0 (istniejące w baseline); w frontend/ analogicznie
npm run lint:fix              # auto-fix tego, co da się naprawić mechanicznie (sort-imports, ??, itp.)
npm run lint:baseline-prune   # po naprawie długu: usuwa z baseline wpisy, które już nie występują
```

- Naprawiony błąd znika z baseline dopiero po `lint:baseline-prune` — bez tego suppressions „wiszą" nieszkodliwie.
- Nowy błąd tej samej reguły w tym samym pliku **nie** jest tłumiony (baseline liczy wystąpienia per plik/reguła —
  przekroczenie licznika = błąd).
- Weryfikacja końcowa 26.09: `npm run lint` exit 0 (BE i FE), `tsc --noEmit` OK (BE i FE), `vite build` OK,
  Jest 726/726.

## 6. Czego celowo NIE zrobiono

- Nie wyłączono ani nie obniżono żadnej reguły, żeby lint „przeszedł" — czerwony pierwszy przelot był oczekiwany.
- Nie dodano `eslint-disable` w kodzie. Nie naprawiono kodu (27 mechanicznych poprawek z wcześniejszej próby
  na presecie `recommended` zostało **wycofanych**).
- Nie zainstalowano niczego spoza listy (w szczególności `eslint-plugin-import`).
- Surowe raporty `lint-baseline.json` (BE 1.7 MB, FE 0.4 MB) są w `.gitignore` — regenerowalne jednym poleceniem.

## 7a. Spłata długu — wykonana 27.09.2026 (11 commitów, `98ded99..db87781`)

Kolejność ustalona przez właściciela po recenzji: **(a) → (e) → (b) → (c) → (d) → (f)**. Każdy krok = osobny commit
z pełną weryfikacją (tsc → jest 726 → lint pełny „żadna reguła nie może wzrosnąć" → rebuild → logi produkcji;
dla (f) dodatkowo A/B na prawdziwych filingach SEC i porównanie kształtu odpowiedzi API).

| Krok | Commit | Co | Wynik |
|---|---|---|---|
| (a) | `98ded99` | `restrict-template` kalibracja (allowNumber/Boolean), 32 fallbacki `null`/`undefined`, `bootstrap().catch`, CI, hook `lint-changed` | BE 1768→1530, FE 499→445 |
| (e) | `7cc2adc` | `strict: true` BE — 159 pól encji `!`, `errMsg()`/`errCode()` dla 23 `catch(unknown)` | tsc 183→0 |
| (b) | `7df258c` | auto-fix reguł kosmetycznych (sort-imports, zbędne asercje, `Array<T>`→`T[]`, `.match`→`.exec`); nullish celowo nie | BE →1194, FE →400 |
| (c) | `8a97396` | TS 4.9→5.9 na froncie, `moduleResolution: bundler` | lint bez zmian |
| (d) | `8b64446` | 3 komponenty wewnętrzne wyniesione (koniec remountu), 22 async z `void`/`catch` | FE →343 |
| CI | `eb3e73f` | `vite.config.ts` bez type-checku (brak `@types/node` w `npm ci`); prune | CI FE zielone |
| (f1) | `d76d850` | parser Form 4 + pipeline 8-K: typy XML/JSON zamiast `any` (99→0) | 2× SAFE; A/B 7 filingów 7/7 |
| (f2) | `7a7ddaf` | pipeline Form 4, dekorator `@Logged`, 2 kontrolery, Finnhub, SEC (292→0) | 6× SAFE; API 5/5 identyczne |
| (f3) | `db87781` | 8 plików niekrytycznych (133→0); **1× UNSAFE poprawione** (reddit) | 7 SAFE + fix; API 5/5 |

**Bilans: backend 1768 → 594 (−66 %), frontend 499 → 332 (−33 %).** Zero wyłączonych reguł, zero `eslint-disable`.
Pozostały dług (w baseline, decyzją właściciela): `strict-boolean-expressions` 187 BE / 79 FE, `prefer-nullish-coalescing`
54 / 17, `require-await` 116, plus 16 `no-unsafe-*` w 9 małych plikach. Rozkład reguł FE bez zmian od (d):
`no-unsafe-*` 122 (z `any` w `api.ts`/DataPanel), `no-missing-key` 17.

**Dwie lekcje z tego dnia:**
1. **Recenzja adwersarialna złapała realną regresję**, której implementer nie widział: w `reddit.service` zamiana
   `any` na guard z `throw` zmieniała kontrakt kolektora (cykl SUCCESS/0 → FAILED + retry BullMQ + health degraded).
   Poprawka: odtworzyć dawny stan „brak tokenu" zamiast rzucać. Sam typ był poprawny — zmieniło się *zachowanie*.
2. **ESLint 9.39 traktuje nieużyte wpisy baseline jako błąd (exit 2)** — po każdym spadku długu trzeba
   regenerować `eslint-suppressions.json`, inaczej CI jest czerwone mimo zielonego lintu lokalnie (weryfikowanego
   z pustym plikiem suppressions). Dwa czerwone runy z tego powodu; od teraz przed pushem: symulacja
   `git archive | tar` + `npm ci` + `npm run lint`.

## 7. Następne kroki (do decyzji właściciela, osobne zadanie)

Spłata długu warstwami, od najtańszych mechanicznie: `perfectionist/sort-imports` (168, `--fix`),
`prefer-nullish-coalescing` (81+17, `--fix` w większości), `no-unnecessary-type-assertion` (102, `--fix`).
Reguły wymagające myślenia (`strict-boolean-expressions`, `no-unsafe-*`) najlepiej per moduł, zaczynając od
pipeline'ów sygnałowych (`src/sec-filings/pipelines/`, `src/alerts/`), bo tam błąd typu = błąd decyzji.
