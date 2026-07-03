---
name: storage-builder
description: Implement storage-backed features using NumisBook's object storage abstraction. Use when adding or modifying functionality that stores, retrieves, transforms, or deletes binary objects such as images or documents.
---

# Storage Builder

Implement features that persist binary objects using the project's object storage abstraction.

All storage access must remain provider-independent and integrate cleanly with the repository layer.

---

# Responsibilities

Owns:

* object storage integration
* storage abstractions
* upload workflows
* download workflows
* deletion workflows
* metadata coordination
* storage lifecycle management

Does not own:

* database schema
* business rules
* API design
* UI
* storage provider selection

Storage providers are an implementation detail.

---

# Workflow Position

Typical workflow:

Database Review

↓

Repository Builder

↓

Storage Builder

↓

API Builder

Storage implementation follows the approved architecture and database design.

---

# Required Inputs

Review:

* approved Architecture Review
* approved Database Review
* approved Implementation Plan

Review project documentation:

* CLAUDE.md
* docs/architecture.md
* docs/database.md
* docs/decisions/

Review existing storage-backed features before introducing new ones.

---

# Architectural Principles

## Always Use the Storage Abstraction

Interact only through the project's `ObjectStorage` interface.

Never couple feature code directly to:

* Cloudflare R2
* AWS SDK
* local filesystem

The storage backend must remain swappable.

---

## Separate Metadata from Binary Data

Binary objects belong in object storage.

Metadata belongs in PostgreSQL.

Repositories coordinate both.

Do not store binary data in the database.

---

## Repository Owns Coordination

Repositories coordinate:

database metadata

↓

object storage

Storage Builder should extend this pattern rather than bypass it.

---

## Handle the Entire Object Lifecycle

Storage implementations should consider:

* upload
* retrieval
* replacement
* deletion
* cleanup after failures

Avoid leaving orphaned database rows or orphaned objects.

---

## Fail Safely

If persistence only partially succeeds:

* clean up temporary state
* remove orphaned objects
* maintain consistency between storage and metadata

Prefer atomic behavior whenever practical.

---

## Keep Providers Replaceable

Do not expose provider-specific concepts outside the storage layer.

Features should work regardless of whether the active backend is:

* local filesystem
* Cloudflare R2
* another S3-compatible provider

---

## Respect Existing Constraints

Implement the project's existing constraints.

Examples include:

* supported MIME types
* maximum file size
* thumbnail generation
* cache behavior
* download behavior

Reuse existing validation and helper utilities.

---

# Implementation Process

## Step 1

Review an existing storage-backed feature.

## Step 2

Reuse the existing storage abstraction.

## Step 3

Implement metadata coordination.

## Step 4

Implement upload and retrieval.

## Step 5

Handle cleanup and failure scenarios.

## Step 6

Add or update tests.

---

# Testing

Verify:

* successful uploads
* successful downloads
* object deletion
* metadata persistence
* cleanup after failures
* invalid file types
* oversized files
* missing objects
* storage provider failures

Mock storage providers during service tests.

Avoid testing provider SDKs directly.

---

# Output

## Implementation Summary

### Storage Feature

...

---

### Objects Managed

* ...

---

### Metadata Changes

Summarize any metadata coordination.

---

### Lifecycle Handling

Describe upload, retrieval, replacement, and deletion behavior.

---

### Failure Handling

Describe cleanup and consistency guarantees.

---

### Tests Added or Updated

* ...

---

### Notes

Summarize any implementation decisions specific to the storage layer.