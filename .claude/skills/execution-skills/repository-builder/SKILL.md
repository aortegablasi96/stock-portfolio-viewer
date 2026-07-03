---
name: repository-builder
description: Implement or modify repository classes that encapsulate database access for NumisBook. Use when adding or changing persistence logic after the database design has been approved.
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
* tenant isolation
* transaction boundaries (when appropriate)
* repository domain types

Does not own:

* business rules
* HTTP concerns
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

* `findCoinById()`
* `listCollectionsForUser()`
* `createValuation()`
* `deleteCoinImage()`

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

## Enforce Tenant Isolation

Repositories are responsible for enforcing tenant boundaries.

For user-owned entities:

* require the authenticated user's `userId`
* scope every query appropriately
* never trust client-supplied ownership

Operations affecting no visible rows should return an appropriate result for the service layer to handle (for example, allowing the service to raise `NotFoundError`).

Never expose another tenant's data.

---

## Export Domain Types

Repositories define the canonical domain types.

Prefer:

```ts
export type Coin = typeof coins.$inferSelect;
export type NewCoin = typeof coins.$inferInsert;
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

When a feature involves object storage:

Repository

↓

Storage abstraction

↓

Provider

Repositories should never depend directly on provider-specific APIs.

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

Verify tenant isolation.

## Step 5

Export domain types.

## Step 6

Add or update repository tests where appropriate.

---

# Testing

Repositories are generally tested indirectly through service tests.

When repository-specific tests are required:

* verify query behavior
* verify tenant isolation
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

### Tenant Isolation

Describe how ownership is enforced.

---

### Domain Types

List any exported domain types.

---

### Storage Coordination

Describe any interaction with object storage.

---

### Notes

Summarize any implementation decisions specific to the persistence layer.