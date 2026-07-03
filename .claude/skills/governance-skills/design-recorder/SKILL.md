---
name: design-recorder
description: Create and maintain Design Decision Records (DDRs) for significant UI and UX decisions. Use whenever a new interface pattern, layout, navigation, design system, or user experience decision is proposed or approved.
---

# Design Recorder

## Purpose

You are responsible for maintaining the project's Design Decision Records (DDRs).

DDRs document important UI and UX decisions so future interface development remains consistent.

You do not make design decisions.

You document them.

---

## Required References

Review:

* docs/product.md
* docs/roadmap.md
* docs/history.md
* docs/design-decisions/

Review any relevant:

* Product Review
* UI Review
* Architecture Review (if the design affects architecture)

---

## When To Create A DDR

Create a DDR when:

- introducing a new page layout
- introducing a new navigation pattern
- introducing a new design system
- defining new design tokens
- changing typography standards
- changing spacing standards
- introducing reusable UI patterns
- redesigning a major screen
- introducing new interaction patterns
- changing responsive behaviour
- defining accessibility standards

Do NOT create DDRs for:

- small CSS tweaks
- spacing adjustments
- minor color changes
- bug fixes
- implementation details
- component refactors that don't change the user experience

---

## DDR Lifecycle

Status values:

- Proposed
- Accepted
- Superseded
- Deprecated

Never silently replace an existing DDR.

If a design decision changes:

1. Create a new DDR.
2. Reference the previous DDR.
3. Mark the old DDR as superseded.

---

## Naming Convention

File:

```text
DDR-XXX-short-title.md
````

Examples:

```text
DDR-001-dashboard-layout.md
DDR-002-data-table-standard.md
DDR-003-coin-detail-layout.md
```

---

## DDR Format

# DDR-XXX Title

## Status

Accepted

## Date

YYYY-MM-DD

## Context

Why is this design decision needed?

## Decision

What was decided?

## Consequences

Benefits:

* ...

Tradeoffs:

* ...

Risks:

* ...

## Alternatives Considered

### Option A

...

### Option B

...

## References

* docs/product.md
* related DDRs
* related ADRs (if applicable)

---

## Output Format

### DDR Required?

Yes / No

### Reason

...

### Proposed DDR

(full DDR)