// Relay ESLint flat config.
// Layering (docs/01-architecture.md §3, Q14) is enforced with `no-restricted-imports` per path:
//   apps/web ─► core/services ─► core/domain (pure)
//   core/jobs ─► core/repos ─► packages/db ; core/integrations
//   contracts ◄── everyone (types/schemas only, no server deps)
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';
import relay from './tools/eslint-plugin-relay/index.mjs';

const FRAMEWORK = [
  { group: ['next', 'next/*'], message: 'Only apps/web may import Next.js (01 §3).' },
  {
    group: ['react', 'react/*', 'react-dom', 'react-dom/*'],
    message: 'Only apps/web may import React (01 §3).',
  },
];
const DB_LAYER = [
  {
    group: ['@relay/db', '@relay/db/*', 'pg', 'drizzle-orm', 'drizzle-orm/*'],
    message: 'Database access belongs in core/repos via a Tx, called from services/jobs (01 §3).',
  },
];
const CORE = [
  { group: ['@relay/core', '@relay/core/*'], message: 'This layer must not depend on @relay/core (01 §3).' },
];
const WEB = [
  { group: ['@relay/web', '@relay/web/*', '@/*'], message: 'Packages must not depend on apps/web.' },
];
const NODE_BUILTINS = [
  {
    group: ['node:*', 'fs', 'path', 'crypto', 'child_process', 'net', 'http', 'https'],
    message: 'contracts is shared with the browser: no Node built-ins.',
  },
];

/** Merge pattern groups into one rule entry (a later override replaces, not merges, the rule). */
const restrict = (...groups) => ['error', { patterns: groups.flat() }];

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/coverage/**',
      'playwright-report/**',
      'test-results/**',
      'reports/**',
      'packages/db/drizzle/**',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'dangerouslySetInnerHTML is banned (06 §4).',
        },
      ],
    },
  },

  // ── apps/web ────────────────────────────────────────────────────────────
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin, 'react-hooks': reactHooks },
    settings: { next: { rootDir: 'apps/web/' } },
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactHooks.configs.recommended.rules,
      // Route handlers stay thin: they call ONE service, never the DB or repos directly.
      'no-restricted-imports': restrict(DB_LAYER, [
        {
          group: ['@relay/core/repos', '@relay/core/repos/*'],
          message: 'apps/web calls services, never repos (01 §3).',
        },
      ]),
    },
  },

  // ── apps/web UI rules (Lane D, T-005/T-012): i18n, logical properties, tokens only ───────────
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    ignores: ['apps/web/**/*.test.{ts,tsx}', 'apps/web/**/*.d.ts'],
    plugins: { relay },
    rules: {
      'relay/no-physical-direction': 'error',
      'relay/no-raw-colors': 'error',
    },
  },
  {
    files: ['apps/web/**/*.tsx'],
    ignores: ['apps/web/**/*.test.tsx'],
    plugins: { relay },
    rules: { 'relay/no-literal-jsx-strings': 'error' },
  },

  // ── packages/contracts: types + Zod only ─────────────────────────────────
  {
    files: ['packages/contracts/**/*.ts'],
    rules: { 'no-restricted-imports': restrict(FRAMEWORK, DB_LAYER, CORE, WEB, NODE_BUILTINS) },
  },

  // ── packages/db: no business logic ───────────────────────────────────────
  {
    files: ['packages/db/**/*.ts'],
    rules: { 'no-restricted-imports': restrict(FRAMEWORK, CORE, WEB) },
  },

  // ── packages/core (default) ──────────────────────────────────────────────
  {
    files: ['packages/core/**/*.ts'],
    rules: { 'no-restricted-imports': restrict(FRAMEWORK, WEB) },
  },
  // core/domain: pure. No I/O, no services/repos/jobs/integrations, no wall clock.
  {
    files: ['packages/core/src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': restrict(FRAMEWORK, WEB, DB_LAYER, [
        {
          group: [
            '**/services',
            '**/services/*',
            '**/repos',
            '**/repos/*',
            '**/jobs',
            '**/jobs/*',
            '**/integrations',
            '**/integrations/*',
            '**/config',
            '**/clock',
          ],
          message: 'core/domain is pure: receive data and `now` as arguments (01 §3).',
        },
        {
          group: ['node:*', 'fs', 'child_process', 'net', 'http', 'https'],
          message: 'core/domain is pure: no I/O.',
        },
      ]),
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'core/domain receives `now`; never read the clock (01 §3).',
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'core/domain receives `now`; never read the clock (01 §3).',
        },
      ],
    },
  },
  // core/repos: take `tx: Tx`, never grab the pool/db themselves (06 §3).
  {
    files: ['packages/core/src/repos/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...FRAMEWORK,
            ...WEB,
            { group: ['**/services', '**/services/*'], message: 'repos must not call services.' },
          ],
          paths: [
            {
              name: '@relay/db',
              importNames: ['getDb', 'getPool', 'withWorkspaceTx', 'withSystemTx'],
              message: 'repos receive `tx: Tx`; services open transactions (06 §3).',
            },
            {
              name: '@relay/db/client',
              message: 'repos receive `tx: Tx`; services open transactions (06 §3).',
            },
          ],
        },
      ],
    },
  },

  // Tests and tooling may reach across layers (e.g. owner connections in RLS tests).
  {
    files: [
      '**/*.test.ts',
      '**/test/**/*.ts',
      'tests/**/*.ts',
      'scripts/**/*.ts',
      '*.config.{ts,mjs}',
      'packages/*/scripts/**/*.ts',
    ],
    rules: { 'no-restricted-imports': 'off' },
  },
  prettier,
);
