# `src/shared`

What **both processes agree on**: the IPC wire shape, the domain types that cross it, and the one
formatter. Everything here is imported by main *and* the renderer, which makes it the one place a
careless dependency reaches a bundle it has no business being in.

```text
ipc/channels.ts   channel-name constants
ipc/contract.ts   Zod schemas + the inferred types + RendererApi
domain/           the domain vocabularies the contract composes
format.ts         money, percentages and dates, at APP_LOCALE
errors.ts         the typed errors repositories throw
```

## `ipc/contract.ts` is the single source of truth for the wire

Every channel's request and response is a Zod schema here, with its TypeScript type inferred from
it — never declared twice. Main validates against the schema; the renderer and preload import
**types only**, so Zod never lands in those bundles.

Domain result schemas live in `domain/*.ts` and the contract **composes** them. Don't inline a
shape that a domain already names.

## The Zod isolation rule

**A constant the renderer needs at runtime must not live in a module that imports Zod.** One value
import pulls the whole package into the renderer or preload bundle — and lint, typecheck, tests,
build and e2e all still pass. `domain/zodIsolation.test.ts` is what fails instead (DDR-0105).

`domain/assistantKey.ts` is the shape of the fix: the constant on its own, in a module with no
schema in it. `domain/assistantHistory.ts` is deliberately **Zod-free** for the same reason.

## `format.ts`

Figures go through here, at **`APP_LOCALE`, never the host's**. Passing `undefined` as the locale
means two processes resolve it differently, in silence — main formatting a number for the
assistant's grounding and the renderer formatting the same number on screen would disagree
(DDR-0111).

## `domain/`

The vocabularies each domain is written against: allocation, asset class, dividends, flex,
performance and its standard periods, the portfolio, snapshots, realized gains, the investor
profile and its terms, balance drift, the app's baseline, classification, and the assistant's
disclosure categories, absences, history and key.

Two carry rules worth knowing before editing:

- **`assetClass.ts` is shared on purpose.** The profile stores the allocation report's own key; a
  second copy of the vocabulary would leave targets joining with nothing and reading 0%.
- **`standardPeriods.ts` / `performanceWindow.ts`** hold *every* standard period, precomputed. A
  window the set does not hold is a **named state with alternatives**, never the adjacent row, and
  `findPeriod` matches exactly. The renderer's `lib/` re-exports both rather than reimplementing
  them.
