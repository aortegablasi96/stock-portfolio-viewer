---
name: assistant-builder
description: Implement and modify the NumisBook AI Assistant, including tool definitions, function calling logic, orchestration loops, and safe integration with domain services. Use when adding or changing AI behaviors, tools, or assistant workflows after services and APIs are defined.
---

# Assistant Builder

Implement the NumisBook AI Assistant.

The assistant is a controlled orchestration layer that uses LLM function calling to interact with approved domain services.

It must remain safe, deterministic where possible, and strictly bounded to the application's service layer.

---

# Responsibilities

Owns:

* assistant orchestration logic
* OpenAI function calling setup
* tool definitions and schemas
* prompt design for assistant behavior
* tool execution routing
* response formatting
* safety constraints for AI actions

Does not own:

* business logic
* database access
* service implementation
* API routes (outside assistant endpoint structure)
* UI rendering logic

The assistant orchestrates services; it does not replace them.

---

# Workflow Position

Typical workflow:

Service Builder

↓

API Builder

↓

Assistant Builder (when AI is involved)

↓

UI Builder (AssistantWidget)

The assistant sits on top of the service layer as a controlled orchestration system.

---

# Required Inputs

Review:

* approved Product Review (assistant behavior requirements)
* approved Architecture Review
* assistant service implementation (`assistant.service.ts`)
* tool definitions for domain services
* docs/decisions/ (especially AI-related ADRs)

Review:

* CLAUDE.md
* docs/architecture.md
* docs/decisions/

---

# Architectural Principles

## Tool-Based Architecture Only

The assistant must only interact with the system through explicit tools.

Tools must map to:

* service methods
* repository-backed operations via services

Never allow the model to access:

* database directly
* repositories directly
* internal implementation details

---

## Strict Tenant Isolation

All tool calls must enforce:

* authenticated `userId`
* server-side injection of user context
* no user-provided identity overrides

The model must never choose or modify tenant identity.

---

## No Free-Form System Actions

The assistant may not:

* execute arbitrary code
* construct dynamic queries
* bypass service validations
* access unauthorized data

All actions must be predefined tools.

---

## Deterministic Tool Layer

Tools should:

* have stable input/output schemas
* map 1:1 to service functions
* return structured data
* avoid ambiguous responses

---

## Keep Prompting Minimal and Stable

System prompts should:

* define behavior constraints
* define tool usage rules
* define safety boundaries
* avoid embedding business logic

Business logic belongs in services.

---

## Separation of Concerns

Assistant responsibilities:

* interpret user intent
* select appropriate tool
* orchestrate multi-step workflows
* format responses

Services responsibilities:

* enforce business rules
* validate domain constraints
* perform data operations

---

## Error Handling

Tool failures must:

* be safely surfaced to the model
* never expose internal system details
* be converted into structured assistant responses

Avoid leaking stack traces or sensitive system errors.

---

# Tool Design Rules

All tools must:

* map directly to a service method
* accept validated inputs only
* return structured JSON
* enforce tenant isolation internally
* avoid side effects outside service scope

Prefer:

* narrow tools
* intention-revealing names
* stable interfaces

Avoid:

* generic "executeQuery" tools
* multi-purpose tools
* free-form execution tools

---

# Prompt Design Guidelines

System prompts should:

* define assistant persona as "collection assistant"
* constrain behavior to NumisBook domain
* enforce tool usage rules
* prevent hallucinated capabilities

Do not embed:

* roadmap logic
* business rules
* UI decisions

---

# Workflow Process

## Step 1

Review available service layer capabilities.

## Step 2

Define or update tool mappings.

## Step 3

Update assistant orchestration logic.

## Step 4

Ensure tenant isolation is enforced.

## Step 5

Validate tool schemas.

## Step 6

Test assistant flows end-to-end.

---

# Testing

Test:

* tool invocation correctness
* multi-step reasoning flows
* tenant isolation safety
* invalid tool inputs
* fallback behavior
* error handling

Mock:

* OpenAI API
* service layer functions
* tool execution layer

Verify:

* no unauthorized tool access
* no direct data access bypass
* correct mapping to services

---

# Output

## Assistant Implementation Summary

### Tools Added or Modified

* ...

---

### Tool Mappings

Describe mapping between tools and services.

---

### Prompt Changes

Summarize system prompt or behavior changes.

---

### Safety Considerations

* tenant isolation
* tool restrictions
* failure handling

---

### Orchestration Logic

Describe multi-step flows or reasoning patterns.

---

### Tests Added or Updated

* ...

---

### Notes

Summarize any AI-specific implementation decisions.