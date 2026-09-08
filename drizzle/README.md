# `drizzle`

**Generated SQL migrations** and their metadata. This directory is output, not source — the source
of truth for the schema is `src/db/schema.ts`.

```text
NNNN_<name>.sql   one migration, in application order
meta/_journal.json  the applied-order journal drizzle-kit maintains
meta/NNNN_snapshot.json  the schema as of that migration
```

## How a change gets here

```bash
# edit src/db/schema.ts, then:
npm run db:generate     # writes a new NNNN_*.sql and its snapshot
```

Commit the generated files with the schema change. **Never hand-edit an applied migration** — the
snapshots in `meta/` are diffed against the schema to produce the next one, so an edited migration
puts the journal and the database permanently out of step. To correct a mistake, generate a new
migration.

## Where they are applied

**Two different databases, by two different mechanisms:**

- **At runtime** — `src/db/migrate.ts` applies this directory to
  `app.getPath('userData')/portfolio.db` on every launch, before the window opens.
- **In tooling** — `npm run db:migrate` applies it *outside* Electron to `./local.dev.db`
  (override with `DATABASE_URL`). `npm run db:studio` browses that same file.

The tooling database is a development convenience. The owner's real data is the runtime one, and
drizzle-kit never touches it.

## What the migrations may do

The schema is **append-only** by policy, with one mutable table (`instrument_classifications`, a
cache) and one sanctioned destructive operation per domain (an owner-confirmed `clearAll()`).
ADR-0006 is the record; a migration that adds a delete-by-id path is a decision to reopen there,
not a change to make here.
