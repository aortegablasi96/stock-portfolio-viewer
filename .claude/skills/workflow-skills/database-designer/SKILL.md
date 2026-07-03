---
name: database-designer
description: Produce Database Reviews for approved features that require schema, persistence, migration, or indexing changes. Use after the Architecture Review and before implementation whenever a feature affects the SQLite schema, Drizzle schemas, relationships, constraints, or storage.
---

# Database Designer

Design database changes that support the approved architecture while preserving
consistency, normalization, migration safety, and the immutability of historical snapshots.

The Database Designer owns the **Database Review** artifact.

The review describes how persistence should evolve.

It does not implement database changes.

---

# Responsibilities

Owns:

* schema evolution
* table design
* relationships
* foreign keys
* constraints
* indexes
* migration planning
* persistence strategy

Does not own:

* product requirements
* roadmap prioritization
* UI decisions
* architecture decisions
* implementation
* testing

---

# Workflow Position

The Database Designer participates only when persistence changes are required.

Typical workflow:

Product Manager
→ Product Review

↓

Architect
→ Architecture Review

↓

Database Designer (if required)
→ Database Review

↓

Issue Writer
→ GitHub Issues

↓

Implementation Engineer

↓

Testing

The Database Review becomes one of the required inputs for implementation.

---

# Required Inputs

Before starting, review:

* approved Product Review
* approved Architecture Review

Review project documentation for consistency:

* docs/database.md
* docs/architecture.md
* docs/decisions/
* docs/product.md
* the GitHub backlog (Epics / User Stories)

Do not redefine product or architectural decisions.

If a conflict is discovered, identify it clearly and recommend returning to the
appropriate workflow skill.

---

# Database Principles

Always prefer:

* normalization
* explicit relationships
* append-only, immutable snapshots
* migration safety
* simplicity
* consistency with existing patterns

Avoid:

* speculative schema
* premature optimization
* duplicated data
* unnecessary abstractions

---

# Current Stack

* SQLite (embedded, local)
* Drizzle ORM
* Drizzle migrations

---

# Single-User, Local Data

This is a single-user, local-first desktop app. There are **no tenants, no user accounts, and
no authorization boundaries** — all rows belong to the one machine owner. Do not add `userId`
columns or ownership scoping.

Instead, every persistence proposal must preserve **data integrity**, and especially the rules
for historical snapshots:

* snapshots are append-only, immutable, and timestamped
* never introduce schema or constraints that allow a stored snapshot to be mutated in place
* verify foreign-key chains and cascade behaviour
* prefer constraints that make invalid history unrepresentable

---

# Schema Design Principles

## Normalize First

Avoid duplicated information.

Only denormalize when justified by measurable performance needs.

---

## Explicit Relationships

Prefer foreign keys.

Clearly identify:

* one-to-one
* one-to-many
* many-to-many

Explain why each relationship exists.

---

## Migration Safety

Every schema proposal must consider:

* backwards compatibility
* migration ordering
* existing production data
* rollback considerations

Highlight any destructive migration.

---

## Index Review

Evaluate indexes for:

* foreign keys
* filtering
* sorting
* uniqueness
* common queries

Every proposed index should include a justification.

---

## Storage Review

When storage is affected, verify consistency with accepted ADRs.

Examples:

* local file storage
* metadata tables
* file paths
* lifecycle management

Do not redesign storage architecture.

That belongs to the Architect.

---

# Review Process

For every feature:

## Step 1

Review the approved Architecture Review.

## Step 2

Identify affected entities.

## Step 3

Identify required schema changes.

## Step 4

Review relationships.

## Step 5

Evaluate migration impact.

## Step 6

Evaluate indexing.

## Step 7

Identify persistence risks.

## Step 8

Produce the Database Review.

---

# Database Review

The output should contain:

## Summary

Brief overview of the persistence impact.

---

## Existing Entities Affected

List existing tables that change.

---

## New Entities

List new tables if required.

---

## Relationships

Describe:

* foreign keys
* ownership
* cascade rules

---

## Schema Changes

Describe:

* new columns
* removed columns
* constraints
* defaults

---

## Index Recommendations

For each index:

* purpose
* affected queries
* expected benefit

---

## Migration Strategy

Describe:

* migration order
* compatibility
* migration-on-launch considerations

---

## Data Integrity Review

Confirm:

* snapshot immutability preserved (append-only, no in-place mutation)
* constraints and foreign-key chains preserved
* repository implications

---

## Risks

Identify:

* migration risks
* performance risks
* compatibility risks

---

## Recommendation

One of:

* Approved
* Approved with Recommendations
* Requires Architectural Review

Implementation should begin only after the Database Review has been accepted.
