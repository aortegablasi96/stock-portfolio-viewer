---
name: issue-writer
description: Create GitHub Epics, User Stories, and Bugs that follow the repository issue templates. Use whenever new work should be tracked in GitHub.
---

# Issue Writer

## Purpose

Convert approved work into well-structured GitHub issues.

This skill creates project-management artifacts only.

It does **not** design features, architecture, or implementation.

It follows the repository issue templates instead of inventing its own structure.

---

## Issue Types

The project tracks work using only three issue types:

- Epic
- User Story
- Bug

Always choose the smallest issue type that accurately represents the work.

---

## Required References

Review:

- .github/ISSUE_TEMPLATE/
- docs/github-issues.md

When available also review:

- Product Review
- UI Review
- Architecture Review
- Database Review
- ADRs
- DDRs

Use these documents as inputs for the issue.

Do not redefine decisions already captured elsewhere.

---

## Classification Rules

### Epic

Create an Epic when the work:

- spans multiple user stories
- represents a milestone-sized capability
- delivers value incrementally
- requires coordination across domains

Examples:

- Coin Images
- Portfolio Analytics
- Authentication
- Production Readiness

---

### User Story

Create a User Story when the work delivers one coherent piece of user value.

A User Story should normally:

- be independently implementable
- have clear acceptance criteria
- belong to at most one Epic

---

### Bug

Create a Bug when existing behaviour is incorrect.

Focus on:

- expected behaviour
- actual behaviour
- reproduction steps
- acceptance criteria for the fix

Do not rewrite a feature request as a bug.

---

## Issue Writing Process

### Step 1

Determine the issue type.

### Step 2

Review the appropriate template in:

.github/ISSUE_TEMPLATE/

### Step 3

Populate every relevant section.

### Step 4

Add references to:

- Product Review
- UI Review
- Architecture Review
- Database Review
- ADRs
- DDRs

when applicable.

### Step 5

Recommend labels defined in:

docs/github-issues.md

Do not invent new labels.

---

## General Rules

Write concise, implementation-neutral issues.

Describe **what** needs to be achieved.

Avoid prescribing **how** to implement it unless the decision has already been documented.

Acceptance criteria should be observable and testable.

Out-of-scope items belong in the issue's "Not Included" section, not in acceptance criteria.

---

## Output

Produce:

### Issue Type

Epic / User Story / Bug

### Suggested Labels

...

### Completed GitHub Issue

Populate the corresponding repository issue template exactly as it should appear in GitHub.