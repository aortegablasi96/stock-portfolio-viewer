# `src/preload`

The **typed `contextBridge` bridge** — a single file, and the only surface the renderer can use to
reach the main process. Context isolation is on and Node integration is off, so the renderer can
never touch Electron, Node, services or repositories directly (ADR-0002).

It exposes one object, `window.api`, whose shape is `RendererApi` from
`@shared/ipc/contract`. Each method is a one-line `ipcRenderer.invoke` against a channel constant
from `@shared/ipc/channels`.

## What may be imported here

**Channel-name constants and types only.** The types are erased at build time, so neither Zod nor
any service code lands in the sandboxed preload bundle. Validation is the main process's job,
performed on the far side of the boundary where a malicious renderer cannot skip it.

That restriction has a sharp edge worth knowing: **a constant the renderer needs at *runtime* must
not live in a module that imports Zod.** One value import pulls the whole package into the bundle,
and lint, typecheck, tests, build and e2e all still pass — `zodIsolation.test.ts` is what fails
instead (DDR-0105). `@shared/domain/assistantKey` is the shape of the fix.

## Subscriptions

A main→renderer event is wrapped rather than forwarded: the raw `IpcRendererEvent` is never handed
to a renderer callback, and each subscription returns its own unsubscribe function.

Adding a method here is step three of the four-file recipe — see `src/main/README.md`.
