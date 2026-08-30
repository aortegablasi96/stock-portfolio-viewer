# 0011. Supplying a key is the authorization: the assistant's consent gate is removed

- **Status:** Accepted
- **Date:** 2026-08-30

## Context

[[0010-openai-provider-and-the-network-policy]] narrowed the data-privacy guarantee for one feature
and put an owner-facing decision point in front of it:

> Nothing leaves the machine until the owner has seen what would be sent — at its real granularity,
> generated from or pinned against the code that assembles it, so the disclosure cannot drift from
> the payload. Consent is refusable, leaving every other part of the app fully functional, and
> revocable, after which no request is made.

That was the right answer to the question ADR-0010 asked. **The question has since been answered a
second time by use.** The gate was built (Story #283, DDR-0097), and in the shape this app actually
has it protects the owner from themselves: a single user, on their own machine, who wrote the app,
installed it, obtained an OpenAI account and pasted the key. Every one of those acts is deliberate,
and the last of them is already a decision to send data to OpenAI — the key has no other purpose
here. The gate asks the same person the same question a second time, in a panel they must read past
before they can ask anything.

The cost is not only ceremony. Consent is stored, fingerprinted against `DISCLOSURE_CATEGORIES`,
checked before the key, before a prompt and before a socket, and re-asked whenever the disclosure
list is re-worded. That last property — correct, and the point of DDR-0097 — means a grounding
change that adds or renames a category silently withdraws the owner's consent and stops the
assistant until they read the list again. Three of M10's stories moved that list.

**The owner took the decision to remove it**, on 2026-08-30, having been shown what the gate
currently enforces and what remains once it is gone. Epic #306 is the work; this record is the
amendment it is blocked on, because `CLAUDE.md` and `docs/decisions/README.md` both state that an
accepted decision is never silently overridden.

This record does **not** re-open ADR-0010's other decisions, none of which change. It is written as
an amendment rather than a superseding record for that reason: one section of ADR-0010 is reversed
and the rest — the provider, the main-only rule, the unprefixed key, the gateway's discipline, the
size bound, and the honest restatement of what leaves the machine — remains in force exactly as
written. Marking the whole record Superseded would retire five decisions to change one. The
precedent is ADR-0010 itself, which amends ADR-0007's network section without superseding it.

## Decision

### The consent gate is removed as a concept, not only as a panel

No consent is **asked for, stored, or checked** anywhere in the app. There is no revocation,
because there is nothing to revoke. `needs_consent` and `stale consent` cease to be states the
assistant can report, and the fingerprint that re-asked the owner when the disclosure list moved
ceases to exist.

The disclosure list is no longer **rendered**. `DISCLOSURE_CATEGORIES` itself survives, and its
other two jobs are unaffected: it *types* the context, so a section nobody declared cannot be
assembled, and it is the boundary at which an undeclared section is dropped (DDR-0098). What is
removed is the reading of it, not the bound.

### Supplying a key is the act that authorizes sending; removing the key is what stops it

There is exactly one owner-facing control over whether portfolio-derived figures leave the machine,
and it is the key. **With a key present and a question asked, the request is made with nothing in
front of it.** Without a key the assistant is `not_configured` and no socket is opened — the resting
state of a fresh clone, unchanged from ADR-0010.

This is stated plainly rather than left to be inferred from a missing section. The app **sends
portfolio-derived figures to OpenAI whenever a key is present and a question is asked.** What
leaves and what does not is unchanged from ADR-0010's *What leaves the machine, and what does not*,
which stands in full; only the permission in front of it is gone.

The trade is acceptable **because of the shape of this app, and for no more general reason**: one
user, who is the machine's owner, the key's holder and the software's author. It would not be
acceptable in an app with a second user, an app the owner did not install themselves, or an app
that supplied the key. If any of those ever becomes true, this record is the one to revisit — the
gate's code is in the history, and the argument for it is above.

### The key policy is restated, unchanged

DDR-0105 stands as written, and is repeated here so this record can be read without it:

- **Two sources, one stated order.** The environment (an OS variable, or a `.env` line merged into
  `process.env` at startup) beats the key the owner saves in the app. The stored key is one
  overwritten `app_meta` value.
- **The order is reported, never silent.** A saved key the environment shadows is reported as kept
  and unused, with what to do about it.
- **`aiGateway` owns key material end to end**, reading and writing both sources. Nothing about the
  value ever comes back across IPC — no fragment, no last-four hint.
- **A packaged build has no `.env`**, which is why the in-app field exists at all. It is shown when
  there is no working key and not shown once there is one. There is no activate, deactivate or
  rotate.
- **Setting a key remains ungated** — it sends nothing. Under ADR-0010 that was said to distinguish
  it from the consent gate; it is now simply the whole of the setup.

### What still enforces the boundary

Everything structural. None of it was consent's work, and none of it moves:

- **Every model call is made from the main process.** The renderer cannot reach OpenAI.
- **The renderer's CSP is unchanged** — `connect-src` admits `'self'` and `https://api.mapbox.com`
  and nothing else. `events.mapbox.com` stays omitted.
- **`OPENAI_API_KEY` is unprefixed**, so it never enters a shipped renderer bundle.
- **`aiGateway` is the only module that reaches OpenAI**, and the only one that holds key material.
- **The prompt size is bounded in the gateway**, and exceeding it is a reported state rather than a
  silent truncation.
- **Context assembly is deterministic and unit-tested**, and no section outside
  `DISCLOSURE_CATEGORIES` can be assembled or can cross the IPC boundary.
- **A refusal is redacted** before it leaves the gateway.

`aiGatewayIsolation.test.ts` fails on each of the first four: on an `OPENAI_` name in
`src/renderer` or `src/preload`, on an import of the gateway from outside main, on a new
`connect-src` origin, and on the storage row's name appearing in a second file. It is unchanged by
this record, and Epic #306 requires it to pass unchanged.

### The guarantees, restated again

- **Local-first stays qualified.** All storage, all computation and all broker access remain local.
  One feature sends derived figures to a third party — **when a key is present**, where ADR-0010
  said *gated on consent*.
- **ADR-0007's network statements remain true of the renderer.** They were never made true by
  consent, and are not weakened by its removal.
- **ADR-0009 is untouched.** The assistant proposes, names positions, and never acts. The advisory
  boundary was never the privacy one.

## Consequences

### Benefits

- The owner opens the assistant and asks a question. No decision point, no list to re-read, and
  nothing to configure after the first key.
- **A grounding change can no longer stop the assistant.** Re-wording or adding a disclosure
  category moved the fingerprint and withdrew consent under DDR-0097; three M10 stories did exactly
  that. The coupling between what the app computes and whether it may answer is gone.
- The state machine shrinks by two states (`needs_consent`, stale consent) in the service, the IPC
  contract and the view, each of which had to be rendered, tested and kept honest.
- The single control over sending is the one the owner already understands, and it is the one that
  actually gates the socket.

### Tradeoffs

- **The app no longer tells the owner what it sends before it sends it.** The disclosure is in this
  record, in ADR-0010's *What leaves the machine* and in `DISCLOSURE_CATEGORIES`, and nowhere in
  the running app. That is a real loss of transparency, accepted because the reader and the owner
  are the same person.
- **The only "no" is deleting the key**, which also turns the feature off. There is no longer a way
  to keep a key configured and refuse a send.
- **`docs/product.md`'s local-first claim now rests on one sentence** — that a key must be present
  — where it previously rested on an act the owner performed knowingly in the app.

### Risks

- **Scope creep in what is sent is now less visible.** ADR-0010 named this risk and gave the
  generated disclosure as half its mitigation; that half is gone. What remains is the gateway's
  size bound, `DISCLOSURE_CATEGORIES` as a type, and the tests that read assembled sections back
  and fail on money in a section that declared none (DDR-0098). Those are stronger than the panel
  was — they fail a build rather than inform a reader — but they bind the *shape* of what is sent
  and no longer its *visibility*.
- **A first send can now be accidental.** A key left in the environment plus a mistyped question is
  a request. Bounded by the same fact that justifies the removal: the environment and the key are
  both the owner's own.
- **This app's argument is portable to apps it does not fit.** "The owner supplied the key, so the
  key is the consent" is true here because there is one user. Recorded explicitly so a future
  multi-user or distributed shape has to argue past it rather than inherit it.
- **Re-adding the gate later is not free.** The stored value, the fingerprint and the panel go; a
  future requirement to gate again rebuilds them, and any consent recorded before this change is
  discarded rather than honoured.

## Alternatives Considered

### Option A — Keep the gate, shrink the panel

Ask once, in one line, and never render the category list again. Rejected: it keeps every part that
costs — the stored value, the fingerprint, the check before the key, the two extra states, and the
re-ask when the grounding moves — and drops the only part that justified them, which was the owner
seeing the real granularity. A one-line consent is a click-through, and a click-through is worse
than no gate because it claims to be one.

### Option B — Keep consent, drop only the fingerprint

Ask once and never re-ask, so a grounding change stops withdrawing consent. Rejected: it makes the
agreement drift from the payload, which is the exact failure DDR-0097's third reading exists to
prevent. The choice is between a gate that re-asks and no gate; a gate that does not re-ask is the
weakest of the three and the easiest to mistake for the strongest.

### Option C — Show the disclosure without gating on it

Render the list somewhere in the view as reference, sending regardless. Rejected as a decision here
but **not foreclosed**: it is a UI question for Epic #306's stories, and this record does not
require the app to hide anything. What it removes is the *gate*, not the possibility of the app
ever explaining what it sends.

### Option D — Supersede ADR-0010 with a full replacement

Restate provider, transport, key, gateway discipline and privacy boundary in one current record.
Rejected: five decisions would be re-litigated to change one, and the reasoning ADR-0010 carries for
the four unchanged ones is worth more where it is than restated by a scribe. The amendment chain
ADR-0007 → ADR-0010 → ADR-0011 keeps each argument at the record that made it.

## Supersedes

None.

This ADR **amends** [[0010-openai-provider-and-the-network-policy]], specifically its *Consent gates
the first send, and revocation bites* section, which is no longer in force. Every other section of
that record stands, including *What leaves the machine, and what does not*. ADR-0010 carries a
pointer to this record so the two cannot be read separately, as does
[[0007-mapbox-basemap-and-renderer-network-policy]], whose amendment note named the gate.

`docs/product.md` and `CLAUDE.md` are amended in the same change.

## References

- [[0010-openai-provider-and-the-network-policy]] — the record amended; the provider, the main-only
  rule, the unprefixed key and the gateway's discipline are unchanged by this one.
- [[0009-ai-assistant-grounding-and-advisory-boundary]] — the advisory boundary, untouched.
- [[0007-mapbox-basemap-and-renderer-network-policy]] — the renderer's network policy, untouched.
- DDR-0097 — what consent gates today, in code, and the three readings of
  `DISCLOSURE_CATEGORIES`; the third is what this record retires.
- DDR-0098 — the context boundary and the tests that bound what a section may carry.
- DDR-0105 — the two key sources and their order, restated above and unchanged.
- GitHub Issues: Epic #306, Story #307 (this record), #309 and #310 (the code it unblocks),
  #283 (the gate this removes), #300 (the in-app key).
