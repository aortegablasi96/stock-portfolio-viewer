import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { scanDeclarations } from './cssDeclarations'
import { readTokens } from './tokenAdoption'

/**
 * The Allocation view's composition, and the one coupling in it that is invisible (Story #191).
 *
 * The view's *appearance* is the shared work of Stories #180–#188 and is guarded where it lives.
 * What this story decided, and what nothing else can see, is three things:
 *
 * - the breakdown's **pair** — a fixed 280px donut track beside the table, and a stacking
 *   breakpoint derived from what the table needs rather than picked,
 * - the **order** of the two cards, the breakdown before the map,
 * - and the basemap going **dark**, which is only half a decision: the weight donut's track was
 *   painted in the card's own colour, which is a grey ring on a white map and nothing at all on a
 *   dark one. Ground and track have to move together or the left donut stops being a proportion
 *   ([[0030]], [[0063]]).
 *
 * That last one is the reason this file exists rather than a comment. Both halves type-check,
 * both render, and the failure is a mark that looks *fine* — a small blue arc, floating, with
 * nothing to be a fraction of. Reverting the basemap alone would restore the picture and leave a
 * grey-on-grey track; swapping the track alone leaves a lit panel in a dark room. The pair is
 * asserted here so a later story has to touch both.
 *
 * A text scan for the reason `analyticsShell.test.ts`, `chartGeometry.test.ts` and
 * `performanceLayout.test.ts` are: Vitest runs in Node with no jsdom, so no component may be
 * rendered (DDR-0029). Comments are stripped first — `app.css` and these components quote their
 * own values in prose, and an assertion that passes off the commentary alone is the trap DDR-0042
 * records and this suite has now hit six times.
 */
const strip = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const CSS = readFileSync(new URL('../app.css', import.meta.url), 'utf8')
const VIEW = strip(
  readFileSync(new URL('../components/analytics/AllocationView.tsx', import.meta.url), 'utf8'),
)
const BREAKDOWN = strip(
  readFileSync(new URL('../components/analytics/AllocationBreakdown.tsx', import.meta.url), 'utf8'),
)
const PIE = strip(readFileSync(new URL('../components/charts/PieChart.tsx', import.meta.url), 'utf8'))
const MAP = strip(readFileSync(new URL('../components/charts/CountryMap.tsx', import.meta.url), 'utf8'))

const DECLARATIONS = scanDeclarations(CSS)

/** One declaration by its `context | property` key, which is what a failure can name. */
function declaration(key: string): string {
  const found = DECLARATIONS.find((d) => d.key === key)
  expect(found, `no declaration keyed \`${key}\``).toBeDefined()
  return found!.value
}

/**
 * The spacing scale, read through `tokenAdoption`'s own reader rather than a second one.
 *
 * `scanDeclarations` cannot see these: it takes properties matching `[a-zA-Z-]+`, and every step
 * on the scale ends in a digit. That is the ratchet's boundary, not a bug — the guard scans for
 * raw lengths in rules, and the scale itself is where the numbers are *allowed* to be.
 */
const SPACE = readTokens(CSS, 'space')

/** A `:root` token's px value, following `var()` indirection (`--surface-pad-md` → `--space-6`). */
function tokenPx(name: string): number {
  const step = SPACE.find((t) => t.name === name)
  if (step) return step.px

  const raw = declaration(`:root | ${name}`)
  const indirect = raw.match(/var\((--[a-z0-9-]+)\)/)
  if (indirect) return tokenPx(indirect[1]!)

  const length = raw.match(/([\d.]+)(rem|px)/)
  expect(length, `\`${name}\` is not a single length`).not.toBeNull()
  return length![2] === 'rem' ? Number(length![1]) * 16 : Number(length![1])
}

describe('the breakdown is a pair: the table beside a fixed donut track', () => {
  /**
   * The redesign's `1fr / 280px`, and the fixed half is the point. Under two fractional tracks
   * the donut's column grew with the window while the donut stopped at its own 13rem cap, so a
   * maximized display spent the difference on air — taken from the table, which is the half with
   * figures in it.
   */
  it('gives the donut a fixed track and the table everything else', () => {
    const columns = declaration('.breakdown-split | grid-template-columns')
    expect(columns).toBe('minmax(0, 1fr) var(--donut-column-width)')
    expect(tokenPx('--donut-column-width')).toBe(280)
  })

  /**
   * `align-items: start`, not `center`. The donut column is the short one at most widths, and
   * centring it against a twelve-row table floats it in the middle of the card.
   */
  it('starts both halves at the card’s top edge', () => {
    expect(declaration('.breakdown-split | align-items')).toBe('start')
  })

  /**
   * The number is derived, and this is the derivation rather than the comment beside it. A fixed
   * track does not shrink with the window, so below this width the table is the only thing left
   * to squeeze — which is the opposite of what the pair is for.
   */
  it('stacks at the width where the table stops fitting, not at a round number', () => {
    /** What a slice label, a currency value and a percentage need before the columns collide. */
    const TABLE_MIN_PX = 320

    const expected =
      tokenPx('--sidebar-width') +
      2 * tokenPx('--content-pad') +
      2 * tokenPx('--surface-pad-md') +
      tokenPx('--donut-column-width') +
      tokenPx('--space-7') +
      TABLE_MIN_PX

    const stacked = DECLARATIONS.find(
      (d) =>
        d.context.includes('.breakdown-split') &&
        d.context.includes('@media') &&
        d.property === 'grid-template-columns',
    )
    expect(stacked, 'the pair never stacks').toBeDefined()
    expect(stacked!.value).toBe('minmax(0, 1fr)')

    const breakpoint = stacked!.context.match(/max-width:\s*(\d+)px/)
    expect(breakpoint, 'the stack is not driven by a max-width').not.toBeNull()
    expect(Number(breakpoint![1])).toBe(expected)
  })
})

describe('the donut carries a legend the table cannot replace', () => {
  it('renders it unconditionally — there is no “off” left to leave it in', () => {
    expect(PIE).toContain('<figcaption className="chart-legend pie-legend">')
    expect(PIE).not.toContain('showLegend')
    expect(BREAKDOWN).not.toContain('showLegend')
  })

  /**
   * Name and share, never the value. The value is the table's column and the slice's `<title>`;
   * a third copy in a 280px column is the vertical list this legend replaced.
   */
  it('states the share, and leaves the value to the table beside it', () => {
    expect(PIE).toContain('<span className="pie-legend-value">{arc.percent.toFixed(1)}%</span>')
    expect(PIE).not.toMatch(/pie-legend-value[\s\S]{0,120}formatValue/)
  })

  it('wraps rather than stacking one slice per line', () => {
    expect(declaration('.pie-legend-list | flex-wrap')).toBe('wrap')
    expect(DECLARATIONS.some((d) => d.key === '.pie-legend-list | flex-direction')).toBe(false)
  })
})

describe('the page reads breakdown, then map, then positions', () => {
  /**
   * The map is the tallest card and the only approximate one — positioned by issuer country, as
   * its own label says. The breakdown is the exact answer. Ordering is a property of the rendered
   * page, so it is asserted on the source's own sequence rather than on a class name.
   */
  it('puts the exact answer above the approximate one', () => {
    const breakdown = VIEW.indexOf('<AllocationBreakdown')
    const map = VIEW.indexOf('<CountryMap')
    const positions = VIEW.indexOf('<PositionsTable')
    expect(breakdown).toBeGreaterThan(-1)
    expect([breakdown, map, positions]).toEqual([breakdown, map, positions].sort((a, b) => a - b))
  })

  /**
   * DDR-0036: the slice-by control sits in the card's header strip and is `aria-pressed`, never a
   * second tablist. Only the view list is a real one (DDR-0029).
   */
  it('keeps the slice-by control in the header, and not as a tablist', () => {
    expect(VIEW).toMatch(/<CardHeader>[\s\S]*?<ToggleGroup[\s\S]*?<\/CardHeader>/)
    expect(VIEW).not.toContain('role="tab"')
  })

  /** DDR-0030: only sectors pay the reserved blue slot; the other three keep all eight. */
  it('offsets the palette for sectors alone', () => {
    expect(VIEW).toContain("colorOffset={tab === 'sector' ? SECTOR_SLOT_OFFSET : 0}")
  })
})

describe('the basemap and the weight donut’s track are one decision', () => {
  /**
   * Monochrome, which is DDR-0019's reason and is unspent by going dark: the sector palette is
   * categorical, so the marks must stay the only saturated thing on screen. `streets` or
   * `satellite` would spend that whatever the app's ground is.
   */
  it('is a dark monochrome Mapbox style', () => {
    const style = MAP.match(/const MAP_STYLE = '([^']+)'/)
    expect(style, 'MAP_STYLE is gone or no longer a literal').not.toBeNull()
    expect(style![1]).toBe('mapbox://styles/mapbox/dark-v11')
  })

  /**
   * The half that is silent. `fill: var(--card)` at 42% is how a grey ring is drawn **on a white
   * basemap**; on a dark one it is near-black on near-black and the track disappears, leaving an
   * arc with nothing to be a fraction of — the one thing DDR-0030 says this half of the mark is
   * for. A surface token here is the failure, whichever way the ground went.
   */
  it('draws the track in a neutral that does not depend on a light ground', () => {
    const fill = declaration('.country-mark-rest | fill')
    expect(fill).toBe('var(--muted)')
    expect(fill).not.toMatch(/--card|--bg|--surface/)
  })

  /** DDR-0045: the gain/loss mode stays withdrawn — no mark wears `--pos` / `--neg`. */
  it('leaves the marks free of the loss tones', () => {
    for (const d of DECLARATIONS.filter((x) => x.context.includes('.country-mark'))) {
      expect(d.value, `${d.key} paints a mark with a gain/loss tone`).not.toMatch(/--pos|--neg/)
    }
  })
})
