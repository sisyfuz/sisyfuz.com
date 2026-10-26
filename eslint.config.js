import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

const nodeFiles = [
  'scripts/**/*.js',
  'worker/**/*.js',
  'test/**/*.js',
  'vite.config.js',
  '*.config.js',
  'design/**/*.js',
]

export default defineConfig([
  globalIgnores(['dist/', 'node_modules/', 'scripts/companion/', '.claude/']),
  {
    files: ['**/*.{js,jsx}'],
    ignores: nodeFiles,
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      // Best-effort `catch {}` (socket sends, cleanup) is an intentional idiom here
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: nodeFiles,
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      // Best-effort `catch {}` (socket sends, cleanup) is an intentional idiom here
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // The Tailwind design preset is a CommonJS module.
    files: ['design/**/*.js'],
    languageOptions: { sourceType: 'commonjs' },
  },
])
