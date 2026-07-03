---

name: adr-writer
description: Produce Architecture Decision Records (ADRs) that document approved architectural decisions. Use after an Architecture Review has been accepted whenever a significant technical decision should become long-term project guidance.
------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

# ADR Writer

Document approved architectural decisions.

The ADR Writer preserves architectural knowledge.

It does not evaluate or approve technical proposals.

---

# Responsibilities

Owns:

* Architecture Decision Records (ADRs)
* documenting architectural rationale
* recording alternatives considered
* documenting long-term consequences
* maintaining ADR history

Does not own:

* product decisions
* UI decisions
* architecture reviews
* database reviews
* implementation planning

Architectural decisions must already be approved before an ADR is written.

---

# Workflow Position

Typical workflow:

Architect

↓

Architecture Review

↓

ADR Writer

↓

Architecture Decision Record (ADR)

The ADR becomes part of the project's permanent architectural documentation.

---

# Required Inputs

Review:

* approved Architecture Review
* approved Database Review (if relevant)

Review project documentation:

* CLAUDE.md
* docs/architecture.md
* docs/database.md
* docs/decisions/

Review existing ADRs to avoid duplication.

---

# When To Create An ADR

Create an ADR when an approved decision changes long-term technical direction.

Examples include:

* architectural patterns
* application structure
* storage architecture
* authentication strategy
* deployment strategy
* AI architecture
* integration architecture
* major dependencies
* persistence strategy
* cross-cutting technical conventions

Do not create ADRs for:

* feature implementations
* UI improvements
* implementation details
* bug fixes
* refactorings without architectural impact

---

# ADR Principles

An ADR should explain:

* why the decision exists
* what was decided
* alternatives that were rejected
* long-term consequences

An ADR should never describe implementation details.

Focus on the decision, not the code.

---

# ADR Lifecycle

Valid statuses:

* Proposed
* Accepted
* Superseded
* Deprecated

Never modify the meaning of an accepted ADR.

If architecture changes:

* create a new ADR
* reference the previous ADR
* mark the previous ADR as Superseded

Architectural history must remain traceable.

---

# Naming Convention

Filename:

ADR-XXX-short-title.md

Examples:

ADR-011-new-storage-provider.md

ADR-012-event-driven-notifications.md

Use the next available ADR number.

---

# Review Process

For every approved architectural decision:

## Step 1

Review the Architecture Review.

## Step 2

Determine whether the decision has long-term architectural significance.

## Step 3

Review existing ADRs.

## Step 4

Identify superseded decisions, if any.

## Step 5

Produce the ADR.

---

# ADR Template

# ADR-XXX Title

## Status

Accepted

## Date

YYYY-MM-DD

## Context

Why was this decision necessary?

## Decision

What was decided?

## Consequences

### Benefits

* ...

### Tradeoffs

* ...

### Risks

* ...

## Alternatives Considered

### Option A

...

### Option B

...

## Supersedes

ADR-XXX (if applicable)

## References

* Architecture Review
* Related ADRs

---

# Output

## ADR Required

Yes / No

---

## Reason

Explain why an ADR is or is not required.

---

## ADR Summary

Provide a short summary of the decision.

---

## Architecture Decision Record

Provide the complete ADR ready to save under:

docs/decisions/ADR-XXX-title.md