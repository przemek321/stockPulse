// ESLint 9 flat config — backend NestJS (dodany 26.09.2026).
// Tryb STRICT type-checked: strictTypeChecked + stylisticTypeChecked (typescript-eslint 8),
// projectService (tsconfig.eslint.json obejmuje src/ + test/), perfectionist sort-imports,
// eslint-config-prettier na końcu. Dług istniejący jest w baseline (eslint-suppressions.json);
// nowe błędy blokują `npm run lint`. Czyszczenie baseline: `npm run lint:baseline-prune`.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import perfectionist from 'eslint-plugin-perfectionist';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'frontend/**', 'scripts/**', 'coverage/**', 'backups/**', 'logs/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // projectService domyślnie bierze najbliższy tsconfig.json (wyklucza test/) — dlatego
        // testy lintujemy z jawnie wskazanym tsconfig.eslint.json (src + test).
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { perfectionist },
    rules: {
      // Reguły wymagane na `error` niezależnie od presetu
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-enum-comparison': 'error',
      '@typescript-eslint/no-unsafe-unary-minus': 'error',
      '@typescript-eslint/no-unsafe-declaration-merging': 'error',
      '@typescript-eslint/no-unsafe-function-type': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/strict-boolean-expressions': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      'perfectionist/sort-imports': ['error', { type: 'natural', newlinesBetween: 'ignore' }],
    },
  },
  {
    // Testy: złagodzone WYŁĄCZNIE no-unsafe-* i no-explicit-any (mocki `as any`) — nic więcej.
    files: ['test/**/*.spec.ts', 'test/**/*.e2e-spec.ts', 'src/**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    files: ['jest.config.js', 'eslint.config.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
