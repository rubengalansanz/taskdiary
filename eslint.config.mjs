import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import security from 'eslint-plugin-security'
import prettier from 'eslint-config-prettier/flat'
import globals from 'globals'

/**
 * Phase 0 lint stack, pinned by the plan's version matrix (§8.1).
 *
 * `eslint-plugin-react` is deliberately absent: its stable peer range stops at
 * `eslint ^9.7` and cannot install against `eslint@10` (plan §8.1, conflict C).
 * `typescript-eslint` plus the hooks/refresh plugins cover TSX adequately.
 */
export default defineConfig(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'out/**',
      'release/**',
      'coverage/**',
      'test-results/**'
    ]
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked, security.configs.recommended, prettier],
    languageOptions: {
      parserOptions: {
        // The root `tsconfig.json` only holds project references with `files: []`, so
        // `projectService` would resolve every file against an empty program and the
        // type-aware rules would see `any` everywhere. Point at the real projects.
        project: ['./tsconfig.node.json', './tsconfig.web.json'],
        tsconfigRootDir: import.meta.dirname
      },
      globals: {
        ...globals.node
      }
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      // The plan requires explicit, honest error handling at the IPC boundary.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // `security/detect-object-injection` produces false noise on typed access.
      'security/detect-object-injection': 'off'
    }
  },
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node
      }
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser
      },
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.web.json'],
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    rules: {
      ...reactHooks.configs.flat['recommended-latest'].rules,
      ...reactRefresh.configs.vite.rules
    }
  },
  {
    // shadcn/ui primitives legitimately export a variant helper next to the
    // component; Fase 2 will import more of them from the registry.
    files: ['src/renderer/src/components/ui/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off'
    }
  }
)
