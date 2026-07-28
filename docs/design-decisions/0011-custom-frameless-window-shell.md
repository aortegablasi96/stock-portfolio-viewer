# 0011. Custom frameless window shell with in-app title bar

- **Status:** Accepted
- **Date:** 2026-07-24

## Context

Through M3 the app used the default OS window frame. Story #42 (second-round M3 UX polish)
asks for a modern, integrated window chrome: the native title bar replaced by an in-app title
bar with minimize, maximize/restore, and close controls, so the app reads as a purpose-built
desktop product rather than a generic framed window. The primary target is Windows.

The constraint is that the app's locked-down Electron security posture must not change:
`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false` (ADR-0001). The renderer
cannot touch `BrowserWindow`, so any window control has to travel over the typed IPC bridge.

## Decision

Run the single `BrowserWindow` **frameless** (`frame: false`) and render a custom title bar
(`TitleBar`) at the very top of the app shell, above the existing tab nav (DDR-0006).

- The title bar is a slim (40px) strip: the app title on the left in a **draggable** region
  (`-webkit-app-region: drag`), and the three window controls on the right in a **no-drag**
  region so they stay clickable and keyboard-focusable.
- Controls are real `<button>`s with `aria-label`s and a `:focus-visible` ring; icons are
  dependency-free inline SVG (matching the project's inline-SVG chart convention). The close
  button hovers to the Windows-standard red; the others hover to the card surface.
- Window commands cross IPC as **fire-and-forget** messages (`window:minimize`,
  `window:toggleMaximize`, `window:close` via `ipcRenderer.send` / `ipcMain.on`) — they carry
  no payload, so there is nothing to Zod-validate, consistent with how `snapshot:capture` /
  `snapshot:list` carry no request schema. Each main-process handler resolves its own window
  from `BrowserWindow.fromWebContents(event.sender)`.
- The maximize/restore icon tracks the **real** window state: the title bar seeds it with a
  `window:isMaximized` query on mount and then subscribes to a main→renderer
  `window:maximizeChanged` event (mirroring the existing `snapshot:captured` event pattern),
  so OS-driven changes — double-clicking the drag region, window snapping — keep the icon
  correct.
- The app brand, previously duplicated in the tab nav, now lives only in the title bar; the
  sticky tab nav offsets below the 40px bar.

The Electron security posture is unchanged: controls are driven entirely over the existing
IPC bridge, not by relaxing sandbox/isolation/node settings.

## Consequences

Benefits:

* A polished, integrated window that matches the app's dark chrome, with correct Windows
  control placement and a native-feeling drag region.
* No new dependency; the title bar is a small presentational component and the window commands
  reuse the established IPC + main→renderer event patterns.
* Maximize state stays truthful because it is sourced from the window itself, not inferred.

Tradeoffs:

* The app now owns chrome the OS used to provide (drag region, control placement). This is the
  point of the story, but it means per-platform placement is our responsibility.
* macOS/Linux get functional-but-not-native controls (right-aligned, no traffic lights). The
  primary target is Windows; platform-specific polish is deferred.

Risks:

* A layout regression that leaves no `-webkit-app-region: drag` surface would make the window
  undraggable. Mitigated by keeping the drag region as the whole left span of a persistent,
  always-mounted title bar.

## Alternatives Considered

### `titleBarStyle: 'hidden'` + `titleBarOverlay` (Windows native overlay controls)

Rejected: the overlay renders OS-drawn controls whose colors we would have to keep in sync via
`setTitleBarOverlay`, and it is less consistent across platforms than drawing our own. Full
custom controls give uniform styling and behaviour with the same IPC plumbing.

### Keep the native OS frame

Rejected: it is exactly what Story #42 replaces; the native frame does not match the app's
custom dark chrome.

### `invoke` for the window commands

Rejected: minimize/maximize/close return nothing and have no failure the renderer acts on, so
one-way `send`/`on` is the right fit; `invoke` is reserved for the `isMaximized` query.

## References

- [[0028-window-state-persistence]] — extends this decision: because the OS frame is gone, the
  window's size, position and maximized state are the app's to remember
- [[0006-app-shell-tab-navigation]] — the tab shell this title bar sits above
- [[0002-connection-state-as-ipc-result]] — precedent for modelling state as IPC data/events
- ADR-0001 — the locked-down Electron security posture kept intact here
- GitHub Issues #4 (Epic M3), #42 (Story)
