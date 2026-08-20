/**
 * Splitting a curve at its zero line, in viewBox units (Story #229, DDR-0071).
 *
 * The return curve is toned like the daily-return bars — `--pos` above break-even, `--neg` below —
 * and the honest way to draw that is **not** two series. Splitting the data at the crossing would
 * mean inventing a point where the curve meets zero, which is a sample the report never took, and
 * it would leave `LineChart` plotting something other than what `returnSeries` contains.
 *
 * So the split is geometry: one polyline and one polygon, each drawn twice under complementary
 * clip rectangles. The renderer never sees two series, and the crossing lands wherever the line
 * actually crosses rather than wherever a resampling put it.
 *
 * What has to be right is the two rectangles, and that is arithmetic — which is why it is here
 * rather than in the component. Vitest runs in Node with no jsdom (DDR-0029), so a `<clipPath>`
 * computed inline could not be tested at all, and the cases that break it are exactly the ones
 * nobody scrubs to by hand: a range that never goes negative, one that never goes positive, and
 * the two where zero lands precisely on an edge of the plot.
 */

/** A clip rectangle, in the plot's own coordinates. */
export interface ClipRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** The plot the bands are cut from — the shape `chartGeometry` exports. */
export interface CurvePlot {
  readonly width: number
  readonly height: number
  readonly pad: {
    readonly top: number
    readonly right: number
    readonly bottom: number
    readonly left: number
  }
}

/** The two halves of a signed plot, and the rule between them. */
export interface SignedBands {
  /** The zero line's y, **clamped into the plot** — where the rule is drawn and the bands meet. */
  readonly zeroY: number
  /** Everything above break-even. Zero-height where the series never rises above zero. */
  readonly above: ClipRect
  /** Everything below break-even. Zero-height where the series never falls below zero. */
  readonly below: ClipRect
}

/**
 * Cut the plot into an above-zero band and a below-zero band.
 *
 * `zeroY` is passed in already projected, because the projection belongs to the chart that owns
 * the domain. It may legitimately land **outside** the plot: a window in which every reading is
 * negative puts break-even above the top edge, and one in which every reading is positive puts it
 * at or below the bottom. Both are real ranges a reader can select, and in both the correct
 * picture is a single tone over the whole plot.
 *
 * That is what the clamping is for, and it is the whole reason this is a function. An unclamped
 * `height` goes **negative** in those ranges, and a negative height is not a small visual error:
 * SVG treats it as an error value and disables the rendering of the shape, so the band that should
 * have covered the entire plot renders as nothing at all. The chart would lose its fill and its
 * line and look like a failed load, in exactly the two cases least likely to be scrubbed by hand.
 */
export function signedBands(zeroY: number, plot: CurvePlot): SignedBands {
  const top = plot.pad.top
  const bottom = plot.height - plot.pad.bottom
  const x = plot.pad.left
  const width = plot.width - plot.pad.left - plot.pad.right

  const clamped = Math.min(Math.max(zeroY, top), bottom)

  return {
    zeroY: clamped,
    above: { x, y: top, width, height: clamped - top },
    below: { x, y: clamped, width, height: bottom - clamped },
  }
}
