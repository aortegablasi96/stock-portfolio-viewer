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
every tool returns a **computed report** — the model may never derive a figure of its own. Epic
#322 adopts tools; DDR-0111 is the contract, and these rules govern from that point.

Tools must map to:

* **exactly one service method each.** Many tools may share one method — four narrow tools over
  `analytics:getPerformance` only *narrow* it — but **no tool may span two**, because a join is
  computation performed in the layer least covered by the service tests. Where no method exists,
  **add the method**; that is ADR-0009's sanctioned route and it is deliberately the expensive one.
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
* never propose changes to the owner's investor profile, and never suggest a target for them to
  set; that is the allocation decision and it is theirs
* apply the app's own **baseline** only where the profile states nothing, never to a dimension the
  owner has targeted, and always mark whose standard a judgement is against (ADR-0012)

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
* be backed by one service function each (see *Tool-Based Architecture Only* — the mapping is
  many-tools-to-one-method, never one-tool-to-many)
* return a **discriminated union**, in `ibkrGateway`'s discipline: a named state per outcome, never
  an exception, and **never an empty report standing in for a state** (DDR-0022). A model handed an
  empty report phrases it as a finding.
* be **rendered into the app's own prose** before reaching the model, through the app's own
  formatters — so a figure in an answer and the same figure on a dashboard agree to the digit
  (DDR-0098, DDR-0111). Not raw JSON.
* accept **enumerated keys, never free-form ranges**, where the app computes a fixed set. A period
  the set does not hold is a named state **with alternatives**, never the adjacent row (DDR-0102).
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

* map directly to **one** service method
* accept validated inputs only
* return a named state or a computed report, rendered as prose (see *Deterministic Tool Layer*)
* remain read-only (never trade, mutate holdings, or execute transactions)
* avoid side effects outside service scope
* declare the `DISCLOSURE_CATEGORIES` category they fall under. Tool results are assembled in
  **main** and never cross the IPC boundary where `pickDisclosedSections` bounds the context, so
  without this a tool is the way around the disclosure (DDR-0111).

The absences are **never a tool.** *WHAT THIS APP DOES NOT COMPUTE* is `BASE_CONTEXT` in
`@shared/domain/assistantAbsences.ts`, and `buildPrompt` emits it above every section on every
question — whichever tools ran and whether any did. DDR-0110 made three prohibitions — cause, risk
statistic, benchmark — conditional on those blocks being present, so a tool the model may decline to
call would unbind all three and nothing would fail (DDR-0101, DDR-0110, DDR-0111).

**A new tool restates the absences its own figures qualify**, in its own payload, the way
`performanceSection` restates the three for the period it is about. That is belt-and-braces: what
holds the prohibitions is the base context, and a tool that carried them *instead* would put them
back behind a choice.

**Do not add to the base context or to the assembled sections without measuring.**
`promptBudget.test.ts` sits at **84.8%** of `MAX_PROMPT_CHARS` against an 85% gate — roughly 90
characters. Epic #322 reclaims that room by moving figures behind tools; until it has, a story that
adds prose to either fails there.

The loop is **bounded twice** and is not a retry: a retry re-sends the *same* request after a
**failure**; a round sends a *larger* message array after a **success**, and a failed round is still
not retried (DDR-0096). A declared round cap and a per-question character ceiling both apply, and
exhausting either ends in a named state — never a partial answer presented as complete.

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