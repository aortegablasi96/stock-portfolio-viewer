# 0025. Single-instance lock: the second launch quits and focuses the first

- **Status:** Accepted
- **Date:** 2026-07-27

## Context

The app is local-first and single-user, and it owns exactly one SQLite file at
`app.getPath('userData')/portfolio.db`. Until Story #107 nothing prevented a second copy from
running: `src/main/index.ts` went straight from module load to `app.whenReady()`, so launching
again while the app was already open — double-clicking the shortcut while the window sits
behind another app, which is easy to do with a frameless shell that has no taskbar-distinct
chrome — started a second process with its own `BrowserWindow` against the same file.

Both processes would then run `runMigrations()` on start, both could capture an on-open
snapshot, and both could import or clear Flex statements. Every write path in the app is built
on the assumption that it is the only writer: the append-only `flex_*` and `snapshots` tables
(ADR-0006, DDR-0004), the 12-hour capture de-dupe (DDR-0003), the two-tier import de-dupe. None
of those assumptions survive a concurrent writer, and the failure would be silent — duplicated
history rather than an error.

This is the only concurrency case in the product that can actually reach the owner's data.
Everything else is one process talking to a read-only gateway.

## Decision

Take Electron's single-instance lock at **module load** in `src/main/index.ts`, before any
`whenReady` work is registered. The process that wins the lock starts normally; the process
that loses calls `app.quit()` and does nothing else.

```text
requestSingleInstanceLock()
  ├─ won  → app.on('second-instance', focusExistingWindow); startPrimaryInstance()
  └─ lost → app.quit()
```

Three properties this ordering buys, and the reason the lock is not requested inside
`whenReady`:

- The losing process never runs `runMigrations()`, never calls `captureOnOpen()`, and never
  **opens the database at all** — `getDb()` is lazy (`src/db/client.ts`), and nothing executed
  before the lock request touches it. "Quit early" is therefore a real guarantee about the
  data, not just about the window.
- The winner registers a `second-instance` handler that restores a minimized window, shows a
  hidden one, and focuses it. From the owner's point of view they asked for the app, so the app
  has to appear; a launch that silently does nothing reads as a broken shortcut.
- The lock is scoped to the user-data directory, so a run started with its own
  `--user-data-dir` is a different app as far as the lock is concerned. The e2e suite depends
  on this: it already launches a second instance against a stalled gateway (DDR-0022), and that
  instance keeps working because it has its own directory.

The existing `window-all-closed` and macOS `activate` handlers are unchanged. This is a
lifecycle guard, not a change to the window shell (DDR-0011).

## Consequences

Benefits:

* The concurrent-writer scenario is removed rather than mitigated — there is no second writer
  to coordinate with.
* A second launch does something useful (surfaces the running window) instead of failing.
* No dependency, no database configuration, no coordination protocol; roughly fifteen lines in
  one file.

Tradeoffs:

* Deliberately single-window forever. Opening a second window on a second launch, or two
  windows onto different data, would now be a design change, not a code change. That matches
  the product: one owner, one portfolio, one local database.

Risks:

* On Windows, focusing a window from another process is subject to foreground restrictions, so
  a second launch may flash the taskbar button instead of raising the window. Acceptable: the
  data guarantee does not depend on the focus succeeding.

## Alternatives Considered

### Let both instances run and make concurrent access safe

Rejected. It is the expensive answer to a question the app does not need to ask: SQLite WAL
plus busy timeouts would stop the writes from colliding at the file level, but nothing would
stop two processes each capturing an on-open snapshot or each importing the same statement,
because the de-dupe policies live in services and read state that the other process is
concurrently changing. Preventing the second instance is both cheaper and stricter.

### Request the lock inside `app.whenReady()`

Rejected. By then `runMigrations()` is one statement away and the ordering guarantee gets
subtle — the acceptance criterion is that the second process exits *without* touching the
database, and the only way to make that obvious on the page is to ask for the lock before any
of that code can run.

### A lock file written by the app itself

Rejected. It reimplements what Electron already provides, and it is the version that strands
the owner: a process killed without cleanup leaves a stale lock file and the app refuses to
start until someone deletes it by hand. Electron's lock is released by the OS when the process
dies.

## References

- [[0011-custom-frameless-window-shell]] — the window shell this lifecycle guard sits under
- [[0003-snapshot-persistence-and-capture-policy]] — the 12h capture de-dupe that assumes one writer
- [[0004-flex-import-persistence-and-dedupe]] — append-only imports and their two-tier de-dupe
- [[0022-gateway-timeout-and-not-responding-state]] — the e2e second instance that relies on per-directory lock scoping
- ADR-0006 — append-only stores with a single whole-store reset
- GitHub Issues #102 (Epic), #107 (Story)
