# 0095. Drift is measured live, and a residual is never absorbed

- **Status:** Accepted
- **Date:** 2026-08-27
- **Extends:** [[0094-the-profile-is-a-setting-and-a-range-is-a-policy]],
  [[0007-portfolio-display-currency-and-live-fx]], [[0009-sector-classification-cache-and-allocation-donuts]],
  [[0052-composition-cumulative-and-chart-readability]], [[0022-gateway-timeout-and-not-responding-state]],
  [[0024-gateway-read-coalescing-and-freshness-window]], [[0088-a-live-holding-is-named-by-imported-history]]

## Context

Story #281 computes how far the portfolio sits from the targets [[0094-the-profile-is-a-setting-and-a-range-is-a-policy]]
let the owner set. It exists for one reason, and the reason is not that the arithmetic is hard:
**it is to keep the model out of the arithmetic.**

Epic #5 names that as its single largest correctness risk. A language model asked "is my portfolio
balanced?" will happily add percentages, and it will sometimes be wrong in a way that reads exactly
like being right — confident, plausible, and unfalsifiable by the person reading it. The defence is
that it never does: every figure in every later answer comes from a service that already computed
it, and the model is given numbers to *phrase*. This DDR records the service that computes the ones
balance needs.

That makes the decisions below unusually consequential for a report nothing yet draws. Every one of
them is a choice about what to do with something the app does not know, and in each case the wrong
choice produces a number that looks fine.

## Decision

### It reads the live portfolio, not the imported Flex store

The story called this a real choice and it is. "Is my portfolio balanced?" is a question about
**now**. Flex would answer it as of the last statement — possibly weeks old, and with nothing in
the answer to tell the owner so. So every *weight* comes from one live reading: positions and
prices from the gateway, cash from the same ledger read, converted with live gateway FX **in the
service** ([[0007-portfolio-display-currency-and-live-fx]]).

That is also why the result distinguishes `not_connected` from `not_responding` at all: with a
Flex-sourced report neither state could arise, and the acceptance criterion asking for both is the
story telling us which source it meant.

**The story warns against a mixed answer, and this is not one.** Two things do come from local
stores, and both are **reference data about an instrument** rather than a weight: its sector, from
the classification cache ([[0009-sector-classification-cache-and-allocation-donuts]]), and its
asset class, from imported `SecurityInfo`. The live gateway carries neither — a position DTO has a
conid, a price and a currency, and nothing that says whether it is a stock or an option, exactly
the gap [[0088-a-live-holding-is-named-by-imported-history]] records for the instrument's *name*. A
sector does not change between Tuesday and Wednesday; a weight does. Every number in the report is
as of the same moment.

### The vocabulary is shared, because a target that joins with nothing reads as zero

The profile stores an asset-class target under the *key* the allocation report published. If the
drift service derived its own key scheme, every stored target would join with nothing and report
0% — a wrong answer with no symptom. So `ASSET_CLASS_LABELS` and the `__cash__` sentinel moved out
of `allocationService` into `@shared/domain/assetClass`, and both services read them from there.
Two private copies of that table would have been one edit away from the failure.

The same argument fixed a latent version of it in [[0094-the-profile-is-a-setting-and-a-range-is-a-policy]]'s
own vocabulary module: the sector exclusion list matched the string `Unclassified`, but the
allocation report spells that absence as a **blank key** with `Unclassified` as the *label*. The
list matched nothing; the blank-key filter beside it was doing the work, and its test fixture had
key and label equal, which no real slice ever has. The list is gone and the filter now says why it
exists.

### Cash is attributed to the currency it is in

`getBalances` reports cash as one base-currency figure, which is right for a dashboard tile and
wrong for a currency question: it is the base-currency *equivalent* of money held across several
currencies, so attributing it to the base currency would invent an exposure the owner may not have.
`portfolioRepository.getCashByCurrency` reads the per-currency ledger entries instead — the same
ledger read `getBalances` already made, coalesced by the cache, so it costs no round trip
([[0024-gateway-read-coalescing-and-freshness-window]]) — and `portfolioService.getCashPositions`
converts each at its own rate under DDR-0007's rule.

Cash then behaves differently in each dimension, and the differences are the model rather than
special cases. In **currency** it is an ordinary bucket: dollars are dollars whether invested or
not, and a currency policy is about the whole portfolio. In **sector** it is a residual, because
money has no sector. In **asset class** it is a bucket again, under the allocation report's own
`__cash__` key, so a target set from that vocabulary joins with it.

### Three residuals, surfaced and never redistributed

A residual is a quantity that belongs to the portfolio but to no bucket in a dimension: cash in
the sector dimension, an instrument the classification cache has not reached, an instrument
imported history has never seen. Each is its own named weight, and none is spread across the
buckets that *do* have a category — [[0052-composition-cumulative-and-chart-readability]]'s rule,
and its reason applies verbatim: drop one into a bucket and nothing will look wrong.

The classification case is not hypothetical. That refresh is **resumable, not transactional**
([[0009-sector-classification-cache-and-allocation-donuts]], DDR-0023), so a run that died at 30 of
40 leaves 29 classified and the report has to say so rather than quietly rescale to 100%.

Each dimension therefore satisfies one invariant, checked end to end against a fixture:
`Σ bands + Σ residuals + untargeted === 100`. `untargeted` is the weight held in categories the
portfolio has but the profile says nothing about, and it is what makes the sum checkable — a
double-count pushes it over, a silent drop pushes it under.

### An unconvertible holding is unplaced, and is given no percentage

A holding whose FX rate the gateway could not supply is excluded from the denominator and reported
in its own block by **count, currency and native amount** ([[0007-portfolio-display-currency-and-live-fx]]).

**It is deliberately given no percentage**, and that is the one place this report declines to
answer the acceptance criterion in the units it was asked in. Pricing the holding in the display
currency is precisely what the gateway could not do, so a share of the display-currency total does
not exist to be reported. The tempting derivation — the gap between our summed conversions and
IBKR's own base-currency `netLiquidation` — is unsound: those are two different rate paths (per
currency at our rates, versus one base figure at IBKR's) and they disagree by small amounts
routinely, which Bug #68 already records. Reading that gap as a quantity would be reading rounding
noise, in the one Epic whose whole point is that figures are computed rather than produced. So what
is reported is what is known.

The same rule makes the concentration ceiling **bounded**: with something unplaced, the largest
holding's weight is a lower bound, because a larger one may be hiding among the positions that
could not be valued.

### The states that are not a report

Six variants, as data ([[0022-gateway-timeout-and-not-responding-state]]). `no_profile` and
`no_targets` both mean "nothing to measure" and are kept apart because they want different copy —
one says *set a profile*, the other *add some targets*, and telling an owner to do what they have
already done is the failure DDR-0022's own pair exists to avoid. `not_connected` and
`not_responding` are that pair, mapped in the handler from the same two errors
`portfolio:getOverview` maps, since this is built on that read.

`no_data` covers an empty account **and** one in which nothing could be valued: with no denominator
there are no weights either way, and the Portfolio view is already where unconverted rows are shown.

A dimension the profile states nothing about is **absent from the report**, never present with an
empty band list and never a drift of zero — a profile stating nothing about sectors is not a
profile stating that sectors do not matter. A target the portfolio does *not* hold is the opposite:
a real band at 0%, because "I want 10% in utilities and hold none" is exactly the answer being
asked for.

## Alternatives Considered

- **Reading the Flex allocation report.** It already produces the three breakdowns and would have
  made this service nearly free. Rejected: it answers as of the last statement, and the owner
  cannot tell from the answer.
- **`balances.netLiquidation` as the denominator.** Rejected above — two rate paths, and the
  disagreement would land in every percentage.
- **Deriving the unconvertible share from that gap.** Same reason, and worse: it would put
  rounding noise into a figure presented as a quantity.
- **Attributing cash to the base currency.** Rejected: it invents an exposure.
- **Redistributing residuals across the buckets so each dimension sums to 100 on its own.**
  Rejected: it is the failure mode with no symptom.
- **A percentage for the unplaced block.** Rejected; see above.
- **A single `no_targets` variant covering an unwritten profile too.** Rejected: different copy.

## Consequences

- `@shared/domain/assetClass` is the one place the asset-class vocabulary lives, and
  `allocationService` now reads it rather than owning it. A code added in one place reaches both.
- `portfolioRepository` gains `getCashByCurrency` and `portfolioService` gains `getCashPositions`;
  both ride the existing ledger read and the existing rate fetch, so the drift report costs one
  gateway round trip beyond the overview it already needs.
- `flexReadRepository.getInstrumentAssetClasses` sits beside `getInstrumentNames` as the second
  local answer to something the live gateway does not carry.
- `profile:getDrift` exists with no consumer. That is the story's own scope — it produces a report;
  drawing it is #288's and answering with it is #289's — and the channel is the contract half
  rather than presentation.
- **No model is reachable from any of this**, and the service's test asserts which four things it
  consults.
