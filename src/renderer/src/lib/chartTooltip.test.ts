import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PERFORMANCE_PLOT } from './chartGeometry'
import { stripComments } from './cssDeclarations'
import {
  ANCHOR_GAP,
  CHAR_W,
  PAD_X,
  PAD_Y,
  ROW_H,
  TITLE_H,
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
    const long = layout(100, '31 December 2026', [{ value: '€1,234' }])
    const short = layout(100, '1 Jan', [{ value: '€1,234' }])
    expect(long.width).toBeGreaterThan(short.width)
    expect(short.width).toBe('€1,234'.length * CHAR_W + 2 * PAD_X)
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

describe('the card app.css draws', () => {
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
