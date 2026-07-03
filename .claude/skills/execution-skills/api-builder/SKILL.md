---
name: api-builder
description: Implement Next.js API routes by exposing approved services through thin HTTP endpoints. Use when adding or modifying API routes after the service layer has been designed or implemented.
---

# API Builder

Implement HTTP APIs that expose the application's business services.

API routes translate HTTP requests into service calls.

They do not contain business logic.

---

# Responsibilities

Owns:

* API route handlers
* request validation
* authentication
* response shaping
* HTTP status codes
* error mapping

Does not own:

* business logic
* database access
* schema design
* repository implementation
* UI

Business behavior belongs in services.

---

# Workflow Position

Typical workflow:

Service Builder

↓

API Builder

↓

UI Builder

API routes expose existing business capabilities.

---

# Required Inputs

Review:

* approved Architecture Review
* approved Implementation Plan
* relevant service implementation

Review project documentation:

* CLAUDE.md
* docs/architecture.md
* docs/decisions/

Review existing route implementations before creating new endpoints.

---

# Architectural Principles

## Keep Routes Thin

Every route should follow the same pattern:

Validate request

↓

Authenticate user

↓

Call service

↓

Return response

Avoid placing business logic inside route handlers.

---

## Use Shared API Helpers

Reuse existing helpers whenever possible.

Current shared helpers include:

* `currentUser()`
* `unauthorized()`
* `errorResponse()`

Do not duplicate common API logic.

---

## Validate Inputs

Validate all client input using the project's Zod schemas.

Validation belongs at the API boundary.

Services should receive validated data.

---

## Authentication

Never trust user identifiers supplied by the client.

Resolve the authenticated user from the session.

Pass the resolved domain user into services.

Tenant ownership must always be enforced by the service and repository layers.

---

## Error Handling

Services throw typed `AppError` instances.

Routes translate them into HTTP responses using the shared error helpers.

Avoid manual error mapping unless required by an endpoint.

---

## Response Design

Return concise, consistent JSON.

Prefer existing response shapes over inventing new ones.

Use appropriate HTTP status codes:

* 200 OK
* 201 Created
* 204 No Content
* 400 Bad Request
* 401 Unauthorized
* 404 Not Found
* 500 Internal Server Error

---

# Implementation Process

## Step 1

Review the existing service interface.

## Step 2

Review similar API routes.

## Step 3

Validate request inputs.

## Step 4

Authenticate the request.

## Step 5

Invoke the service.

## Step 6

Return the appropriate HTTP response.

## Step 7

Add or update API route tests.

---

# Testing

Follow the project's API testing conventions.

Mock:

* `@/auth`
* `@/services/auth.service`
* called service modules

Use real Zod validation.

Verify:

* successful requests
* validation failures
* unauthorized requests
* AppError mapping
* response structure
* expected status codes

---

# Output

## API Implementation Summary

### Endpoints Added or Modified

* ...

---

### Request Validation

Describe any new or updated validation schemas.

---

### Authentication

Describe how authentication is enforced.

---

### Response Changes

Summarize any new or modified response shapes.

---

### Tests Added or Updated

* ...

---

### Notes

Summarize any implementation details relevant to the API layer.