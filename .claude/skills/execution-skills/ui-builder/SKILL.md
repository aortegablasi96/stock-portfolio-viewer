---
name: ui-builder
description: Implement or modify the NumisBook user interface using existing React patterns, the design system, and approved UX decisions. Use when building or updating pages, components, managers, or user interactions after UI and architecture reviews have been approved.
---

# UI Builder

Implement the user interface.

Translate approved UX designs into accessible, maintainable React components that follow the project's architecture and design system.

---

# Responsibilities

Owns:

* pages
* React components
* client managers
* user interactions
* responsive layouts
* accessibility
* visual consistency

Does not own:

* business logic
* database access
* API implementation
* architecture decisions
* UX design

The UI presents information and captures user input.

Business behavior belongs in services.

---

# Workflow Position

Typical workflow:

API Builder

↓

UI Builder

↓

Testing

UI implementation follows the approved Product Review, UI Review, Architecture Review, and Implementation Plan.

---

# Required Inputs

Review:

* approved Product Review
* approved UI Review
* approved Architecture Review
* approved Implementation Plan

Review project documentation:

* CLAUDE.md
* docs/architecture.md
* docs/design-decisions/
* docs/decisions/

Review similar pages and components before introducing new ones.

---

# Architectural Principles

## Keep Components Focused

Components should primarily:

* render data
* capture user input
* display state
* delegate business actions

Avoid embedding business rules inside components.

---

## Respect Server and Client Responsibilities

Server Components should:

* fetch data
* compose pages
* pass props

Client Components should:

* manage interaction
* manage local UI state
* call APIs
* provide a responsive user experience

Choose the smallest possible client boundary.

---

## Reuse Existing Patterns

Before creating new components:

* extend existing components
* reuse existing managers
* reuse existing layouts
* reuse shared UI primitives

Avoid introducing new interaction patterns unless approved by the UI Review.

---

## Follow the Design System

Use the existing design system defined in `globals.css`.

Reuse:

* theme tokens
* utility classes
* existing layout patterns
* shared components

Do not introduce:

* CSS-in-JS
* Tailwind
* component frameworks
* duplicate styling systems

---

## Accessibility

Accessibility is a requirement.

Always consider:

* keyboard navigation
* focus management
* semantic HTML
* meaningful labels
* screen reader support
* sufficient contrast
* responsive layouts

Prefer existing accessibility patterns already used throughout the application.

---

## Responsive Design

Every UI change should work across supported screen sizes.

Consider:

* narrow mobile layouts
* wide desktop layouts
* tables
* forms
* dialogs
* images

Avoid desktop-only assumptions.

---

## Data Flow

Components receive data through:

* props
* Server Components
* API calls

Components must never:

* import repositories
* query the database
* implement business logic

---

## State Management

Prefer:

* local component state
* existing manager components
* server-rendered data

Avoid introducing new global state unless approved by the Architecture Review.

---

# Implementation Process

## Step 1

Review the approved UI Review.

## Step 2

Review existing UI patterns.

## Step 3

Identify reusable components.

## Step 4

Implement the approved layouts and interactions.

## Step 5

Verify responsiveness and accessibility.

## Step 6

Update UI tests or supporting helper tests where appropriate.

---

# Testing

Verify:

* expected rendering
* interaction flows
* loading states
* empty states
* error states
* responsive behavior
* accessibility

Where component tests are not used, extract complex UI logic into pure helper functions and test those.

---

# Output

## Implementation Summary

### Files Created

* ...

---

### Files Modified

* ...

---

### Components Added

* ...

---

### Components Updated

* ...

---

### Accessibility

Summarize any accessibility considerations addressed.

---

### Responsive Behavior

Summarize any mobile or responsive considerations.

---

### Tests Added or Updated

* ...

---

### Notes

Summarize any implementation decisions specific to the UI layer.