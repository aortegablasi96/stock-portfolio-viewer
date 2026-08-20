import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RANGE_OPTIONS } from './dateRange'

/**
 * What the Performance view does with its one range selection (Story #190).
 *
 * The view's *appearance* is the shared work of Stories #180–#188 — typefaces, palette, card and
 * table density, KPI tiles, the chart language — and each of those is guarded where it lives.
 * What a restyle can quietly take with it is the plumbing underneath, and every one of the four
 * charts is drawn from a series that is windowed a *different* way on purpose:
 *
 * - the value curve is **sliced** (DDR-0013 — it is a value curve, and rebasing one is a
 *   different decision from rebasing a return curve),
 * - the return curve is sliced **and rebased**, so it opens at 0% and closes on the tile beside
 *   it (Story #169),
 * - the daily bars are chain-linked from the **unwindowed** cumulative curve (DDR-0049,
 *   DDR-0052), so the window's opening bar measures against the day that really preceded it,
 * - composition is sliced and **never** rebased or carried forward, because each point is a
 *   simultaneous observation of every band (DDR-0052).
 *
 * `lib/dailyReturns` and `lib/performanceRange` test that maths. Nothing tested that the *view*
 * hands each function the series it is owed — which is the half a restyle touches, and the half
 * that draws a wrong picture rather than throwing. A deposit differenced out of `valueSeries`
 * plots as a spectacular day; a daily bar taken off the *sliced* curve opens against a synthetic
 * edge point. Both are plausible, both look like data.
 *
 * A text scan for the same reason `analyticsShell.test.ts` and `chartGeometry.test.ts` are:
 * Vitest runs in Node with no jsdom, so no component may be rendered (DDR-0029).
 */

/**
 * The view with its comments removed. The prose above each of these lines names the very calls
 * being searched for — `sliceSeries`, `rebaseSeries`, "unwindowed" — so a raw scan would pass off
 * the commentary alone. This is the trap DDR-0042 records for `app.css`, and it has now bitten
 * five times.
 */
const VIEW = readFileSync(
  new URL('../components/analytics/PerformanceView.tsx', import.meta.url),
  'utf8',
)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

describe('one range selection reframes all four charts', () => {
  /**
   * The point of the grid (DDR-0051): four charts under one `RangeFilter` is one selection, not
   * four. Each chart's input is derived from the same `bounds`, so a chart that stopped reading
   * it would be showing a different period from the three beside it — with nothing on the page
   * to say so.
   */
  it('derives every chart’s series from the one resolved window', () => {
    expect(VIEW).toContain('const bounds = extent ? boundsFor(range, extent, customBounds) : null')
    for (const series of ['valueSeries', 'returnSeries', 'dailyPoints', 'compositionPoints']) {
      const declaration = VIEW.match(new RegExp(`const ${series} =[^\\n]*(\\n[^\\n]*){0,2}`))
      expect(declaration?.[0], `${series} is not windowed by bounds`).toContain('bounds')
    }
  })

  it('holds the selection above the shell, which holds no state of its own', () => {
    expect(VIEW).toContain('const { range, setRange, custom, editCustom } = useRangeSelection()')
    expect(VIEW).toMatch(/<AnalyticsShell<PerformanceReport>/)
  })
})

describe('each series is windowed the way its own chart needs', () => {
  it('slices the value curve without rebasing it (DDR-0013)', () => {
    expect(VIEW).toContain('bounds ? sliceSeries(r.valueSeries, bounds) : r.valueSeries')
  })

  it('rebases the return curve, so it opens at 0% and closes on its tile', () => {
    expect(VIEW).toContain('bounds ? rebaseSeries(r.returnSeries, bounds) : r.returnSeries')
  })

  /**
   * The one that matters most and reads as a typo. `dailyReturns` takes the report's **own**
   * `returnSeries` and the bounds *separately* — it chain-links off the unwindowed curve and
   * windows the bars afterwards. Handing it the local `returnSeries` (sliced and rebased) would
   * type-check, render, and silently measure the opening bar against a synthetic edge point.
   */
  it('chain-links the daily bars from the unwindowed cumulative curve (DDR-0049, DDR-0052)', () => {
    expect(VIEW).toContain('dailyReturns(r.returnSeries, bounds ?? undefined)')
    expect(VIEW).not.toMatch(/dailyReturns\(\s*returnSeries/)
    // And never from the value curve, where a deposit draws as a spectacular day.
    expect(VIEW).not.toMatch(/dailyReturns\(\s*r?\.?valueSeries/)
  })

  it('slices composition and never rebases or carries it forward (DDR-0052)', () => {
    expect(VIEW).toContain('sliceComposition(r.compositionSeries.points, bounds)')
    expect(VIEW).not.toMatch(/rebaseSeries\(\s*r\.compositionSeries/)
  })

  /**
   * The stack's top edge is `point.total` — IBKR's own NAV for the day — which is what makes the
   * bands amounts rather than proportions. The view passes the report's points through
   * untouched; the cumulative stacking is `lib/composition`'s, where it is unit-tested against
   * zero NAV and negative bands.
   */
  it('hands the bands and points to the chart rather than restacking them here', () => {
    expect(VIEW).toContain('const compositionBands = r.compositionSeries.bands')
    expect(VIEW).not.toContain('reduce')
  })
})

describe('a chart is named the same thing in every range (Story #221)', () => {
  /**
   * The four titles the redesign gives the grid, in the order the view renders them. Written out
   * rather than counted: the point of the story is that these exact strings are what the reader
   * sees whichever range is selected, so the assertion has to be the strings themselves.
   */
  const TITLES = [
    'Portfolio value over time',
    'Performance change over time',
    'Daily return',
    'Composition over time',
  ]

  /** Each `<ChartCard …>` opening tag's props — the definition below is `function ChartCard(`. */
  const cardProps = [...VIEW.matchAll(/<ChartCard\b([\s\S]*?)>/g)].map((m) => m[1] ?? '')

  it('gives every chart card a literal title, never an expression', () => {
    expect(cardProps).toHaveLength(TITLES.length)
    for (const props of cardProps) {
      expect(props, 'a chart card title is computed rather than written').not.toMatch(/title=\{/)
    }
    expect(cardProps.map((p) => p.match(/title="([^"]+)"/)?.[1])).toEqual(TITLES)
  })

  /**
   * The specific wording that used to appear under every range but `all`, and the binding that
   * chose between the two. Both named, because a later story could reintroduce either half alone.
   */
  it('has no range-dependent wording left to fall back to', () => {
    expect(VIEW).not.toContain('Performance change over the selected period')
    expect(VIEW).not.toContain('returnChartTitle')
  })

  /**
   * The half that would be quietly lost by deleting the conditional and stopping there. Rebasing
   * is invisible on an axis (Story #169), so it is disclosed twice — once visibly in the card
   * header for the sighted reader, once at length in the chart's accessible name — and neither is
   * the card's title. `BaselineNote` takes no props, which is what makes it unconditional.
   */
  it('still states the baseline the removed wording carried', () => {
    expect(VIEW).toContain('aside={<BaselineNote />}')
    expect(VIEW).toMatch(/function BaselineNote\(\): React\.JSX\.Element \{/)
    expect(VIEW).toContain('0% at period start')
    expect(VIEW).toMatch(/returnChartLabel[\s\S]{0,240}from 0% at the start of the/)
  })

  /**
   * DDR-0051's equality: four cards of one header plus one bare `<svg>`. The note lands in the
   * header the legend already lives in, so nothing about the height changes — but it changes by
   * *construction* only for as long as every card still goes through the one `CardHeader`.
   */
  it('keeps all four cards on the one header, aside or not', () => {
    expect(VIEW.match(/<CardHeader\b/g)).toHaveLength(1)
    expect(VIEW).toMatch(
      /<CardHeader align="center" className="chart-card-header">\s*<CardTitle>\{title\}<\/CardTitle>\s*\{aside\}\s*<\/CardHeader>/,
    )
  })
})

describe('the Custom range is the RangeFilter’s own, not a fifth control', () => {
  /**
   * DDR-0017 and DDR-0035 settled this before the redesign proposed it: `Custom` is one of the
   * presets, and choosing it reveals the two `Field` + `DateInput` edges inside the same
   * `RangeFilter`. The prototype draws a fifth pill beside `1M / 3M / 1Y / All`, which is what
   * this already is — so the reconciliation is that nothing is added, and this is what would
   * fail if a second custom-range control appeared beside the first.
   */
  it('is the fifth preset of the one shared vocabulary', () => {
    expect(RANGE_OPTIONS.map((o) => o.id)).toEqual(['1m', '3m', '1y', 'all', 'custom'])
  })

  it('renders exactly one RangeFilter, and no date input of its own', () => {
    expect(VIEW.match(/<RangeFilter\b/g)).toHaveLength(1)
    expect(VIEW).not.toContain('<DateInput')
    expect(VIEW).not.toContain('<Field')
  })

  /**
   * The `RangeFilter` pairs its labels through `Field`, which mints its id with `useId()` and
   * takes none. All three views carrying one can be mounted at once (DDR-0027), so a fixed id
   * would name only whichever landed in the document first.
   */
  it('leaves the date inputs’ identity to Field', () => {
    const filter = readFileSync(
      new URL('../components/analytics/RangeFilter.tsx', import.meta.url),
      'utf8',
    )
    expect(filter).toMatch(/<Field label="From">\s*\{\(id\) => \(/)
    expect(filter).not.toMatch(/<Field[^>]*\sid=/)
  })
})
