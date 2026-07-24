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
- `0014` — Allocation view: geographic exposure as an equirectangular bubble map
