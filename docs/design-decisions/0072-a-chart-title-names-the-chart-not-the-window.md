# 0072. A chart title names the chart, not the window

- **Status:** Accepted
- **Date:** 2026-08-20

## Context

*Performance change over time* renamed itself. Under **All** the card read *Performance change over
time*; under every other range it read *Performance change over the selected period*. The three
cards beside it — *Portfolio value over time*, *Daily return*, *Composition over time* — did not
move.

The conditional was not an accident. Story #169 rebased the return curve to the selected window:
it opens at 0% and closes exactly on the *Time-weighted return* tile, so a 1M heading stopped
sitting over an inception-to-date baseline the reader had to subtract for themselves. **Rebasing is
invisible on an axis** — a curve from 0% looks the same whether zero means "the start of the
history" or "the start of the last month" — so something had to disclose it, and the title was
where it went.

What that costs is visible in the 2×2 grid. [[0051-performance-chart-grid]] put four charts on one
screen *to be read against each other*, under one `RangeFilter` that is one selection rather than
four. Moving the range is the reader's main gesture in this view, and it made one of the four cards
change its name — so the grid appeared to swap a chart out on every gesture, which is exactly the
comparison the layout exists to support.

## Decision

### The title is one fixed string

`title="Performance change over time"` — a literal, in every range, custom included. The binding
that chose between two wordings is gone rather than defaulted, and the other three titles were
already the proposal's and are untouched.

### The disclosure was never conditional in the first place

This is the whole decision, and it is why nothing has to be traded away for it.

The curve opens at 0% under **every** range. Full history is the *identity* case of rebasing, not a
second case — Story #169's own note says so — so the fact needing disclosure ("this curve is
measured from zero at the left edge") is one fact with one wording. Only the *name of the window*
varied, and the window is what the `RangeFilter` two rows above already states, on the control the
reader just used.

So the wording splits by what it is rather than by the range:

- **the baseline** — invariant, and moves out of the title into a fixed note;
- **the window** — variable, and stays where a variable thing belongs: the range control, and the
  KPI tiles' hints, which legitimately read *Full history* or *Over selected period* because a tile
  reports a figure computed over that window.

### The note goes in the card header, in the slot the legend already uses

`BaselineNote` renders `0% at period start` into `ChartCard`'s `aside`, at the header's right edge —
the slot `CompositionLegend` has occupied since [[0052-composition-cumulative-and-chart-readability]].

**"Period", because the tiles beside it already say it.** *Portfolio value* is hinted *At period
end* in every range. The view therefore already uses "period" as its fixed word for the selected
window, whatever that window is, and the note is deliberately parallel to that hint rather than
introducing a third vocabulary for the same idea.

**It wears `.chart-legend .chart-legend-header` rather than a rule of its own.** It is not a key —
there is no swatch — but it is the same *object in the layout*: one muted `--text-xs` line at the
header's right edge, `nowrap`, constrained not to out-height the title. A second rule differing from
that one only in its name is precisely the drift Epic #125 exists to remove, so the existing rule
gains a second kind of occupant and a comment saying so.

### The accessible name keeps naming the window, and that is not a contradiction

`aria-label` stays conditional: *…from 0% at the start of the history* under All, *…at the start of
the period* otherwise. A chart's accessible name is not its title — it is read in place of the plot
by someone who cannot see the axis, where the extra precision is worth having and costs no visual
churn. The story permits this explicitly. What it forbids is a *title* that moves, and a name is not
a title.

The consequence is that the baseline is now stated twice, visibly and audibly, and **neither
statement is the card's name**.

## Consequences

Benefits:

- The grid's four cards are named the same four things at all times, so moving the range visibly
  reframes the charts instead of appearing to replace one of them.
- The baseline is disclosed *more* than before, not less: it was previously absent under All (where
  the title said only "over time") and is now stated in every range, including the one where a
  reader is most likely to assume inception-to-date.
- One fewer derived binding in the view, and one fewer place a range value can reach.

Tradeoffs:

- A second thing competes for the return card's header row. Measured at 1421px — the narrowest
  window that still renders two columns — the title does not clip (`scrollWidth === clientWidth` on
  all four) and every card is 304px with a 50px header, so the equality [[0051-performance-chart-grid]]
  guards is unaffected. A materially longer note would not survive that measurement.
- `.chart-legend-header` now dresses something that is not a legend. Recorded rather than renamed:
  the alternative was a duplicate rule.

Risks:

- The note is a *fixed* string asserting something the chart's maths does. Were the return curve
  ever un-rebased — sliced like the value curve — the note would silently become a lie. That
  coupling is the reason `performanceLayout.test.ts` asserts the rebasing and the note in the same
  file: the test that would catch it is already there and already fails on
  `rebaseSeries(r.returnSeries, bounds)` disappearing.

## Alternatives Considered

### Keep the conditional title (do nothing)

Rejected by the story. It is the defect: a chart that renames itself on the reader's main gesture,
inside a layout built for cross-reading.

### Drop the conditional and add nothing visible

The minimum that satisfies "the title is fixed", and it fails the story's third criterion. The
conditional title existed *for the sighted reader*; an `aria-label` does not replace it for them, so
this would quietly delete Story #169's disclosure while claiming to preserve it.

### State the baseline in a caption under the plot

Rejected on [[0052-composition-cumulative-and-chart-readability]]'s finding, which deleted two such notes:
a `<figcaption>` makes the card taller than the three beside it, and four charts on one screen meant
four bodies of prose competing with the plots. The header slot exists because of that finding.

### Put "0%" on the y-axis as a labelled zero line

The curve already draws a zero line where it crosses zero ([[0061-chart-language-gradient-zero-line-and-one-hover-card]]),
and axis labels are sized in viewBox units off the page type scale ([[0018-content-measure-and-chart-aspect]]).
Rejected: a labelled tick says *where* zero is, not that the series was *rebased* to open there, and
under a range whose curve never returns to zero there is no line to hang it on.

### Make the accessible name fixed too, for symmetry

Rejected as a loss for no gain. Nothing about the name churns visually, and "the start of the
history" is genuinely more useful than "the start of the selected period" when the selection *is*
the history.

## References

- Story #221 — one fixed title per chart, whatever the range
- Story #169 — rebasing the return curve to open at 0% over the selected window
- Epic #179 — the visual redesign, second round
- [[0051-performance-chart-grid]] — the 2×2 grid, shared geometry, equal card heights
- [[0052-composition-cumulative-and-chart-readability]] — the header legend slot, and the deleted source notes
- [[0059-card-strip-and-table-density]] — the ruled header strip the title sits in
- [[0061-chart-language-gradient-zero-line-and-one-hover-card]] — the zero line and the chart tooltip
- [[0071-indigo-value-curve-and-the-signed-return-curve]] — the curve this card draws
