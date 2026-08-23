import { useRef, useState } from 'react'
import {
  axisTicks,
  bandIndexAt,
  columnPlot,
  columnPlotWidthPx,
  pairedDomain,
  pairedTooltipRows,
} from '../../lib/column'
import { StatePanel } from '../ui/StatePanel'
import { ChartTooltip } from './ChartTooltip'

/**
 * Two columns a month over a time axis (Milestone M3, Story #23; re-shaped by Story #241).
 *
 * Each month draws a **pair of bars across one baseline**: a `primary` rising from zero — the
 * month's whole income — and a `secondary` hanging below it, which is what was taken out of the
 * primary. Inline SVG, no charting dependency.
 *
 * **It was a stack until Story #241**, `lower` (the net) with `upper` (the withholding) on top of
 * it, so the column's height read as the gross. Two names in the key and one column drawing one of
 * them *as part of* the other is the problem that ended it: the withholding segment's size could
 * only be read against a baseline that was not there, which asked the reader to do the arithmetic
 * the chart existed to do for them.
 *
 * **Story #246 turned the secondary downward.** #241's pair fixed the arithmetic but left both
 * bars pointing the same way, so the picture said *compare these two* where the relationship is a
 * deduction — one figure taken out of the other. Drawing it below the line makes the deduction the
 * subject and gives Story #49's month its mark back: a month whose withholding outweighed its
 * income is a short bar up and a longer one down rather than a lone bar beside a gap.
 *
 * The thing that makes this legal, and that DDR-0078 was right to guard: **a bar's direction is a
 * property of its series, never of its value.** Both figures stay non-negative and the plot keeps
 * exactly one baseline. A third *net* bar — the alternative DDR-0078 was actually refusing — would
 * not, because its sign moves with the data; the net stays a toned figure in the hover card.
 *
 * **The legend moved into the card header** in Story #192 (DDR-0064), the same move DDR-0052 made
 * for the composition stack and for the same two reasons: a key is read *before* the plot rather
 * than after it, and a `<figcaption>` under the plot is height the card's neighbours do not have.
 * `IncomeLegend` below is what the view renders there, so this component emits a bare `<svg>` —
 * inside the scroll wrapper described next, which draws nothing.
 *
 * **The plot is sized in pixels from its history, and the card scrolls it** (Story #241). Until
 * then the `<svg>` was `width: 100%` over a `viewBox` that widened by a band a month, so a unit
 * was worth whatever the card's width divided by the history happened to make it, and every mark
 * shrank as months accumulated — 11.3px axis labels at thirteen months, 3.5px at five years.
 * `COLUMN_MONTH_PX` fixes what a month is worth on screen and `min-width: 100%` keeps a short
 * history filling its card, so the plot grows *longer* rather than denser. It is a deliberate
 * re-decision of DDR-0018 for this chart alone; the Performance grid keeps its shared aspect
 * (DDR-0051).
 *
 * **Story #236 took the native `<title>` off and gave the chart the app's hover card**, the last
 * of the four to get it (#188, #220):
 *
 * - the hit target is the **band**, as it is in `BarChart` — so a month with nothing to draw is
 *   still hoverable, which a `<title>` on a zero-height rect never was;
 * - the card is **drawn in this plot's own `viewBox`**, which is why `columnPlot` exists: the
 *   three Performance charts share a fixed geometry and this one does not (DDR-0061);
 * - the card reports all three figures where the `<title>` did, but **omits a row it has no figure
 *   for** and tones only the one the chart no longer draws. `pairedTooltipRows` owns both rules,
 *   because neither can be seen from a test that cannot render (DDR-0029).
 */
export interface PairedColumn {
  key: string
  label: string
  /** The taller bar — the month's whole income. Non-negative. */
  primary: number
  /** The bar beside it — what was taken out of the primary. Non-negative. */
  secondary: number
}

/** A pair's share of its band, leaving the rest as the gap between one month and the next. */
const GROUP_FILL = 0.7
/** The gap between the two bars of one month, in viewBox units. */
const PAIR_GAP = 3
/** Widest a single bar gets, so a short history spread over a year's axis is not a row of slabs. */
const MAX_BAR_W = 26

export function ColumnChart({
  columns,
  formatValue,
  primaryLabel,
  secondaryLabel,
  differenceLabel,
  ariaLabel,
}: {
  columns: PairedColumn[]
  formatValue: (v: number) => string
  /** Names the taller bar, in the hover card and in the key beside it. */
  primaryLabel: string
  /** Names the bar beside it, in both. */
  secondaryLabel: string
  /** When set, the hover card also reports `primary − secondary` under this name, toned by sign. */
  differenceLabel?: string
  ariaLabel: string
}): React.JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)

  if (columns.length === 0) {
    return <StatePanel surface="inline">No income to plot over time yet.</StatePanel>
  }

  const plot = columnPlot(columns.length)
  const { width: W, height: H, pad: PAD } = plot
  const plotH = H - PAD.top - PAD.bottom
  const plotW = W - PAD.left - PAD.right
  const { top, bottom, ticks } = pairedDomain(columns)
  const span = top - bottom || 1
  // The plot is drawn for at least a year of bands, so a shorter history gets a *wider* band
  // rather than a narrower plot — which is what keeps three months from being three slabs.
  const band = plotW / columns.length
  const barW = Math.min(MAX_BAR_W, (band * GROUP_FILL - PAIR_GAP) / 2)
  const y = (v: number): number => PAD.top + plotH - ((v - bottom) / span) * plotH
  const zeroY = y(0)

  /** Map a pointer event to the month whose band it falls in (see `bandIndexAt`). */
  function onMove(e: React.MouseEvent<SVGSVGElement>): void {
    const svg = svgRef.current
    if (!svg) return
    // `getBoundingClientRect` is the *rendered* box, so it already accounts for however far the
    // wrapper is scrolled — the arithmetic below is unchanged by the scroll and must stay that way.
    const rect = svg.getBoundingClientRect()
    const vbX = ((e.clientX - rect.left) / rect.width) * W
    setHover(bandIndexAt(vbX, PAD.left, plotW, columns.length))
  }

  const active = hover !== null ? columns[hover] : undefined

  const gutter = axisTicks(ticks, plot, y)
  // Sizes the gutter to its own content, so the column is exactly as wide as the widest figure it
  // holds. A hand-set width is the failure DDR-0051 §#190 recorded — a gutter cut for eight
  // characters against labels that render ten, clipping the currency symbol in silence — and this
  // element makes that unexpressible rather than documented: the browser measures the real string
  // in the real face, and a portfolio crossing a decimal place widens the column by itself.
  const widest = gutter.reduce(
    (longest, tick) => {
      const text = formatValue(tick.value)
      return text.length > longest.length ? text : longest
    },
    '',
  )

  return (
    // A tab stop and a name, because this is the only copy of the older months and a scroll region
    // a mouse alone can reach hides them from a keyboard reader (WCAG 2.1.1). `role="group"` for
    // the reason DDR-0047 gave the map one: it is a graphic with something inside it. It declares
    // no focus rule — the `:where(...)` base rule rings it.
    <div className="chart-scroll" tabIndex={0} role="group" aria-label={ariaLabel}>
      {/* The gutter is **inside** the scroll container and sticks to its left edge, which is what
          makes its height the plot's rather than the plot's plus a scrollbar — a percentage
          resolves against the scroller's *content* box, and a horizontal scrollbar is not in it.
          Placed outside instead, every label sat ~15px low the moment the plot got long enough to
          scroll: exact at rest, and wrong precisely when the axis has a job to do (Story #243).

          `aria-hidden`: the chart is a `role="img"` with a name of its own and its figures are in
          the tables below, so five bare numbers read out before it would be noise. */}
      <div className="chart-axis" aria-hidden="true">
        <span className="chart-axis-sizer">{widest}</span>
        {gutter.map((tick) => (
          <span
            className="chart-axis-tick"
            key={tick.value}
            style={{ top: `${tick.topPercent}%` }}
          >
            {formatValue(tick.value)}
          </span>
        ))}
      </div>
      <svg
        ref={svgRef}
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        // A pixel width, and the one place in the app a chart has one (DDR-0018 is re-decided here
        // and nowhere else). `min-width: 100%` in the stylesheet turns it into a floor, so a short
        // history fills its card instead of floating in the middle of a panel.
        style={{ width: `${columnPlotWidthPx(plot)}px` }}
        role="img"
        aria-label={ariaLabel}
        preserveAspectRatio="xMidYMid meet"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* Gridlines only. The figures that named them are the HTML gutter above, so that scrolling
            the plot cannot carry the value axis off the screen (Story #243). */}
        {ticks.map((t, i) => (
          <line
            // Zero is a level the plot straddles again (Story #246): income above it, tax below.
            // Emphasised for the reason it always was — it is the one line both bars of a pair are
            // read against — but it is now a baseline *between* them rather than under them.
            className={t === 0 ? 'chart-zero' : 'chart-grid'}
            key={`${t}-${i}`}
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(t)}
            y2={y(t)}
          />
        ))}

        {columns.map((c, i) => {
          // The pair is centred in its band, so the month label below it names both bars.
          const groupW = barW * 2 + PAIR_GAP
          const left = PAD.left + i * band + (band - groupW) / 2
          return (
            <g key={c.key}>
              {/* No per-bar `<title>`: the hover card below replaces it, and leaving both would
                  float a slow native tooltip over the one that already answered the question — the
                  note `BarChart` has carried since Story #170. */}
              {/* Absent, not a zero-height mark on the line — the rule `pairedTooltipRows` applies
                  to the card's rows, applied to the plot. A `rect` of height 0 draws nothing
                  anyway; saying so here is what keeps it from being restored as a rounded sliver
                  the next time `rx` is touched. */}
              {c.primary > 0 && (
                <rect
                  className="chart-bar-primary"
                  x={left}
                  y={y(c.primary)}
                  width={barW}
                  height={zeroY - y(c.primary)}
                  rx={2}
                />
              )}
              {/* Downward from the baseline (Story #246). The height is measured from `zeroY` to
                  `y(-secondary)` rather than the other way about, so the bar is anchored on zero at
                  its *top* — the reader compares both series against the same line, and a month
                  with more tax than income simply reaches further down. */}
              {c.secondary > 0 && (
                <rect
                  className="chart-bar-secondary"
                  x={left + barW + PAIR_GAP}
                  y={zeroY}
                  width={barW}
                  height={y(-c.secondary) - zeroY}
                  rx={2}
                />
              )}
              <text
                className="chart-axis-label"
                x={left + groupW / 2}
                y={H - 10}
                textAnchor="middle"
              >
                {c.label}
              </text>
            </g>
          )
        })}

        {/* The card carries the figure the chart does not draw: the net. The plot shows what came
            in and what was taken, one either side of the line, and leaves their difference as the
            thing the reader can see but not measure — so the signed figure itself lives here,
            toned, and is still the only row of the three the chart has no mark for. */}
        {active && hover !== null && (
          <ChartTooltip
            plot={plot}
            anchorX={PAD.left + (hover + 0.5) * band}
            title={active.label}
            rows={pairedTooltipRows(
              active,
              { primary: primaryLabel, secondary: secondaryLabel, difference: differenceLabel },
              formatValue,
            )}
          />
        )}
      </svg>
    </div>
  )
}

/**
 * The pair's key, rendered into the income card's **header** rather than under the plot
 * (Story #192, DDR-0064) — the placement DDR-0052 settled for the composition stack.
 *
 * It takes the same labels the hover card uses, so the key cannot name one thing while the month
 * under the pointer names another. The swatches are `aria-hidden`: the label beside each is the
 * text, and a screen reader reading "square, Withholding tax" gains nothing.
 *
 * **Both swatches now name a bar** (Story #241). Under the stack the first named the *column* and
 * the second a segment of it, which is the ambiguity the pair removes: two swatches, two bars,
 * one baseline.
 */
export function IncomeLegend({
  primaryLabel,
  secondaryLabel,
}: {
  /** Names the taller bar of each pair. */
  primaryLabel: string
  /** Names the bar beside it. */
  secondaryLabel: string
}): React.JSX.Element {
  return (
    <p className="chart-legend chart-legend-header">
      <span className="legend-item">
        <span className="legend-swatch legend-swatch-primary" aria-hidden="true" /> {primaryLabel}
      </span>
      <span className="legend-item">
        <span className="legend-swatch legend-swatch-secondary" aria-hidden="true" />{' '}
        {secondaryLabel}
      </span>
    </p>
  )
}
