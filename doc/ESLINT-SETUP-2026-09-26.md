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

## 7. Następne kroki (do decyzji właściciela, osobne zadanie)

Spłata długu warstwami, od najtańszych mechanicznie: `perfectionist/sort-imports` (168, `--fix`),
`prefer-nullish-coalescing` (81+17, `--fix` w większości), `no-unnecessary-type-assertion` (102, `--fix`).
Reguły wymagające myślenia (`strict-boolean-expressions`, `no-unsafe-*`) najlepiej per moduł, zaczynając od
pipeline'ów sygnałowych (`src/sec-filings/pipelines/`, `src/alerts/`), bo tam błąd typu = błąd decyzji.
