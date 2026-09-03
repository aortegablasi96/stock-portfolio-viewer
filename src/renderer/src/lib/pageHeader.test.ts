import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { IMPORTED_SOURCE, LIVE_SOURCE, readingLine } from './pageHeader'

/**
 * The shared page header (Story #185, DDR-0058).
 *
 * The header itself is a component and so is unassertable under Node (DDR-0029). What is pinned
 * here is everything that used to be written twice: the two provenance sentences, and the
 * freshness line `RefreshBar` expressed inline.
 */

const NOON = Date.UTC(2026, 7, 18, 12, 0, 0)

describe('readingLine', () => {
  /**
   * The case that made the order matter. Portfolio renders one header over all five of its
   * states, so it is busy before it has ever read anything — and "Refreshing…" there would report
   * on a reading that does not exist. The analytics views cannot reach this: they only render the
   * line from the loaded branch.
   */
  it('says nothing at all until something has been read', () => {
    expect(readingLine(true, null, NOON)).toBe('')
    expect(readingLine(false, null, NOON)).toBe('')
  })

  it('reports a re-read over figures that are already on screen', () => {
    expect(readingLine(true, NOON - 60_000, NOON)).toBe('Refreshing…')
  })

  it('uses the ellipsis character, not three periods', () => {
    expect(readingLine(true, NOON - 60_000, NOON)).not.toContain('...')
  })

  it('reports when the reading on screen was taken', () => {
    expect(readingLine(false, NOON, NOON)).toMatch(/^Updated /)
  })

  /** A reading from another day carries its date, which is `formatUpdatedAt`'s own rule. */
  it('defers the clock format to formatUpdatedAt', () => {
    const yesterday = NOON - 24 * 60 * 60 * 1000
    expect(readingLine(false, yesterday, NOON)).toMatch(/^Updated .+,/)
  })
})

/**
 * The provenance line is the header's whole reason for existing beside the sidebar's badge: it
 * says which of the app's two data paths the figures below came from. Both sentences were
 * written out in a component before this story — one in `PortfolioDashboard`, one in `App` —
 * which is two chances for a view to claim a source it does not read.
 */
describe('the two provenance sentences', () => {
  it('names the live source and the imported source distinctly', () => {
    expect(LIVE_SOURCE).toBe('Live from Interactive Brokers')
    expect(IMPORTED_SOURCE).toBe('From imported Flex Query data')
  })

  /**
   * There was a third — `OWNER_SOURCE`, `'Set by you'` — and Story #343 deleted it with the
   * Assistant's page header (DDR-0115 amendment 1). This asserts the *deletion*, because a
   * constant nothing renders is exactly what the module's note says it must not become: the
   * sentence is gone from the module, not merely unexported or left unused.
   */
  it('carries no third sentence, and no dead one', () => {
    const module = readFileSync(new URL('./pageHeader.ts', import.meta.url), 'utf8')
    expect(module).not.toContain('OWNER_SOURCE =')
    expect(module).not.toContain("'Set by you'")
  })

  /** Comments stripped first, the trap DDR-0042 and DDR-0047 both record. */
  const source = (path: string): string =>
    readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')

  /**
   * The composition half, the same shape as `analyticsShell.test.ts`'s guard: a view that spells
   * a provenance sentence out is a view that can drift from the store it actually reads.
   */
  it.each([
    'App.tsx',
    'components/PortfolioDashboard.tsx',
    'components/analytics/PerformanceView.tsx',
    'components/analytics/AllocationView.tsx',
    'components/analytics/DividendsView.tsx',
    'components/analytics/TradeHistoryView.tsx',
    'components/AssistantView.tsx',
  ])('%s quotes none of the three sentences', (path) => {
    const code = source(path)
    expect(code).not.toContain(LIVE_SOURCE)
    expect(code).not.toContain(IMPORTED_SOURCE)
  })
})
