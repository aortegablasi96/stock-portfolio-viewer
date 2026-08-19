import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

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

describe('the stack’s key sits in the card header', () => {
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
   * The key and the tooltips are handed the same two constants, so a legend cannot come to name
   * one thing while the segment under the pointer names another.
   */
  it('names the two series once, for both the key and the tooltip', () => {
    expect(VIEW).toContain("const INCOME_NET_LABEL = 'Net received'")
    expect(VIEW).toContain("const INCOME_TAX_LABEL = 'Withholding tax'")
    expect(VIEW).toMatch(/<IncomeLegend lowerLabel=\{INCOME_NET_LABEL\} upperLabel=\{INCOME_TAX_LABEL\} \/>/)
    expect(VIEW).toMatch(/lowerLabel=\{INCOME_NET_LABEL\}\s*\n\s*upperLabel=\{INCOME_TAX_LABEL\}/)
  })

  /**
   * `ColumnChart` stays its own component (DDR-0052). It stacks two series, legends them and
   * labels every column; `BarChart` does none of the three, and folding them together would mean
   * conditioning all of it on flags — the fork-wearing-a-shared-name that component's own header
   * describes.
   */
  it('keeps the stacked chart separate from the daily-return bars', () => {
    expect(VIEW).toContain("from '../charts/ColumnChart'")
    expect(VIEW).not.toContain('BarChart')
    expect(COLUMN_CHART).toContain('lower')
    expect(COLUMN_CHART).toContain('upper')
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
