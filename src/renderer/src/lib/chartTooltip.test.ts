import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PERFORMANCE_PLOT } from './chartGeometry'
import { stripComments } from './cssDeclarations'
import {
  ANCHOR_GAP,
  CHAR_W,
  INK_NEGATIVE,
  INK_POSITIVE,
  MIN_WIDTH,
  PAD_X,
  PAD_Y,
  RADIUS_UNITS,
  ROW_H,
  TITLE_H,
  signInk,
  tooltipLayout,
  type TooltipLayout,
  type TooltipRow,
} from './chartTooltip'

/**
 * The hover card's layout (Story #188, DDR-0061).
 *
 * The card is the story's one interaction change, and none of it can be observed: Vitest runs in
 * Node with no jsdom, so nothing here renders a `<g>` and measures where it landed (DDR-0029).
 * What can be checked is the arithmetic, which is all a tooltip's placement actually is — and the
 * two properties that matter are the ones a screenshot would not tell you either: that the card
 * never leaves its plot, and that it grows with its rows rather than clipping them.
 *
 * The block at the bottom scans `app.css` instead, for the parts of the card that are CSS. It
 * strips comments first, because this stylesheet quotes its own values in prose and an assertion
 * can otherwise pass off the commentary alone (DDR-0042, DDR-0047).
 */

const CSS = stripComments(readFileSync(new URL('../app.css', import.meta.url), 'utf8'))
const PLOT = PERFORMANCE_PLOT
const RIGHT_EDGE = PLOT.width - PLOT.pad.right

function layout(anchorX: number, title: string, rows: TooltipRow[]): TooltipLayout {
  return tooltipLayout(anchorX, title, rows, PLOT)
}

describe('tooltipLayout', () => {
  it('sizes the box from its widest line, title included', () => {
    const long = layout(100, '31 December 2026 (a very long heading)', [{ value: '€1,234' }])
    const short = layout(100, '31 December 2026', [{ value: '€1,234' }])
    expect(long.width).toBeGreaterThan(short.width)
    expect(short.width).toBe('31 December 2026'.length * CHAR_W + 2 * PAD_X)
  })

  /**
   * The floor (Story #220, DDR-0070). Both halves are the assertion: a short card is padded out
   * to it, and a card with more to say is not held down to it. The failure the second half
   * catches is a `min` written where a `max` was meant, which looks identical on the chart that
   * has one row and clips every row off the chart that has five.
   */
  it('never draws narrower than the minimum, and is not capped by it', () => {
    expect(layout(100, '1 Jan', [{ value: '€1' }]).width).toBe(MIN_WIDTH)

    const wide = layout(100, '31 December 2026', [
      { label: 'Stocks and equities', value: '€1,234,567.89 (98.7%)' },
    ])
    expect(wide.width).toBeGreaterThan(MIN_WIDTH)
    // The text columns follow the widened box rather than the line that widened it.
    expect(wide.valueX - wide.textX).toBe(wide.width - 2 * PAD_X)
  })

  it('still flips rather than clipping once a longer row has widened it', () => {
    // The interaction between the two: a card that grew for its content has *less* room on the
    // right than the one the flip threshold was reasoned about with, so the widening is exactly
    // what would push a card over the edge if the flip were decided before the width.
    const anchorX = RIGHT_EDGE - 60
    const narrow = layout(anchorX, '1 Jan', [{ value: '€1' }])
    const wide = layout(anchorX, '1 Jan', [{ label: 'Cash', value: '−€1,234.56 (10.0%)' }])
    expect(wide.width).toBeGreaterThan(narrow.width)
    expect(wide.flipped).toBe(true)
    expect(wide.x).toBeGreaterThanOrEqual(PLOT.pad.left)
    expect(wide.x + wide.width).toBeLessThanOrEqual(anchorX)
  })

  it('counts a labelled row as both columns plus the gutter between them', () => {
    // The two-column row is the case a single-column heuristic silently clips: "Technology" and
    // "€120,000 (42.0%)" each fit a narrow card, and side by side they do not.
    const bare = layout(100, '1 Jan', [{ value: '€120,000 (42.0%)' }])
    const labelled = layout(100, '1 Jan', [{ label: 'Technology', value: '€120,000 (42.0%)' }])
    expect(labelled.width).toBeGreaterThan(bare.width + 'Technology'.length * CHAR_W)
  })

  it('grows in height with the row count, so eight bands and a total still fit', () => {
    const one = layout(100, '1 Jan', [{ value: 'x' }])
    const nine = layout(
      100,
      '1 Jan',
      Array.from({ length: 9 }, (_, i) => ({ label: `Band ${i}`, value: '€1' })),
    )
    expect(one.height).toBe(TITLE_H + ROW_H + 2 * PAD_Y)
    expect(nine.height).toBe(one.height + 8 * ROW_H)
    // Every baseline is inside the box it is drawn in. Three components computing their own
    // height and their own row step is how the composition card's rows and its box disagreed.
    for (const y of nine.rowYs) expect(y).toBeLessThan(nine.y + nine.height)
  })

  it('sits right of the anchor with room, and flips left without it', () => {
    const left = layout(PLOT.pad.left + 10, '1 Jan', [{ value: '€1' }])
    expect(left.flipped).toBe(false)
    expect(left.x).toBe(PLOT.pad.left + 10 + ANCHOR_GAP)

    const right = layout(RIGHT_EDGE - 5, '31 December 2026', [{ value: '€1,234,567' }])
    expect(right.flipped).toBe(true)
    expect(right.x + right.width).toBeLessThanOrEqual(RIGHT_EDGE - 5)
  })

  it('never leaves the plot, at any anchor', () => {
    // The whole reason the card is drawn inside the `<svg>` rather than at the cursor: in the 2×2
    // grid a card that overran its plot would be hanging over the chart next door (DDR-0061).
    const rows: TooltipRow[] = [{ label: 'Cumulative return', value: '−12.34% (100.0%)' }]
    for (let anchorX = PLOT.pad.left; anchorX <= RIGHT_EDGE; anchorX += 7) {
      const box = layout(anchorX, '31 December 2026', rows)
      expect(box.x, `anchor ${anchorX}`).toBeGreaterThanOrEqual(PLOT.pad.left)
      expect(box.y).toBeGreaterThanOrEqual(PLOT.pad.top)
      expect(box.y + box.height).toBeLessThan(PLOT.height - PLOT.pad.bottom)
    }
  })

  it('pins to the top of the plot, whatever the anchor', () => {
    // Not tracked to the mark: a daily-return bar can be one unit tall, so a card following it
    // would jump the height of the plot between two adjacent days (DDR-0052, DDR-0061).
    expect(layout(80, '1 Jan', [{ value: '€1' }]).y).toBe(PLOT.pad.top)
    expect(layout(400, '1 Jan', [{ value: '€1' }]).y).toBe(PLOT.pad.top)
  })

  it('keeps its text columns inside its own padding', () => {
    const box = layout(120, '1 Jan', [{ label: 'Cash', value: '€1' }])
    expect(box.textX).toBe(box.x + PAD_X)
    expect(box.valueX).toBe(box.x + box.width - PAD_X)
  })
})

describe('signInk', () => {
  it('gives a direction its own tone, and a flat day none', () => {
    expect(signInk(0.4)).toBe(INK_POSITIVE)
    expect(signInk(-0.4)).toBe(INK_NEGATIVE)
    // The case the function exists for: zero is not a small loss, and toning it either way
    // paints a day that did not move as one that did (DDR-0021).
    expect(signInk(0)).toBeUndefined()
  })
})

describe('the card app.css draws', () => {
  /**
   * The restyle's four surface properties (Story #220, DDR-0070). Two of them are CSS and two are
   * geometry, and the split is DDR-0018's: a fill and a border are page-independent, while a
   * padding and a corner are drawn in `viewBox` units and would resize against their own plot if
   * they came from the page's scale.
   */
  it('floats on the one surface step that goes up, with the card edge every card draws', () => {
    expect(CSS).toMatch(
      /\.chart-tooltip-bg\s*\{[^}]*fill:\s*var\(--surface-raised\)[^}]*stroke:\s*var\(--border\)/,
    )
    // Not --card on --card, which is what it was: a panel with no ground of its own.
    expect(CSS).not.toMatch(/\.chart-tooltip-bg\s*\{[^}]*fill:\s*var\(--card\)/)
  })

  it('keeps its padding and its corner in viewBox units, off the page scale', () => {
    // `--radius-md`'s step and the proposal's `10px 14px`, as numbers the plot scales with. The
    // assertion is that they are *not* in the stylesheet — a `rx: 8px` here would grow the corner
    // as the chart shrank (DDR-0018, DDR-0031).
    expect(RADIUS_UNITS).toBe(8)
    expect([PAD_X, PAD_Y]).toEqual([14, 10])
    expect(CSS).not.toMatch(/\.chart-tooltip-bg\s*\{[^}]*(rx|border-radius|padding):/)
  })

  it('inks a signed figure from the loss *text* token, never the fill one', () => {
    // The split is silent when you pick the wrong half (DDR-0046), and SVG hides it further: the
    // property is `fill` in both cases, so nothing about the declaration says which role it is.
    expect(CSS).toMatch(new RegExp(`\\.${INK_POSITIVE}\\s*\\{\\s*fill:\\s*var\\(--pos\\)`))
    expect(CSS).toMatch(new RegExp(`\\.${INK_NEGATIVE}\\s*\\{\\s*fill:\\s*var\\(--neg-text\\)`))
  })

  it('resolves a band’s class through the ink ramp, and leaves the band itself alone', () => {
    // Nine rules, each two classes deep so it out-specifies `.pie-series-*`'s own fill without an
    // `!important`. The row is keyed by the same string the ribbon and the swatch carry — what
    // changes is only the role the colour plays (DDR-0030).
    for (const slot of [1, 2, 3, 4, 5, 6, 7, 8, 'neutral']) {
      expect(CSS, `slot ${slot}`).toMatch(
        new RegExp(
          `\\.chart-tooltip-value\\.pie-series-${slot}\\s*\\{\\s*fill:\\s*var\\(--series-ink-${slot}\\)`,
        ),
      )
    }
    // The ramp is the card's alone: a band still fills at full strength, softened by opacity.
    expect(CSS).toMatch(/\.pie-series-1\s*\{\s*fill:\s*var\(--series-1\)/)
  })

  it('takes its entrance from the motion scale, so reduced motion zeroes it', () => {
    // DDR-0044's mechanism: drawing the duration from the token is what puts the animation inside
    // the one `prefers-reduced-motion` rule. A raw 90ms here would keep running.
    expect(CSS).toMatch(
      /\.chart-tooltip\s*\{[^}]*animation:\s*chart-tooltip-in var\(--duration-fast\)/,
    )
  })

  it('fades the area to nothing at the baseline, in the series colour', () => {
    // The gradient's colour stays in the stylesheet; only the `<defs>` is in the component, because
    // a gradient is referenced by id and two curves share a page (DDR-0061).
    expect(CSS).toMatch(/\.chart-area-from\s*\{[^}]*stop-color:\s*var\(--series-1\)/)
    expect(CSS).toMatch(/\.chart-area-to\s*\{[^}]*stop-opacity:\s*0;/)
    // The flat wash it replaced set `fill` and `opacity` on the polygon itself.
    expect(CSS).not.toMatch(/\.chart-area\s*\{/)
  })

  it('leaves the composition bands softened by fill-opacity alone (DDR-0052)', () => {
    // The restyle must not reach `.stack-band`: eight gradients would spend one-hue-per-class.
    expect(CSS).toMatch(/\.stack-band\s*\{[^}]*fill-opacity:/)
  })
})
