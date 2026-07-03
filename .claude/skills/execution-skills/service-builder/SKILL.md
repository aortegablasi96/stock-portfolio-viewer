---
name: service-builder
description: Implement or modify business services for NumisBook. Use when adding or changing domain behavior after the architecture and repository design have been approved.
---

# Service Builder

Implement business services.

Services contain the application's business rules and orchestrate interactions between repositories and other domain services.

They are framework-agnostic and independent of HTTP, React, and database implementation details.

---

# Responsibilities

Owns:

* business rules
* domain workflows
* orchestration
* domain validation
* coordinating repositories
* coordinating storage abstractions
* throwing domain errors

Does not own:

* HTTP
* request validation
* UI
* SQL queries
* database schema

Services answer "what the application should do."

Repositories answer "how data is stored."

---

# Workflow Position

Typical workflow:

Repository Builder

↓

Service Builder

↓

API Builder

Services expose business capabilities to the rest of the application.

---

# Required Inputs

Review:

* approved Product Review
* approved Architecture Review
* approved Database Review (if applicable)
* approved Implementation Plan

Review project documentation:

* CLAUDE.md
* docs/architecture.md
* docs/database.md
* docs/decisions/

Review existing services before creating new ones.

---

# Architectural Principles

## Services Own Business Logic

Services implement:

* business rules
* workflows
* domain validation
* orchestration

They should not contain:

* SQL
* Drizzle queries
* React components
* HTTP request handling

---

## Remain Framework-Agnostic

Services should not depend on:

* Next.js
* Route Handlers
* React
* Request
* Response

Services operate on plain TypeScript values and return domain objects.

---

## Coordinate Repositories

Services orchestrate repository operations.

A service may:

* call multiple repositories
* coordinate storage
* coordinate transactions
* enforce business invariants

Repositories should never coordinate each other directly.

---

## Validate Domain Rules

API routes validate request shape.

Services validate business rules.

Examples include:

* preventing invalid state transitions
* enforcing ownership rules
* checking required domain conditions
* rejecting duplicate operations where appropriate

---

## Throw Typed Errors

Known business failures should throw project-specific errors such as:

* `ValidationError`
* `NotFoundError`

Avoid throwing raw `Error` for expected domain failures.

Routes are responsible for translating domain errors into HTTP responses.

---

## Keep Services Focused

A service should represent a coherent business capability.

Prefer:

* small, focused methods
* intention-revealing names
* reusable private helpers where appropriate

Avoid:

* large procedural methods
* duplicated business logic
* unrelated responsibilities

---

## Respect Layer Boundaries

Services may depend on:

* repositories
* storage abstractions
* shared libraries
* other services (when justified)

Services must never depend on:

* database implementation
* UI components
* Route Handlers

---

# Implementation Process

## Step 1

Review the approved business requirements.

## Step 2

Review existing services.

## Step 3

Implement the required business logic.

## Step 4

Coordinate repositories and supporting services.

## Step 5

Handle expected domain failures.

## Step 6

Add or update service tests.

---

# Testing

Services are the primary unit-testing target.

Mock:

* repositories
* storage abstractions
* external APIs
* AI services
* other external dependencies

Verify:

* business rules
* workflow execution
* edge cases
* failure paths
* domain errors
* interactions with repositories

Avoid testing SQL or HTTP behavior in service tests.

---

# Output

## Implementation Summary

### Files Created

* ...

---

### Files Modified

* ...

---

### Business Capabilities Added

* ...

---

### Repository Interactions

Summarize any repositories coordinated by the service.

---

### Domain Errors

List any new or modified domain error handling.

---

### Tests Added or Updated

* ...

---

### Notes

Summarize any implementation decisions specific to the service layer.