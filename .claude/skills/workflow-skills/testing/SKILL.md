---
name: testing
description: Produce Testing Reports for completed implementations by validating requirements, regressions, accessibility, user workflows, and overall implementation quality. Use after implementation and before considering a feature complete.
---

# Testing

Validate that an implemented feature satisfies the approved requirements,
preserves existing behaviour, and is ready for release.

The Testing skill owns the **Testing Report**.

The Testing Report is the project's final quality gate.

Testing does not implement features.

Testing validates them.

---

# Responsibilities

Owns:

* implementation validation
* testing strategy
* regression analysis
* edge-case review
* accessibility validation
* workflow validation
* release readiness

Does not own:

* product requirements
* UI design
* architecture
* database design
* implementation

---

# Workflow Position

Testing is the final workflow step.

Typical workflow:

Product Manager
→ Product Review

↓

(UI Designer)
→ UI Review

↓

(Architect)
→ Architecture Review

↓

(Database Designer)
→ Database Review

↓

Issue Writer
→ GitHub Issues

↓

Implementation Engineer
→ Implementation Plan

↓

Execution Skills

↓

Testing
→ Testing Report

Testing validates that the implementation matches the approved planning
artifacts.

---

# Required Inputs

Before starting, review:

* approved Product Review
* approved UI Review (if applicable)
* approved Architecture Review
* approved Database Review (if applicable)
* approved Implementation Plan

Review project documentation when needed:

* docs/product.md
* docs/roadmap.md
* docs/architecture.md
* docs/database.md
* docs/decisions/

Testing validates the implementation.

It does not redefine requirements.

If implementation conflicts with approved planning, identify the issue and
recommend returning to the appropriate workflow skill.

---

# Testing Philosophy

Never assume code is correct.

Verify behaviour.

Verify user outcomes.

Verify regressions.

Every completed feature should leave the application at least as reliable as
before implementation.

---

# Validation Areas

Every review should evaluate:

* functional correctness
* business rules
* regressions
* edge cases
* authorization
* validation
* accessibility
* user workflows

Include only the areas relevant to the feature.

---

# Test Strategy

## Service Tests

Primary testing target.

Verify:

* business rules
* domain logic
* error handling

Repositories and external providers should be mocked.

---

## API Tests

Verify:

* validation
* authorization
* status codes
* error mapping

---

## UI Validation

When UI changes are involved, verify:

* expected user workflows
* responsive behaviour
* loading states
* empty states
* error states
* visual consistency

---

## End-to-End Validation

When appropriate, verify complete workflows using Playwright.

Examples:

* authentication
* create collection
* add coin
* upload image
* edit valuation
* assistant workflow

---

## Accessibility

When UI changes exist, verify:

* keyboard navigation
* focus management
* colour contrast
* semantic HTML
* accessible labels

Accessibility is required.

It is not optional.

---

# Regression Review

Always evaluate whether the implementation could affect:

* existing services
* existing APIs
* existing repositories
* existing user workflows
* existing database behaviour

Identify any additional regression testing that should be performed.

---

# Edge Cases

Review relevant edge cases such as:

* invalid input
* missing data
* duplicate operations
* authorization failures
* storage failures
* database failures
* concurrent operations

---

# Completion Criteria

A feature is considered complete only when:

* approved requirements have been implemented
* acceptance criteria are satisfied
* regressions have been evaluated
* appropriate tests exist
* accessibility has been reviewed (when applicable)
* user workflows have been validated

---

# Testing Report

## Summary

Brief assessment of implementation quality.

---

## Requirements Validation

Confirm whether each acceptance criterion has been satisfied.

---

## Test Coverage

Summarize:

* service tests
* API tests
* UI validation
* end-to-end validation

---

## Regression Review

Identify potential regressions.

---

## Accessibility Review

When applicable, summarize accessibility findings.

---

## Remaining Risks

List:

* known limitations
* missing coverage
* follow-up recommendations

---

## Recommendation

One of:

* Approved
* Approved with Recommendations
* Requires Rework

Implementation should be considered complete only after the Testing Report has
been accepted.