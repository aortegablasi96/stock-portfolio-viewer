import type { ReactNode } from 'react'
import {
  analyticsBranch,
  errorHeading,
  loadingMessage,
  retryLabel,
  type AnalyticsLoad,
  type AnalyticsReportResult,
} from '../../lib/analyticsShell'
import { IMPORTED_SOURCE } from '../../lib/pageHeader'
import { Button } from '../ui/Button'
import { PageHeader } from '../ui/PageHeader'
import { StatePanel } from '../ui/StatePanel'
import { NeedsImport } from './NeedsImport'

/**
 * The one shell the four analytics views render through (Story #153, DDR-0043).
 *
 * Epic #125 consolidated the recurring *elements*; the same duplication existed one tier up, in
 * composition. Every view opened with a byte-equivalent four-branch guard differing only in one
 * noun, and `DividendsView` carried the wrapper and the `RefreshBar` a second time for its own
 * empty state — one edit away from disagreeing with the other four.
 *
 * Adding a fifth analytics view now means naming its subject and rendering its report. The three
 * unloaded states, the retry action, the page header, the wrapper element and the freshness line
 * arrive with it.
 *
 * Two things it deliberately does not do. It does not fetch — `useAnalytics` still owns that, and
 * the view still calls it, because the fetcher and the report type are the view's (the hook is
 * out of this story's scope). And it does not touch DDR-0027: `loading` is still the *first* load
 * only, `refreshing` still drives the non-destructive re-read, and view-local state above it
 * survives a tab switch exactly as before, since the shell holds no state at all.
 *
 * **Story #185 moved the page header in here** (DDR-0058), from the `AnalyticsPage` wrapper `App`
 * used to put around each analytics panel. Two consequences are worth naming. The shell now owns
 * the `<main className="dashboard">` element as well, because a header that renders in every
 * branch has to sit inside the same page box as the panel below it. And the title renders in
 * **all four branches** while the reading time and the Refresh action render in one: a view that
 * failed to load should still say which view it is, but its recovery action belongs in the
 * `StatePanel` that explains the failure rather than doubled beside it (DDR-0038).
 */
export function AnalyticsShell<Report>({
  title,
  subject,
  refreshLabel = subject,
  analytics,
  children,
}: {
  /** The view's name, as the page's heading — "Trades & realized gains", not "trade history". */
  title: string
  /** The noun the three unloaded states are written from, e.g. "performance". */
  subject: string
  /**
   * What the `Refresh` action calls it, when that differs from the subject. Trade history
   * refreshes "trades and realized gains" while it loads "trade history"; the other three
   * coincide.
   */
  refreshLabel?: string
  analytics: AnalyticsLoad<AnalyticsReportResult<Report>>
  /** The loaded view, below the header and inside the shared wrapper. */
  children: (report: Report) => ReactNode
}): React.JSX.Element {
  const { state, refreshing, loadedAt, reload } = analytics
  const branch = analyticsBranch(state)

  /**
   * The header, identical in all four branches but for the status row. `title` and `source` are
   * what a view always knows about itself; `loadedAt` and `action` are what only a loaded read
   * has, so the three unloaded branches pass neither and the row is absent rather than empty.
   */
  const header = (loaded: boolean): React.JSX.Element => (
    <PageHeader
      title={title}
      source={IMPORTED_SOURCE}
      {...(loaded
        ? {
            loadedAt,
            refreshing,
            action: (
              <Button
                variant="secondary"
                size="sm"
                aria-label={`Refresh ${refreshLabel}`}
                disabled={refreshing}
                onClick={() => void reload()}
              >
                Refresh
              </Button>
            ),
          }
        : {})}
    />
  )

  /** The branch's own content, below the header and inside the same page box. */
  const body = (): ReactNode => {
    switch (branch.kind) {
      case 'loading':
        return <StatePanel variant="loading">{loadingMessage(subject)}</StatePanel>
      case 'error':
        return (
          <StatePanel
            variant="error"
            heading={errorHeading(subject)}
            action={
              <Button variant="primary" disabled={refreshing} onClick={() => void reload()}>
                {retryLabel(refreshing)}
              </Button>
            }
          >
            {branch.message}
          </StatePanel>
        )
      case 'needs_import':
        return <NeedsImport />
      case 'loaded':
        return <div className="analytics-view">{children(branch.report)}</div>
    }
  }

  return (
    <main className="dashboard">
      {header(branch.kind === 'loaded')}
      {body()}
    </main>
  )
}
