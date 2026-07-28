# 0028. Remembering window state: app_meta JSON, reachability judged on the title bar

- **Status:** Accepted
- **Date:** 2026-07-28

## Context

`createWindow()` hard-coded `width: 1280, height: 800` on every launch, so a window the owner
maximized or resized yesterday reopened at the default size today. Story #110 asks for the
window to reopen where it was left.

The shell is frameless with in-app controls (DDR-0011), which is what makes this app code at
all: with no OS frame there is no OS behaviour restoring anything. Two constraints shape the
design. Services may not import `electron` (ESLint-enforced), yet deciding whether stored
bounds are still usable needs to know what displays are attached. And the persistence must go
through a repository like every other data access (ADR-0003).

## Decision

A `windowStateService` reads and writes a single JSON value under the `app_meta` key
`window_state`, through the existing `metaRepository`.

- **No new table.** Window state is lightweight application metadata — a *current* value that
  is overwritten, not history — which is exactly what `app_meta` exists for. It is not
  append-only data and would be misplaced next to `snapshots` / `flex_*` (ADR-0006). No schema
  change and therefore no migration.
- **The stored value is parsed, never trusted.** It is a hand-editable row in a local database
  and may predate a change to the shape, so it goes through a Zod schema on the way in and
  anything that fails to parse is treated as absent. A corrupt value costs the owner their
  layout, not their launch.
- **Display geometry is passed in as data.** `main` hands the service
  `screen.getAllDisplays().map(d => d.workArea)` as plain rectangles, so the recovery maths is
  a pure function under unit test and the service stays Electron-free.
- **Reachability is judged on the title bar, not the window's area.** A window whose body
  covers a display but whose bar sits above its top edge cannot be dragged anywhere — so an
  area overlap is the wrong test. The stored position is kept when the 40px bar is *wholly* on
  a display vertically and at least 120px of it horizontally; otherwise the position is
  dropped and Electron centres the window at the stored size.
- **A reachable position is left alone**, including one deliberately straddling two displays.
  The window is only moved when it could not be reached, or when it had to be shrunk to fit
  the display it reopens on — a window we resized should land wholly inside that display
  rather than half off it. Restored sizes are floored at the window's own
  `minWidth` / `minHeight`.
- **What is persisted is `getNormalBounds()`**, never the maximized bounds: a maximized window
  has to remember the size it will be restored *to*. Maximized state is stored beside it and
  re-applied with `maximize()` before first paint, so the window is never shown small and then
  snapped.
- **Writes are debounced 400ms** on `resize` / `move` (those fire continuously while a window
  is dragged; the owner's intent is where they stop), fired on `maximize` / `unmaximize`, and
  flushed synchronously on `close` so a close inside the debounce window is not lost. A
  **minimized** window is skipped entirely — it reports neither useful bounds nor, on Windows,
  its maximized state, so the last known good state is left in place.
- **A restored rectangle is applied with `setBounds()`, not the constructor.** This is not
  cosmetic: `setBounds` is the exact inverse of the `getNormalBounds()` being persisted, while
  the constructor's `width`/`height` are not — Windows adds its invisible resize border to a
  frameless window, so a size round-tripped through the constructor comes back a couple of
  pixels taller. Left that way the window grows a little on every single launch, which the
  cross-launch e2e spec caught by opening the app three times and asserting the geometry
  settles.

No new IPC channel and no renderer change: `TitleBar` already seeds its icon from
`window:isMaximized` on mount (DDR-0011), so a maximized launch paints the restore icon
correctly on first paint.

## Consequences

Benefits:

* The app reopens as the owner left it, including maximized, with no new table, dependency,
  IPC channel or renderer change.
* The interesting logic — off-screen recovery — is a pure function with unit tests, despite
  living behind an Electron-only concern.
* Corrupt or stale stored state degrades to the first-launch defaults instead of failing the
  launch.

Tradeoffs:

* The 40px / 120px reachability thresholds are judgement, not a platform rule. They are
  deliberately generous: keeping a position the owner chose matters more than tidiness.
* Debouncing means a hard kill (not a close) can lose up to 400ms of window movement. Losing
  the last drag of a window that was force-killed is not worth a write per pixel.

Risks:

* `getNormalBounds()` behaviour differs subtly across platforms; the primary target is
  Windows, matching DDR-0011. The e2e spec pins the round-trip on the platform it runs on.

## Alternatives Considered

### A dedicated `window_state` table

Rejected: one row that is overwritten is not a table's worth of schema, and it would sit
oddly among append-only history. `app_meta` is the documented home for exactly this.

### Persisting from the renderer over a new IPC channel

Rejected: the renderer cannot see window bounds without being told them, and window geometry
is a main-process concern. It would have added a channel to move data the main process
already holds.

### Saving only on `close`

Rejected: it loses everything if the app is killed rather than closed, and `close` alone gives
no chance to record a maximize the owner performed and then reverted. The debounce plus a
synchronous flush on close costs one small write per settled gesture.

### Clamping every restored window fully inside one display

Rejected: it yanks a window the owner deliberately straddled across two monitors onto one of
them. The story asks for a window that *cannot be reached* to be brought back — not for every
window to be tidied.

## References

- [[0011-custom-frameless-window-shell]] — the frameless shell that makes window state app code
- [[0025-single-instance-lock-and-window-focus]] — the other main-process window-lifecycle decision
- ADR-0003 — repositories as the only data-access layer
- ADR-0006 — append-only history, and why this value is not history
- GitHub Issues #100 (Epic), #110 (Story)
