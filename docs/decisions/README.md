# Architecture Decision Records (ADRs)

This directory holds **accepted decisions** for Stock Portfolio Viewer. ADRs are the highest tier
of the documentation hierarchy — they override the prose docs (`product.md`,
`architecture.md`, `database.md`, etc.) when they conflict.

ADRs are authored via the `adr-writer` governance skill.

## Conventions

- One file per decision: `NNNN-short-title.md` (e.g. `0001-use-drizzle-orm.md`).
- Numbers are zero-padded and increase monotonically.
- Never silently override an accepted decision. To change one, write a new ADR that
  supersedes it and mark the old one `Superseded by NNNN`.

## Suggested Template

```markdown
# NNNN. <Title>

- **Status:** Proposed | Accepted | Superseded by NNNN
- **Date:** YYYY-MM-DD

## Context

What problem or force prompted this decision?

## Decision

What we decided to do.

## Consequences

Trade-offs, follow-ups, and what becomes easier or harder.
```

No ADRs have been recorded yet.
