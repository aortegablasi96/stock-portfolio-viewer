import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default tseslint.config(
  // `docs/figma_design/` is the Figma Make export Epic #179 adopts the *design* of — a
  // React 19 + Tailwind v4 scaffold with its own package.json, read as a specification and
  // never built here. It is untracked and the owner deletes it once M5 lands; linting a
  // vendored prototype fails eight ways and blocks `npm run lint` for every story in the
  // milestone.
  { ignores: ['out/**', 'dist/**', 'release/**', 'node_modules/**', 'docs/figma_design/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Main and preload run in Node (Electron main process); so do the repo's own tooling
    // scripts, including the screenshot driver the `run-app` skill invokes.
    files: [
      'src/main/**/*.{ts,tsx}',
      'src/preload/**/*.{ts,tsx}',
      '*.{js,mjs,ts}',
      '.claude/skills/**/*.mjs',
      'build/**/*.mjs',
    ],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // Playwright E2E runs in Node; its page.evaluate callbacks touch window.
    files: ['e2e/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    // Renderer runs in the browser (Electron renderer process).
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      // Enforce the downward-only dependency rule: the renderer may only reach
      // the main process over the IPC bridge (window.api), never by importing
      // services, repositories, the database, or Electron/Node directly
      // (see ADR-0002 / ADR-0003).
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@services',
                '@services/*',
                '@repositories',
                '@repositories/*',
                '@db',
                '@db/*',
                '@main',
                '@main/*',
                '**/services/**',
                '**/repositories/**',
                '**/db/**',
                'electron',
              ],
              message:
                'The renderer must not import services, repositories, the database, main, or electron directly. Communicate over the IPC bridge (window.api).',
            },
          ],
        },
      ],
    },
  },
  {
    // Services hold pure business logic: they may use repositories, but must not
    // reach the database directly or depend on Electron/main (see ADR-0003).
    files: ['src/services/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@db', '@db/*', '**/db/**', '@main', '@main/*', 'electron'],
              message:
                'Services must not access the database or Electron directly. Go through a repository (@repositories/*).',
            },
          ],
        },
      ],
    },
  },
)
