import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  analyticsBranch,
  errorHeading,
  loadingMessage,
  retryLabel,
  type AnalyticsReportResult,
  type AnalyticsState,
} from './analyticsShell'

/**
 * The analytics views' shared shell (Story #153, DDR-0043).
 *
 * Kept out of the component because Vitest runs Node-only (DDR-0029). Two things are pinned:
 * the flattening of the hook's phase and the result's status into one branch, and the wording
 * the four views used to restate — the drift the story exists to stop.
 */

type Report = { figure: number }

const LOADING: AnalyticsState<AnalyticsReportResult<Report>> = { phase: 'loading' }
const ERROR: AnalyticsState<AnalyticsReportResult<Report>> = {
  phase: 'error',
  message: 'The gateway went quiet.',
}
const NEEDS_IMPORT: AnalyticsState<AnalyticsReportResult<Report>> = {
  phase: 'loaded',
  result: { status: 'needs_import' },
}
const LOADED: AnalyticsState<AnalyticsReportResult<Report>> = {
  phase: 'loaded',
  result: { status: 'ok', report: { figure: 42 } },
}

describe('analyticsBranch', () => {
  it('reports the first load as loading', () => {
    expect(analyticsBranch(LOADING)).toEqual({ kind: 'loading' })
  })

  it('carries the failure message through, so the panel explains itself', () => {
    expect(analyticsBranch(ERROR)).toEqual({ kind: 'error', message: 'The gateway went quiet.' })
  })

  /**
   * The nesting this flattens: `needs_import` is a *loaded* read whose result says the store is
   * empty, not a phase of its own. Four views each unpacked that by hand.
   */
  it('reads the empty store out of a loaded result', () => {
    expect(analyticsBranch(NEEDS_IMPORT)).toEqual({ kind: 'needs_import' })
  })

  it('unwraps the report so a view never touches the result envelope', () => {
    expect(analyticsBranch(LOADED)).toEqual({ kind: 'loaded', report: { figure: 42 } })
  })

  /**
   * DDR-0027's half of the contract. `refreshing` is not in this mapping at all: a re-read over
   * a report that is already on screen leaves the phase `loaded`, so the branch stays `loaded`
   * and the figures never blank. Only the *first* load is `loading`.
   */
  it('keeps a refreshing view on its report rather than sending it back to loading', () => {
    expect(analyticsBranch(LOADED).kind).toBe('loaded')
    expect(analyticsBranch(NEEDS_IMPORT).kind).toBe('needs_import')
  })

  it('only ever reports one of the four branches', () => {
    const kinds = [LOADING, ERROR, NEEDS_IMPORT, LOADED].map((s) => analyticsBranch(s).kind)
    expect(kinds).toEqual(['loading', 'error', 'needs_import', 'loaded'])
  })
})

describe('the wording derived from the subject noun', () => {
  it('builds the loading line from the noun alone', () => {
    expect(loadingMessage('performance')).toBe('Loading performance…')
    expect(loadingMessage('trade history')).toBe('Loading trade history…')
  })

  /** The apostrophe is typographic, and it is the exact character four copies drifted on. */
  it('keeps the typographic apostrophe in the error heading', () => {
    expect(errorHeading('allocation')).toBe('Couldn’t load allocation')
    expect(errorHeading('dividends')).not.toContain("'")
  })

  it('uses the ellipsis character, not three periods', () => {
    expect(loadingMessage('dividends')).toContain('…')
    expect(loadingMessage('dividends')).not.toContain('...')
    expect(retryLabel(true)).toBe('Retrying…')
  })

  it('reports the retry it started', () => {
    expect(retryLabel(false)).toBe('Retry')
    expect(retryLabel(true)).toBe('Retrying…')
  })
})

/**
 * The composition half of the story. A view that keeps its own copy of the guard is a view that
 * can drift from the other three, which is what happened before the shell existed — so the four
 * are read as text and checked for the parts the shell now owns. This is the same shape as the
 * primitives' "a superseded selector must not reappear" tests, one tier up.
 */
describe('no analytics view restates the shell', () => {
  const VIEWS = ['PerformanceView', 'AllocationView', 'DividendsView', 'TradeHistoryView']

  const source = (view: string): string =>
    readFileSync(new URL(`../components/analytics/${view}.tsx`, import.meta.url), 'utf8')

  it.each(VIEWS)('%s does not re-declare the four-branch guard', (view) => {
    const code = source(view)
    expect(code).not.toContain("phase === 'loading'")
    expect(code).not.toContain("phase === 'error'")
    expect(code).not.toContain("status === 'needs_import'")
    expect(code).not.toContain('<NeedsImport')
  })

  it.each(VIEWS)('%s does not re-declare the wrapper or the refresh bar', (view) => {
    const code = source(view)
    expect(code).not.toContain('className="analytics-view"')
    expect(code).not.toContain('<RefreshBar')
  })

  /**
   * `DividendsView` is the one that had two copies — its "no dividend income recorded" path
   * restated the wrapper and the refresh bar a second time. It still renders the upcoming panel
   * there, which is the behaviour that path exists for: a dividend can be announced before one
   * has ever been paid.
   */
  it('DividendsView still shows upcoming dividends when nothing has been paid', () => {
    const code = source('DividendsView')
    const emptyPath = /No dividend income recorded[\s\S]{0,400}?<Upcoming/
    expect(code).toMatch(emptyPath)
  })
})
