# 0100. The `.env` file is loaded in main, and the real environment wins

- **Status:** Accepted
- **Date:** 2026-08-28
- **Extends:** [[0096-the-model-gateway-inherits-a-discipline-and-adds-two-states]],
  [[0022-gateway-timeout-and-not-responding-state]],
  [[0025-single-instance-lock-and-window-focus]]

## Context

`.env.example` documented `OPENAI_API_KEY` and `IBKR_GATEWAY_URL` without a prefix, ADR-0010 chose
that deliberately so the key can never be inlined into a renderer bundle, and `CLAUDE.md` told
every session the value "stays in `process.env`". **Nothing put it there.**

electron-vite's `loadEnv` defaults to the prefixes `VITE_` / `MAIN_VITE_` / `PRELOAD_VITE_` /
`RENDERER_VITE_` and uses them for one purpose: deciding what Vite inlines into a bundle. It
assigns nothing to `process.env`, and this repo added no loader of its own. So an unprefixed
variable reached the app only when the operating system already carried it, and an owner who
pasted their key into the documented place got an assistant that was permanently `not_configured`
with no way to tell why (Bug #297).

It stayed invisible for two reasons worth recording, because both are the shape of a test that
looks like coverage and is not:

- `e2e/assistant-consent.spec.ts` supplies the key through `electron.launch({ env })` — the real
  process environment. It proves the app **reads** a variable and says nothing about loading one.
- `ibkrGateway.test.ts` writes `process.env` directly. Same shape. And `IBKR_GATEWAY_URL` carries
  the identical defect, masked since M1 because its default `https://localhost:5000` is the value
  everyone actually uses, so nobody ever needed the override to work.

## Decision

### `src/main/env.ts` loads the file, and it is not `dotenv`

Forty lines: parse, then set. `CLAUDE.md`'s standing rule is to avoid dependencies without clear
long-term value, and what is needed here has **no** variable expansion, **no** multiline values and
**no** `.env.local` cascade. In a file that holds a secret those absences are a property rather
than a limitation — every one of them is a rule about the *inside* of a value.

Two grammar decisions follow from the same reasoning:

- **The key is everything before the first `=`.** A secret is frequently base64-ish and carries its
  own; splitting anywhere else hands the gateway a truncated key, which fails authentication with
  no hint as to the cause.
- **No inline-comment stripping and no `${}` expansion.** Both are guesses about a value's
  interior. A key silently cut at a `#` is the worst failure this file could produce, and the cost
  of not guessing is that a value containing `#` must be quoted.

### The real environment wins over the file

A variable already in `process.env` is **never** overwritten, and an empty string counts as set —
that is every shell's way of saying *unset this*, and the file must not undo the decision.

This is the rule with teeth. `assistant-consent.spec.ts` passes a key through
`electron.launch({ env })`; the opposite precedence would let a developer's own `.env` replace the
value the suite asserts on, turning a passing test into one that passes for the wrong reason. It is
also the right order for a human: an OS variable is a deliberate per-session act, while the file is
a default sitting in a working copy.

### A missing file is a no-op, never an error

A packaged build has no `.env` beside its binary; a fresh CI checkout has none either. Both must
start normally. Every consumer already reports its own absence as a *state* the owner can read —
`not_configured` for the key ([[0096-the-model-gateway-inherits-a-discipline-and-adds-two-states]]),
a default for the gateway URL — and turning a missing optional file into a startup failure would
replace a legible state with a crash.

### It runs as `index.ts`'s first statement, above the single-instance lock

Every consumer reads its variable lazily inside a function today (`aiGateway.apiKey()`,
`ibkrGateway`'s base URL), so a later call would work. Doing it first means it *keeps* working when
one of them stops being lazy — which is the kind of change nobody would think to check.

Above the lock, because the lock's rule is that the **losing** process quits without migrating,
capturing a snapshot, or opening the database ([[0025-single-instance-lock-and-window-focus]]). Reading one small
text file is none of those, and the loser does no more work than it did before.

### Only names are logged

`loadEnvFile` returns the names it set, and the launch line prints those. A launch log is exactly
the artefact that gets pasted into an issue.

## Consequences

- **`OPENAI_API_KEY` in `.env` now reaches the assistant.** Verified on the owner's machine:
  `[env] loaded from .env: RENDERER_VITE_MAPBOX_TOKEN, OPENAI_API_KEY`.
- **A packaged build is not covered.** There is no `.env` beside a packaged binary, so an
  unprefixed variable must come from the operating system. A desktop owner should not have to set
  one, which points at a settings field stored the way consent and the profile are
  ([[0094-the-profile-is-a-setting-and-a-range-is-a-policy]],
  [[0097-consent-is-to-a-list-and-the-list-is-the-code]]) — **a decision this record does not
  make**, deliberately, and one that is tracked separately.
- **Editing an unprefixed variable needs a restart.** It is read once at startup, and there is no
  hot reload across the main-process boundary.
- **The tests go through a real file on disk.** The defect lived in the step between the file and
  the environment, so a mock at that seam would have passed while the app stayed broken. The
  wiring — that `index.ts` calls the loader, and calls it before `runMigrations()` — is held by a
  source scan, the same way several `lib/*.test.ts` guards read `app.css`, because Vitest cannot
  import an Electron entry point.
