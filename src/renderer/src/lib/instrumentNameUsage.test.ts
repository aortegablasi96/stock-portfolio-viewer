import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * One instrument name across every view that draws one (Story #211, DDR-0066).
 *
 * `format.test.ts` proves that `instrumentName` decides correctly. What it cannot see is whether
 * the views *ask* it — and that is the whole story: the function existed and worked before #211,
 * and three of seven cells called it while four rendered the raw description, so the same holding
 * read `Serabi Gold` on Dividends and `SERABI GOLD PLC` on Trades. Nothing failed. The defect was
 * a call site that did not call.
 *
 * So this scans every analytics view for the two ways of drawing that line and asserts there is
 * only one left. It is written against the **directory**, not a list of three files, because a
 * fourth view added later is exactly the case a hand-listed test would miss.
 *
 * `.flex-import-file` outside `components/analytics/` is untouched and deliberately out of scope:
 * `DataSources.tsx` uses it for what it was named after, an imported statement's filename, which
 * is not an instrument and has no symbol to repeat.
 *
 * A text scan for the reason `analyticsShell.test.ts`, `dividendsLayout.test.ts` and
 * `tradesLayout.test.ts` are: Vitest runs in Node with no jsdom, so no component may be rendered
 * (DDR-0029). Comments are stripped first — `InstrumentName.tsx` and the views quote their own
 * decisions in prose, and an assertion that passes off the commentary alone is the trap DDR-0042
 * records and this suite has now hit nine times.
 */
const strip = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const DIR = new URL('../components/analytics/', import.meta.url)

const VIEWS = readdirSync(DIR)
  .filter((f) => f.endsWith('.tsx') && f !== 'InstrumentName.tsx')
  .map((f) => ({ file: f, source: strip(readFileSync(new URL(f, DIR), 'utf8')) }))

const COMPONENT = strip(readFileSync(new URL('InstrumentName.tsx', DIR), 'utf8'))

describe('the instrument name has exactly one implementation', () => {
  it('finds the analytics views at all, so an empty scan cannot pass', () => {
    expect(VIEWS.length).toBeGreaterThan(5)
  })

  /**
   * The line is `InstrumentName`'s to draw. A view that emits the class itself is the state this
   * story ended: four cells doing by hand what three did through a helper.
   */
  it.each(VIEWS.map((v) => v.file))('%s does not draw the name line itself', (file) => {
    const view = VIEWS.find((v) => v.file === file)
    expect(view?.source).not.toContain('flex-import-file')
  })

  /**
   * Nor may a view shorten a description on its own. `formatCompanyName` assumes its input is a
   * company name — calling it directly is how `EUR.CHF` became `Eur.chf`.
   */
  it.each(VIEWS.map((v) => v.file))('%s does not call formatCompanyName directly', (file) => {
    const view = VIEWS.find((v) => v.file === file)
    expect(view?.source).not.toContain('formatCompanyName')
  })

  /** The component is the only place either appears. */
  it('keeps both inside InstrumentName', () => {
    expect(COMPONENT).toContain('flex-import-file')
    expect(COMPONENT).toContain('instrumentName(symbol, description)')
  })

  /**
   * Every call passes the row's **symbol** as well as its description. The symbol is not
   * decoration: it is what the decision is made against, and a call site that had only the
   * description could not tell a name from a repeated ticker.
   */
  it('always hands it both halves of the pair', () => {
    const calls = VIEWS.flatMap((v) => v.source.match(/<InstrumentName[^/]*\/>/g) ?? [])
    expect(calls.length).toBe(7)
    for (const call of calls) {
      expect(call).toMatch(/symbol=\{/)
      expect(call).toMatch(/description=\{/)
    }
  })

  /**
   * It renders nothing rather than something quieter. A secondary line repeating the ticker above
   * it is the same text twice, which read as a rendering fault on the trade history's FX rows.
   */
  it('renders nothing where there is no name', () => {
    expect(COMPONENT).toContain('if (name === null) return <></>')
  })
})
