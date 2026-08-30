# 0097. Consent is to a list, and the list is the code

- **Status:** Superseded by [[0107-the-assistant-view-is-the-chat]] (Story #309) — the consent
  gate is removed as a concept by ADR-0011. **Two of the three readings of
  `DISCLOSURE_CATEGORIES` below still apply**: it types `AssistantContext`, and it is the
  boundary at which an undeclared section is dropped. The third — the list the owner read, and
  the fingerprint consent was stored against — is retired, along with `consentService` and the
  panel. The argument for the gate is preserved here on purpose: ADR-0011 records that a second
  user, or an app the owner did not install, would have to argue past it.
- **Date:** 2026-08-28
- **Extends:** [[0096-the-model-gateway-inherits-a-discipline-and-adds-two-states]],
  [[0094-the-profile-is-a-setting-and-a-range-is-a-policy]], [[0028-window-state-persistence]],
  [[0012-in-place-destructive-confirm]], [[0022-gateway-timeout-and-not-responding-state]],
  [[0055-vertical-sidebar-tablist]]

## Context

Every other data path in this app ends on the owner's machine. The IBKR gateway is `localhost`;
the database is a file in `userData`; the one external origin the renderer may reach is Mapbox, and
ADR-0007 records that only tiles and a viewport leave — no portfolio data, with `events.mapbox.com`
omitted from the CSP so the *platform* enforces it however the library is configured.

Epic #5 breaks that. ADR-0010 records why and #279 accepted it. Story #283 is the part the owner
actually experiences: **the moment the app stops being local-first, made visible and made
optional.**

The story's sharpest observation is that a disclosure is worth nothing unless it is specific.
"Your portfolio data may be sent to OpenAI" is a shrug. What the owner needs is which fields, at
what granularity, and whether absolute money is involved — and its second observation is that a
disclosure maintained by hand becomes a lie on the first change.

## Decision

### The disclosure is a constant, and three things read it

`DISCLOSURE_CATEGORIES` in `@shared/domain/assistantDisclosure` is not a description of what is
sent. It is the thing itself, in three ways at once:

1. **The panel renders it.** The view maps over the constant and quotes none of its text; a test
   fails if it starts to.
2. **It types the payload.** `AssistantContext` is `Partial<Record<DisclosureCategoryId, string>>`,
   so a later story cannot send a section that is not on the list the owner read — the type says so
   at compile time, and `buildPrompt` drops an unknown key at runtime so the two agree.
3. **Consent is stored against its fingerprint.** Add a category, remove one, or re-describe what
   one sends, and the fingerprint changes, stored consent stops matching, and the owner is asked
   again.

That third point is the one that makes the disclosure load-bearing rather than decorative:
**consent is to a specific list, not to the idea of one.** Without it, #285–#289 would inherit an
agreement made about something narrower, one category at a time, and nobody would notice.

The fingerprint covers each category's **detail text**, not only its id, because re-wording what a
category actually sends is exactly the change an owner would want to see again. A purely cosmetic
edit therefore costs one re-consent, which is the right side to err on.

### The finding the story invited: most of this Epic sends percentages

The story asked whether the context could be assembled without absolute figures, and said that if
so it is a finding to record rather than a toggle to build. It largely can.

Of five categories, **three send no money at all** — the question, the instrument names, and every
weight. The investor profile and the drift report against it are percentages by construction
(DDR-0095: weights are shares of a placed total, and the total itself is not part of an answer).
Only the performance category carries amounts, because "how much did I earn in dividends" cannot be
answered in percentages.

So the disclosure names a **granularity** per category, and the panel says which is which. That is
strictly more honest than a single warning, and it is a better product for the reason the story
gave: a weight says nothing about how much money is involved.

### `needs_consent` is a state, and it is checked first

The gate is `assistantService`, the only module that calls `aiGateway`. Consent is checked before
the key is read, before a prompt is built, and long before a socket is opened. `needs_consent`
joins the gateway's own states as data, never an exception ([[0022-gateway-timeout-and-not-responding-state]]).

**Consent before configuration**, deliberately: "no API key" is a setup detail, "you have not
agreed to send anything" is a decision, and telling an owner to paste a key when they have not
agreed to use the feature answers a question they did not ask. Both facts are reported *beside* the
blocker, so the panel can name what will be next rather than revealing the second obstacle only
after the owner clears the first.

**Stale consent is its own state.** Someone whose disclosure changed is being asked to re-read a
list, not to decide for the first time, and telling them the wrong one of those is DDR-0022's
mistake in a different domain.

### Consent lives where the profile lives

One overwritten `app_meta` value through `metaRepository`, exactly as
[[0094-the-profile-is-a-setting-and-a-range-is-a-policy]] settled for the investor profile — the
story asked the two to answer the same question the same way rather than inventing two mechanisms
for two small owner-owned flags. It is a *setting*, and ADR-0006 governs history.

Revocation **removes the key**, so "never asked" and "said no" are the same state. Neither is a
decision the app should treat as durable, and both mean the same thing: nothing may be sent. An
unreadable stored value falls back to *no consent* — worth stating because for the app's other two
settings the safe direction was a default rather than a refusal.

### The Assistant view opens one story early, carrying only its front door

The gate needs a room to stand in. Building a temporary home on the Profile page and moving it when
#284 lands would be churn, and the Profile page is the owner's *investment policy*, not their
privacy settings.

So the Assistant row arrives now with exactly the part that must exist before anything can be
asked: the disclosure, the decision, and the two blocking states. **There is no question box and no
channel behind one** — the app still cannot reach OpenAI at all, and a guard test fails if the view
grows a `textarea` or anything network-shaped.

It sits **between Trades and Profile**, which makes the sidebar's order the app's own grammar: five
views of the data, then the surface that talks about it, then the policy the owner sets over it.
Assistant takes `Ctrl`/`Cmd`+`6` and Profile `+7` with no code change, because nothing counts rows
([[0083-a-view-accelerator-beside-the-tabs-pattern]], [[0090-ctrl-tab-rotates-and-the-list-carries-the-hint]]).

### The wording states the cost and does not sell the benefit

Held by a test, because a rule about prose that nothing checks is a preference. The heading says
this is the one feature that sends data off the machine; the destination is named — OpenAI, in the
United States; and no benefit appears in the consent copy at all. The benefit is why the owner
opened the view; the cost is what the panel is for, and pairing them is how a disclosure becomes a
sales pitch.

Withdrawing uses the in-place `ConfirmAction` ([[0012-in-place-destructive-confirm]]) — no modal,
no `window.confirm` — though withdrawing is the *safe* direction, so the confirm stops a slip
rather than warning of loss.

## Alternatives Considered

- **A disclosure written in prose in the view.** Rejected by the story and rightly: it is a lie on
  the first change, and nothing would catch it.
- **A fingerprint over category ids only.** Rejected: re-describing what a category sends is
  exactly the change worth re-asking about.
- **Consent as a boolean with no fingerprint.** Simplest, and it silently widens every time a later
  story sends something new.
- **Putting the gate on the Profile page.** Rejected: the profile is the owner's investment policy,
  and the gate would have to move in #284 anyway.
- **A modal on first use.** Rejected: the app has no modal pattern, and a decision the owner can
  return to and re-read is better than one they dismiss.
- **Checking the API key before consent.** Rejected: it answers a question the owner did not ask.
- **Storing a refusal as `false`.** Rejected: it makes "said no" and "never asked" different states
  that the app must treat identically.
- **Redaction options — sending weights but not values.** Out of scope by the story; the finding
  above records where the line already falls without a toggle.

## Consequences

- The sidebar has seven rows, and `profileView.test.ts` now pins the *sequence* rather than
  Profile's position.
- `AssistantContext` is the shape #285–#289 must fill, and they cannot add a section without
  adding a disclosure category — which re-asks the owner.
- **A built app reads `OPENAI_API_KEY` from the environment it was started in.** `npm run dev`
  supplies `.env`; a directly-launched build does not, which is why the e2e specs now state the key
  they launch with rather than inheriting one. This is pre-existing and applies equally to
  `IBKR_GATEWAY_URL`, whose default happens to be correct; it is recorded here rather than fixed,
  because loading `.env` in main changes startup behaviour for every variable and deserves its own
  change.
- Nothing in this story can reach OpenAI. The gateway exists (#282), the gate exists (#283), and
  the thing that asks a question does not (#284).
