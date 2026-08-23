import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { stripComments } from './cssDeclarations'

/**
 * The Dividends view's composition (Story #192, DDR-0064).
 *
 * The view's *appearance* is the shared work of Stories #180–#188 and is guarded where it lives —
 * the badge's rules in `badgeVariants.test.ts`, the tones in `contrast.test.ts`, the scale in
 * `tokenAdoption.test.ts`. What this story decided, and what nothing else can see, is three
 * things, each of which fails as something that still renders:
 *
 * - the transaction type is a **badge whose tone comes from the row's own amount**, not from a
 *   list of type strings. Matching on `'Withholding Tax'` type-checks, renders, and paints a
 *   reversal or a renamed fee in the gain tone with nothing to notice;
 * - the badge is `sm` **in the cell placement**, because `md`'s vertical padding is what grows
 *   every row of a 200-row table — the trap DDR-0037's size axis exists for, arriving from the
 *   other direction;
 * - the stack's key moved into the **card header**, so `ColumnChart` emits a bare `<svg>`. A
 *   `<figcaption>` growing back under the plot is invisible to every other test in the suite,
 *   which is exactly what `chartGeometry.test.ts` says about the three charts it guards.
 *
 * It also pins the two data rules a restyle must not disturb (DDR-0010, DDR-0005), because both
 * are one prop-drop away from a view that looks right and says something false.
 *
 * A text scan for the reason `analyticsShell.test.ts`, `chartGeometry.test.ts`,
 * `performanceLayout.test.ts` and `allocationLayout.test.ts` are: Vitest runs in Node with no
 * jsdom, so no component may be rendered (DDR-0029). Comments are stripped first — these
 * components quote their own decisions in prose, and an assertion that passes off the commentary
 * alone is the trap DDR-0042 records and this suite has now hit seven times.
 */
const strip = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const VIEW = strip(
  readFileSync(new URL('../components/analytics/DividendsView.tsx', import.meta.url), 'utf8'),
)
const COLUMN_CHART = strip(
  readFileSync(new URL('../components/charts/ColumnChart.tsx', import.meta.url), 'utf8'),
)
/** Story #241's half of the decision that lives in the stylesheet. Comments stripped, as above. */
const CSS = stripComments(readFileSync(new URL('../app.css', import.meta.url), 'utf8'))

describe('the transaction type is a toned badge', () => {
  it('renders the type through Badge rather than as bare text', () => {
    expect(VIEW).toMatch(/key: 'type',[\s\S]*?cell: \(e\) => \([\s\S]*?<Badge/)
    expect(VIEW).not.toMatch(/key: 'type',[\s\S]{0,120}cell: \(e\) => e\.type/)
  })

  /**
   * The polarity comes from the amount. A type-string branch is the version that passes review
   * and ships wrong: three types are known today and the tone has to be right for the fourth.
   */
  it('takes its tone from the row’s signed amount, never from the type string', () => {
    expect(VIEW).toContain('variant={toneOf(e.amountBase)}')
    expect(VIEW).not.toMatch(/'Withholding Tax'|'Dividends'|includes\('Tax'\)/)
  })

  /**
   * `sm` plus the cell placement, and both halves matter: `md` grows the row, and `sm` alone
   * carries the gap from a value that is not there, setting the column's only element in from
   * its own header.
   */
  it('is the inline size in the cell placement, so the row height is unchanged', () => {
    expect(VIEW).toMatch(/<Badge variant=\{toneOf\(e\.amountBase\)\} size="sm" className=\{BADGE_CELL_CLASS\}>/)
  })

  /** Tone is never the only channel: the badge's text is still the type's own name. */
  it('still names the type inside the badge', () => {
    expect(VIEW).toMatch(/<Badge[^>]*>\s*\{e\.type\}\s*<\/Badge>/)
  })

  /** A badge is what the cell renders; the column still sorts on the value behind it. */
  it('leaves the column sorting on the type itself', () => {
    expect(VIEW).toMatch(/key: 'type',[\s\S]*?sortValue: \(e\) => e\.type/)
  })

  /** The signed base-currency column is toned by the same call, and keeps its sign character. */
  it('tones the base-currency column from the same amount', () => {
    expect(VIEW).toContain('cellClassName: (e) => toneClassName(toneOf(e.amountBase))')
    expect(VIEW).toMatch(/key: 'amountBase',[\s\S]*?cell: \(e\) => c\(e\.amountBase\)/)
  })
})

describe('the pair’s key sits in the card header', () => {
  it('renders IncomeLegend inside the income card’s CardHeader', () => {
    expect(VIEW).toMatch(/<CardHeader className="chart-card-header">[\s\S]*?<IncomeLegend[\s\S]*?<\/CardHeader>/)
  })

  /**
   * Nothing under the plot. The same assertion `chartGeometry.test.ts` makes about the grid's
   * three charts, for the same reason — a wrapper growing back changes the card's height and
   * nothing else in the suite would notice.
   */
  it('leaves ColumnChart emitting a bare svg', () => {
    expect(COLUMN_CHART).not.toMatch(/<figure/)
    expect(COLUMN_CHART).not.toMatch(/<figcaption/)
    expect(COLUMN_CHART.match(/<svg\b/g)).toHaveLength(1)
  })

  /**
   * The key and the hover card are handed the same constants, so a legend cannot come to name one
   * thing while the column under the pointer names another.
   *
   * **#236 renamed all three and #241 made the chart draw them** (DDR-0077, DDR-0078). The guard
   * exists precisely so that cannot be done by halves: the key first named the two *segments* of a
   * stack, leaving the column's own height — the gross — named nowhere the reader could see, and
   * then named the column while the chart still drew the net. Both bars are named now and both are
   * drawn. Renaming one of the three and not the others is the drift this catches; deleting the
   * test is not a way to pass it.
   */
  it('names the three parts once, for both the key and the hover card', () => {
    expect(VIEW).toContain("const INCOME_GROSS_LABEL = 'Gross'")
    expect(VIEW).toContain("const INCOME_TAX_LABEL = 'Withholding tax'")
    expect(VIEW).toContain("const INCOME_NET_LABEL = 'Net'")
    // Two swatches for two bars, and the same two labels reaching the chart.
    expect(VIEW).toMatch(
      /<IncomeLegend\s*\n\s*primaryLabel=\{INCOME_GROSS_LABEL\}\s*\n\s*secondaryLabel=\{INCOME_TAX_LABEL\}\s*\n\s*\/>/,
    )
    expect(VIEW).toMatch(
      /primaryLabel=\{INCOME_GROSS_LABEL\}\s*\n\s*secondaryLabel=\{INCOME_TAX_LABEL\}\s*\n\s*differenceLabel=\{INCOME_NET_LABEL\}/,
    )
    // A literal here is how the card and the key drifted apart in the first place.
    expect(VIEW).not.toMatch(/(primary|secondary|difference)Label="/)
  })

  /**
   * The view hands over the report's **own** two figures. `lower: m.netBase` is the mapping #241
   * removed — the chart drew the net and the key called the column gross, which is the whole of
   * the ambiguity the pair resolves. Net is derived where it is displayed.
   */
  it('plots the report’s gross and withholding, not a net it has to re-derive', () => {
    expect(VIEW).toMatch(/primary: m\.grossBase,\s*\n\s*secondary: m\.withholdingBase,/)
    expect(VIEW).not.toContain('lower: m.netBase')
  })

  /** The chart still states its own full name, and it states the new one (DDR-0052's note). */
  it('updates the chart’s aria-label to the naming the key uses', () => {
    expect(VIEW).toMatch(/ariaLabel="Gross dividend income and withholding tax by month[^"]*"/)
    expect(VIEW).not.toContain('stacked at the top of each column')
  })

  /**
   * The income card carries **no** chart source note (Story #247), and this is the assertion that
   * used to pin its wording. It is replaced rather than deleted, because what it was really
   * guarding is that the horizontal scroll is *disclosed* — the plot holds the only copy of the
   * older months, and before #247 the paragraph was where a reader was told so.
   *
   * The disclosure moved into the scroll region's own accessible name, which is the better home
   * for it: a `role="group"` with `tabIndex={0}` announces its label at the moment a keyboard
   * reader arrives at the region, where the paragraph announced it to whoever happened to read
   * the card top to bottom. Losing both at once is the failure this test now catches.
   */
  it('drops the chart’s prose note but keeps the scroll disclosed', () => {
    // The paragraph and every sentence of it are gone.
    expect(VIEW).not.toContain('two columns on the same baseline')
    expect(VIEW).not.toContain('a column keeps its')
    expect(VIEW).not.toMatch(/<p className="source-note">\s*\n\s*Each month/)
    // …and the scroll is still named, in the region's own label.
    expect(VIEW).toMatch(/ariaLabel="[^"]*Scroll sideways[^"]*"/)
  })

  /**
   * The other two notes annotate a panel and a table, not a plot. The Performance precedent this
   * story follows is about charts competing with their own prose, so it reaches neither of them —
   * and a later sweep that took all three would be going further than #247 decided.
   */
  it('leaves the upcoming and transactions notes alone', () => {
    expect(VIEW.match(/className="source-note"/g)).toHaveLength(2)
  })

  /**
   * `ColumnChart` stays its own component (DDR-0052). It plots two series a month, legends them
   * and labels every month; `BarChart` does none of the three, and folding them together would
   * mean conditioning all of it on flags — the fork-wearing-a-shared-name its header describes.
   */
  it('keeps the paired chart separate from the daily-return bars', () => {
    expect(VIEW).toContain("from '../charts/ColumnChart'")
    expect(VIEW).not.toContain('BarChart')
    expect(COLUMN_CHART).toContain('primary')
    expect(COLUMN_CHART).toContain('secondary')
  })
})

/**
 * Two columns on one baseline, and the plot that scrolls (Story #241, DDR-0078).
 *
 * The stack is the thing that must not come back, and nothing else in the suite can see it: a
 * `y` computed from `lower + upper` renders, type-checks, and draws a chart whose key describes
 * something else. What is asserted here is the *shape* — two rects a month, both anchored on the
 * zero line — plus the two halves of the width decision, which only work as a pair.
 */
describe('a month is two columns on one baseline', () => {
  it('draws two bars a month, neither stacked on the other', () => {
    expect(COLUMN_CHART).toContain('className="chart-bar-primary"')
    expect(COLUMN_CHART).toContain('className="chart-bar-secondary"')
    // Both heights are measured from the baseline. A `y(c.lower)`-relative height is the stack.
    expect(COLUMN_CHART).toContain('height={zeroY - y(c.primary)}')
    expect(COLUMN_CHART).not.toMatch(/chart-bar-(lower|upper)/)
  })

  /**
   * The secondary hangs **below** the line (Story #246). Anchored at `zeroY` with its height
   * running down to `y(-c.secondary)` — the negation is on the *series*, applied here at the one
   * place it is drawn, and never on the figure, which stays a magnitude all the way from the
   * report. A `y(c.secondary)`-anchored rect is #241's upward bar and the thing that must not
   * come back.
   */
  it('hangs the secondary below the baseline, negated by series and not by value', () => {
    expect(COLUMN_CHART).toMatch(/y=\{zeroY\}[\s\S]*?height=\{y\(-c\.secondary\) - zeroY\}/)
    expect(COLUMN_CHART).not.toContain('height={zeroY - y(c.secondary)}')
  })

  /**
   * A month with nothing on one side draws nothing there — absent, not a zero-height mark sitting
   * on the line, which is `pairedTooltipRows`' rule for the card's rows applied to the plot.
   */
  it('omits a bar it has no figure for, rather than drawing it flat', () => {
    expect(COLUMN_CHART).toContain('{c.primary > 0 && (')
    expect(COLUMN_CHART).toContain('{c.secondary > 0 && (')
  })

  /**
   * `pairedDomain` owns the span, and the two extremes come from different series — so a month
   * whose only entry is withholding still scales the plot correctly at both ends.
   */
  it('takes its axis from the paired domain, not the stacked one', () => {
    expect(COLUMN_CHART).toContain('pairedDomain(columns)')
    expect(COLUMN_CHART).not.toContain('columnDomain(columns)')
  })

  /**
   * Story #49's month is drawn again, but not by Story #49's mechanism: the withholding series is
   * what reaches below the line, so there is no separate loss-toned *net* bar and no class for one.
   * `.chart-bar-secondary` is already `--neg`, and a second downward mark would be the third bar
   * DDR-0078 refused.
   */
  it('paints below the baseline without reviving the loss bar', () => {
    expect(COLUMN_CHART).not.toContain('chart-bar-loss')
  })

  /**
   * The two halves of the width decision. A pixel width with nothing to fill against leaves a short
   * history floating in the middle of its card (DDR-0018 rejected that on sight); the fill without
   * the pixel width is the behaviour this story replaced. Neither is useful alone, so both are
   * pinned — the fill was `min-width: 100%` until Story #243 gave the plot a flex sibling.
   */
  it('sizes the plot in pixels and lets a short history still fill its card', () => {
    expect(COLUMN_CHART).toContain('columnPlotWidthPx(plot)')
    expect(CSS).toMatch(/\.chart-scroll \.chart\s*\{\s*flex:\s*1 0 auto/)
  })

  /**
   * A scroll region reachable only by mouse hides the older months from a keyboard reader
   * (WCAG 2.1.1). It declares no focus rule of its own — the `:where(...)` base rule rings it.
   */
  it('scrolls sideways from a named, keyboard-reachable wrapper', () => {
    expect(CSS).toMatch(/\.chart-scroll\s*\{[^}]*overflow-x:\s*auto/)
    expect(COLUMN_CHART).toMatch(
      /<div className="chart-scroll" tabIndex=\{0\} role="group" aria-label=\{ariaLabel\}>/,
    )
    expect(CSS).not.toMatch(/\.chart-scroll[^{]*\{[^}]*outline:/)
  })
})

/**
 * The value axis stays on screen while the plot scrolls (Story #243, DDR-0079).
 *
 * The failure this guards is silent in a way the last two were not: the labels are HTML and the
 * gridlines are SVG, so the two can drift apart and both still render. Three things hold them
 * together and none is visible from a test that cannot lay out a page (DDR-0029) — so what is
 * asserted is that each is present, and the arithmetic is checked in `column.test.ts`.
 */
describe('the value axis does not scroll with the plot', () => {
  /** Out of the `<svg>` entirely: `<text>` inside it moves when the plot moves. */
  it('renders the ticks as HTML, and leaves only the month labels in the plot', () => {
    expect(COLUMN_CHART).toContain('className="chart-axis"')
    // The figures that used to be drawn at `PAD.left - 8` are gone from the plot; the month
    // labels are the only `.chart-axis-label` left, and they scroll with the months they name.
    expect(COLUMN_CHART).not.toContain('x={PAD.left - 8}')
    expect(COLUMN_CHART.match(/className="chart-axis-label"/g)).toHaveLength(1)
  })

  /**
   * **Sticky, and inside the scroller.** Both halves are load-bearing and the second is the one
   * that is easy to get wrong: a tick is placed on a share of the gutter's height, and stretched
   * to a flex line *inside* the scroller the gutter is exactly as tall as the `<svg>` — a
   * horizontal scrollbar sits outside the content box a percentage resolves against. Beside the
   * scroller instead, the labels measured exact at rest and ~15px low the moment the plot was long
   * enough to scroll, which is the only time the axis has a job to do.
   */
  it('sticks to the scroller’s left edge from inside it, so the plot slides under it', () => {
    expect(CSS).toMatch(/\.chart-scroll\s*\{[^}]*display:\s*flex/)
    expect(CSS).toMatch(/\.chart-axis\s*\{[^}]*position:\s*sticky[^}]*left:\s*0/)
    // Inside: the scroll container opens first, and the gutter is its first child.
    expect(COLUMN_CHART).toMatch(
      /<div className="chart-scroll"[^>]*>[\s\S]*?<div className="chart-axis"/,
    )
    // The plot slides *under* it, so it needs ground of its own — the surface it is drawn on.
    expect(CSS).toMatch(/\.chart-axis\s*\{[^}]*background:\s*var\(--card\)/)
  })

  /**
   * `flex-grow` fills what the gutter leaves, which a percentage of the container cannot; and
   * `flex-shrink: 0` is what keeps the plot scrolling rather than being squeezed back to the card,
   * which would put it straight back to spending legibility on its history.
   */
  it('lets the plot fill what the gutter leaves, and never shrink to fit', () => {
    expect(CSS).toMatch(/\.chart-scroll \.chart\s*\{\s*flex:\s*1 0 auto/)
    expect(CSS).not.toMatch(/\.chart-scroll \.chart\s*\{[^}]*min-width:/)
  })

  /** The offset is data, derived from the same `y` the gridlines use, and never a length. */
  it('places each tick on a percentage of the plot’s height, from the chart’s own mapping', () => {
    expect(COLUMN_CHART).toContain('axisTicks(ticks, plot, y)')
    expect(COLUMN_CHART).toContain('top: `${tick.topPercent}%`')
    expect(CSS).toMatch(/\.chart-axis-tick\s*\{[^}]*position:\s*absolute/)
  })

  /**
   * The column is as wide as its widest figure because an element in flow measures it. A hand-set
   * width is DDR-0051 §#190's failure — an allowance cut for eight characters against labels that
   * render ten — and this makes it unexpressible rather than documented.
   */
  it('sizes its column from the widest label the browser measures, not from a constant', () => {
    expect(COLUMN_CHART).toContain('className="chart-axis-sizer"')
    expect(CSS).toMatch(/\.chart-axis-sizer\s*\{\s*visibility:\s*hidden/)
    expect(CSS).not.toMatch(/\.chart-axis\s*\{[^}]*width:/)
  })

  /**
   * Now that it is page type rather than a `viewBox` unit it takes a scale step, and it joins the
   * figure role's **existing** selector list — `lib/figureRole.ts` throws if a second rule applies
   * it (DDR-0053).
   */
  it('takes the type scale and the figure role, in one rule', () => {
    expect(CSS).toMatch(
      /\.chart-axis-sizer,\s*\n\.chart-axis-tick\s*\{[^}]*font-size:\s*var\(--text-2xs\)/,
    )
    expect(CSS).toMatch(
      /\.chart-axis-sizer,\s*\n\.chart-axis-tick,[\s\S]{0,80}\{\s*font-family:\s*var\(--font-figure\)/,
    )
  })

  /** The chart is a named `role="img"` and its figures are in the tables below. */
  it('hides the gutter from the accessibility tree', () => {
    expect(COLUMN_CHART).toMatch(/<div className="chart-axis" aria-hidden="true">/)
  })
})

/**
 * The hover card, and the native `<title>` it replaced (Story #236, DDR-0077).
 *
 * `ColumnChart` was the last chart in the app on a `<title>`; the three in the Performance grid
 * moved to the shared card in #188 and #220. None of what follows can be observed under Node — the
 * card is a `<g>` nothing here renders (DDR-0029) — so the arithmetic is checked in
 * `column.test.ts` and what is checked here is that the component actually reaches for it.
 */
describe('the income columns are read by pointing at them', () => {
  /**
   * Both halves matter. A `<title>` left behind floats a slow native tooltip *over* the card that
   * already answered the question — the note `BarChart` has carried since #170, arriving here.
   */
  it('raises the shared card and leaves no native tooltip behind', () => {
    expect(COLUMN_CHART).toContain('<ChartTooltip')
    expect(COLUMN_CHART).not.toMatch(/<title>/)
  })

  /**
   * The card is laid out against **this** chart's plot. The three it was written for share one
   * fixed `viewBox`; this one is as long as its history, so a card defaulting to the Performance
   * geometry would flip sides at the wrong x and clamp to an edge that is not there.
   */
  it('lays the card out in the plot the chart is actually drawn in', () => {
    expect(COLUMN_CHART).toContain('columnPlot(columns.length)')
    expect(COLUMN_CHART).toMatch(/<ChartTooltip[\s\S]*?plot=\{plot\}/)
    // Not the grid's geometry: ColumnChart is not in that grid (DDR-0018, chartGeometry.test.ts).
    expect(COLUMN_CHART).not.toContain('PERFORMANCE_PLOT')
  })

  /**
   * The band, not the bar — the pair's whole band, so the gap between the two bars of one month
   * reads that month rather than nothing. It also survives the scroll: `getBoundingClientRect` is
   * the rendered box, so it already carries the scroll offset and the arithmetic is unchanged.
   */
  it('hit-tests the month’s band, the way the daily-return bars do', () => {
    expect(COLUMN_CHART).toContain('bandIndexAt(vbX, PAD.left, plotW, columns.length)')
    expect(COLUMN_CHART).toContain('svg.getBoundingClientRect()')
    expect(COLUMN_CHART).toMatch(/onMouseLeave=\{\(\) => setHover\(null\)\}/)
  })

  /** The absent row and the sign tone are one function, so no caller can implement half of them. */
  it('builds its rows through the shared helper rather than inline', () => {
    expect(COLUMN_CHART).toContain('pairedTooltipRows(')
    expect(COLUMN_CHART).toMatch(
      /\{ primary: primaryLabel, secondary: secondaryLabel, difference: differenceLabel \}/,
    )
  })

  /** Pointer-only, as the other three are — and the figures stay in the tables below regardless. */
  it('keeps the chart an img with a name of its own', () => {
    expect(COLUMN_CHART).toContain('role="img"')
    expect(COLUMN_CHART).toContain('aria-label={ariaLabel}')
  })
})

/**
 * The two data rules the restyle must not disturb. Both are one edit away from a view that still
 * renders and now says something false.
 */
describe('the upcoming-dividends panel still degrades rather than failing', () => {
  /** An export without `OpenDividendAccruals` is an empty list plus the instruction (DDR-0010). */
  it('keeps the instructional copy in a StatePanel, with the section check in front of it', () => {
    expect(VIEW).toContain('!upcoming.sectionPresent')
    expect(VIEW).toMatch(/!upcoming\.sectionPresent \? \(\s*<StatePanel surface="inline">/)
    expect(VIEW).toContain('Open Dividend Accruals')
  })

  /**
   * `role` stays derived from the variant (DDR-0038). A `role` written at this call site is the
   * drift: three panels on one view, and only the primitive knows which state announces.
   */
  it('never writes a role at the call site', () => {
    expect(VIEW).not.toMatch(/<StatePanel[^>]*\brole=/)
  })

  /**
   * The empty-section state and the genuinely-empty state stay distinct. Collapsing them reads as
   * "no income is coming" when the truth is "the query does not export that section".
   */
  it('distinguishes an absent section from an empty one', () => {
    expect(VIEW).toContain('upcoming.items.length === 0')
    expect(VIEW).toContain('No announced dividends are pending')
  })

  /** The as-of date is the latest statement's end date, so a stale import is visible (DDR-0005). */
  it('still reports what the accruals are as of', () => {
    expect(VIEW).toContain('upcoming.asOf')
  })
})

describe('the transactions table still composes its three axes', () => {
  /** The period narrows, the chips narrow that, the table reorders what survives (DDR-0017). */
  it('filters by range and then by type, and counts what survives both', () => {
    expect(VIEW).toContain('const inRange = filterByRange(events, (e) => e.date, bounds)')
    expect(VIEW).toContain('const rows = filterByTypes(inRange, (e) => e.type, selected)')
    expect(VIEW).toMatch(/shown=\{rows\.length\}\s*\n\s*total=\{events\.length\}/)
  })

  /** The chips stay derived from *all* events, so narrowing the period never removes one. */
  it('derives the type chips from every event, not from the filtered rows', () => {
    expect(VIEW).toContain('const types = distinctTypes(events, (e) => e.type)')
  })
})
