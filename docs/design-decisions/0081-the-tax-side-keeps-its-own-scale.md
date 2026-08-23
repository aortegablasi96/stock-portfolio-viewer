# 0081. The tax side keeps its own scale, and the axis is uneven across zero

- **Status:** Accepted

- **Date:** 2026-08-23

## Context

[[0080-withholding-hangs-below-the-line]] put withholding below the zero line and recorded an open
finding against its own result: the space below the line was not earning its height. Measured in
the running app on the owner's real import —

| | |
| --- | --- |
| largest gross | €184.21 |
| largest withholding | €14.25 |
| axis drawn | −€100.00 to €200.00 |

— so a series needing 7% of the domain was given 33% of it, and the tax bars rendered as ~3px
slivers over a wide empty band.

The cause is not a bug. `columnDomain` rounds **both** extremes outward to one shared nice step,
which is correct behaviour and the reason the tallest bar gets headroom. With a step of 100 the
bottom floors from −14.25 to −100.

What makes it the *common* case rather than an edge case is the data: withholding is a fraction of
income in every ordinary month. A chart whose subject is the deduction cannot draw the deduction
at a twentieth of the scale it drew it at before, and DDR-0080's whole argument was that the
deduction is the subject.

## Decision

### The step comes from the dominant side; the small side is not rounded to it

`pairedDomain` stops delegating to `columnDomain` and builds its own domain:

- the step is `niceStep(max(rawTop, −rawBottom) / TARGET_INTERVALS)` — **whichever side has the
  range to divide sets it**, so a history that is all withholding and no income still gets a
  sensible step rather than `niceStep(0)`'s fallback of 1;
- the income side rounds outward to that step, exactly as before;
- **the tax side rounds outward to that step only if it needs a whole one.** Where it needs less,
  it rounds outward to a nice number of *its own* magnitude and contributes a single labelled tick
  at the bottom.

`niceStep` is reused for that second rounding rather than a new helper written: it is already a
nice-*ceiling* (14.25 → 20, 6 → 10), and "round outward to 1, 2 or 5 times a power of ten" is the
same rule at both scales.

On the measured import the axis becomes −€20 to €200. The negative region falls from 33% to **9%**,
and the income side gains resolution as a side effect — a 50 step where it had 100 — so every bar
on the chart is taller, not only the tax ones.

### The axis is uneven across zero, and nowhere else

This is the cost, stated plainly. In the second branch the gap between the bottom tick and zero is
not the gap between the other ticks. It is **the only place in the app where gridline spacing is
not uniform.**

Two things keep it honest, and both are load-bearing:

- **The bottom tick is labelled.** The reader takes the number off the axis rather than by counting
  spaces, which is what makes an uneven interval legible instead of misleading.
- **Zero is always a tick.** The one line both series are read against is never the interpolated
  one, so the uneven interval is always *outside* the comparison the chart is for.

### `columnDomain` is left alone

The change is in `pairedDomain` only. `columnDomain` is the daily-return chart's domain too, and
that chart's two sides are genuinely comparable — a shared step is right there, and none of the
reasoning above reaches it. A fix applied one level up would have moved an axis this story never
looked at.

## Consequences

Benefits:

* The deduction is drawn at a scale a reader can compare month to month, which is what DDR-0080
  said the chart was for.
* The income side gains resolution for free: a finer step divides a domain no longer stretched to
  cover a rounded-out negative floor.
* DDR-0080's open finding is closed rather than carried.
* No new constant, class or module. One function, and it stops calling another.

Tradeoffs:

* **Uneven gridline spacing across zero**, discussed above. The alternative was a step fine enough
  to divide the tax side, which puts eleven gridlines behind a chart that wants four — and a chart
  that dense is a worse answer to "how much was taken" than an uneven interval with a label on it.
* `pairedDomain` and `columnDomain` are now two domain builders rather than one with a caller. They
  encode genuinely different rules, so the duplication is the honest shape, but a future change to
  ticking has two places to look. Both are in `lib/column.ts`, adjacent, and each says why it is
  not the other.
* A month whose withholding lands exactly on a nice step touches the bottom gridline rather than
  clearing it. This matches the income side's existing convention (`Math.ceil`) and every other
  chart in the app; real money rarely lands there.

Risks:

* A later reading of `pairedDomain` may "simplify" it back onto `columnDomain`. The tests name the
  measured case with its real figures, so that change fails with the number that caused this story
  rather than with a generic assertion.

## Alternatives Considered

### Independent nice steps either side of zero

Uniform within each side, different across it. It is this decision with more gridlines below the
line and no more information — the tax side is one bar's magnitude, not a range that wants
dividing.

### Let the domain edge not be a tick at all

Tightest possible bottom, no negative label. Rejected: it leaves the region below zero unlabelled,
so the reader has a bar and no scale to read it against — worse than an uneven interval, because
the number is simply absent.

### Fix it in `columnDomain`

Would move the daily-return chart's axis, which has no such problem: its two sides are comparable
and a shared step is what it wants. Out of scope by construction rather than by preference.

### Leave it, as DDR-0080 did

Correct for one story — the geometry had to land before its proportions could be judged on real
data — and not correct twice. The finding was measured, not predicted, and it does not improve by
waiting.

## References

* [[0080-withholding-hangs-below-the-line]] — the geometry, and the open finding this record
  closes.
* [[0078-two-columns-a-month-and-a-plot-sized-in-pixels]] — the pixel width and the scroll, both
  untouched.
* [[0079-the-value-axis-leaves-the-viewbox]] — the pinned HTML axis, which renders these ticks
  through the same `y` the gridlines use, so an uneven interval needed no change there.
* `lib/column.ts` — `pairedDomain` and `columnDomain`, adjacent and deliberately distinct.
* Story #248, Epic #245.
