# Database

Stock Portfolio Viewer uses an embedded **SQLite** database with **Drizzle ORM**. The
database is a local file on the owner's machine (the app is a single-user desktop
application) — there is no database server and no remote data. This document describes the
intended data model. No schema exists yet — the project is greenfield.

## Purpose

The database stores:

- Historical snapshots
- Cached analytics
- Benchmark history (future)
- Application metadata

Do **not** duplicate live brokerage data unless necessary for analytics.

## Principles

- **Interactive Brokers is the source of truth** for live positions and balances.
- **Snapshots are append-only, immutable, and timestamped.** Never update or delete a
  recorded snapshot; capture a new one instead.
- Repositories own all data access; schema details never leak into services or the app.
- Migrations are generated and applied with Drizzle:
  - `npm run db:generate`
  - `npm run db:migrate`
  - `npm run db:studio`

## Intended Tables (to be designed)

These are placeholders to be refined through Database Reviews — not a committed schema.

- `snapshots` — one row per captured portfolio state (timestamped, immutable).
- `snapshot_holdings` — per-holding detail belonging to a snapshot.
- `dividends` — recorded dividend events.
- `analytics_cache` — precomputed analytics keyed by inputs/period.
- `accounts` / metadata — brokerage account references and application metadata.

## Conventions (to be ratified)

- Timestamps stored in UTC (ISO-8601 text or epoch integer — SQLite has no native date type).
- Monetary values stored as integer minor units (or text) plus an explicit currency code;
  avoid floating point for money, since SQLite has no decimal type.
- Snapshot rows carry the capture timestamp and the source (e.g. `ibkr`).

> Database Reviews (see the `database-designer` skill) produce the input to this document.
> Significant schema decisions should be recorded as ADRs in `docs/decisions/`.
