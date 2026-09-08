# `docs`

The project's written record. **Decisions outrank prose**: where a file here conflicts with an
accepted ADR, the ADR wins, and an accepted decision is never silently overridden — to change
one, write a new record that supersedes it.

Consult in this order:

1. **[`decisions/`](decisions)** — Architecture Decision Records. The highest tier; they override
   every prose doc below. Authored via the `adr-writer` governance skill.
2. **[`design-decisions/`](design-decisions)** — Design Decision Records: UI/UX and lower-level
   choices, more granular than an ADR but still worth recording. Authored via `design-recorder`.
   Promote one to an ADR if it turns out to have architectural impact.
3. **[`product.md`](product.md)** — what the app is for, its current capabilities, and the
   guardrails: it proposes and never acts, and it never sets the owner's policy.
4. **GitHub Issues** — where work originates. The owner authors Epics and Stories; issues are
   never created after implementation to record work already done.
5. **[`architecture.md`](architecture.md)** — layering, process boundaries, and the IPC surface,
   expanding on `CLAUDE.md`.
6. **[`database.md`](database.md)** — the schema in prose: tables, conventions, and why history is
   append-only.

Also here:

- **[`mcp.md`](mcp.md)** — setup notes for the configured MCP servers.
- **[`github-issues.md`](github-issues.md)** — the issue and Epic lifecycle. An Epic closes with
  its stories, and refinement opens a *new* area-scoped Epic rather than reopening a delivered
  one; the one narrow exception and its precedent are recorded there.

Both record directories have a **README indexing every entry in one line**. Keep the index in step
when adding a record — it is what makes over a hundred records searchable without opening them.

## Conventions

One file per decision, `NNNN-short-title.md`, zero-padded and monotonically increasing. A record
carries its status (`Proposed` | `Accepted` | `Superseded by NNNN`), its date, the context that
forced it, the decision, and the consequences. Each runs 8–20 KB and carries its own reasoning —
which is why `CLAUDE.md` cites a record number rather than repeating the argument.

## Two directories a fresh clone will not have

Both are **gitignored** and their absence is normal:

- **`flex-queries/`** — real Flex Query exports from the owner's account. They are the reference
  for what an XML section actually looks like; check them before guessing at a shape, or before
  concluding a section is missing (#171 was filed on a false premise). Without them the parser's
  tests fall back to an inline fixture.
- **`figma_design/`** — a design reference, never built or imported by `src/`. It carries **its own
  `CLAUDE.md` / `AGENTS.md` that replace the root one** for work inside it.
