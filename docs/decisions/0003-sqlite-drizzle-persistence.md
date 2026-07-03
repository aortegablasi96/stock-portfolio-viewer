# 0003. Local persistence: SQLite (better-sqlite3) + Drizzle ORM, migrate-on-launch

- **Status:** Accepted
- **Date:** 2026-07-03

## Context

Stock Portfolio Viewer is local-first: historical snapshots and cached analytics need
durable, private storage on the owner's machine (see `CLAUDE.md`, `docs/database.md`). The
stack already names SQLite via Drizzle ORM. Story #11 (Epic M0) wires this up before any real
schema exists, so a driver, a migration workflow, a database location, and the layer that is
allowed to touch the database all need to be fixed as durable conventions.

## Decision

- **Driver:** `better-sqlite3` — synchronous, fast, and the standard choice for SQLite in an
  Electron **main** process. Accessed through `drizzle-orm/better-sqlite3`.
- **Location:** the database file lives at `app.getPath('userData')/portfolio.db` — the OS
  per-user application-data directory. It never leaves the machine. WAL journaling and
  `foreign_keys = ON` are set on open.
- **Migrations:** authored with drizzle-kit (`npm run db:generate`) into `drizzle/`, applied
  programmatically on **every app launch** via `drizzle-orm/better-sqlite3/migrator` before
  any window opens. drizzle-kit also drives `db:migrate` / `db:studio` against a local dev
  database for tooling. Generated SQL is committed and shipped with the packaged app
  (electron-builder `extraResources`).
- **Encapsulation:** the Drizzle client and schema live in `src/db` (`@db`). Only the
  **repository layer** may query the database; the startup **migration bootstrap** in main is
  the one other permitted importer. Services and the renderer must never import `@db` —
  enforced statically by ESLint `no-restricted-imports`. Services reach data through
  repositories; the renderer through IPC.
- **Native rebuild:** `better-sqlite3` is a native addon and must match Electron's ABI, not
  the system Node's. A `postinstall` runs `electron-rebuild -f -w better-sqlite3`; packaging
  rebuilds via electron-builder's `@electron/rebuild` step.

## Consequences

### Benefits

- Simple, synchronous data access well-suited to the main process; no external DB server.
- Type-safe schema and queries via Drizzle; migrations are versioned and reproducible.
- Clear ownership: the database is an implementation detail of the repository layer.
- Migrate-on-launch keeps a desktop app (which only runs when opened) always up to date.

### Tradeoffs

- Native module: needs an ABI-correct rebuild for Electron in dev and at packaging time
  (automated, but a real build step).
- Synchronous I/O in the main process — acceptable for a single-user local app; heavy
  operations can move to a worker later if ever needed.

### Risks

- **ABI mismatch** between system Node and Electron (`NODE_MODULE_VERSION`) — hit during #11
  and resolved with `electron-rebuild`; the postinstall guards against regressions on clean
  checkouts.
- Packaged-app migration path must resolve under `process.resourcesPath`; handled in
  `src/db/migrate.ts` and verified when the real schema lands (M2).

## Alternatives Considered

### `node:sqlite` / `libsql` / `sql.js`

Rejected: `node:sqlite` is still stabilizing and not aligned with Drizzle's mature
better-sqlite3 path; `sql.js` (wasm) loses native performance and durable file semantics;
libsql adds surface we don't need for a purely local app.

### Asynchronous driver in a worker thread

Rejected as premature for a single-user local app. `better-sqlite3`'s synchronous API is
simpler and fast enough; revisit only if a real workload proves it necessary.

## References

- ADR-0001 (build & packaging toolchain), ADR-0002 (typed IPC contract)
- `CLAUDE.md` — Stack, Repository Pattern, Historical Snapshots
- `docs/database.md`
- GitHub Issues #1 (Epic M0), #11 (Story)
