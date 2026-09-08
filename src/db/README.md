# `src/db`

The **SQLite layer** — better-sqlite3 behind Drizzle. Only repositories import from here; ESLint
fails a service or renderer module that tries (ADR-0003).

```text
client.ts    the better-sqlite3 + Drizzle singleton
migrate.ts   applies drizzle/ migrations, run once at launch
schema.ts    every table, in one file
```

## Two databases, and they are not the same file

- **Runtime** — the app opens `app.getPath('userData')/portfolio.db` and migrates it on launch.
- **Tooling** — drizzle-kit (`npm run db:generate | db:migrate | db:studio`) runs *outside*
  Electron against `./local.dev.db` (override with `DATABASE_URL`). It cannot open the runtime
  database while the app holds it, and it is not meant to.

`better-sqlite3` is a **native module**, rebuilt for Electron's ABI by the `postinstall` hook. On
a mismatch: `npm install`, or `npx electron-rebuild -f -w better-sqlite3`. It also cannot be
loaded outside Electron at all — to inspect a real database from a script, use Node's own
`node:sqlite`.

## The tables

Fifteen, in three groups:

- **`app_meta`** — a key/value table of settings: install id, window geometry, sidebar state, the
  investor profile, the saved API key. Each is *one overwritten value*, not history.
- **`snapshots` / `snapshot_holdings`** — immutable local history of the live portfolio.
- **`flex_*`** (eleven) — imported Flex Query history: statements, NAV changes, open and prior-period
  positions, equity summaries, trades, lots, cash transactions, FIFO summaries, securities and open
  dividend accruals.
- **`instrument_classifications`** — sector/industry, and **the one mutable table** in the schema:
  a cache of derived reference data, upserted by conid (DDR-0009).

## Conventions that bite

- **Everything except that cache is append-only**, with exactly one sanctioned exception: a
  whole-store, owner-confirmed reset per domain (`clearAll()`). There is deliberately no
  delete-by-id, by-date or by-statement variant — don't add one (ADR-0006).
- **Two money conventions coexist, and mixing them is silent.** `snapshots` and
  `snapshot_holdings` store **integer minor units** plus a currency (DDR-0003); `flex_*` tables
  store **`real`** (DDR-0004).
- **All timestamps are epoch-ms UTC integers.**
- **One writer.** The single-instance lock is what makes that true; see `src/main/README.md`.

Changing `schema.ts` means generating a migration (`npm run db:generate`) and committing it —
`drizzle/` is the applied history, and `docs/database.md` is the prose.
