---
name: repository-builder
description: Implement or modify repository classes that encapsulate database access for Stock Portfolio Viewer. Use when adding or changing persistence logic after the database design has been approved.
---

# Repository Builder

Implement the persistence layer.

Repositories encapsulate all database access and expose intention-revealing operations to the service layer.

They are the only layer allowed to interact directly with Drizzle.

---

# Responsibilities

Owns:

* database queries
* persistence logic
* mapping database rows to domain objects
* transaction boundaries (when appropriate)
* repository domain types

Does not own:

* business rules
* IPC concerns
* UI
* request validation
* application workflows

Repositories answer "how data is stored."

Services answer "what the application does."

---

# Workflow Position

Typical workflow:

Database Review

↓

Repository Builder

↓

Service Builder

Repositories implement the approved database design.

---

# Required Inputs

Review:

* approved Database Review
* approved Architecture Review
* approved Implementation Plan

Review project documentation:

* CLAUDE.md
* docs/database.md
* docs/architecture.md
* docs/decisions/

Review similar repositories before creating new ones.

---

# Architectural Principles

## Repositories Own Database Access

Repositories are the only layer that may import:

* `@/db`
* `@/db/schema`

No other layer should execute Drizzle queries.

---

## Use Intention-Revealing Methods

Repository methods should describe business intent.

Prefer:

* `findHoldingById()`
* `listPortfoliosForAccount()`
* `createSnapshot()`
* `deleteStaleAnalyticsCache()`

Avoid generic CRUD names when a more meaningful name exists.

---

## Keep Repositories Thin

Repositories perform:

* querying
* persistence
* mapping

Do not implement:

* business rules
* calculations
* workflows
* orchestration

Those belong in services.

---

## Scope by Domain, Not by Tenant

This is a single-user, local application — there is **no multi-tenancy and no
authenticated user** to scope by. Scope queries by the domain concepts that exist (e.g.
brokerage `accountId`, snapshot timestamp) rather than by user identity.

Operations affecting no rows should return an appropriate result for the service layer to handle (for example, allowing the service to raise `NotFoundError`).

---

## Export Domain Types

Repositories define the canonical domain types.

Prefer:

```ts
export type Holding = typeof holdings.$inferSelect;
export type NewHolding = typeof holdings.$inferInsert;
```

Other layers should import these types from repositories rather than directly from the schema.

---

## Reuse Existing Schema

Never duplicate schema definitions.

Reuse the approved Drizzle schema.

Schema changes belong to the Database Designer.

---

## Storage Responsibilities

Repositories coordinate persistence.

When a feature involves stored files (e.g. exported reports):

Repository

↓

Storage abstraction

↓

Local filesystem (app data directory)

Repositories should never depend directly on storage-implementation details.

---

# Query Design

Prefer:

* clear query composition
* explicit filtering
* intentional ordering
* efficient joins
* reusable helper functions when appropriate

Evaluate whether indexes assumed by the queries exist.

Avoid unnecessary query complexity.

---

# Implementation Process

## Step 1

Review the approved schema.

## Step 2

Review existing repositories.

## Step 3

Implement repository methods.

## Step 4

Verify query scoping (e.g. by `accountId`) is correct.

## Step 5

Export domain types.

## Step 6

Add or update repository tests where appropriate.

---

# Testing

Repositories are generally tested indirectly through service tests.

When repository-specific tests are required:

* verify query behavior
* verify query scoping (e.g. by `accountId`)
* verify persistence behavior
* verify storage coordination
* verify edge cases

Avoid testing business rules in repository tests.

---

# Output

## Repository Implementation Summary

### Repository

...

---

### Methods Added

* ...

---

### Methods Modified

* ...

---

### Query Scoping

Describe how queries are scoped (e.g. by `accountId`).

---

### Domain Types

List any exported domain types.

---

### Storage Coordination

Describe any interaction with local file storage.

---

### Notes

Summarize any implementation decisions specific to the persistence layer.