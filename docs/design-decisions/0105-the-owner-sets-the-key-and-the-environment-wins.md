# 0105. The owner sets the key inside the app, and the environment still wins

- **Status:** Accepted
- **Date:** 2026-08-29
- **Extends:** [[0100-the-env-file-is-loaded-and-the-environment-wins]],
  [[0096-the-model-gateway-inherits-a-discipline-and-adds-two-states]],
  [[0097-consent-is-to-a-list-and-the-list-is-the-code]],
  [[0094-the-profile-is-a-setting-and-a-range-is-a-policy]]
- **Amends:** [[0035-field-and-form-control-primitives]] — `term` names a *measure*, not a
  vocabulary

## Context

Bug #297 fixed the half of this that a checkout suffers from: nothing loaded `.env`, so an
unprefixed variable never reached `process.env` and an owner who pasted their key into the
documented place got an assistant that was permanently `not_configured`
([[0100-the-env-file-is-loaded-and-the-environment-wins]]).

**It did not fix a packaged build**, and that record says so in its own Consequences: there is no
`.env` beside an installed binary, so an installed copy finds a key only if the operating system
already carries one. Asking a desktop owner of a single-user local-first app to set a user
environment variable is a poor answer — it is invisible from inside the app, unguessable from
anything on screen, and platform-specific in a way nothing else here is. DDR-0100 named the gap and
deliberately declined to close it, because a settings field storing a secret is its own decision
rather than an implementation detail of a loader. This is that decision.

Two things about it are not obvious, and both are why the story exists rather than a patch:

- **The value crosses IPC.** Every other `assistant:*` payload is a boolean or a string the owner
  can already see on a dashboard. This one is the credential ADR-0010 built a whole isolation test
  around keeping out of the renderer's reach.
- **A third source needs a stated order.** Two already exist and are ordered
  ([[0100-the-env-file-is-loaded-and-the-environment-wins]]: the environment wins over the file).
  Adding a third without saying where it sits means the answer is whatever the code happens to do.

## Decision

### The key is stored as one overwritten `app_meta` value

The shape consent and the investor profile already have
([[0097-consent-is-to-a-list-and-the-list-is-the-code]],
[[0094-the-profile-is-a-setting-and-a-range-is-a-policy]]): a *setting*, not history, so ADR-0006's
append-only rule does not reach it and `metaRepository.remove` is the right un-set rather than the
delete-by-id that record refuses. Removing takes the row out rather than blanking it, so "never
set" and "removed" are one state — consent's rule, for consent's reason: the app must behave
identically in both.

**The store is unencrypted.** So is every other row in this database, and so is `.env`, and so is
an environment variable in a user's shell profile — which makes this no worse than the two places
the key could already live, but that is a claim the owner is entitled to check rather than one the
app gets to make quietly. It is written here, and it is on the panel that asks for the key.
Encrypting the database is a separate decision affecting every table and is not taken here; what
*is* taken here is that the fact is stated.

### Precedence: the environment beats the stored key

`OPENAI_API_KEY` in `process.env` — an OS variable, or a `.env` line that `src/main/env.ts` merged
into it with the OS winning — is used when present. The stored key is used otherwise. A **blank**
value is no key at either end.

The direction is DDR-0100's, extended one step, and for the same two reasons. An environment
variable is the deliberate per-session act of whoever launched the process, while a stored key is a
default sitting in an installation, so the more specific act wins. And the e2e suite supplies keys
through `electron.launch({ env })`; the opposite order would let whatever a run happened to have
stored replace the value a test asserts on — a passing test that passes for the wrong reason, which
is the failure DDR-0100 records as "the rule with teeth".

**The order is only defensible because it is reported.** `AssistantStatus` carries `keySource` and
`keyStored`, and the panel has a state for the pair that would otherwise be silent: a key saved in
the app *and* an environment key shadowing it. That state says the saved key is kept, is not being
used, and what to do about it. An owner who pastes a key and watches it be silently ignored is
exactly the failure a stated order exists to prevent, and an order the owner cannot see is not
stated.

Three sources collapse to **two names** on purpose. Nothing downstream of `src/main/env.ts` can
tell an OS variable from a `.env` line — the file is merged into the environment at startup — so a
third name would be a distinction the app cannot actually make, and the copy says "your environment
or your .env file" rather than pretending to know which.

### `aiGateway` owns the key end to end

The store is read **and written** in `repositories/assistant/aiGateway.ts`, which makes it a
repository over two sources: SQLite and OpenAI. That is the shape `classificationRepository`
already has (a mutable cache in front of `ibkrGateway`), and it buys the invariant this whole story
is about — **the key exists in exactly one module.** Split the read from the write and there are
two places to forget the trim, two places a fragment could escape, and nothing left for a test to
point at.

The test that points at it is a new assertion in `aiGatewayIsolation.test.ts`: the `app_meta` row
name `'openai_api_key'` appears in exactly one file. It is phrased as "which files contain this
string" rather than as an import rule, because reading `metaRepository.get('openai_api_key')`
requires no import of the gateway at all — which is precisely how the invariant would be worked
around by accident.

`services/assistant/apiKeyService.ts` keeps only the rule about what may go *into* the store, and
that rule is small:

- **No format check.** A key is opaque, and `OPENAI_BASE_URL` can point the gateway at a compatible
  endpoint whose credentials are shaped differently, so requiring `sk-` would reject a working
  setup to catch a typo the provider reports better anyway — as `refused`, in its own words
  ([[0096-the-model-gateway-inherits-a-discipline-and-adds-two-states]]).
- **Printable ASCII only, after trimming.** A space, a newline or a smart quote a document viewer
  substituted is a paste accident rather than a key — and a control character would make
  `node:http` **throw** on `Authorization: Bearer …`, turning a bad paste into an exception in the
  one module whose entire design is that every outcome is a state ([[0022-gateway-timeout-and-not-responding-state]]).
  Refusing it here is what keeps that promise true.

### Nothing about the value ever comes back

`AssistantStatus` carries three booleans-in-effect about the key — `configured`, `keySource`,
`keyStored` — and no material. There is **no last-four-characters hint**, which is the affordance
this panel most obviously invites, and the reason is already in the codebase: `aiGateway` redacts
even the masked fragment OpenAI quotes back in a refusal (*"Incorrect API key provided:
`sk-defin****…`"*), so that "the key never leaves the main process" is exactly true rather than
nearly true. A hint here would be the one place it came back after that trouble was taken.

So the field is `type="password"`, is cleared the moment a save lands, and is never repopulated —
because nothing *can* repopulate it. That makes "never displayed back in full" a property of the
wire rather than a discipline in a component.

A refused paste is the one thing deliberately **not** cleared: it is still the owner's to fix, and
wiping it would make them find the key again to correct a stray space.

### Setting a key is not gated on consent

Saving a key sends nothing. It is the same class of act as pasting one into `.env`, and requiring
consent first would make a setup step depend on a decision the owner may reasonably want to take
second. The gate stays exactly where it has been since
[[0097-consent-is-to-a-list-and-the-list-is-the-code]] — `assistantService.ask`, the only path that
can send — and a unit test asserts that setting a key reaches the model gateway not at all.

### The panel sits between the gate and the question

The order on the Assistant view is the order of the decisions: what may be sent, then what it is
sent with, then the asking. It also puts the key field directly where the gate's `not_configured`
state points, so the blocker and its fix are adjacent instead of the owner being sent to edit a
file.

### `term` names a measure, not a vocabulary

The key field wants exactly `.control-term`'s box: a single-line text control taking the row's
slack. A sixth `secret` kind would be an axis value whose rule copied another declaration for
declaration — the speculative abstraction [[0035-field-and-form-control-primitives]] and
[[0034-stat-tile-primitive-tone-axis]] both already refuse for a size scale, and one the guard test
**cannot** catch, because a duplicate rule is still a rule. So `term` is re-read as the row-slack
text kind, and the `<datalist>` belongs to the profile's call site rather than to the kind.

## Consequences

- **A packaged build can use the assistant.** The gap DDR-0100 left open is closed by the source it
  named, in the shape it pointed at.
- **`.env` support is untouched**, and still wins. Running from source behaves exactly as it did.
- **Three states can now say "a key is present" and mean different things**, which is why the panel
  has four kinds rather than two. The one that earns its keep is the shadowed save.
- **The e2e suite grows a spec that starts the app twice** against one user-data directory, in the
  shape `window-state.spec.ts` and `assistant-consent.spec.ts` use. Nothing in it asks a question:
  saving a key opens no socket, and the keys it pastes were never valid anywhere.
- **The unencrypted store is a stated position, not a solved problem.** Someone who can read the
  files on the machine can read the key — as they could read `.env`, the shell profile, and every
  figure in the database. Encrypting it remains a separate decision about every table.
- **A text-scanning guard needed comment-stripping again, for the seventh time** (DDR-0042,
  DDR-0047, DDR-0048, DDR-0058, DDR-0070, DDR-0075). The key panel *explains in prose* that the
  gateway redacts fragments, and the import guard reading for `aiGateway` could not tell a sentence
  from an import. Then an **eighth**: `zodIsolation.test.ts`'s own subject quotes
  `import { z } from 'zod'` while explaining why it exists.

### The constant that pulled Zod into the renderer bundle

`MAX_API_KEY_CHARS` was first declared in `@shared/domain/assistant`, beside the schemas that use
it. That reads naturally and is wrong: the renderer needs it at **runtime**, to cap the key field's
`maxLength`, and that module opens with `import { z } from 'zod'`.

Every other renderer import from a schema module is `import type`, erased at compile time — which
is how ADR-0002's "the renderer imports only the types, so Zod never reaches the renderer bundle"
had held for the app's whole life: by convention, enforced by nothing. **One value import broke it
for the entire module graph.** `npm run lint`, `npm run typecheck`, 1,986 unit tests,
`npm run build` and 138 e2e specs all passed. The only symptom was one line of Vite output during a
manual launch for review: `new dependencies optimized: zod`.

Measured, by reintroducing the import deliberately: the renderer bundle goes from **3,098.79 kB to
3,211.58 kB** and contains `ZodError`.

Two things follow. The constant moves to **`@shared/domain/assistantKey`**, dependency-free — the
shape `assistantDisclosure` and `investorProfileTerms` already have, now with a stated reason. And
`src/shared/domain/zodIsolation.test.ts` holds the rule: for `src/renderer` and `src/preload`, no
shipped file may import a **runtime value** from a module that imports Zod.

Three details of that guard are load-bearing:

- **The mixed clause is the case that matters.** `import type { A }` and `import { type A, type B }`
  are both erased; `import { VALUE, type T }` is not, and that is the form that shipped. The parser
  is unit-tested against all three rather than trusted.
- **The clause may span lines but may contain no brace and no quote.** Written lazily without those
  exclusions, the first version matched from one statement's `{` across two lines to a *later*
  statement's specifier, and reported `periodSet.ts` — whose only shared import is `import type` —
  as an offender. A guard that names innocent files is one whose next real finding is waved through.
- **Tests are excluded, and that is the rule rather than a loophole.** The invariant is about a
  bundle, and a Vitest file is never in one. Two of them import a schema deliberately, to assert
  against the real shape instead of a hand-written copy of it.

## Alternatives Considered

### The stored key wins over the environment

Tempting on owner-experience grounds: the in-app field is the only source visible from inside the
app, so an owner who types into it expects it to take effect. Declined because it reverses
DDR-0100's direction for no new reason, and because it makes the e2e suite's injected key
overridable by whatever a run happened to have stored — the exact defect DDR-0100 records. The
owner-experience objection is answered instead by *reporting* which source is in force, which is
the better fix in both orders.

### Show the last four characters of the saved key

Common practice, and genuinely useful for telling two keys apart. Declined: `aiGateway.redactKeys`
exists specifically so that not even OpenAI's own masked fragment crosses back, and re-opening that
for a convenience would make the redaction pointless. An owner who cannot tell which key is saved
can paste the one they want; a replace costs nothing.

### Store the key in the OS keychain

The right long-term answer, and out of scope. It means a native dependency or Electron's
`safeStorage` (which is main-only, unavailable before `app.ready`, and silently degrades to
plaintext on Linux without a keyring) — a set of platform behaviours that deserves its own decision
rather than being smuggled in under a settings field. Nothing here blocks it: the store is one
`app_meta` row behind two gateway methods, which is exactly the seam a later record would move.

### A `secret` control kind

Declined, above: its rule would duplicate `.control-term`'s exactly.

## References

- Story #300, Epic #5 — the packaged-build gap, carved out of Bug #297
- ADR-0010 — the OpenAI provider and the network policy; the unprefixed key
- [[0100-the-env-file-is-loaded-and-the-environment-wins]] — the loader, and the precedence this
  extends
- [[0096-the-model-gateway-inherits-a-discipline-and-adds-two-states]] — `not_configured`, and the
  redaction
- [[0097-consent-is-to-a-list-and-the-list-is-the-code]] — the setting shape, and the removal rule
- [[0035-field-and-form-control-primitives]] — amended: `term` is a measure
