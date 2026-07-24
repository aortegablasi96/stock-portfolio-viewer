# 0006. Sanctioned full reset of imported/captured local history

- **Status:** Accepted
- **Date:** 2026-07-24

## Context

The app's two local history stores were designed as **append-only and immutable**:

- `snapshots` / `snapshot_holdings` — captured portfolio history
  ([[0003-snapshot-persistence-and-capture-policy]], DDR-0003).
- the `flex_*` tables — imported Flex Query history ([[0005-flex-query-file-import]], DDR-0004).

The immutability guarantee was enforced structurally: the repositories exposed **no update or
delete surface**, and `CLAUDE.md` states "every other table is append-only and must stay that
way." De-dupe on import/capture means the stores only ever grow.

Story #43 introduces a real need that this absolute framing did not allow for: the owner
exports Flex statements by hand, and a **wrong or corrupted export** (or a decision to restart
history) leaves bad data permanently wedged in the store with no in-app way out short of
hand-editing the SQLite file. The owner needs to **reset** the imported statements and,
separately, the captured snapshots, so they can re-import cleanly.

This forces an explicit decision about how a destructive reset reconciles with an
architecture-level invariant recorded in two DDRs and `CLAUDE.md` — hence an ADR rather than an
inline change (`CLAUDE.md`: never silently override an accepted decision).

## Decision

Refine — not abandon — the immutability guarantee. The invariant that matters is **immutability
during normal operation**: imported and captured records are never edited, partially deleted, or
silently mutated by the app's data flow. We add exactly one sanctioned exception:

- **A whole-store, owner-confirmed full reset per domain.** `flexRepository.clearAll()` and
  `snapshotRepository.clearAll()` each delete their entire store in a single transaction and
  return the number of top-level rows removed. Deletes cascade to child tables via the existing
  `onDelete: 'cascade'` foreign keys (`foreign_keys = ON`, `db/client.ts`).
- **No partial/selective deletion.** There is deliberately no delete-by-id, by-date, or
  by-statement variant. The only mutation is "remove everything," which keeps individual records
  immutable — you cannot rewrite history, only discard it wholesale and rebuild by re-importing
  or re-capturing.
- **The two stores are independent.** Clearing statements never touches snapshots and vice
  versa; they are separate actions with separate confirmations.
- **Explicit, owner-initiated confirmation is required** before the delete runs (UX in
  companion DDR-0012). The reset is never automatic.
- **Modelled as data, not exceptions.** The `flex:clear` / `snapshot:clear` IPC results are
  discriminated unions (`cleared` with a removed-count, or `error`), consistent with
  [[0002-connection-state-as-ipc-result]]. Nothing throws across IPC.
- **Layering unchanged.** Services (`flexImportService.clearStatements`,
  `snapshotService.clearHistory`) delegate to the repositories; the repositories remain the only
  layer touching the tables. The mutable-cache table `instrument_classifications` (DDR-0009) is
  unaffected and keeps its own upsert semantics.

The append-only guarantee stated in DDR-0003, DDR-0004, and `CLAUDE.md` is hereby understood as
"append-only in normal operation, with a single sanctioned full-reset path per store"; those
documents are refined by this ADR rather than contradicted.

## Consequences

### Benefits

- The owner can recover from a bad Flex export or restart history entirely in-app, without
  hand-editing the database.
- After a clear, the analytics views fall back to their existing `needs_import` empty states and
  repopulate on the next import/capture — no new empty-state handling required.
- The immutability invariant is preserved where it matters (no per-record edits), so analytics
  correctness assumptions (no rewriting of historical rows) still hold.

### Tradeoffs

- A destructive capability now exists. Mitigated by requiring explicit confirmation and by
  making the only available operation an all-or-nothing reset (no fiddly partial edits that could
  silently corrupt derived analytics).
- "Immutable" is now conditional and must be read together with this ADR.

### Risks

- **Accidental data loss.** Mitigated by the in-place confirm step (DDR-0012) that states exactly
  what will be removed and what will not, and by the two stores being cleared independently.

## Alternatives Considered

### Option A — Keep the stores strictly append-only; no in-app delete

Rejected: leaves the owner with no recovery path from a bad import short of manually deleting the
SQLite file, which is exactly the "start fresh without editing the database" pain Story #43
raises.

### Option B — Selective deletion (per statement / per date range)

Rejected for this story (and noted out of scope in the issue): per-row deletion genuinely breaks
immutability, invites partially-inconsistent stores, and complicates the de-dupe and analytics
assumptions. A full reset is the smallest change that solves the actual need.

### Option C — Overwrite-on-import (re-importing replaces prior data)

Rejected: couples "fix my data" to the import action, surprises the owner (import is currently
additive and idempotent), and removes the ability to clear snapshots, which are captured, not
imported.

## References

- [[0003-snapshot-persistence-and-capture-policy]], [[0005-flex-query-file-import]] — the stores
  whose immutability this ADR refines
- DDR-0003, DDR-0004 (append-only storage models), DDR-0009 (the mutable classification cache)
- Companion DDR-0012 (in-place destructive-confirm UX)
- [[0002-connection-state-as-ipc-result]] — outcome-as-data convention reused here
- `CLAUDE.md` — "Enforced boundaries & gotchas" (append-only tables)
- GitHub Issues #4 (Epic M3), #43 (Story)
