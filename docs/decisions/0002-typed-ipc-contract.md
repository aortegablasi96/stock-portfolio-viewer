# 0002. Typed IPC contract: preload contextBridge + shared contract + Zod validation

- **Status:** Accepted
- **Date:** 2026-07-03

## Context

Stock Portfolio Viewer is local-first: all business logic and data access run in the
Electron **main** process, and the React **renderer** reaches them only over IPC (see
`CLAUDE.md` Architecture Rules and `docs/architecture.md`). Story #10 (Epic M0) establishes
that boundary before any feature channels exist, so a single, repeatable pattern for adding
IPC channels is needed. The renderer must stay untrusted and isolated, handlers must stay
thin, and input crossing the process boundary must be validated.

## Decision

Every IPC channel follows one pattern:

1. **Shared contract** lives in `src/shared/ipc/`:
   - `channels.ts` — dependency-free channel-name constants (safe to bundle into the
     sandboxed preload).
   - `contract.ts` — Zod schemas, the request/response types inferred from them, and the
     `RendererApi` interface describing the `window.api` bridge.
2. **Preload** (`src/preload/index.ts`) exposes a typed API via `contextBridge` under
   `window.api`, importing only channel constants and (erased) types — so Zod and service
   code never enter the renderer/preload bundle.
3. **Main handler** (`src/main/ipc/handlers.ts`) registers `ipcMain.handle`, validates the
   untrusted input with the channel's Zod schema, and delegates to a service. Handlers
   contain no business logic.
4. **Service** (`src/services/**`) holds the logic and is the primary unit-test target.
5. **Renderer** consumes `window.api` only. It is forbidden (by ESLint `no-restricted-imports`)
   from importing `@services`, `@repositories`, `@main`, or `electron` directly.

Security defaults established in #9 remain in force: `contextIsolation: true`,
`nodeIntegration: false`, `sandbox: true`.

The example channel `app:ping` (renderer → preload → handler → `systemService` → back)
demonstrates the pattern.

## Consequences

### Benefits

- One source of truth for each channel's shape; renderer and main cannot drift.
- The trust boundary is explicit — untrusted renderer input is validated exactly once, at
  the handler, with Zod.
- Handlers stay thin and testable; logic is isolated in services.
- The renderer cannot bypass IPC — enforced statically by lint, not just convention.

### Tradeoffs

- A little ceremony per channel (schema + type + bridge method + handler) versus ad-hoc
  `ipcRenderer` calls. Accepted: it is the boundary's whole value.
- Request/response types are inferred from Zod schemas, so the schema is authored first.

### Risks

- Contract files that import Zod must only be imported **type-only** from renderer/preload;
  a value import would pull Zod into those bundles. Mitigated by keeping channel constants
  in the dependency-free `channels.ts`.

## Alternatives Considered

### Direct `ipcRenderer` exposure / no shared contract

Expose `ipcRenderer.invoke` (or per-call wrappers) without a shared, validated contract.
Rejected: loses static typing across the boundary, invites untrusted-input bugs, and lets
channel shapes drift between renderer and main.

### Validate inside services instead of at the handler

Rejected: services would then depend on the transport's trust model. Validating once at the
handler keeps services transport-agnostic and pure.

## References

- ADR-0001 (build & packaging toolchain)
- `CLAUDE.md` — Architecture Rules, Layer Responsibilities
- `docs/architecture.md`
- GitHub Issues #1 (Epic M0), #10 (Story)
