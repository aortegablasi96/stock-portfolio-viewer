# 0096. The model gateway inherits a discipline, and adds two states

- **Status:** Accepted
- **Date:** 2026-08-28
- **Extends:** [[0022-gateway-timeout-and-not-responding-state]],
  [[0002-connection-state-as-ipc-result]], [[0024-gateway-read-coalescing-and-freshness-window]]

## Context

Story #282 builds the Epic's one new external data source. ADR-0010 already settled the hard part —
that portfolio-derived figures may leave the machine, from main only, gated on consent — and said
the gateway inherits `ibkrGateway`'s discipline. This record is what "inherits" turned out to mean,
and the three places the two gateways genuinely differ.

Everything that transfers, transfers without argument: the repository layer is the only layer that
speaks HTTP; every response is validated with Zod at ingress; every request is bounded by a
**whole-request deadline** rather than a socket-inactivity timeout, because the characteristic
failure of a remote service is accepting a connection and then going quiet; **one bounded attempt,
never a retry loop**; and failure is data.

The no-retry rule matters more here than it did there, and for a reason `ibkrGateway` never had:
a retry against a **metered** endpoint compounds the cost of every stall.

## Decision

### Plain HTTPS, not the `openai` SDK

The story asked for this to be decided against the plain-HTTP precedent, and the precedent wins.

The app's needs are one endpoint, no streaming, no tool calling. What the SDK would buy is retry,
timeout handling and an error taxonomy — and **the first must be turned off** (one attempt is the
rule), the second is a socket-level bound this gateway deliberately does not want, and the third
has to be re-mapped onto the states below anyway. A dependency whose three main features are
disabled, replaced and re-mapped is not carrying its weight, which is the standing rule in CLAUDE.md
and in ADR-0008.

The transport is therefore structurally identical to `ibkrGateway.rawGet`: the same one-shot
`settle`, the same always-cleared timer, the same `unref`, POST instead of GET.

### It returns a result, not a thrown error

`ibkrGateway` throws typed errors because several methods share them and one IPC handler does the
mapping. This gateway has **one operation**, and every outcome is already a named state, so a
discriminated union is the honest shape: it cannot be forgotten, it needs no mapping layer, and a
test can enumerate the states exhaustively. The promise never rejects.

### Seven states, divided by what the owner does next

`ok`, `not_configured`, `too_large`, `refused`, `not_responding`, `invalid`, `error`. The
acceptance criteria named six; `too_large` is the addition, and it is an addition rather than a
substitution — every state the story named still exists.

**`not_configured`** is the OpenAI analogue of the IBKR gateway's `not_connected`: the resting
state of a fresh clone, and the one failure the owner can fix directly. Reported as a calm,
actionable fact naming the variable to set (ADR-0010).

**`too_large`** is the request exceeding the gateway's own ceiling, with **nothing sent**. Folding
it into `refused` would tell the owner the *provider* rejected their portfolio when in fact it
never left the machine — the one distinction ADR-0010 exists to keep clear, so it is worth a
seventh variant rather than a shared one.

**`not_responding`** absorbs three causes: a stall past the deadline, an unreachable host, and a
5xx. That is deliberate, and it is [[0022-gateway-timeout-and-not-responding-state]]'s own rule
applied rather than bent — states divide by **recovery**, not by cause, and the answer to all three
is *wait and ask again*. There is no `not_connected` here because there is nothing for the owner to
start: unlike a local gateway they can launch, "the internet is down" and "OpenAI is down" are the
same shrug.

**`refused`** is a 4xx: a bad key, a quota, a content policy. The app is working; the request is
not acceptable. The provider's own wording is carried through, because it is more useful than
anything this file could invent — *"You exceeded your current quota."*

**`invalid`** is an answer that arrived and was not the documented shape, which says where the
fault is in a way `error` does not. A `200` carrying **no** answer is `invalid` too: it is what a
content filter leaves behind, and reporting it as `ok` with an empty string would show the owner a
blank reply and call it a response.

### The ceiling on what may be sent is a constant, not an environment variable

`MAX_PROMPT_CHARS` is 24,000 characters of `system` + `user`, checked before anything is sent.

A constant on purpose: the story asks that no later story exceed it *by accident*, and a value
someone can raise in `.env` is one a stalled afternoon will raise. Changing it means editing the
gateway, which means reading the paragraph beside it.

**Characters rather than tokens**, because counting tokens needs a tokenizer, and a tokenizer is a
dependency taken to price a request exactly when the job here is only to stop runaway growth.
~24k characters is roughly 6k tokens of English prose and figures — several times the largest
context this Epic assembles.

The answer is bounded too: a caller may ask for **fewer** output tokens, never more.

### A refusal is redacted before it leaves the gateway

Found by making the call rather than by reasoning about it. A wrong key comes back as *"Incorrect
API key provided: `sk-defin****************-key`"*. OpenAI has already masked the middle, so what
arrives is a fragment rather than a secret — but it is a fragment of the one value this story
exists to keep in the main process, and a refusal's `message` crosses IPC and can reach the screen.
One regex strips anything key-shaped, and the provider's wording survives intact.

### There is no service, and no IPC channel

Deliberate, and the reason is [[0094-the-profile-is-a-setting-and-a-range-is-a-policy]]'s
neighbour: **#283 is consent before anything leaves the machine.** An `assistant:ask` channel
shipped now would be a working, un-consented path to OpenAI — precisely what ADR-0010 gates. The
gateway is repository-layer code with no caller until consent exists (#283) and a view asks
something (#284).

## Alternatives Considered

- **The `openai` SDK.** Above. It would also have made the single-attempt guarantee a
  configuration rather than a property of the code.
- **A `not_connected` state for an unreachable host.** Rejected: nothing for the owner to start,
  so it is `not_responding` — same recovery, one fewer state to explain.
- **Folding `too_large` into `refused`.** Rejected: it would misattribute the refusal to the
  provider and imply data was sent.
- **`error` for a 5xx.** Rejected: the owner's move is a stall's, and `error` should mean something
  unexpected happened in the app.
- **`OPENAI_MAX_PROMPT_CHARS` as an environment variable.** Rejected: the ceiling exists to be
  hard to raise.
- **A provider abstraction.** Out of scope by the story, and anticipating a second provider is not
  a reason to build a seam for one.
- **Caching identical questions.** Rejected by the story and rightly: two identical questions are
  not obviously the same request, and a stale answer is worse than a slow one
  ([[0024-gateway-read-coalescing-and-freshness-window]]'s policy does not transfer).

## Consequences

- One new file reaches OpenAI, and a guard test fails if the renderer or the preload bundle so
  much as names an `OPENAI_` variable, if anything outside main imports the gateway, or if the
  CSP's `connect-src` gains an origin.
- The transport tests drive a **real local HTTP server**, so the suite makes no external request;
  the single-attempt guarantee is asserted by counting requests that server received, which is the
  one form a future refactor cannot talk its way past.
- The wire format was verified with **two real calls** while building: one completion (24 tokens,
  `gpt-4.1-mini` resolving to `gpt-4.1-mini-2025-04-14`, confirming that the model *answering* is
  reported rather than the model asked for) and one deliberate 401, which is where the redaction
  above came from.
- Nothing calls it yet. That is the story's scope and the next two stories' subject.
