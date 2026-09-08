# `e2e`

**Playwright specs that launch the built app** and drive the real renderer. They exist for what a
unit test in this repo structurally cannot see.

Vitest runs under `src/` in a Node environment with **no jsdom**, so nothing there renders a
component; the renderer's logic is tested as pure modules in `renderer/src/lib/`, and several of
those "tests" are text scans over `app.css` and the components. That leaves three things only a
real browser can answer, and they are what belongs here:

- **a cascade actually resolving** — which rule wins, at what specificity, in source order;
- **a measured width, height or position** — layout, clipping, and anything derived from a font;
- **a key or a click reaching the app** — accelerators, focus movement, the tabs pattern.

## Running them

```bash
npm run test:e2e                          # builds first, then runs every spec
npx playwright test e2e/tab-navigation.spec.ts
npx playwright test -g "collapses to the rail"
```

`test:e2e` runs `npm run build` first on purpose: the specs launch `out/main/index.js`, not the
dev server, so a stale bundle silently tests the previous change.

**CI does not run these** — Playwright needs a display server, so CI runs `lint`, `typecheck`,
`test` and `build` only. Run the suite locally before opening a PR.

## How a spec is set up

Each spec launches Electron with an **isolated, empty `--user-data-dir`** under the OS temp
directory, so the SQLite database and snapshot history start clean and the run is deterministic.
No Client Portal Gateway is running, so the app resolves to its `not_connected` state and
capture-on-open is skipped — the live views are exercised in *that* state, and the Flex-backed
views against whatever the spec imports.

Playwright is configured `fullyParallel: false` with `workers: 1`: the app takes a
single-instance lock, so two of them cannot run at once. The lock is scoped to the user-data
directory, which is what lets the suite's own app start beside a running one.

**A failure restarts the worker**, and `beforeAll` then relaunches with a *fresh* temp directory.
Later failures in the same file therefore look like data loss when they are really a consequence
of the first one — **fix the first failure before reading the rest**.

## A note on the view list

Several specs enumerate the sidebar's views. Adding, removing or renaming one is a **list edit across
every one of them** — that redundancy is deliberate, because each spec asserts something different about
the list.
