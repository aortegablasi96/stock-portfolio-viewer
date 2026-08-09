import type { ReactNode } from 'react'
import {
  analyticsBranch,
  errorHeading,
  loadingMessage,
  retryLabel,
  type AnalyticsLoad,
  type AnalyticsReportResult,
} from '../../lib/analyticsShell'
import { Button } from '../ui/Button'
import { StatePanel } from '../ui/StatePanel'
import { NeedsImport } from './NeedsImport'
import { RefreshBar } from './RefreshBar'

/**
 * The one shell the four analytics views render through (Story #153, DDR-0043).
 *
 * Epic #125 consolidated the recurring *elements*; the same duplication existed one tier up, in
 * composition. Every view opened with a byte-equivalent four-branch guard differing only in one
 * noun, and `DividendsView` carried the wrapper and the `RefreshBar` a second time for its own
 * empty state — one edit away from disagreeing with the other four.
 *
 * Adding a fifth analytics view now means naming its subject and rendering its report. The three
 * unloaded states, the retry action, the wrapper element and the freshness bar arrive with it.
 *
 * Two things it deliberately does not do. It does not fetch — `useAnalytics` still owns that, and
 * the view still calls it, because the fetcher and the report type are the view's (the hook is
 * out of this story's scope). And it does not touch DDR-0027: `loading` is still the *first* load
 * only, `refreshing` still drives the non-destructive re-read, and view-local state above it
 * survives a tab switch exactly as before, since the shell holds no state at all.
 */
export function AnalyticsShell<Report>({
  subject,
  refreshLabel = subject,
  analytics,
  children,
}: {
  /** The noun the three unloaded states are written from, e.g. "performance". */
  subject: string
  /**
   * What the `RefreshBar` calls it, when that differs from the subject. Trade history refreshes
   * "trades and realized gains" while it loads "trade history"; the other three coincide.
   */
  refreshLabel?: string
  analytics: AnalyticsLoad<AnalyticsReportResult<Report>>
  /** The loaded view, below the refresh bar and inside the shared wrapper. */
  children: (report: Report) => ReactNode
}): React.JSX.Element {
  const { state, refreshing, loadedAt, reload } = analytics
  const branch = analyticsBranch(state)

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
      return (
        <div className="analytics-view">
          <RefreshBar
            label={refreshLabel}
            loadedAt={loadedAt}
            refreshing={refreshing}
            onRefresh={() => void reload()}
          />
          {children(branch.report)}
        </div>
      )
  }
}
