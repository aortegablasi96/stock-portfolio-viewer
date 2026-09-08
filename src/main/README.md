# `src/main`

The **Electron main process**. It owns application startup, the single window, and the IPC
surface — and it is the only process with access to Node, the filesystem, the database and the
network.

```text
env.ts            .env → process.env, before anything can read a variable
index.ts          app lifecycle, the window, the single-instance lock
ipc/handlers.ts   one thin handler per channel
```

## Startup order is load-bearing

`index.ts` does three things before a window exists, and the order of each has a bug behind it:

1. **`loadEnvFile()` is the file's first statement**, above the single-instance lock (Bug #297).
   Every consumer reads its variable lazily today, so a later call would work; doing it first
   means it keeps working when one of them stops being lazy.
2. **`app.requestSingleInstanceLock()` runs at module load**, before any `whenReady` work. Every
   write path in the app assumes it is the only writer, so the losing process must quit *without*
   migrating, capturing or opening the database (DDR-0025). The lock is scoped to the user-data
   directory, which is why the e2e suite's second app still starts.
3. **Migrations run on launch**, against `app.getPath('userData')/portfolio.db`.

## The window

Security is locked down from day one and should stay that way: `sandbox: true`,
`contextIsolation: true`, `nodeIntegration: false`, and `frame: false` with an in-app `TitleBar`
(ADR-0001, DDR-0011). The renderer reaches nothing except through the preload bridge.

Geometry is app code, not the OS's (DDR-0028). Three traps, all pinned by
`e2e/window-state.spec.ts`:

- persist **`getNormalBounds()`**, never maximized bounds, and skip a **minimized** window;
- re-apply with **`setBounds()`**, not the constructor, or a frameless window grows a few pixels
  every launch;
- `windowStateService` may not import `electron`, so main passes geometry in as plain rectangles
  and hands back a callback.

A resize or move is debounced before it is written — the owner's intent is the position they stop
at, not every pixel on the way there.

## IPC handlers

`ipc/handlers.ts` is deliberately thin: validate the request with the Zod schema from
`@shared/ipc/contract`, delegate to a service, return plain data. No business logic lives here,
and nothing here reaches a repository directly.

**Adding a channel touches four files, in this order:**

```text
shared/ipc/channels.ts → shared/ipc/contract.ts → preload/index.ts → main/ipc/handlers.ts
```

Failures come back as **result variants, never thrown exceptions** — `not_connected` and
`not_responding` are not interchangeable, because they differ in how the owner recovers
(DDR-0022).

The recipe assumes `invoke`/`handle`. The exception is the payload-free
`window:minimize | toggleMaximize | close`, which use `send`/`on` and skip `contract.ts` entirely.
A main→renderer event returns an unsubscribe function.
