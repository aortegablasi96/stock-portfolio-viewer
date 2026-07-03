import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'release/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Main and preload run in Node (Electron main process).
    files: ['src/main/**/*.{ts,tsx}', 'src/preload/**/*.{ts,tsx}', '*.{js,mjs,ts}'],
    languageOptions: {
      globals: { ...globals.node },
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
      // services, repositories, or Electron/Node directly (see ADR-0002).
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
                '@main',
                '@main/*',
                '**/services/**',
                '**/repositories/**',
                'electron',
              ],
              message:
                'The renderer must not import services, repositories, main, or electron directly. Communicate over the IPC bridge (window.api).',
            },
          ],
        },
      ],
    },
  },
)
