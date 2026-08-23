/**
 * The hover tooltip card's layout, in viewBox units (Story #188, DDR-0061).
 *
 * Three charts floated a tooltip and each computed its own box: two lines at a fixed 36 units in
 * `LineChart` and `BarChart`, a computed height in `StackedAreaChart`, and the same
 * `widest * 7 + 16` width heuristic copied into all three. They agreed by transcription, which is
 * how the composition card ended up with a 13-unit first baseline where its neighbours had 14.
 *
 * So the maths lives here and the markup lives in `components/charts/ChartTooltip`. Extracting it
 * is also the only way it gets tested: Vitest runs in Node with no jsdom, so nothing can render
 * the `<g>` and ask where the box landed (DDR-0029). Everything interesting about a tooltip is
 * arithmetic — how wide two columns of text make it, which side of the crosshair it goes on, and
 * whether it still fits — and all of it is checked in `chartTooltip.test.ts`.
 *
 * **Units are viewBox units, not pixels**, like every other number a chart draws with (DDR-0018).
 * The card scales with its plot, so a half-column chart in the 2×2 grid gets a proportionally
 * smaller card rather than a page-sized one crowding a 500-unit plot.
 */

/** One line of the card: an optional series name, and the figure it names. */
export interface TooltipRow {
  /** The series' name, muted and left-aligned. Omitted where the card's title already names it. */
  readonly label?: string
  /** The formatted figure. Right-aligned beside a label, left-aligned without one. */
  readonly value: string
  /**
   * A class inking the figure, where the chart has a colour for it (Story #220).
   *
   * Omitted is the card's default `--text`, and that is the common case: a figure is only tinted
   * where the mark it names is already coloured, so the tint restates something the reader can
   * see rather than introducing a channel of its own. Two charts qualify — the composition
   * stack, whose rows take the band's own `.pie-series-*` class, and the daily-return bars, whose
   * rows take {@link signInk}. The value stays on the row regardless, so nothing here is carried
   * by colour alone (DDR-0021, DDR-0048).
   */
  readonly ink?: string
}

/** The gain ink, for a figure whose mark is drawn above the zero line. */
export const INK_POSITIVE = 'chart-tooltip-value-pos'
/** The loss ink. `--neg-text`, never `--neg` — this is text, and the split is silent (DDR-0046). */
export const INK_NEGATIVE = 'chart-tooltip-value-neg'

/**
 * The ink a signed figure takes, or `undefined` where it takes none.
 *
 * **A zero day is untoned**, which is the case worth having a function for: neither tone is
 * true of it, and folding it into either would paint a flat day as a direction it did not move.
 */
export function signInk(value: number): string | undefined {
  if (value > 0) return INK_POSITIVE
  if (value < 0) return INK_NEGATIVE
  return undefined
}

/** The plot the card must stay inside — the shape `chartGeometry` exports. */
export interface TooltipPlot {
  readonly width: number
  readonly height: number
  readonly pad: {
    readonly top: number
    readonly right: number
    readonly bottom: number
    readonly left: number
  }
}

/* Card metrics, held together here rather than spread over three components: the height is
   `TITLE_H + rows × ROW_H + 2 × PAD_Y`, and a card whose padding disagrees with its row height
   puts its last line on its own border. */

/**
 * Inner padding, horizontal and vertical — the redesign's `padding: 10px 14px` (Story #220).
 *
 * Read as **viewBox units**, not pasted as a page length, which is the whole of DDR-0018's rule
 * applied to a padding rather than to a font size: the card scales with its plot, so a padding
 * fixed in px would be a different card in the 2×2 grid than in the stacked column. The
 * proposal's asymmetry is kept because it is right for the content — the two columns need
 * separating from the edge more than the four lines need separating from the top.
 */
export const PAD_X = 14
export const PAD_Y = 10
/**
 * The corner, in viewBox units — `--radius-md`'s step, which is what a card this size takes.
 *
 * A number rather than the token for the same reason {@link CHAR_W} is one: this is geometry
 * inside a `viewBox`, and `var(--radius-md)` resolves against the page rather than against the
 * plot, so the corner would grow when the chart shrank. It was an `rx={8}` literal in the
 * component until this story; naming it here is what puts it beside the padding it has to agree
 * with (DDR-0018, DDR-0031).
 */
export const RADIUS_UNITS = 8
/**
 * The narrowest the card gets, in viewBox units — the redesign's `min-width: 140` (Story #220).
 *
 * Without it the card is exactly as wide as its widest line, so scrubbing from Daily return
 * (one row, `Return  −1.23%`) to Composition over time (four rows and a total) changes the size
 * of the thing under the pointer as well as its contents, and the two read as different
 * components rather than as one card saying different things. The floor is a floor only: a card
 * with more to say still grows past it, which is what {@link tooltipLayout}'s width takes the
 * maximum of.
 */
export const MIN_WIDTH = 140
/** The title line's height — the date, one step smaller than a value row. */
export const TITLE_H = 15
/** A value row's height. */
export const ROW_H = 14
/** The gutter between a row's label column and its value column. */
export const COL_GAP = 16
/**
 * Width per character, in viewBox units.
 *
 * Deliberately one number for both columns and deliberately generous. The figures are set in
 * `--font-figure`, whose digits are ~20% wider than the sans face's (DDR-0053), and a card a few
 * units too wide is invisible where one a few units too narrow clips a number. Measuring text
 * properly would need a layout engine, which is exactly what a `viewBox` does not have.
 */
export const CHAR_W = 7
/** Gap between the crosshair and the card's near edge. */
export const ANCHOR_GAP = 12

/**
 * How many value rows a card can hold inside `plot`, derived rather than chosen (Story #228).
 *
 * The card's height is `TITLE_H + rows × ROW_H + 2 × PAD_Y` and its top is `plot.pad.top`, so what
 * it can hold follows from those four numbers and the plot's inner height — nothing here is a
 * budget someone picked. Change `ROW_H`, the padding or the plot, and the bound moves with them.
 *
 * This is DDR-0051 §#190's treatment applied to the other axis. That story found `pad.left`
 * described by a rule the number never implemented, with the `€` clipped off every tick for
 * months, and replaced the number with a derivation. The card's height had the same defect and had
 * never been looked at: `tooltipLayout` bounded the card across the plot and never down it.
 *
 * On `PERFORMANCE_PLOT` this is **7**. The composition card — the tallest caller, at every
 * `CompositionBand` key plus a `Total` — reaches 6, so the margin is one row.
 *
 * Floored at 1: a plot too short for even one row still gets a card rather than a negative count,
 * and the overflow row below is what tells the reader the rest is missing.
 */
export function maxRowsFor(plot: TooltipPlot): number {
  const inner = plot.height - plot.pad.top - plot.pad.bottom
  return Math.max(1, Math.floor((inner - TITLE_H - 2 * PAD_Y) / ROW_H))
}

/**
 * The row standing in for the ones that did not fit.
 *
 * **A truncation is information.** Dropping rows off the bottom of a card silently is the failure
 * this story exists to prevent, and it is the same principle DDR-0021 and DDR-0048 settled for
 * colour: a reader must not lose a figure without being able to tell that a figure is missing.
 * It carries no `label`, so it sets left-aligned under the date like any bare figure and does not
 * read as a series with a value.
 */
export function overflowRow(hidden: number): TooltipRow {
  return { value: `+${hidden} more` }
}

/** Where the card goes and how big it is. All coordinates are the plot's own. */
export interface TooltipLayout {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  /** Left text edge — where the title and a row's label start. */
  readonly textX: number
  /** Right text edge — where a labelled row's value ends (`text-anchor: end`). */
  readonly valueX: number
  /** The title's baseline. */
  readonly titleY: number
  /** Baselines for each drawn row, index-aligned with {@link TooltipLayout.rows}. */
  readonly rowYs: readonly number[]
  /**
   * The rows actually drawn — the caller's, or as many as fit followed by {@link overflowRow}.
   *
   * The component renders **this**, not the array it passed in, which is what makes the bound
   * impossible to bypass: a chart cannot draw a row the layout decided there was no room for
   * (DDR-0061 — geometry here, markup there).
   */
  readonly rows: readonly TooltipRow[]
  /** How many rows the card could not hold. `0` whenever everything fitted. */
  readonly hiddenRows: number
  /** Whether the card sits left of the anchor, because the right side had no room. */
  readonly flipped: boolean
}

/** The widest line the card has to hold, in characters. */
function widestLine(title: string, rows: readonly TooltipRow[]): number {
  const rowWidths = rows.map((row) =>
    row.label === undefined
      ? row.value.length
      : row.label.length + row.value.length + COL_GAP / CHAR_W,
  )
  return Math.max(title.length, ...rowWidths, 0)
}

/**
 * Lay the card out beside `anchorX`, inside `plot`.
 *
 * **Pinned to the top of the plot**, never to the mark it describes. A daily-return bar can be one
 * unit tall, so a card tracking the mark jumps the height of the plot between two adjacent days;
 * and the three charts in the Performance grid are read against each other, so a reader scrubbing
 * from one to the next should find the card where they left it (DDR-0051, DDR-0052).
 *
 * **Right of the crosshair by default, flipped left when it would overrun**, and clamped to the
 * plot's left edge in the degenerate case where it fits on neither side — a clipped card is worse
 * than one overlapping its own crosshair.
 *
 * **Bounded down the plot as well as across it** (Story #228). The card was previously free to
 * grow past the axis labels and then past the `viewBox`, which clips it without a sound — the
 * failure class DDR-0051 §#190 recorded in the other axis. Past {@link maxRowsFor} the card keeps
 * as many rows as fit and spends the last one saying how many it dropped, so the box it returns is
 * inside the plot at every row count and the reader is told when there is more.
 */
export function tooltipLayout(
  anchorX: number,
  title: string,
  rows: readonly TooltipRow[],
  plot: TooltipPlot,
): TooltipLayout {
  const maxRows = maxRowsFor(plot)
  // The overflow row costs a slot of its own, so the last row kept is `maxRows - 1` and the count
  // it reports includes the row it displaced. Treating that slot as free would put the card one
  // row past the bound it exists to respect, and under-report by one on the way.
  const overflows = rows.length > maxRows
  const kept = overflows ? maxRows - 1 : rows.length
  const hiddenRows = rows.length - kept
  const drawn = overflows ? [...rows.slice(0, kept), overflowRow(hiddenRows)] : rows

  // Measured on the rows actually drawn: the overflow row is short, so a card sized to a hidden
  // row would be wider than anything in it.
  const width = Math.max(MIN_WIDTH, widestLine(title, drawn) * CHAR_W + 2 * PAD_X)
  const height = TITLE_H + drawn.length * ROW_H + 2 * PAD_Y

  const right = anchorX + ANCHOR_GAP
  const flipped = right + width > plot.width - plot.pad.right
  const x = Math.max(plot.pad.left, flipped ? anchorX - ANCHOR_GAP - width : right)
  const y = plot.pad.top

  const titleY = y + PAD_Y + TITLE_H - 4

  return {
    x,
    y,
    width,
    height,
    textX: x + PAD_X,
    valueX: x + width - PAD_X,
    titleY,
    rowYs: drawn.map((_, i) => titleY + (i + 1) * ROW_H),
    rows: drawn,
    hiddenRows,
    flipped,
  }
}
