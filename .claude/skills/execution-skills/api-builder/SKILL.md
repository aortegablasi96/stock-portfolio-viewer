---
name: api-builder
description: Implement thin Electron IPC handlers that expose approved services to the React renderer over IPC. Use when adding or modifying IPC handlers after the service layer has been designed or implemented.
---

# API Builder

Implement the IPC handlers that let the React renderer call the Electron main process.

An IPC handler translates an invocation from the renderer into a service call.

It does not contain business logic.

Stock Portfolio Viewer is a **single-user, local-first desktop application**: there is no HTTP
server, no network API, and no authentication. The "API" is the typed **IPC boundary** between
the renderer and the main process.

---

# Responsibilities

Owns:

* IPC handler registration (`ipcMain.handle`)
* validating the channel payload (Zod)
* delegating to services
* shaping the serializable result returned to the renderer
* mapping domain errors into a serializable error result

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

Review the existing IPC handlers and the preload bridge before adding new channels.

---

# Architectural Principles

## Keep Handlers Thin

Every handler follows the same pattern:

Validate payload

↓

Call service

↓

Return serializable result

Avoid placing business logic inside handlers.

---

## Name Channels by Domain

Namespace channels by domain and action, for example `portfolio:getHoldings`,
`snapshots:capture`, `analytics:performance`. Keep the channel list explicit and expose it to
the renderer through the preload **contextBridge** as a typed API surface. The renderer must
only reach the main process through that allowlisted bridge — never through `ipcRenderer`
directly, and never by touching repositories or data sources.

---

## Validate Inputs

Validate every payload crossing the IPC boundary using the project's Zod schemas. Treat the
renderer as untrusted input even though it runs locally. Services receive already-validated
data.

---

## Single Owner — No Authentication

There is no user authentication and no multi-tenancy. All data belongs to the single machine
owner, and the desktop OS account is the security boundary. Do not add user identifiers,
sessions, or ownership scoping.

---

## Error Handling

Services throw typed `AppError` instances. Handlers either re-throw (so `ipcRenderer.invoke`
rejects in the renderer) or return a structured error result — follow the existing convention.
Because IPC serializes values, never return non-serializable values (class instances,
functions, `Date` where a primitive is expected); return plain, serializable data.

---

# Implementation Process

## Step 1

Review the existing service interface.

## Step 2

Review similar IPC handlers and the preload bridge.

## Step 3

Validate the channel payload with Zod.

## Step 4

Invoke the service.

## Step 5

Return a serializable result (or structured error).

## Step 6

Expose the channel through the preload bridge if it is new.

## Step 7

Add or update handler tests.

---

# Testing

Follow the project's testing conventions.

Mock:

* the called service modules

Use real Zod validation.

Verify:

* successful invocations
* validation failures
* `AppError` mapping to the error result / rejection
* result serializability
* the channel is exposed through the preload bridge

---

# Output

## IPC Implementation Summary

### Channels Added or Modified

* ...

---

### Payload Validation

Describe any new or updated validation schemas.

---

### Error Handling

Describe how domain errors surface to the renderer.

---

### Result Changes

Summarize any new or modified result shapes.

---

### Tests Added or Updated

* ...

---

### Notes

Summarize any implementation details relevant to the IPC layer.
