# `src/repositories`

The **data-access layer**. Repositories own all reads/writes to data sources
(SQLite via Drizzle, the Interactive Brokers local Gateway / MCP, future external
providers) and expose domain-oriented methods. Services depend on repositories;
services must never know where data originates.

This directory is currently a placeholder — the first real repository (and the
SQLite/Drizzle wiring it depends on) arrives with **Story #11 / Milestone M2**.

Dependency direction (downward only, see `CLAUDE.md`):

```
renderer → IPC → main → services → repositories → SQLite / IBKR Gateway
```
