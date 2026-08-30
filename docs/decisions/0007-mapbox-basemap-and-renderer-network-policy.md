# 0007. Mapbox GL JS basemap and the renderer's network policy

- **Status:** Accepted
- **Date:** 2026-07-26
- **Amended by:** [[0010-openai-provider-and-the-network-policy]] (2026-08-27) — *Confine network
  access to the basemap surface* below remains true **of the renderer**, which still carries no
  application data off the machine. It is no longer true of the application as a whole: the AI
  assistant sends portfolio-derived figures to OpenAI **from the main process**, gated on the owner's
  consent. The CSP, and the deliberate omission of `events.mapbox.com`, are unchanged.
- **Amended by:** [[0011-the-key-is-the-authorization]] (2026-08-30) — the gate named in the line
  above is gone; the assistant sends whenever a key is present. Everything the line says about the
  **renderer** is unchanged, and so is the CSP.

## Context

Until now the renderer made **no network requests at all**. `src/renderer/index.html` declared
`default-src 'self'` with no external origin, under the comment "Lock the renderer down: no remote
content, inline styles only", and every chart was hand-written inline SVG with its geometry
bundled as static data ([[0014-allocation-world-map-bubble-map]]). All data reached the UI over
IPC from the main process, which alone talked to the IBKR gateway
([[0004-interactive-brokers-integration]]) and SQLite ([[0003-sqlite-drizzle-persistence]]).

Story #89 asks for the Allocation map to be drawn on a real Mapbox GL JS basemap, because the
bundled land silhouette has no coastlines, borders, or labels: zoomed into Western Europe the owner
can see that bubbles overlap but not which country each sits on, and identity only arrives on
hover.

The visual question — how the map is drawn — is a design decision and belongs in a DDR. Two
consequences of it are architectural and are decided here:

1. **A major third-party runtime dependency** enters the renderer, in a codebase whose stated
   stance is dependency-minimal and whose other charts are deliberately hand-written.
2. **The renderer gains outbound network access** for the first time, which changes the app's
   security posture and touches its local-first, private framing (`docs/product.md`).

`CLAUDE.md` requires that an accepted decision is never silently overridden, and the "no remote
content" stance is recorded in both `index.html` and `CLAUDE.md`. Hence an ADR rather than an
inline change.

## Decision

### Adopt `mapbox-gl` as a renderer dependency

Accepted for the Allocation map specifically. The dependency-free inline-SVG convention
([[0006-app-shell-tab-navigation]], DDR-0006) continues to govern **every other chart**; this is a
scoped exception for geographic basemap rendering, not a general licence to add charting
libraries. A future chart still starts from inline SVG.

### Relax the CSP to exactly one external origin

`connect-src` admits `https://api.mapbox.com` and nothing else. `img-src` gains `blob:`, and
`worker-src` / `child-src` admit `blob:` so the library can compile its worker. Every other
directive is unchanged; `default-src` stays `'self'`.

### Block telemetry structurally, not by configuration

Mapbox GL JS posts usage telemetry to `events.mapbox.com` by default. **That origin is
deliberately omitted from `connect-src`**, so the browser blocks the requests at the platform
level regardless of library version, configuration flag, or future upgrade.

This is the enforcement mechanism for the story's privacy requirement, and it is chosen in the
same spirit as the ESLint-enforced layer boundaries ([[0002-typed-ipc-contract]] and the import
rules in `eslint.config.mjs`): an invariant that matters is enforced by tooling rather than left to
intent. The CSP carries a comment saying so, because a missing origin looks like an oversight to a
future reader and inviting them to "fix" it would silently undo this decision.

### Confine network access to the basemap surface

No application data crosses the network. Holdings, values, tickers, issuer countries, sectors and
NAV are computed in the renderer from locally imported Flex data and drawn as an overlay; only tile
and style requests leave the machine, carrying the public token and the current viewport. Panning
to a region weakly implies interest in it; it does not reveal that a holding exists there, let
alone its size.

This is a **narrowing of the offline guarantee, not of the data-privacy guarantee**. The analytics
data path remains entirely local: `allocationService` still reads only through
`flexReadRepository`, and the Allocation view still renders with the IBKR gateway closed.

### Token handling

The token is supplied as `RENDERER_VITE_MAPBOX_TOKEN` and inlined into the renderer bundle at
build time. It must therefore be a **public `pk.` token** with minimum scopes (`styles:read`,
`tiles:read`).

Mapbox scopes tokens by HTTP origin, but a packaged Electron renderer loads from `file://`, which
has no usable origin — **URL-based token restriction does not apply here** and must not be assumed
to be protecting the token. The available mitigations are scope minimisation and usage monitoring.

### Absence of token or network is a state, not an error

Consistent with [[0002-connection-state-as-ipc-result]] (DDR-0002), where connection failure became
a first-class result variant rather than an exception: a missing token, an unreachable tile
service, or a revoked token all render as a first-class "map unavailable" state. The rest of the
Allocation view — breakdown donuts, geography donut, positions table — stays fully usable, and the
app remains runnable on a fresh clone with no Mapbox account.

## Consequences

### Benefits

- Geographic identity becomes legible without interaction, which is the user problem Story #89
  exists to solve.
- The privacy-relevant guarantee is enforced by the runtime rather than by trust in a third-party
  library's defaults.
- The blast radius is small and reversible: one component, one origin, one directive set. Nothing
  below the renderer changes.
- No new IPC surface, and `sandbox: true` / `contextIsolation: true` / `nodeIntegration: false` are
  untouched — Mapbox GL JS is ordinary web content needing no main-process privilege.

### Tradeoffs

- `mapbox-gl` is ~800 KB gzipped, by a wide margin the largest dependency in the project; deleting
  the 54 KB silhouette does not offset it.
- Mapbox GL JS v3 is under the **Business Source License**, not open source, and map loads are
  metered against a Mapbox account. Comfortably inside the free tier for single-user personal use,
  but a different licensing posture from every other dependency here.
- "The renderer makes no network requests" is no longer true, and the claim in `CLAUDE.md` and
  `index.html` must now be read together with this ADR.
- The Allocation map no longer works fully offline. Accepted deliberately; the geography donut and
  positions table carry the same numbers when it does not.

### Risks

- **CSP drift.** Once one external origin is allowed, adding a second is a smaller step than
  adding the first was. Mitigated by keeping the allowlist to a single origin and by the telemetry
  comment making the policy's intent explicit.
- **Token exposure.** The token ships in the bundle and cannot be origin-restricted. Mitigated by
  scope minimisation and usage monitoring; a leaked public token costs quota, not data.
- **Upstream licensing or pricing change.** Mitigated by the overlay being independent of the
  basemap: the bubbles, centroids and sector logic are the app's own, so swapping the basemap
  provider later is a contained change.

## Alternatives Considered

### Option A — Keep the bundled SVG silhouette (status quo)

Zero dependencies, fully offline, no CSP change. Rejected: it is exactly the state that fails the
owner's need — no coastlines, borders, or labels, so a bubble cannot be identified without
hovering.

### Option B — MapLibre GL JS with a free tile provider

The open-source fork of Mapbox GL JS; BSD-licensed, no token, no metering. A genuine candidate,
and it would avoid the licensing tradeoff above. Not chosen: the owner has provisioned a Mapbox
account and token, and tile hosting would still require an external origin — so the CSP and offline
consequences recorded here would be identical. Recorded as the primary fallback should the
licensing or pricing posture change, since the overlay code is provider-independent.

### Option C — Bundle or self-host an offline tile set

Preserves the offline guarantee and needs no external origin. Rejected: a world tile set at usable
zoom is hundreds of megabytes, which is far worse than the 54 KB the silhouette cost and would
dominate the packaged app.

### Option D — Proxy tiles through the main process

Would keep the renderer network-free and the CSP untouched, routing tile requests over IPC.
Rejected: it adds a caching, streaming binary proxy for no privacy gain — the same requests reach
Mapbox either way — and puts a high-traffic media path through an IPC channel designed for typed,
Zod-validated domain messages ([[0002-typed-ipc-contract]]).

## Supersedes

None. This ADR **refines** the "no remote content" stance stated in `src/renderer/index.html` and
`CLAUDE.md`: the renderer makes no network requests **other than basemap tiles from the single
allowlisted origin**, and carries no application data off the machine.

The companion DDR-0019 supersedes [[0014-allocation-world-map-bubble-map]] on how the map is drawn.

## References

- Architecture Review for Story #89 (Epic #4, M3)
- Companion DDR-0019 (basemap and overlay design); supersedes DDR-0014
- [[0002-typed-ipc-contract]], [[0002-connection-state-as-ipc-result]] — outcome-as-data convention
- [[0004-interactive-brokers-integration]] — the main process as the only other network caller
- `docs/product.md` — local-first and private framing
- GitHub Issues #4 (Epic M3), #89 (Story), #46 / #70 / #71 (the map's prior rounds)
