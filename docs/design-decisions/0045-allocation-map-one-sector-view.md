# 0045. The Allocation map has one view, coloured by sector

- **Status:** Accepted
- **Date:** 2026-08-09

## Context

Story #95 gave the map a second colour mode behind a toggle: unrealized **return on cost**, on a
seven-step red ↔ gray ↔ blue diverging scale bounded at ±25%
([[0021-allocation-map-gain-loss-scale]]). The scale was carefully built — deliberately not the
app's `--pos` / `--neg`, because on a mark with no number beside it fill colour is the only
channel, and green/red measures ΔE 4.1 under deuteranopia against the light basemap, below the 6.0
floor.

**The owner asked for it to go.** That is the decision this DDR records; what follows is the
evidence that supports it, not the argument that produced it.

The mode had a weakness the map's own granularity decision makes unfixable. Since
[[0030-allocation-map-country-donut-pairs]] retired per-holding marks, a country is one mark
carrying one aggregated return — so a losing holding inside a winning country is averaged away
before the colour sees it, and a portfolio holding several losers can show a single red mark. That
limitation was recorded rather than solved, on the grounds that it is granularity rather than
colour. Withdrawing the mode resolves it the other way: the question is answered where it can be
answered per holding, in the Positions table and in the popup.

It also restores an invariant [[0030-allocation-map-country-donut-pairs]] states plainly — *one
sector, one hue, everywhere.* The gain/loss mode was the only place in the app where a mark's
colour meant something other than its sector, and the sector dimension pays a real price for that
invariant already: it starts at palette slot 2, because slot 1 (the only blue) is reserved for the
country-weight donut.

## Decision

**The map has one view. Marks are coloured by sector, always.**

Removed: the Sector/Gain-loss toggle, the `MapColorMode` type and the prop it fed, the diverging
legend, `.map-diverge-*`, and the `--diverge-1..7` token scale. The diverging half of
`lib/gainLoss.ts` goes with them.

Four consequences worth stating, because each is larger than "a toggle was deleted".

### The `--diverge-*` scale leaves the app entirely

It had exactly one consumer. `--diverge-*` was read only by `.map-diverge-*`, which was worn only
by this mode, so withdrawing the mode retires the whole palette — including the CVD and contrast
validation recorded against it on 2026-07-26. `designTokens.test.ts` now pins that **absence**: a
diverging scale reappearing in `:root` fails. A palette that comes back looking like a restoration
would in fact be a new, unvalidated decision, and should have to say so.

### [[0021-allocation-map-gain-loss-scale]] is superseded, not deleted

Its conclusion is withdrawn; its *reasoning* is load-bearing and this decision depends on it.
DDR-0021 is where the app records **when `--pos` / `--neg` may be spent**: never as the only
channel on a mark, freely where a figure accompanies the colour. That rule is what still permits
the popup's return tint ([[0041-map-popup-return-tint-strength]]) and what forbids anyone
"simplifying" the map by painting wedges green and red — the exact move DDR-0021 exists to prevent,
and one made *more* tempting now that the map shows no return at all.

`mapPopupTint.test.ts` carries that forward. Its assertion used to read "the marks keep the
diverging scale"; it now reads that no `.country-mark*` rule may reference `--pos` or `--neg`. The
half that mattered was never the scale's existence — it was that return colour stays off the marks.

### The popup is untouched, and is now the only place the map speaks about performance

Identity, weight, Unrealized P&L, return, and the `--pos` / `--neg` edge tint all stand, along with
the tint geometry [[0041-map-popup-return-tint-strength]] pins. The tint runs off the hovered
subject rather than off a colour mode, so it never depended on the toggle. `returnPercent` survives
in `lib/gainLoss.ts` for the popup's return row — as a percentage of cost basis rather than
absolute P&L, for the reason the colour scale needed it: the mark's area already encodes market
value.

### The token ratchet collected part of the cleanup by itself

Two of [[0042-token-adoption-ratchet]]'s eleven permanent exemptions were the diverging legend's
end caps (`.map-scale-swatches .legend-swatch:first-child` / `:last-child`, `3px` corners below
`--radius-sm`). Deleting those rules made both exemptions stop matching, which fails the suite by
design — the ratchet's second half, the one that exists so dead entries cannot accumulate. Nothing
in this story went looking for that list; the test sent us to it. Nine exemptions now.

## Consequences

Benefits:

- The map does one job. Colour means sector, on the map and in every donut and table beside it.
- The recorded aggregation weakness stops being shipped as a feature: the map no longer makes a
  claim about performance that its own granularity cannot support.
- Roughly 120 lines leave the renderer — a component prop, a state hook, a type, a legend branch, a
  seven-step palette and its CSS — with no capability lost that another surface does not already
  provide better.

Tradeoffs:

- **A validated palette is discarded.** The CVD work behind `--diverge-*` was real and is now
  unused. Kept in git history and in the superseded DDR-0021 rather than in `:root`, because an
  unused palette in the token scale is an invitation to use it for something it was not validated
  against.
- **"Where am I losing money?" now takes two moves on the map** — hover a country, read the popup —
  where it previously took one glance. The glance was the misleading part, but it was a glance.

Risks:

- **Someone re-adds return colouring using `--pos` / `--neg`**, which is the cheap version DDR-0021
  rejected on measured CVD grounds. Mitigated by keeping DDR-0021 as Superseded-but-applicable and
  by `mapPopupTint.test.ts` failing if a mark rule reaches for those tokens.
- **The map is now purely descriptive**, and a later story may want performance back. That is a new
  decision with a new DDR, and the honest place for it is per-holding granularity rather than a
  per-country average.

## Alternatives Considered

### Keep the mode and fix the aggregation

Colour each country by its *worst* holding, or split the mark. Rejected: the owner asked for the
view to go, and both variants make a small mark carry more meaning rather than less — the failure
mode DDR-0030 already worked through when it rejected the nested sunburst and the eight-hue
holdings donut.

### Keep the mode, drop only the toggle, defaulting to sector

Leaves the scale, the legend branch and the dead code path in place against a mode nothing can
reach. Rejected: unreachable code with a validated palette attached is exactly what gets
"restored" later without the reasoning being re-read.

### Keep `--diverge-*` in `:root` for future use

Rejected for the reason given above: a validated palette is validated *for a use*. Leaving it
declared invites a future chart to adopt it as "the app's diverging scale" without re-running the
contrast work against whatever surface that chart sits on.

## References

- [[0021-allocation-map-gain-loss-scale]] — superseded here; its rule about where `--pos` / `--neg`
  may be spent still governs, and this decision depends on it
- [[0030-allocation-map-country-donut-pairs]] — the country donut pairs, the aggregation that made
  the mode understate losses, and the "one sector, one hue everywhere" invariant
- [[0041-map-popup-return-tint-strength]] — the popup tint, explicitly retained
- [[0042-token-adoption-ratchet]] — the two exemptions this story retired, collected by the ratchet
- `src/renderer/src/components/charts/CountryMap.tsx`,
  `src/renderer/src/components/analytics/AllocationView.tsx`,
  `src/renderer/src/lib/gainLoss.ts`, `src/renderer/src/lib/countryDonuts.ts`,
  `src/renderer/src/app.css`
- GitHub Issues #98 (Epic), #160 (Story), #95 (the story that added the mode)
