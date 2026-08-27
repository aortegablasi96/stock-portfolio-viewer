# 0010. OpenAI as the assistant's model provider, and portfolio data leaving the machine

- **Status:** Accepted
- **Date:** 2026-08-27

## Context

[[0007-mapbox-basemap-and-renderer-network-policy]] gave the renderer outbound network access for the
first time, and drew the line that has held since:

> No application data crosses the network. Holdings, values, tickers, issuer countries, sectors and
> NAV are computed in the renderer from locally imported Flex data and drawn as an overlay; only tile
> and style requests leave the machine, carrying the public token and the current viewport.

It described itself as **a narrowing of the offline guarantee, not of the data-privacy guarantee**,
and it enforced the privacy half structurally: `events.mapbox.com` is omitted from the CSP so the
browser blocks Mapbox telemetry however the library is configured.

Epic #5 needs a language model, and every model the Epic could plausibly use is either a service on
someone else's machine or a runtime the app cannot bundle. **The data-privacy guarantee is what is
now being narrowed**, and unlike the offline one it cannot be narrowed quietly: it is the reason a
local-first app was the right shape for this problem in the first place.

The owner chose `gpt-4.1-mini` on the OpenAI API, having been shown the alternatives and what each
costs. This record states what that means, where the boundary now runs, and what still enforces it.

The advisory half of the same redefinition is [[0009-ai-assistant-grounding-and-advisory-boundary]].

## Decision

### One provider, one model: `gpt-4.1-mini` on the OpenAI API

Configurable through `OPENAI_MODEL`, defaulting to `gpt-4.1-mini`. No provider abstraction is built.
One provider is a decision; two would be an architecture, and anticipating a second before it exists
is the speculative generality this project's dependency stance exists to avoid.

### Every model call is made from the main process

The renderer's CSP is **unchanged**: `connect-src` still admits `'self'` and `https://api.mapbox.com`
and nothing else. The renderer therefore *cannot* reach OpenAI — not by convention, but because the
platform refuses the request. The model is reached from main, behind an IPC channel, exactly as the
IBKR gateway and SQLite are ([[0002-typed-ipc-contract]], [[0004-interactive-brokers-integration]],
[[0003-sqlite-drizzle-persistence]]).

This preserves ADR-0007's mechanism rather than eroding it. That record's structural argument was
that an invariant which matters should be enforced by tooling rather than intent; extending the
CSP to a second origin would have spent exactly that.

### The key is unprefixed, and that is load-bearing

`OPENAI_API_KEY` carries none of electron-vite's prefixes, so it stays in `process.env` and reaches
the main process only. A `RENDERER_VITE_` prefix would inline the secret into the shipped renderer
bundle — and, because the CSP would still block the call, the result would be a leaked key attached
to a feature that does not work. `.env.example` carries this reasoning at the variable.

### Consent gates the first send, and revocation bites

Nothing leaves the machine until the owner has seen what would be sent — at its real granularity,
generated from or pinned against the code that assembles it, so the disclosure cannot drift from the
payload. Consent is refusable, leaving every other part of the app fully functional, and revocable,
after which no request is made.

"No API key" and "consent not given" are **distinct states**, each reported as a calm fact rather
than an error, in the register [[0002-connection-state-as-ipc-result]] established.

### The gateway inherits the IBKR gateway's discipline

The assistant's provider is reached through a repository-layer gateway, and the rules
[[0004-interactive-brokers-integration]] and DDR-0022 paid for transfer without argument: Zod at
ingress; a **whole-request deadline** rather than a socket-inactivity timeout, because the
characteristic failure of a remote service is accepting a connection and then going quiet; **one
bounded attempt and never a retry loop**, which matters more here than there, since a retry against a
metered endpoint compounds the cost of every stall; and failure modelled as data.

The **size of what may be sent is bounded in the gateway**, so no later story can exceed it by
accident. Exceeding it is a reported state, never a silently truncated prompt.

### What leaves the machine, and what does not

**Leaves:** portfolio-derived figures assembled for a question — weights, returns, currencies,
sectors, instrument names, and the owner's own profile targets, together with the question itself.

**Does not leave:** the database, the imported Flex XML, the IBKR session or its credentials, the
Mapbox token, or anything the app holds that a question did not ask for.

It is worth naming the difference from ADR-0007 plainly rather than by omission. That record could
argue that panning a map *weakly implies* interest in a region. This one cannot: sending holdings
does not imply anything, **it discloses them**.

### The guarantees, restated honestly

- **Local-first is now qualified**, not abandoned. All storage, all computation and all broker access
  remain local. One feature, gated on consent, sends derived figures to a third party.
- **ADR-0007 narrowed the offline guarantee. This ADR narrows the data-privacy guarantee**, for the
  Assistant view alone. Every other view still renders with the network unavailable.

## Consequences

### Benefits

- The capability is available at a quality a bundleable local model does not currently reach, with no
  setup burden beyond pasting a key.
- The blast radius is one repository and one view. Nothing below the gateway changes, and no existing
  data path is touched.
- The CSP, the sandbox, `contextIsolation`, `nodeIntegration: false` and the layer boundaries are all
  unchanged — the new network caller sits where the app already puts network callers.
- Absence of a key is the resting state of a fresh clone, so the app remains fully usable without an
  OpenAI account, as it already is without a Mapbox one.

### Tradeoffs

- **The strongest claim in `docs/product.md` is now qualified.** "Local-first and private" needs
  reading together with this record, exactly as "the renderer makes no network requests" has needed
  reading together with ADR-0007.
- A **metered, paid dependency on a service the owner does not control** now sits behind a feature.
  Availability, pricing and model behaviour can all change without notice.
- The Assistant view does not work offline. Accepted; the four analytics views carry the same
  underlying figures and do.
- Answers are not reproducible. The same question can return differently worded text on two days,
  which is a poor fit for a codebase that tests almost everything.

### Risks

- **Scope creep in what is sent.** The easiest way to improve an answer is to send more context, and
  each increment is individually reasonable. Mitigated by the gateway's size bound, and by the
  disclosure being generated from the assembly code so that growth is visible to the owner rather
  than silent.
- **Key handling.** Mitigated structurally: unprefixed, main-only, and demonstrated absent from
  renderer build output rather than assumed to be.
- **A second origin is now easier to justify than the first was** — ADR-0007 flagged exactly this,
  about itself. Nothing here adds a renderer origin, and that is the property to defend.
- **Provider policy change**, including model deprecation or a shift in data-retention terms. Partly
  mitigated by the gateway being the only code that knows about OpenAI; the alternatives below record
  the fallback.
- **Prompt-shape lock-in.** Context assembly built around one provider's expectations is harder to
  move than the transport is. Kept small by the grounding rule in
  [[0009-ai-assistant-grounding-and-advisory-boundary]]: the payload is computed reports, which are
  the app's own shapes rather than the provider's.

## Alternatives Considered

### Option A — A local model (Ollama or similar)

Preserves the data-privacy guarantee completely; nothing leaves the machine and neither this ADR nor
any amendment to ADR-0007 would have been needed. Not chosen: the app cannot bundle a runtime or
weights of a usable size, so it would trade a pasted API key for a multi-gigabyte external
installation the owner must maintain, and the answer quality at sizes that run comfortably on a
personal machine is materially lower for exactly the reasoning-over-figures task this Epic asks for.

Recorded as the fallback with the strongest claim on a future revisit, since it is the only option
that restores the original guarantee.

### Option B — Bring-your-own-key, provider-agnostic

Lets the owner choose local or cloud per their own comfort and ships the app neutral on the question.
Rejected for now: two code paths, two sets of failure modes, and two prompt dialects to test, for a
single-user app whose owner has already made the choice. Revisit if a second provider is ever
genuinely wanted — at which point the gateway is the seam.

### Option C — Renderer calls the provider directly, with a CSP addition

Simplest to build. Rejected twice over: it requires the key in the renderer bundle, and it spends the
structural enforcement ADR-0007 deliberately bought. A second allowed origin also weakens the
telemetry block's rationale by precedent, even though the origins differ.

### Option D — Proxy through a service of our own

Would allow redaction, key custody and provider swapping in one place. Rejected: it contradicts the
standalone, single-user, local-first shape at the root of the project
([[0001-electron-build-toolchain]], [[0004-interactive-brokers-integration]]), and introduces hosting
and an operational surface for one desktop user.

### Option E — Send weights only, never absolute values

Meaningfully less disclosing, and much of this Epic genuinely works on weights. Not adopted as a
constraint here because it is not yet known whether every question can be answered from them —
Story #283 will find out while building the disclosure, and a finding that it can is worth recording
as a follow-up rather than pre-committing to now.

## Supersedes

None.

This ADR **amends** [[0007-mapbox-basemap-and-renderer-network-policy]], specifically its *Confine
network access to the basemap surface* section. That record's statements remain true **of the
renderer**, which still carries no application data off the machine; they are no longer true of the
application as a whole. ADR-0007 carries a pointer to this record so the two cannot be read
separately.

`docs/product.md` and `CLAUDE.md` are amended in the same change, and the CSP comment in
`src/renderer/index.html` is made precise about what it does and does not guarantee.

## References

- [[0007-mapbox-basemap-and-renderer-network-policy]] — the record amended, and the structural
  enforcement preserved.
- [[0009-ai-assistant-grounding-and-advisory-boundary]] — the companion: what the assistant may
  assert, and where its figures come from.
- [[0004-interactive-brokers-integration]] — the gateway pattern this copies.
- [[0002-typed-ipc-contract]], [[0002-connection-state-as-ipc-result]] — typed channels, and outcome
  as data.
- `.env.example` — `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_TIMEOUT_MS`, and why the key is
  unprefixed.
- GitHub Issues: Epic #5, Story #279 (this record), #282 (the gateway), #283 (consent and
  disclosure).
