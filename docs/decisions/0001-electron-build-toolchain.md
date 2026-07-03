# 0001. Electron build & packaging toolchain: electron-vite + electron-builder

- **Status:** Accepted
- **Date:** 2026-07-03

## Context

Stock Portfolio Viewer is a standalone, single-user, local-first Electron desktop
application (Electron + React + Vite + TypeScript, per `CLAUDE.md`). Story #9 (Epic M0 —
Project scaffolding) requires a launchable shell with `dev` (HMR), `build`, and `package`
(a distributable desktop app) working from a clean checkout, with strict TypeScript in
**both** the main and renderer processes.

The choice of build/packaging toolchain is load-bearing: it fixes the repository layout
(`src/main`, `src/preload`, `src/renderer`), the dev/build/package scripts, and the native-
module build path that later stories depend on (notably `better-sqlite3` in Story #11). It
is expensive to reverse once feature code is built on top, so it is recorded as an ADR.

## Decision

Use **electron-vite** for development and building, and **electron-builder** for packaging.

- `electron-vite` drives all three targets (main, preload, renderer) through Vite with a
  single `electron.vite.config.ts`, providing HMR for the renderer and fast rebuilds/
  restarts for main and preload, with first-class TypeScript support.
- `electron-builder` produces the distributable via `npm run package` (Windows NSIS /
  portable initially, since the owner's machine is Windows), and supports rebuilding native
  modules against Electron's ABI.

Scripts:

- `npm run dev` → `electron-vite dev`
- `npm run build` → `electron-vite build`
- `npm run package` → `electron-vite build && electron-builder`

## Consequences

### Benefits

- Purpose-built for the exact stack; minimal configuration vs. hand-wiring Vite + Electron.
- One config and one mental model for all three process targets.
- HMR/fast-restart developer loop out of the box.
- electron-builder is mature and handles native-module rebuilds needed for SQLite (#11).

### Tradeoffs

- Two tools rather than one integrated toolchain (cf. Electron Forge), so dev/build and
  packaging are configured separately.
- Some coupling to electron-vite's conventions for entry-point locations and output layout.

### Risks

- Native-module packaging friction on Windows may surface at #11; mitigated because
  electron-builder explicitly supports `better-sqlite3`-style rebuilds.
- Toolchain lock-in — reversal after feature code exists would be costly (accepted; this is
  why the decision is recorded here).

## Alternatives Considered

### Electron Forge (Vite + TypeScript template)

Official Electron tooling that also owns packaging/publishing (`make`/`publish`). Rejected
as heavier than needed for a single-user local app: its own lifecycle and multiple config
files add moving parts without benefit for this project's scope.

### Manual Vite + electron-builder

Hand-wired Vite configs for renderer and main plus a custom dev script. Rejected for the
maintenance burden and boilerplate, which conflicts with the project's simplicity principle.

## References

- Architecture Review for Story #9 (Epic M0)
- `CLAUDE.md` — Stack, Architecture Rules
- GitHub Issues #1 (Epic M0), #9 (Story)
