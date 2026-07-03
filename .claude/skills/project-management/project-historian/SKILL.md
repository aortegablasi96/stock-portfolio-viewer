---
name: project-historian
description: Reconstruct completed work as GitHub Epics, User Stories, and Bugs from the project's history, ADRs, DDRs, roadmap, and existing implementation.
---

# Project Historian

## Purpose

Reconstruct the project's development history as GitHub issues.

This skill is intended for repositories that adopted GitHub Issues after significant development had already been completed.

It recreates historical Epics, User Stories, and Bugs so the issue tracker reflects the project's evolution.

It does not modify implementation.

---

## Required References

Review:

- docs/history.md
- docs/roadmap.md
- docs/decisions/
- docs/design-decisions/
- docs/github-issues.md
- .github/ISSUE_TEMPLATE/

Consult when useful:

- docs/product.md
- docs/architecture.md
- docs/database.md

---

## Reconstruction Principles

Treat documentation as the historical source of truth.

Reconstruct work based on:

- milestones
- completed features
- accepted decisions
- documented improvements

Do not invent work that cannot be inferred from project documentation.

---

## Classification

Use only:

- Epic
- User Story
- Bug

Follow the repository issue templates.

---

## Epic Identification

Create Epics for major completed initiatives.

Examples:

- Initial Authentication
- Coin Images
- Portfolio Analytics
- Figma UI Redesign
- Assistant
- Production Readiness

---

## Story Identification

Break each Epic into meaningful completed User Stories.

Examples:

Epic:
Coin Images

Stories:

- Upload multiple images
- Delete images
- Image carousel
- Image thumbnails
- Object storage abstraction

---

## Bug Identification

Only reconstruct bugs when documentation clearly indicates:

- a production issue
- a regression
- a defect that was fixed

Do not convert every improvement into a bug.

---

## Historical Accuracy

Issues should be written as though they existed before implementation.

Avoid phrases like:

- "implemented"
- "finished"
- "already done"

Instead describe the intended work.

The goal is to reconstruct what would have been planned.

---

## References

Link issues back to:

- ADRs
- DDRs
- roadmap milestones

when applicable.

---

## Reconstruction Strategy

Proceed chronologically.

For each milestone:

1. Identify Epics.
2. Identify User Stories.
3. Identify Bugs.
4. Group stories beneath Epics.
5. Preserve historical scope.

---

## Output

Produce:

### Reconstruction Summary

- Epics
- User Stories
- Bugs

### GitHub Issues

Generate completed GitHub issues using the repository templates.

Group issues beneath their corresponding Epic.

Recommend labels using docs/github-issues.md.