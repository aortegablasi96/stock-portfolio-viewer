---
name: api-builder
description: Implement Electron IPC handlers that expose approved services to the React renderer through a thin, typed bridge. Use when adding or modifying the renderer↔main IPC surface after the service layer has been designed or implemented.
---

# API Builder

Implement the application's internal **API surface** — the Electron **IPC handlers** that
expose business services to the React renderer.

In this desktop app there is no HTTP server and no browser-to-server network hop. The
renderer (UI) calls the main process over a typed IPC bridge; handlers in the main process
translate those calls into service calls.

IPC handlers do not contain business logic.

---

# Responsibilities

Owns:

* IPC channel handlers (`ipcMain.handle` registrations)
* the typed preload bridge exposed to the renderer
* input validation at the IPC boundary
* result/error shaping for IPC responses
* mapping domain errors to structured IPC error results

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

IPC handlers expose existing business capabilities to the renderer.

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

Review existing IPC handlers before creating new channels.

---

# Architectural Principles

## Keep Handlers Thin

Every handler should follow the same pattern:

Validate input

↓

Call service

↓

Return a serializable result

Avoid placing business logic inside IPC handlers.

---

## A Single-User, Local Context

This is a single-user desktop app. There is **no authentication, no session, and no
tenant isolation** — the only actor is the owner of the machine. Do not invent `userId`
parameters or ownership checks at the IPC boundary; scope data by domain concepts that
actually exist (e.g. brokerage `accountId`), not by user identity.

---

## Use a Typed, Minimal Bridge

Expose IPC to the renderer through a `contextBridge` preload that surfaces a small, typed
API (e.g. `window.api.portfolio.get()`), not raw `ipcRenderer`. Keep `nodeIntegration`
off and `contextIsolation` on. Never expose arbitrary channel access or Node APIs to the
renderer.

---

## Validate Inputs

Validate all input crossing the IPC boundary using the project's Zod schemas.

Validation belongs at the IPC boundary.

Services should receive validated data.

---

## Error Handling

Services throw typed `AppError` instances.

Handlers translate them into a consistent serializable error result (errors do not cross
IPC as live `Error` objects — return a plain `{ ok: false, error }` shape or rethrow a
sanitized message). Avoid leaking stack traces or internal details to the renderer.

---

## Result Design

Return concise, consistent, **serializable** results (plain objects/arrays — no class
instances, Dates become ISO strings, etc.). Prefer existing result shapes over inventing
new ones. A common convention is a discriminated result:

* `{ ok: true, data }`
* `{ ok: false, error: { code, message } }`

---

# Implementation Process

## Step 1

Review the existing service interface.

## Step 2

Review similar IPC handlers and the preload bridge.

## Step 3

Validate the input.

## Step 4

Invoke the service.

## Step 5

Return the appropriate serializable result.

## Step 6

Expose the channel through the typed preload bridge.

## Step 7

Add or update IPC handler tests.

---

# Testing

Follow the project's testing conventions.

Mock:

* called service modules

Use real Zod validation.

Verify:

* successful calls
* validation failures
* AppError mapping to error results
* result structure and serializability

---

# Output

## IPC Implementation Summary

### Channels Added or Modified

* ...

---

### Input Validation

Describe any new or updated validation schemas.

---

### Bridge Changes

Describe any additions to the typed preload bridge.

---

### Result Changes

Summarize any new or modified result shapes.

---

### Tests Added or Updated

* ...

---

### Notes

Summarize any implementation details relevant to the IPC layer.
