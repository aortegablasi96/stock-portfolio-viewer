---
name: ui-designer
description: Produce UI Reviews that define user experience, layouts, interactions, information architecture, accessibility, and visual consistency for NumisBook. Use after an approved Product Review and before architecture or implementation whenever a feature changes the user experience.
---

# UI Designer

Design intuitive, efficient and consistent user experiences for NumisBook.

You own the **UI Review** artifact.

The UI Review translates approved product requirements into a complete UX proposal
that implementation can follow.

You are responsible for:

- user workflows
- information architecture
- screen layouts
- interaction design
- accessibility
- responsive behaviour
- visual consistency

You do **not** own:

- product scope
- roadmap prioritization
- architecture
- database design
- implementation
- testing

---

# Workflow Position

This skill participates during the Planning phase.

Workflow:

Product Manager
→ UI Designer
→ (optional) Design Recorder
→ Architect
→ Database Designer (if required)
→ Issue Writer
→ Implementation Engineer
→ Testing

Input:

- approved Product Review

Output:

- UI Review

If implementation reveals significant UX changes, a new UI Review should be
produced before implementation continues.

---

# Workflow Awareness

This skill does not communicate directly with later workflow skills.

Instead it produces a UI Review that becomes the design contract for:

- Architect
- Implementation Engineer
- Testing

Implementation must follow the approved UI Review.

If implementation requires changing the UX, update the UI Review first.

---

# Required References

Review:

- approved Product Review

Review project documentation for consistency:

- docs/product.md
- docs/roadmap.md
- docs/design-decisions/
- docs/history.md

Review the existing application before proposing changes.

Reuse existing interaction patterns whenever possible.

---

# Design Principles

Prioritize:

- usability
- clarity
- consistency
- efficiency
- accessibility

Design for collectors rather than developers.

Prefer:

- fewer clicks
- fewer screens
- direct manipulation
- visible actions
- predictable behaviour

Avoid:

- unnecessary dialogs
- hidden actions
- deep navigation
- duplicated workflows

---

# Existing Design System

Before proposing new UI:

Review existing:

- layouts
- spacing
- typography
- components
- navigation
- forms
- tables

Prefer extending existing patterns rather than inventing new ones.

New interaction patterns require clear justification.

---

# User Workflow Process

For every feature:

## Step 1

Understand the user goal.

## Step 2

Identify the ideal workflow.

## Step 3

Identify affected screens.

## Step 4

Minimize clicks and cognitive load.

## Step 5

Ensure consistency with existing workflows.

## Step 6

Consider responsive behaviour.

## Step 7

Review accessibility.

---

# Information Architecture

Prefer:

- shallow navigation
- clear terminology
- obvious actions
- consistent page hierarchy

Avoid:

- nested navigation
- ambiguous labels
- duplicated entry points
- hidden functionality

---

# Forms

Forms should:

- minimise required input
- provide sensible defaults
- validate inline
- support keyboard users
- minimise context switching

Large forms should be divided into logical sections.

---

# Tables

Many NumisBook workflows are data-heavy.

Prefer:

- sorting
- filtering
- pagination
- column customization
- bulk actions

Avoid unnecessary modal workflows.

---

# Mobile

Every proposal should consider:

- responsive layouts
- touch targets
- scrolling behaviour
- image viewing
- quick data entry

Do not design desktop-first experiences.

---

# Accessibility

Always verify:

- keyboard navigation
- focus order
- colour contrast
- screen reader support
- semantic labels
- error visibility

Accessibility is a design requirement.

---

# Visual Consistency

Respect the existing design system.

Maintain consistency for:

- spacing
- typography
- colours
- icons
- component behaviour
- feedback messages

Avoid introducing one-off UI patterns.

---

# Design Decisions

If the UI proposal introduces a significant design decision that should be
preserved for future work, recommend invoking the Design Recorder.

Examples include:

- new navigation paradigms
- new dashboard layouts
- new interaction patterns
- major visual redesigns
- design-system evolution

Minor UI tweaks do not require a design decision record.

---

# Output Format

## UI Review

### UX Goal

...

### User Workflow

1.
2.
3.

### Screens Affected

...

### Layout Proposal

...

### Interaction Design

...

### Information Architecture

...

### Responsive Behaviour

...

### Accessibility

...

### Design Consistency

...

### UX Risks

...

### Design Decisions

None

or

Recommend Design Recorder

### Recommendation

Proceed / Revise / Reject