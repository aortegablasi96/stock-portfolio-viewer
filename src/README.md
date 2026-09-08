# `src`

All application code, split by **process** and by **layer**. The split is not a convention —
ESLint enforces it (`eslint.config.mjs`, ADR-0002/0003), so a violating import fails `npm run
lint` rather than being noticed in review.

```text
renderer → IPC → main → services → repositories → SQLite / IBKR Gateway / OpenAI
```

| Directory | Covers |
| --- | --- |
| [`main/`](main) | the Electron main process — startup, the window, and thin IPC handlers |
| [`preload/`](preload) | the typed `contextBridge` bridge, the renderer's only door out |
| [`renderer/`](renderer) | the React UI, its pure logic, and the design tokens |
| [`services/`](services) | business logic, one directory per domain; the only place currency conversion happens |
| [`repositories/`](repositories) | the only layer that touches a data source |
| [`db/`](db) | the Drizzle client, the schema, and the migration runner |
| [`shared/`](shared) | what both processes agree on: the IPC contract, domain types, formatting |

## The rules that hold across all of it

- **The renderer may not import** `@services`, `@repositories`, `@db`, `@main` or `electron`.
  **Services may not import** `@db` or `electron` — a service that needs Electron takes the value
  as a parameter or a callback instead.
- **Repositories are the only layer touching a data source.** Services never know where data
  came from.
- **Base-currency conversion happens in the service** — never in a repository, never in the
  renderer.
- **Failures cross IPC as result variants, not exceptions** (`not_connected`, `not_responding`,
  `needs_import`, `canceled`, `invalid`, `error`). Success is not uniformly `ok`: capture returns
  `captured`, import `imported`, a profile save `saved`, every clear `cleared`.
- **Path aliases live in three files that must stay in sync**: `tsconfig.json`,
  `electron.vite.config.ts`, `vitest.config.ts`.

`claudeMdBudget.test.ts` sits here rather than in a domain directory: it has no module under test
and pins the size of `CLAUDE.md`, which is loaded into every session before any work starts.

Tests live beside their module as `*.test.ts`. See the root `README.md` for how the suite is
shaped by running without jsdom.
