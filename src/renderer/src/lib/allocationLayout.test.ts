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

describe('the page reads map, then breakdown, then positions', () => {
  /**
   * Reversed by Story #223 (DDR-0074), which supersedes the ordering half of DDR-0063 and nothing
   * else in it. The geographic picture is the one card on the page that has to be *seen*: the
   * breakdown, the map's own legend and the Positions table each restate its figures exactly, and
   * none of them draws where the money is.
   *
   * Ordering is a property of the rendered page, so it is asserted on the source's own sequence
   * rather than on a class name.
   */
  it('opens with the picture, and keeps the per-holding table last', () => {
    const map = VIEW.indexOf('<CountryMap')
    const breakdown = VIEW.indexOf('<AllocationBreakdown')
    const positions = VIEW.indexOf('<PositionsTable')
    expect(map).toBeGreaterThan(-1)
    expect(breakdown).toBeGreaterThan(-1)
    expect([map, breakdown, positions]).toEqual([map, breakdown, positions].sort((a, b) => a - b))
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

describe('the map goes first, and pays for it in height', () => {
  /**
   * The reason DDR-0063 put the breakdown first, answered rather than dropped (Story #223).
   *
   * A 3:1 map above the breakdown pushed the breakdown's title past the bottom of the window the
   * app opens at. The order reverses anyway and the **map is shorter** instead, because capping its
   * *width* stays rejected (DDR-0051, DDR-0057) — so this is the assertion that the swap actually
   * paid for itself, rather than the ratio and the order having moved independently.
   *
   * Four measurements from the running app at 1280x800 stand in for what no Node test can compute:
   * a page header, a KPI row and a wrapped legend are all type on a laid-out page. They are named
   * and asserted, so a story that grows any of them has to come back here rather than quietly
   * pushing the title off screen again — the same footing as `TABLE_MIN_PX` above.
   */

  /** Title bar, page header, KPI row and the gaps: everything above the first card. */
  const ABOVE_FIRST_CARD_PX = 290
  /** The map card minus its frame — the header strip, the two-line legend and the card padding. */
  const MAP_CARD_CHROME_PX = 151
  /** A card's top edge to the bottom of its title's line box. */
  const CARD_TITLE_PX = 40

  /** The window the app opens at, read from the service that decides it (DDR-0028). */
  function windowDefault(name: 'WIDTH' | 'HEIGHT'): number {
    const source = readFileSync(
      new URL('../../../services/window/windowStateService.ts', import.meta.url),
      'utf8',
    )
    const value = new RegExp(`WINDOW_DEFAULT_${name} = (\\d+)`).exec(source)
    expect(value, `WINDOW_DEFAULT_${name} is gone or no longer a literal`).not.toBeNull()
    return Number(value![1])
  }

  /** The `n` in `aspect-ratio: n / 1`, as the frame declares it. */
  function frameRatio(): number {
    const ratio = declaration('.country-map-frame | aspect-ratio')
    const parts = /^(\d+(?:\.\d+)?) \/ (\d+)$/.exec(ratio)
    expect(parts, `aspect-ratio is "${ratio}", not \`n / m\``).not.toBeNull()
    return Number(parts![1]) / Number(parts![2])
  }

  /**
   * The tallest the frame can be drawn at the default window: the ratio's height at the widest
   * content the window affords, or the narrow-window floor, whichever wins. The **collapsed**
   * sidebar is the binding case — a rail leaves more width, and more width is a taller map. The
   * scrollbar is ignored, which only makes the real frame shorter than this bound.
   */
  function tallestFramePx(): number {
    const content =
      windowDefault('WIDTH') -
      tokenPx('--sidebar-width-collapsed') -
      2 * tokenPx('--content-pad') -
      2 * tokenPx('--surface-pad-md')
    return Math.max(content / frameRatio(), tokenPx('--country-map-min-height'))
  }

  it('leaves the breakdown’s title on screen at the window the app opens at', () => {
    const budget =
      windowDefault('HEIGHT') - ABOVE_FIRST_CARD_PX - tokenPx('--space-7') - CARD_TITLE_PX

    expect(tallestFramePx() + MAP_CARD_CHROME_PX).toBeLessThanOrEqual(budget)
  })

  /**
   * The floor and the ratio are one decision, the way the basemap and the track are below. A floor
   * taller than the budget would set the height by itself and flattening the ratio would change
   * nothing — the failure being a title below the fold with a 4:1 map above it, which looks like
   * the ratio was never the problem.
   */
  it('keeps the narrow-window floor inside the same budget', () => {
    const budget =
      windowDefault('HEIGHT') - ABOVE_FIRST_CARD_PX - tokenPx('--space-7') - CARD_TITLE_PX
    expect(tokenPx('--country-map-min-height') + MAP_CARD_CHROME_PX).toBeLessThanOrEqual(budget)
  })

  /** Flatter than the 3:1 DDR-0063 shipped. Restoring that ratio has to come back through here. */
  it('is flatter than the ratio the breakdown-first order could afford', () => {
    expect(frameRatio()).toBeGreaterThan(3)
  })
})

describe('the popup is no longer clipped by the frame it floats over', () => {
  /**
   * The cost of the shorter map, paid where it falls (Story #223, DDR-0074).
   *
   * Mapbox mounts a popup as a direct child of the map container and clips it there
   * (`.mapboxgl-map { overflow: hidden }`), flipping it above or below the mark and nowhere else.
   * That was survivable at 3:1 — measured in the running app, the worst of the map's seventeen
   * hover targets lost 56px — and is not at 4:1, where every one of them lost between 69 and 149px,
   * taking the last figures and the whole holdings row with them.
   *
   * So the clip moves down one level: the canvas container keeps it, and with it the rounded
   * corner and the marks, which must not escape a frame that no longer draws the map under them.
   * Both halves are asserted together because either alone is a regression that renders: lift the
   * clip and drop the corner and the basemap has square edges over a rounded card; put the clip
   * back and the popup is truncated again with nothing else looking wrong.
   */
  it('lets the popup out of the map, at a specificity mapbox’s own rule cannot beat', () => {
    // Two classes deep on purpose: `.mapboxgl-map` is one class, and which stylesheet the bundler
    // emits first is not something this decision should rest on.
    expect(declaration('.country-map.mapboxgl-map | overflow')).toBe('visible')
    expect(DECLARATIONS.some((d) => d.key === '.country-map | overflow')).toBe(false)
  })

  it('keeps the basemap, its marks and the rounded corner clipped', () => {
    expect(declaration('.country-map .mapboxgl-canvas-container | overflow')).toBe('hidden')
    expect(declaration('.country-map .mapboxgl-canvas-container | border-radius')).toBe(
      'var(--radius-sm)',
    )
  })

  /**
   * A popup that hangs outside the map is a *earlier* sibling's descendant to the card below it,
   * so without an order of its own the next card's surface paints straight over it. Mapbox
   * declares none.
   */
  it('gives the popup a stacking order, since it now overlaps the card below', () => {
    expect(Number(declaration('.map-popup-shell | z-index'))).toBeGreaterThan(0)
  })
})

describe('the popup names what the mark covers', () => {
  /**
   * The chips are the shared `Badge`, reached through `badgeClassName` (DDR-0037, ADR-0008).
   *
   * Worth asserting because this is the one place in the app that builds its DOM imperatively —
   * `mapboxgl.Popup` owns its content element, so there is no JSX and no primitive to render, and
   * a hand-rolled `.map-popup-chip` family would have looked like the only option. It is not: the
   * primitive's contract is a *pure class composer*, which works here exactly as it does in JSX.
   */
  it('builds a chip from the primitive rather than a fourth chip family', () => {
    expect(MAP).toContain('badgeClassName(')
    expect(MAP).toContain("'map-popup-holding'")
    // A hand-rolled boundary or ink here would be the one-off Epic #125 consolidated away.
    expect(MAP).not.toMatch(/map-popup-(chip|tag|pill)/)
  })

  /**
   * The names arrive **on the report**, already decided. `countryDonuts` runs them through
   * `instrumentName`, which is where a description that merely repeats the symbol becomes `null`;
   * a view that shortened one itself would be reaching for `formatCompanyName`, and that is how
   * `CAD` became `Cad` (DDR-0066, DDR-0067).
   */
  it('never shortens a name of its own', () => {
    expect(MAP).toContain('holdings')
    expect(MAP).not.toContain('formatCompanyName')
    expect(MAP).not.toContain('instrumentName(')
  })

  /**
   * Sector names, countries and now instrument descriptions all originate from broker data, and
   * this popup is assembled by hand. `textContent` is the whole defence.
   */
  it('sets every string with textContent', () => {
    expect(MAP).not.toContain('innerHTML')
    expect(MAP).toMatch(/\.textContent = /)
  })

  /** The row exists in the stylesheet, and the two halves of a chip are separately inked. */
  it('has a rule behind the row and both halves of a chip', () => {
    expect(declaration('.map-popup-holdings | display')).toBe('flex')
    expect(declaration('.map-popup-holdings | flex-wrap')).toBe('wrap')
    expect(declaration('.map-popup-holding-symbol | color')).toBe('var(--text)')
    // Placement only, at two classes deep so it beats the size's own margin whatever the order.
    expect(declaration('.badge.map-popup-holding | margin-left')).toBe('0')
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
