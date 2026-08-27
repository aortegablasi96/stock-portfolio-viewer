---
name: assistant-builder
description: Implement and modify the Stock Portfolio Viewer AI Assistant, including tool definitions, function calling logic, orchestration loops, and safe integration with domain services. Use when adding or changing AI behaviors, tools, or assistant workflows after services and APIs are defined.
---

# Assistant Builder

Implement the Stock Portfolio Viewer AI Assistant.

The assistant is a controlled orchestration layer that uses LLM function calling to interact with approved domain services.

It must remain safe, deterministic where possible, and strictly bounded to the application's service layer.

---

# Responsibilities

Owns:

* assistant orchestration logic
* model provider setup, and tool-use where tools are used (OpenAI `gpt-4.1-mini`, ADR-0010)
* tool definitions and schemas
* prompt design for assistant behavior
* tool execution routing
* response formatting
* safety constraints for AI actions

Does not own:

* business logic
* database access
* service implementation
* IPC handlers (outside assistant orchestration)
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

The assistant must only interact with the system through explicit tools, where tools are used at
all. ADR-0009 permits either a deterministically assembled context or tool selection, provided
every tool returns a **computed report** — the model may never derive a figure of its own. The
first Assistant story starts without tool calling; these rules govern the moment it gains any.

Tools must map to:

* service methods
* repository-backed operations via services

Never allow the model to access:

* database directly
* repositories directly
* internal implementation details

---

## Single Owner & Read-Only Tools

This is a single-user, local-first app: there is **no user identity, no tenant, and no
`userId`** — tools operate on the one owner's local data. There is no identity for the model
to choose or modify.

The real safety boundary is behavioural: per the AI Principles in CLAUDE.md and ADR-0009, the
assistant **proposes but never acts, and never sets the policy**. Tools must:

* read and analyze the owner's portfolio data
* never place trades, modify holdings, or execute transactions — and expose no path to one
* never propose changes to the owner's investor profile; that is the allocation decision and it
  is theirs

The assistant *may* judge balance against the profile the owner authored and suggest how to close
a gap, naming positions. It **must not produce a figure of its own**: every number comes from a
service that computed it, assembled deterministically, and the model phrases it. A suggestion
naming an instrument the owner does not hold is not grounded in the app's data — mark it apart
from computed claims.

The user remains the decision maker: every suggestion is read and acted on by hand.

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
* remain read-only (never trade, mutate holdings, or execute transactions)
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

* define assistant persona as "portfolio assistant"
* constrain behavior to the portfolio domain
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

Ensure tools remain read-only (no trading or mutation).

## Step 5

Validate tool schemas.

## Step 6

Test assistant flows end-to-end.

---

# Testing

Test:

* tool invocation correctness
* multi-step reasoning flows
* read-only safety (no trading or mutation)
* invalid tool inputs
* fallback behavior
* error handling

Mock:

* the model provider API (OpenAI, reached through the repository-layer gateway)
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

* read-only tools (no trading, no order execution)
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