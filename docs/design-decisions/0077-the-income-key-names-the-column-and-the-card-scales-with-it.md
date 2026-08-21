# 0077. The income key names the column, and the hover card is drawn in the plot that widens

- **Status:** Accepted
- **Date:** 2026-08-21

## Context

Story #236 is the last of Epic #179's third round, and it closes two things that had been left
open for different reasons.

**The key named the two segments and not the figure.** *Income over time* stacks a solid lower
segment and a withholding segment above it, so the **column's height is the month's gross income**
— which is the number the card is about, the number the KPI tile above it leads with, and the
number the key did not name. It said `Net received` and `Withholding tax`
([[0010-upcoming-dividends-from-flex-accruals]] relabelled it there), and the gross appeared
nowhere a reader could see except inside a native `<title>`, under `totalLabel: "Gross"` — a string
literal at the call site, beside two constants that existed precisely so the key and the readout
could not drift.

**`ColumnChart` was the last chart in the app on a native `<title>`.** `LineChart`, `BarChart` and
`StackedAreaChart` moved to the shared card in Story #188
([[0061-chart-language-gradient-zero-line-and-one-hover-card]]) and were restyled in Story #220
([[0070-hover-card-restyle-and-the-series-ink-ramp]]); this chart took neither, and #188 says so in
as many words — it took none of the four elements. A `<title>` waits half a second, has to be
aimed, and on this chart cannot be aimed at all in the case that most needs it: a month whose net
is zero draws a zero-height rect with nothing under the pointer.

The reason it was left is the third thing, and it is the one that needed deciding rather than
doing. **This chart's `viewBox` widens with its history** — `max(1080, 80 + columns × 56)` — while
the three that share the card have one fixed 500×180 geometry
([[0051-performance-chart-grid]]). Everything the card is made of is in `viewBox` units by
[[0018-content-measure-and-chart-aspect]]'s rule, so on a 3664-unit plot the same card renders a
third the size it renders on a 1080-unit one. Whether that is a defect or the correct behaviour is
the question, and it is not answerable by looking at the card alone.

## Decision

### The key names the column and the segment stacked on it; three constants, no literal

`INCOME_GROSS_LABEL` (*Gross*), `INCOME_TAX_LABEL` (*Withholding tax*) and `INCOME_NET_LABEL`
(*Net*) are declared once in `DividendsView` and handed to both the key and the card.
`IncomeLegend`'s first prop is renamed `lowerLabel` → **`columnLabel`**, because that is the change
in meaning and a rename that leaves the prop name alone is the version that reads as a typo three
months later: the swatch beside *Gross* is the colour of the column's body, and the column — not
that segment — is what the word names. The note under the title says the rest, and it is re-worded
to say it: the height is the gross, the tax is stacked at its top, what is left below is the net.

`totalLabel="Gross"` becomes `totalLabel={INCOME_GROSS_LABEL}`. The literal is how the key and the
readout drifted in the first place, and `dividendsLayout.test.ts` now fails on any `totalLabel="`.

**A third swatch for *Net* is declined.** A key names what a reader cannot otherwise resolve, and
the net is the part of the column they can already see — it is what is left when the top segment is
taken off. The card gives it as a figure, with the other two beside it.

### The card replaces the `<title>`, and the band replaces the bar as the hit target

`ChartTooltip` gains an optional `plot`, defaulting to the Performance geometry, so the three
original callers pass exactly what they passed before. `ColumnChart` hit-tests with `bandIndexAt` —
the same function the daily-return bars use — so every x inside the plot names a month, including
the months the chart draws nothing for.

The card's rows are built by **`stackedTooltipRows`**, in `lib/column` rather than in the
component, because the two rules that matter are invisible to a test that cannot render (DDR-0029):

- **A row that does not exist is absent, not zero.** A month with nothing withheld has no
  withholding *row*, and the card shrinks to fit — `tooltipLayout` already sizes from its rows.
  `€0.00` beside a label reads as a figure that was measured and came out at nothing, which is a
  different statement. The **total row stays at zero**, and that asymmetry is the point: a month
  whose only entry is withholding has a gross of exactly zero, and that is the fact that explains
  the negative net below it.
- **Only the signed row is toned**, through the existing `signInk` — `--pos`, `--neg-text`, and a
  flat month untoned, because neither tone is true of it. `--neg-text` and never `--neg`: SVG
  writes both roles as `fill`, so the wrong half is silent ([[0046-contrast-split-tone-tokens]],
  [[0070-hover-card-restyle-and-the-series-ink-ramp]]). Gross and withholding take no tone at all —
  a withholding is a deduction by construction, so a loss tone there restates the label instead of
  adding a channel, which is [[0065-untoned-side-badge-and-the-dimmed-cell]]'s reasoning reaching
  the same answer from the other direction.

**The negative month keeps its explanation, and the card inherits it.** Where withholding outweighs
the dividends, the upper segment is not drawn — it cannot stack across zero without overlapping the
downward bar — so the withholding is a figure this chart states and does not draw. That was the
`<title>`'s one indispensable job (Story #49) and it is now the card's.

### The card is calibrated against the plot's own axis label, which is why it does not scale

The answer to the widening `viewBox` is that **the card is already the right size and needs no
correction**, and the reason is a fact about the two plots rather than a preference.

`.chart-tooltip-value` is 12 `viewBox` units and `.chart-axis-label` is 11, in *both* plots — the
two charts set their type in the same units, so the card stands in the same relation to the labels
beside it in this chart as it does in the Performance grid. That relation is what a reader sees. At
a long history the card renders smaller on screen, and so do the axis labels, the month labels and
the columns, by exactly the same factor; the card is never the mark that is out of proportion.

The version that misbehaves is the one that corrects for it. A card fixed in page pixels, or scaled
by `plot.width / 500` to hold a constant size on screen, **grows against the plot as the history
lengthens**: measured on the owner's 13-month import at a 1440px window, `plot.width / 500` is 2.16
and puts the card's figures at 29.8px against the chart's own 12.6px axis labels — 2.4× the type
around them — and at five years it is a card taller than the plot it is drawn in. So the scale
factor is 1, and it is 1 for a reason that can be stated rather than by omission.

Checked at both ends, in `column.test.ts` and on screen against the real import: at 13 months and
at 64, the card is the same size in units, is a *smaller* share of the plot at the long end, never
leaves the plot at any anchor, and still flips left at the right-hand edge.

### `columnPlot` holds this chart's geometry, and it is not `chartGeometry`

The `W`/`H`/`PAD` constants move out of the component into `lib/column`, so the card's placement
can be checked in Node the way the grid's is. It is deliberately **not** `chartGeometry`: those
three charts share one fixed `viewBox` because they sit in a grid and are read against each other,
and this one is alone in a full-width card and widens with its history. `chartGeometry.test.ts`
asserts `ColumnChart` never imports that module, and it still does not.

### One finding recorded rather than acted on

`COLUMN_PLOT_FLOOR` is 1080 because Story #76 matched the line chart beside it, which was also
1080×240 at the time. [[0051-performance-chart-grid]] has since taken the grid to 500×180, and
nothing came back to this number — so this chart renders its 11-unit labels at roughly **half** the
size the grid does at the same CSS width, and at a multi-year history the whole plot flattens to a
strip (3664×240 for 64 months, ~90px tall in a 1240px card). That is real, it is pre-existing, and
it is a **re-decision of this chart's aspect** — [[0018-content-measure-and-chart-aspect]]'s
territory, not a presentation change Epic #179 can absorb. It is written down here and left for its
own story.

## Consequences

- The Dividends key, the source note and the chart's `aria-label` all state the same three names.
  The `aria-label` is updated with them and remains the chart's own name; the card is pointer-only,
  as the other three are, and every figure in it is in the tables below.
- `ChartTooltip` is now used by four charts and parameterised by one. Nothing about its placement,
  its surface or its inks moved.
- `lib/column` gained a dependency on `lib/chartTooltip` (`signInk`, `TooltipRow`) and a type-only
  one on `lib/chartGeometry` (`PlotGeometry`). Neither is cyclic.
- No CSS changed: the card reuses `.chart-tooltip-*` exactly, so the figure role, the token
  ratchet's empty `BASELINE` and every measured ink are untouched.
- `dividendsLayout.test.ts`'s four naming assertions moved with the constants, as the story
  required, and it gained a block on the card — that the `<title>` is gone, that the plot is this
  chart's, that the rows go through the shared helper.

## Alternatives Considered

### Scale the card with the plot so it holds a constant size on screen

The obvious reading of the trap, and it is backwards. Measured above: it puts the card's type at
2.4× the chart's own axis labels at the common case, and past ~21 months the card is taller than
the plot and has to be clamped — at which point it shrinks again anyway, having spent a clamp, a
row-count dependency and a calibration constant to arrive one point of legibility from where doing
nothing arrives.

### Cap the `viewBox` and thin the columns, as `BarChart` does

This would answer the trap at its source and it is the wrong chart for it. `BarChart` thins because
its bars are unlabelled ([[0049-daily-return-bars-thin-rather-than-aggregate]]); here the **56-unit
band is the month label's number, not the bar's** — `Jul 2026` advances 51 units at
`chartGeometry`'s measured 6.4 per glyph — so capping the width collides the labels. Thinning the
labels instead is a different chart, and it belongs to the aspect re-decision above.

### Fold `ColumnChart` into `BarChart`

Declined again, unchanged ([[0052-composition-cumulative-and-chart-readability]],
[[0064-toned-badges-and-the-income-key]]). This chart stacks two series, legends them and labels
every column; the merge means conditioning all of it on flags.

### Keep the `<title>` alongside the card

A slow native tooltip floating over the card that already answered the question — the note
`BarChart` has carried since Story #170.

## References

- [[0061-chart-language-gradient-zero-line-and-one-hover-card]] — one `ChartTooltip` in the plot's
  own `viewBox`, pinned to the plot's top; and the note that `ColumnChart` took none of it.
- [[0070-hover-card-restyle-and-the-series-ink-ramp]] — the card's surface and inks, `signInk`, and
  a row toned only where its mark is.
- [[0018-content-measure-and-chart-aspect]] — a chart is sized by its aspect, and a label inside a
  `viewBox` stays off the page type scale. The rule this decision turns on.
- [[0051-performance-chart-grid]] — the shared 500×180 geometry, and the derived `pad.left`.
- [[0049-daily-return-bars-thin-rather-than-aggregate]] — band hit-testing, and why *that* chart
  thins where this one widens.
- [[0046-contrast-split-tone-tokens]] — the fill/text split, and why the wrong half is silent.
- [[0065-untoned-side-badge-and-the-dimmed-cell]] — a tone declined because it restates its label.
- [[0064-toned-badges-and-the-income-key]] — the key in the card header, and `ColumnChart`'s bare
  `<svg>`.
- [[0010-upcoming-dividends-from-flex-accruals]] — the `Net received` / `Withholding tax` naming
  this supersedes, and `totalLabel`'s arrival.
- [[0005-analytics-read-model-and-base-currency-conversion]] — gross, withholding as a positive magnitude, and net in base
  currency. Untouched.
- Story #236, Story #192, Story #188, Story #220, Epic #179.
