# 0009. Sector classification: gateway-sourced, locally cached; allocation as donut charts

- **Status:** Accepted
- **Date:** 2026-07-23

## Context

M3 was reopened (Epic #4) to refine the built views. Story #30 asks the Allocation view for
country and currency **pie charts** and for a **sector / industry** breakdown — a dimension
Story #22 explicitly excluded, with the issue deferring the classification source to
planning.

The exclusion was not arbitrary. Allocation is assembled from the latest imported Flex
statement ([[0005-analytics-read-model-and-base-currency-conversion]]), and Flex carries
**no sector field at all**: `SecurityInfo` provides `assetCategory`, `subCategory` (COMMON /
ETF / ADR — instrument type, not sector), `issuerCountryCode`, `listingExchange`, `isin` and
`cusip`. Verified against the owner's own 2026 Portfolio Analyst export. Country and currency
breakdowns already existed in `allocationService`; sector needed a source that does not
exist locally.

The constraint that shapes the answer: the app is local-first and the analytics views must
keep working with the IBKR gateway closed — every other analytics channel reads only the
local Flex store. A sector breakdown that requires a live gateway on every render would
break that.

## Decision

### Sector comes from the IBKR gateway, once per instrument, into a local cache

A new **mutable** table `instrument_classifications` (conid primary key, symbol, sector,
industry, source, fetchedAt) caches IBKR's own classification. `classificationRepository`
fronts *both* sources — the SQLite cache and `ibkrGateway` — which is precisely the
two-source repository CLAUDE.md's Repository Pattern depicts. The gateway field mapping is
`/iserver/contract/{conid}/info` → `industry` (broad, e.g. "Financial") stored as our
`sector`, and `category` (narrow, e.g. "Banks") stored as our `industry`.

This is the first table in the app that is **not** append-only. That is deliberate and
scoped: it holds *derived reference data*, not portfolio history. The immutability guarantees
of `snapshots` and `flex_*` are untouched, and losing this table costs one refresh.

`classificationService.refreshClassifications()` owns the policy the repository deliberately
does not: only the latest statement's open positions are considered, and only conids absent
from the cache are fetched. Lookups are **sequential** — a single local gateway session and a
few dozen instruments make parallelism pointless and rate-limiting real. A row whose `sector`
is `''` records a *resolved-but-unknown* answer (ETFs, cash and some non-US listings have no
classification), so the gateway is asked once, not on every refresh.

### Reading sector never touches the network

`allocationService` joins the cache with a plain synchronous read, using the same
conid-then-symbol fallback already used for issuer country. The Allocation view therefore
renders fully offline; unclassified positions collect in an `Unclassified` slice and
`unclassifiedCount` drives an opt-in "Classify from IBKR" action in the sector panel. The
refresh channel is the only `analytics:*` channel that reaches IBKR, so it carries
`not_connected` alongside the usual variants — as data, not an exception
([[0002-connection-state-as-ipc-result]]).

### All four breakdowns render as donut charts

Asset class, country, currency and sector each render as an inline-SVG donut
(`components/charts/PieChart.tsx`), replacing the `BarList` used since Story #22 — the owner
chose consistency across dimensions over mixing forms. Dependency-free SVG as established in
[[0006-app-shell-tab-navigation]].

Design constraints applied, and why they are not cosmetic:

- **Eight categorical slots, assigned in fixed order, never cycled.** The palette added to
  `app.css` is the validated dark-mode categorical set; it was run through the data-viz
  validator against the panel surface (`#171a21`) and passes the lightness band, chroma
  floor, adjacent-pair CVD separation, normal-vision floor and 3:1 contrast. A ninth
  category is never given a generated hue — the tail folds into an aggregated `Other` slice.
- **Identity is never colour-alone.** A legend is always present and every slice is
  direct-labelled there with its base-currency value and its share of NAV; each slice also
  carries a native `<title>` tooltip. A 2px surface ring separates adjacent slices.
- **Slice angles come from base-currency market value; labels report % of NAV.** These are
  the same shape — every position's NAV share has the same denominator — so ordering and
  relative angles are identical under either measure. Only the denominator differs: NAV
  includes cash, so the displayed percentages legitimately do not sum to 100.

## Consequences

Benefits:

- The sector dimension exists at all, without a new dependency, a bundled data file, or a
  third-party classification API.
- Allocation stays offline-capable: classification is fetched once and cached; the view never
  blocks on the gateway.
- Grouping logic was reused verbatim — `bySector` is one more `groupBy` call over the same
  positions, so cost basis, weights and conversion behave identically across all four
  dimensions.

Tradeoffs:

- A mutable table breaks the "append-only everywhere" symmetry of the schema. Accepted
  because it is a cache; documented here so it is not read as precedent for history tables.
- Classification requires the gateway *once*, so a brand-new install with the gateway closed
  sees an all-`Unclassified` sector chart until the owner runs the action.
- Pie/donut charts read poorly when slices are near-equal — a known weakness of the form.
  Mitigated by sorted slices, direct value + percentage labels, and the `Other` fold; the
  positions table remains the exact-value view.

Risks:

- **The gateway response shape is unverified against a live session.** The local gateway was
  not running when this was implemented, so the `industry` / `category` field mapping rests
  on the documented Client Portal API. Both fields are parsed as optional through a
  `passthrough` schema, so a wrong or drifted shape degrades to "unclassified" rather than
  failing the refresh — but the mapping should be confirmed the first time the action is run
  against a live gateway.
- Sector labels are IBKR's taxonomy, not GICS. Cross-broker comparability is not implied,
  which matters if multi-broker support arrives.

## Alternatives Considered

### A bundled or user-editable classification file (ISIN/symbol → sector)

No network, no schema change, and it would work on a fresh install. Rejected: coverage is
manual, it goes stale every time a new position is opened, and maintaining a mapping file by
hand is exactly the chore a personal analytics tool should absorb.

### Fetching sector live on every Allocation render

Simplest possible code — no table, no cache, no refresh action. Rejected: it makes an
otherwise-offline analytics view depend on a running, authenticated gateway, contradicting
the local-first stance and the read-model in DDR-0005.

### Deferring the sector dimension and shipping only the pies

A legitimate reading of the issue's "to be resolved in planning". Rejected by the owner, who
chose the gateway-plus-cache route so #30 could ship whole.

### Pies for country and currency only, bars elsewhere

Matches the issue text literally and keeps bars for the many-category cases. Rejected by the
owner in favour of one consistent form across all four dimensions.

## References

- GitHub Story #30, Epic #4 (M3)
- [[0005-analytics-read-model-and-base-currency-conversion]]
- [[0006-app-shell-tab-navigation]]
- [[0002-connection-state-as-ipc-result]]
- `docs/decisions/0004-interactive-brokers-integration.md` (gateway access, TLS handling)
- `docs/decisions/0005-flex-query-file-import.md`
