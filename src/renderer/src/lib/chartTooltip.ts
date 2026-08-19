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

/** Inner padding, horizontal and vertical. */
export const PAD_X = 10
export const PAD_Y = 8
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
  /** Baselines for each row, in the order given. */
  readonly rowYs: readonly number[]
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
 */
export function tooltipLayout(
  anchorX: number,
  title: string,
  rows: readonly TooltipRow[],
  plot: TooltipPlot,
): TooltipLayout {
  const width = widestLine(title, rows) * CHAR_W + 2 * PAD_X
  const height = TITLE_H + rows.length * ROW_H + 2 * PAD_Y

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
    rowYs: rows.map((_, i) => titleY + (i + 1) * ROW_H),
    flipped,
  }
}
