# 0107. The Assistant view is the chat: the gate, the disclosure and the key management come out

- **Status:** Accepted
- **Date:** 2026-08-30
- **Supersedes:** [[0097-consent-is-to-a-list-and-the-list-is-the-code]] — entirely as a *mechanism*;
  two of its three readings of `DISCLOSURE_CATEGORIES` (the type, and the boundary) are restated
  below and stand.
- **Amends:** [[0105-the-owner-sets-the-key-and-the-environment-wins]] (the panel's four kinds
  become one field and one note; the two sources and their order are unchanged),
  [[0098-the-assistant-is-grounded-in-text-the-app-wrote]] (the box's blocking states),
  [[0096-the-model-gateway-inherits-a-discipline-and-adds-two-states]] (the ask result is now
  exactly the gateway's seven)

## Context

M10 shipped the Assistant as **three decisions stacked above a chat**: the consent gate
([[0097-consent-is-to-a-list-and-the-list-is-the-code]]), the key card
([[0105-the-owner-sets-the-key-and-the-environment-wins]]), and the "What would be sent" disclosure.
Each was the right answer to a question the Epic asked. Together they made asking a question the
fourth thing on the page, and every one of them had to be read past on every visit.

ADR-0011 removes the gate **on the record**, on the owner's own decision of 2026-08-30: for a
single-user local-first app whose owner wrote it, installed it, obtained an OpenAI account and
pasted the key, supplying that key is already the decision to send — the key has no other purpose
here — and the gate asks the same person the same question a second time. Story #309 is that record
reaching the code.

The cost was never only ceremony. Consent was stored, fingerprinted against
`DISCLOSURE_CATEGORIES`, and checked before the key, before a prompt and before a socket. The
fingerprint was correct and was the point of DDR-0097 — but it meant a **grounding change silently
withdrew consent**, and three of M10's stories moved that list.

## Decision

### The view is the conversation, with one field on the run where there is no key

`AssistantView` draws a `PageHeader`, `AssistantKeyCard` and `AssistantConversation`, and on every
run after the first the key card **renders nothing at all**. There is no consent card and no
disclosure list.

A card whose only content is that the setup is done is the ceremony this story exists to remove, so
a settled key draws no card — not a quieter one.

### Consent is removed end to end, not hidden

`consentService`, its `app_meta` row, `disclosureFingerprint`, `assistant:setConsent`,
`AssistantStatus`'s `consented` / `consentedAt` / `consentStale`, the `needs_consent` ask result,
`lib/assistantGate.ts` and `e2e/assistant-consent.spec.ts` are all gone. Nothing asks for, stores
or reads a consent decision anywhere in `main`, `preload`, `renderer` or `shared`.

`assistantService.ask` now calls `aiGateway.complete` with nothing in front of it. **The gate is
the key, and it is the gateway's own gate** — a missing one is `not_configured`, produced by the
module that would have opened the socket, which is what keeps "no socket is opened" a property of
that module rather than a claim about a caller.

`AssistantStatus` shrinks from six fields to three: `state` (`ready` or `not_configured`),
`keySource`, `keyStored`. `configured` went with the pair it was one half of — two fields for one
fact is the shape this codebase keeps refusing — and `state` is kept as the named fact a view
branches on rather than leaving every caller to re-derive `keySource !== 'none'`.

### `DISCLOSURE_CATEGORIES` stays, and loses one of its three jobs

DDR-0097 gave the constant three readings. Two are unchanged, and they are the stronger two:

- it **types** `AssistantContext`, so a section nobody declared cannot be assembled;
- `pickDisclosedSections` **drops** an undeclared section at the IPC boundary, where a type is a
  comment.

The third — the list the owner read, and the fingerprint their agreement was stored against — is
retired. `granularity` stays on each category: it declares at what precision a section may be
written, and DDR-0098's rule that no money goes in a section declared as names or percentages is
stated against it. `GRANULARITY_LABELS`, `disclosedGranularities` and `DISCLOSURE_DESTINATION`
existed only to draw the panel, and go with it.

### The key surface shrinks; the key feature does not

`keySurface(status)` has three values, and only one of them draws a form:

| value | when | what is drawn |
| --- | --- | --- |
| `field` | no key in force | heading, body, one `password` field, one Save |
| `shadowed` | environment key in force **and** a key saved in the app | one sentence, no control |
| `none` | any other key in force | nothing |

**There is no activate, deactivate or rotate.** `assistant:clearApiKey`, `clearApiKeyResultSchema`,
`assistantService.clearApiKey`, `apiKeyService.clear` and the `ConfirmAction` that drove them are
removed. A channel that removed the key would be exactly the control ADR-0011 says the app does not
have — reachable from `window.api` whether or not a button drew it. `aiGateway.clearStoredKey`
stays: the store's lifecycle belongs with the module that owns key material end to end, and a
future rotate builds on it.

DDR-0105's rules are otherwise unchanged. The field is `password`, is cleared on save and is never
repopulated; nothing returns a key or a fragment of one; the environment beats the stored key, and
**the order is reported, never silent** — which is the whole of what `shadowed` exists for, and the
one thing the app still says about a key it is not offering to change.

The body over the field carries what the consent panel used to say at length: pasting a key means
the questions asked from then on go to OpenAI with the figures they are grounded in. It is one
sentence, on the one screen where the owner is performing the act it describes.

### What the ask box says now

`AskGateKind` was `GateKind` widened by `no_grounding`, and is now this module's own union of
three: `not_configured`, `ready`, `no_grounding`. `FAILURE_HEADINGS` loses `needs_consent` and is
asserted to be **exactly** the gateway's non-`ok` statuses — in both directions, so a heading left
behind for a status the gateway cannot produce fails the same test as a status with no heading.

The order among what is left is unchanged in kind: a key the owner has not pasted comes before data
they have not imported.

## Consequences

### Benefits

- The owner opens the view and asks a question. On the second run the page is one card.
- **A grounding change can no longer stop the assistant.** The coupling between what the app
  computes and whether it may answer is gone with the fingerprint.
- Two states leave the service, the contract, the status shape and the view, each of which had to
  be rendered, tested and kept honest. `lib/assistantGate.ts` and its 332-line test go entirely.
- The one control over sending is the one the owner already understands, and it is the one that
  actually gates the socket.

### Tradeoffs

- **The app no longer tells the owner what it sends before it sends it.** ADR-0011 accepts this
  explicitly: the reader and the owner are the same person, and the disclosure lives in the record,
  in `DISCLOSURE_CATEGORIES`, and in the tests over assembled sections.
- **A wrong key cannot be corrected from inside the app.** Once a key is stored the field is not
  offered again, so a typo is fixed by setting `OPENAI_API_KEY` in the environment — which outranks
  the stored key — or by editing the local database. That is ADR-0011's "no rotate" taken at its
  word rather than softened into a hidden control.
- **`shadowed` is the one state that survived the shrink**, and it is now reachable only across
  launches: save a key, then start the app with `OPENAI_API_KEY` set. `e2e/assistant-api-key.spec.ts`
  reaches it exactly that way.

### Risks

- **Re-adding a gate later is not free.** The stored value, the fingerprint, the panel and the
  service check are gone, and any consent recorded before this change is discarded rather than
  honoured. ADR-0011 is the record to revisit if the app ever gains a second user.
- **An accidental first send is now possible** — a key in the environment plus a mistyped question
  is a request. Bounded by the fact that both are the owner's own.
- **`granularity` is now declared and read by nothing at runtime.** Its rule is held by
  `assistantContext.test.ts` reading assembled sections back, which is where it was actually
  enforced anyway; the chip that displayed it was never the enforcement.

## Alternatives Considered

### Option A — Keep the key card, showing "Key set" once there is one

Rejected. A card whose only content is that the setup is done is a row of chrome on every visit,
and what the owner reads past to reach the box is this story's whole subject. `none` draws nothing.

### Option B — Keep `assistant:clearApiKey`, drawing no button for it

Rejected. The acceptance criterion is that there is no control to remove, replace or disable a key
*from inside the app*, and an IPC channel reachable from `window.api` is inside the app. Leaving it
would also leave a contract, a schema, a handler and a service method that nothing exercises.

### Option C — Drop `keyStored` along with the Remove control it served

Rejected. It has a second job DDR-0105 gave it: reporting that a saved key is shadowed. Dropping it
would make the precedence silent in exactly the state a stated order exists for.

### Option D — Render the disclosure list somewhere, ungated

ADR-0011 leaves this open as a UI question (its Option C). Rejected for this story because #309's
acceptance criteria name the list as removed, and because a list nobody must read before acting is
reference material rather than a disclosure — if it comes back it should come back as a decision,
not as a leftover.

## References

- ADR-0011 — the record this implements; the gate's removal and the key policy restated.
- ADR-0010 — the provider, the main-only rule, the unprefixed key and the gateway's discipline, all
  unchanged.
- ADR-0009 — the advisory boundary, untouched.
- [[0097-consent-is-to-a-list-and-the-list-is-the-code]] — what consent gated, in code, and the
  three readings of `DISCLOSURE_CATEGORIES`; two of them survive here.
- [[0098-the-assistant-is-grounded-in-text-the-app-wrote]] — the context boundary and the box's
  states.
- [[0105-the-owner-sets-the-key-and-the-environment-wins]] — the two key sources and their order.
- [[0096-the-model-gateway-inherits-a-discipline-and-adds-two-states]] — the seven states the ask
  result now consists of exactly.
- GitHub Issues: Epic #306, Story #307 (ADR-0011), Story #309 (this record), Story #310.
