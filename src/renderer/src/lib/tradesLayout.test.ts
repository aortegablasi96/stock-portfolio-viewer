import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The Trades view's composition (Story #193, DDR-0065).
 *
 * The view's *appearance* is the shared work of Stories #180–#188 and is guarded where it lives —
 * the badge's rules in `badgeVariants.test.ts`, the tones in `contrast.test.ts`, the scale in
 * `tokenAdoption.test.ts`. What this story decided, and what nothing else can see, is three
 * things, each of which fails as something that still renders:
 *
 * - the side badge is **toned from `sideVariant`**, and from nothing else. Story #257 reversed
 *   DDR-0065's untoned column (DDR-0086), which turns this guard around without weakening it:
 *   what fails is no longer *a* tone but a tone reached in this file — a literal `variant="…"`,
 *   or the `=== 'Buy'` branch the original guard was written for. The one branch lives in
 *   `tradeSide.ts`, where `tradeSide.test.ts` can assert the mapping itself rather than scan for
 *   it. `variant={toneOf(t.realizedBase)}` is the failure that would still type-check and render:
 *   it would say the side *is* the row's P&L, which is the reading DDR-0086 answers;
 * - the Realized P&L column's dash is **muted**, not neutral. `toneClassName` emits *no* class
 *   for a neutral figure, so the em dash inherits `--text` and reads at the weight of the figures
 *   around it — absent is a quieter thing than zero;
 * - the `Best` / `Worst` label takes the tone of **its own item's figure**, not of the card it
 *   labels. A "Worst" painted red unconditionally states a loss that a portfolio whose weakest
 *   position still gained did not make.
 *
 * The two FIFO rules the story warns a restyle must not disturb — the `Total (All Assets)`
 * aggregate row that doubles every total, and the flow/balance split that shipped 25% overstated
 * as Bug #103 — are deliberately **not** re-asserted here. `realizedGainsService.test.ts` already
 * pins both against constructed statements, which is a behavioural test rather than a text scan,
 * and a renderer test reaching across into `@services` to grep its source would be a weaker copy
 * of it on the wrong side of the layer boundary (ADR-0002).
 *
 * A text scan for the reason `analyticsShell.test.ts`, `chartGeometry.test.ts`,
 * `performanceLayout.test.ts`, `allocationLayout.test.ts` and `dividendsLayout.test.ts` are:
 * Vitest runs in Node with no jsdom, so no component may be rendered (DDR-0029). Comments are
 * stripped first — these components quote their own decisions in prose, and an assertion that
 * passes off the commentary alone is the trap DDR-0042 records and this suite has now hit eight
 * times.
 */
const strip = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const VIEW = strip(
  readFileSync(new URL('../components/analytics/TradeHistoryView.tsx', import.meta.url), 'utf8'),
)
const CSS = readFileSync(new URL('../app.css', import.meta.url), 'utf8')
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

describe('the trade side is a badge, toned from one mapping and nothing else', () => {
  it('renders the side through Badge rather than as bare text', () => {
    expect(VIEW).toMatch(/key: 'side',[\s\S]*?cell: \(t\) => \([\s\S]*?<Badge/)
    expect(VIEW).not.toMatch(/key: 'side',[\s\S]{0,120}cell: \(t\) => t\.side/)
  })

  /**
   * The decision Story #257 reversed (DDR-0086, superseding DDR-0065's side badge). The tone is
   * the side's own, taken from the module that holds the mapping — so this file asserts the
   * *route*, and `tradeSide.test.ts` asserts which tone each side gets.
   */
  it('takes its variant from sideVariant, applied to the side itself', () => {
    expect(VIEW).toMatch(
      /key: 'side',[\s\S]*?<Badge variant=\{sideVariant\(t\.side\)\} size="sm" className=\{BADGE_CELL_CLASS\}>/,
    )
    expect(VIEW).toContain("import { sideVariant } from '../../lib/tradeSide'")
  })

  /**
   * The guard that survives the reversal intact, because what it forbids never changed: a tone
   * decided *here*. A literal `variant="positive"` puts the mapping in two places, and
   * `variant={toneOf(t.realizedBase)}` would tone the side by the row's P&L — which is not a
   * different implementation of DDR-0086 but the misreading DDR-0086 exists to argue against,
   * rendered as fact.
   */
  it('never decides the colour in the view — no literal tone, no branch on the side', () => {
    expect(VIEW).not.toMatch(/=== 'Buy'|=== 'Sell'|side === /)
    expect(VIEW).not.toMatch(/variant=\{?['"](positive|negative|neutral|accent|plain)['"]/)
    expect(VIEW).not.toMatch(/key: 'side',[\s\S]{0,400}?<Badge[^>]*variant=\{toneOf/)
  })

  /**
   * The word stays inside the badge, so the column is legible with no hue at all (DDR-0021, still
   * governing). It is the same assertion that made DDR-0065's untoned column satisfy that rule by
   * construction; under DDR-0086 it is the rule's only remaining guarantee here, and therefore
   * load-bearing rather than incidental.
   */
  it('keeps the side written inside the badge, so colour is never the only channel', () => {
    expect(VIEW).toMatch(/<Badge variant=\{sideVariant\(t\.side\)\}[^>]*>\s*\{t\.side\}\s*<\/Badge>/)
  })

  /**
   * `sm` plus the cell placement, and both halves matter: `md`'s vertical padding puts a
   * `--text-xs` line above the `--text-sm` one beside it and grows every row, and `sm` alone
   * carries the gap from a value that is not there (DDR-0037, DDR-0064).
   */
  it('is the inline size in the cell placement, so no row grows', () => {
    expect(VIEW).toContain('size="sm" className={BADGE_CELL_CLASS}>')
    expect(VIEW).not.toMatch(/<Badge[^>]*size="md"/)
  })

  /** The badge is what the cell renders; the column still sorts on the value behind it. */
  it('leaves the column sorting on the side itself', () => {
    expect(VIEW).toMatch(/key: 'side',[\s\S]*?sortValue: \(t\) => t\.side/)
  })
})

describe('the Realized P&L column separates absent from zero', () => {
  /**
   * One predicate for all three. Written out three times it can drift into a column that tones a
   * row it renders as a dash, or sorts a dash in among the small gains.
   */
  it('asks one predicate for the tone, the text and the sort order', () => {
    expect(VIEW).toContain('function closedSomething(t: TradeRow): boolean')
    expect(VIEW).toContain('return t.realizedNative !== 0')
    expect(VIEW).toMatch(
      /closedSomething\(t\) \? toneClassName\(toneOf\(t\.realizedBase\)\) : 'data-table-dim'/,
    )
    expect(VIEW).toContain("cell: (t) => (closedSomething(t) ? sc(t.realizedBase) : '—')")
    expect(VIEW).toContain('sortValue: (t) => (closedSomething(t) ? t.realizedBase : null)')
  })

  /** An opening buy has no realized P&L, which is not zero: it sorts last, not in the middle. */
  it('hands the comparator null rather than zero for a trade that closed nothing', () => {
    expect(VIEW).not.toMatch(/sortValue: \(t\) => .*realizedBase : 0/)
  })

  /**
   * The dash is muted, and it has to be said explicitly: `toneClassName('neutral')` is the empty
   * string by design (DDR-0034), so an untoned cell keeps `--text`.
   */
  it('backs the dimmed cell with a rule, in the table’s own namespace', () => {
    expect(CSS).toMatch(/^\.data-table \.data-table-dim \{/m)
    expect(/^\.data-table \.data-table-dim \{([^}]*)\}/m.exec(CSS)?.[1] ?? '').toContain(
      'color: var(--muted)',
    )
  })

  /**
   * And there is exactly one such rule. `.flex-import-dim` did this job for the data-sources
   * table; a second copy under a second view's prefix is the half-done consolidation Epic #125
   * names as its own standing risk, so the rule moved rather than multiplied (DDR-0065).
   */
  it('leaves no second dimmed-cell rule behind', () => {
    expect(RULES).not.toContain('.flex-import-dim')
  })

  /** The figures keep their sign character, which is the channel the tone sits beside. */
  it('keeps the signed formatter on both the tiles and the cells', () => {
    expect(VIEW).toContain('formatSignedCurrency(v, r.baseCurrency)')
    expect(VIEW).toContain('formatSignedCurrency(v, baseCurrency)')
  })
})

describe('the Best/Worst cards are toned by their own figure', () => {
  /** Still a nested card at `sm` — the surface the story is explicit about keeping (DDR-0033). */
  it('stays a nested card rather than becoming a tile', () => {
    expect(VIEW).toContain('<Card as="div" variant="nested" size="sm">')
  })

  /**
   * One `toneOf` call feeds both the label and the figure, so the two cannot disagree, and the
   * card's *name* is not what picks the colour.
   */
  it('derives one tone from the item and gives it to the label and the figure', () => {
    expect(VIEW).toContain('const tone = toneOf(item.totalRealized)')
    expect(VIEW).toContain("toneClassName(tone, statPartClassName('label'))")
    expect(VIEW).toContain("toneClassName(tone, 'highlight-value')")
    expect(VIEW).not.toMatch(/label === 'Best'|label === 'Worst'/)
  })

  /**
   * The label composes the app's one micro-label with the two tone rules, rather than growing a
   * second label rule (DDR-0034). Source order is what settles the two `color` declarations, so
   * the tones must stay below `.stat-label` in the stylesheet.
   */
  it('declares the tones after the label they override', () => {
    const label = CSS.indexOf('\n.stat-label {')
    const positive = CSS.indexOf('\n.stat-positive {')
    const negative = CSS.indexOf('\n.stat-negative {')
    expect(label).toBeGreaterThan(-1)
    expect(positive).toBeGreaterThan(label)
    expect(negative).toBeGreaterThan(label)
  })

  /**
   * The ranking is read from the service's array, never from the table's view of it (Story #134):
   * re-sorting the table by short-term gain must not silently redefine "best".
   */
  it('takes best and worst from the report’s own order', () => {
    expect(VIEW).toContain('const best = bySymbol[0]')
    expect(VIEW).toContain('const worst = bySymbol.length > 1 ? bySymbol[bySymbol.length - 1]')
  })
})
