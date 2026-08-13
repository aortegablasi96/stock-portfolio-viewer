# Design Decision Records (DDRs)

This directory holds **design decisions** for Stock Portfolio Viewer — UI/UX and lower-level design
choices that are more granular than full ADRs but still worth recording. In the
documentation hierarchy, DDRs sit just below ADRs in `docs/decisions/`.

DDRs are authored via the `design-recorder` governance skill.

## Conventions

- One file per decision: `NNNN-short-title.md` (e.g. `0001-dashboard-layout.md`).
- Numbers are zero-padded and increase monotonically.
- If a design decision turns out to have architectural impact, promote it to an ADR in
  `docs/decisions/` and reference it here.

## Suggested Template

```markdown
# NNNN. <Title>

- **Status:** Proposed | Accepted | Superseded by NNNN
- **Date:** YYYY-MM-DD

## Context

The design problem and constraints.

## Decision

The chosen design and why.

## Alternatives Considered

Other options and why they were not chosen.
```

## Recorded DDRs

- `0001` — Read-only dashboard layout and data-loading state pattern
- `0002` — Model connection/load outcome as a discriminated-union IPC result
- `0003` — Snapshot persistence model, money representation, and capture policy
- `0004` — Flex import persistence: real-valued multi-currency amounts, append-only, two-tier de-dupe
- `0005` — M3 analytics read model, base-currency conversion, and per-period aggregation
- `0006` — App shell: client-side tab navigation for analytics views
- `0007` — Portfolio display currency: live IBKR FX source + selector/display conventions
- `0008` — Performance view: daily portfolio-value reconstruction from Flex MTM history
- `0009` — Sector classification: gateway-sourced, locally cached; allocation as donut charts
- `0010` — Upcoming dividends from Flex open accruals; net-of-withholding chart reading
- `0011` — Custom frameless window shell with in-app title bar and IPC-driven controls
- `0012` — In-place confirmation pattern for destructive actions (ConfirmAction)
- `0013` — Performance view: cumulative TWR curve, chart tabs, and shared interactive hover
- `0014` — Allocation view: geographic exposure as an equirectangular bubble map *(superseded by 0019 on the basemap; data semantics still apply)*
- `0015` — Allocation view: cash as an asset class, derived from the NAV residual
- `0016` — Dividend rows: shares held reconstructed from trades; per-share divided out of the amount
- `0017` — Analytics tables: time-range filter anchored to the data, composed with the type filter
- `0018` — One shared content measure for the shell; charts sized by aspect ratio
- `0019` — Allocation map: Mapbox basemap with an SVG bubble overlay (supersedes `0014`) *(superseded by 0020 on the overlay; basemap decisions still apply)*
- `0020` — Allocation map: one canvas circle per holding, with a hover popup (supersedes `0019`) *(superseded by 0030 on the unit, spread, canvas layer and per-holding granularity; approximation and a11y stance still apply)*
- `0021` — Allocation map: the gain/loss colour scale (red↔gray↔blue, fixed ±25%; extends `0020`) *(superseded by `0045`; its `--pos`/`--neg` rule still applies)*
- `0022` — Bounded gateway requests; a stalled gateway as its own `not_responding` state (extends `0002`)
- `0023` — Classification refresh: resumable (persist before reporting) and progress-reporting (extends `0009`)
- `0024` — Gateway reads coalesced in the repository behind a short freshness window; FX fetched concurrently (extends `0022`)
- `0025` — Single-instance lock: the second launch quits before touching the database and focuses the first (extends `0011`)
- `0026` — The Flex store describes itself: stored statements + coverage span, read on launch (extends `0004`)
- `0027` — Analytics tabs stay mounted; a re-read becomes explicit and non-destructive (extends `0006`)
- `0028` — Window size/position/maximized remembered in `app_meta`; reachability judged on the title bar (extends `0011`)
- `0029` — Tab shell: the complete ARIA tabs pattern, roving tabindex, automatic activation (extends `0006`)
- `0030` — Allocation map: two donuts per country (country weight + sectors); per-holding marks retired; palette blue reserved from sectors (supersedes `0020`)
- `0031` — Spacing, radius, type and focus scales on `:root`; one focus ring as a zero-specificity base rule (extends `0018`)
- `0032` — One `Button` primitive: seven role-named variants, four sizes, `className` for placement only (extends `0031`)
- `0033` — One `Card` primitive: `default`/`nested` surfaces, `--surface-pad-*` sizes, sentence-case titles, `CardContent` as the body scope (extends `0032`)
- `0034` — One `StatTile`: no surface of its own (the card supplies it), `tone` as the only axis, neutral as the absence of a tone (extends `0033`)
- `0035` — One `Field` owning an explicit `htmlFor` and a generated id; one `.control` box for `Select`/`DateInput`, `kind` as the only axis (extends `0034`)
- `0036` — One `ToggleGroup`: `mode` as the only axis (single-select box vs multi-select pill), `aria-pressed` buttons replacing three tablists that never implemented the pattern (extends `0035`)
- `0037` — One `Badge`: `variant` as boundary and ink, `size` as inline chip vs standalone label; never a pill, because `0036` spent that corner on "pressable" (extends `0036`)
- `0038` — One `StatePanel`: `variant` as the state (loading/empty/notice/error), `surface` as "does it bring a card"; element and ARIA role derived, only `error` paints (extends `0037`)
- `0039` — One `DataTable`: `surface`/`height` on the container (retiring the `.card-content` override), sorting opt-in per column, missing values last in both directions (extends `0038`)
- `0040` — Allocation breakdown: table and donut link on hover; emphasis keyed on slice identity, muting rather than recolouring (extends `0039`)
- `0041` — Map popup return tint: banked into the edges as a gradient whose band is the content padding, so colour never passes behind text (extends `0030`, `0021`)
- `0042` — Token adoption held by a ratchet: `BASELINE` may only shrink and a dead entry fails; exemptions enumerated by hand, because two mechanical rules leaked. Amended by #152, which emptied the baseline and exempted three sub-4px hairlines (extends `0031`)
- `0043` — One `AnalyticsShell` for the four analytics views: a render prop over the report, `subject` as the axis, branch mapping and state wording in a pure module (extends `0038`, `0027`)
- `0044` — Two durations, two easings; reduced motion honoured by redefining the tokens to `0ms` rather than listing what moves, so a raw duration is the only way out (extends `0031`)
- `0045` — Allocation map: one view, coloured by sector; the gain/loss mode and the `--diverge-*` scale withdrawn, the popup's return tint kept (supersedes `0021`, whose `--pos`/`--neg` rule still governs)
- `0046` — Contrast: the loss tone splits (`--neg` for fills, `--neg-text` for text) and `--accent-strong` fills the primary button, so neither validated palette moves; guarded by a Node test that measures hover states too (extends `0021`, `0034`, `0032`)
- `0047` — The Allocation map is a labelled `group`, not an `img`: it must contain Mapbox's attribution links, so the graphics are made inert instead (canvas and markers `tabindex="-1"`, `keyboard: false`); guarded by a comment-stripped text scan (extends `0030`, `0046`)
- `0048` — Tab icons are a second channel beside the label (never its name), one shared `Glyph` frame, sized `1em` from the type scale, drawn in `currentColor`; guarded by a comment-stripped text scan (extends `0029`, `0031`)
- `0049` — Performance daily-return bars: chain-linked from the TWR curve (never differenced from value), thinned rather than aggregated because aggregation destroys the volatility the chart exists to show; own component sharing `columnDomain` and the 4.5:1 ratio (extends `0013`, `0018`)
- `0050` — Daily NAV comes from `EquitySummaryInBase` (already exported, never parsed), so the value curve is the broker's series rather than `0008`'s reconstruction, which stays as the fallback; composition is 100%-stacked with negative bands below the baseline and an `other` residual that is surfaced, not redistributed (supersedes `0008`; extends `0005`, `0015`, `0018`)
- `0051` — Performance: the four charts in a 2×2 grid replacing the switcher; the shared plot re-cut to 500×180 (≈2.78:1) so a half-column keeps its axis labels legible, collapsing to one column at 1200px; geometry shared in `lib/chartGeometry` and checked by a walk over the layout (extends `0018`, `0049`, `0050`)
