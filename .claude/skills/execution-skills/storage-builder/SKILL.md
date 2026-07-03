---
name: storage-builder
description: Implement storage-backed features using Stock Portfolio Viewer's local file storage abstraction. Use when adding or modifying functionality that stores, retrieves, transforms, or deletes binary objects such as documents or exported reports.
---

# Storage Builder

Implement features that persist binary files using the project's local file storage abstraction.

All storage access must go through that abstraction and integrate cleanly with the repository layer.

---

# Responsibilities

Owns:

* local file storage integration
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
* the on-disk storage location and layout

Where files live on disk is an implementation detail behind the abstraction.

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

Interact only through the project's `FileStorage` interface.

Never couple feature code directly to:

* raw `fs` / filesystem calls
* absolute or hard-coded paths

The on-disk layout must remain an implementation detail of the abstraction.

---

## Separate Metadata from Binary Data

Binary files belong in local file storage.

Metadata belongs in SQLite.

Repositories coordinate both.

Do not store binary data in the database.

---

## Repository Owns Coordination

Repositories coordinate:

database metadata

↓

local file storage

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

## Keep Storage Details Behind the Abstraction

Do not expose filesystem paths or layout details outside the storage layer.

Features should work regardless of where the abstraction chooses to place files on disk.

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
* file I/O failures

Mock the file storage abstraction during service tests.

Avoid testing the filesystem directly.

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