import type { ReactNode } from 'react'
import { readingLine } from '../../lib/pageHeader'

/**
 * The one header every view opens with (Story #185, DDR-0058).
 *
 * Title on the left; on the right, where the figures came from, over when they were read and the
 * one action that re-reads them. It replaces two implementations of the same block —
 * `PortfolioDashboard`'s `.dashboard-header` and the `AnalyticsPage` wrapper `App` used to put
 * around the four analytics panels — plus the `RefreshBar` that carried the reading time in a row
 * of its own below the header.
 *
 * Three things about it are decisions rather than defaults.
 *
 * The **title is not optional**, and every caller renders it in every state: a view that failed to
 * load should still say which view it is. The **status row is**, because `loadedAt` and `action`
 * are what the loaded state has and the three unloaded ones do not — and an analytics view's
 * recovery action already sits inside the `StatePanel` that explains the failure (DDR-0038), so a
 * Refresh beside a Retry would be two controls for one job.
 *
 * The reading line keeps its **`role="status"`** live region, which is what lets a screen reader
 * hear a refresh finish without the content shifting under it. It is a live region only where it
 * renders, which is exactly where it rendered before.
 */
export function PageHeader({
  title,
  source,
  loadedAt,
  refreshing = false,
  action,
}: {
  /** The view's name — the panel's heading, and the app's only `<h1>`. */
  title: string
  /** Which of the app's two data paths the figures below came from. */
  source: string
  /** When what is on screen was read, or `null` before the first reading arrives. */
  loadedAt?: number | null
  /** A re-read is in flight over figures that are already on screen. */
  refreshing?: boolean
  /** The view's primary action — `Refresh`, or `Capture now` on Portfolio. */
  action?: ReactNode
}): React.JSX.Element {
  const showStatus = loadedAt !== undefined || action !== undefined

  return (
    <header className="page-header">
      <h1 className="page-title">{title}</h1>
      <div className="page-header-meta">
        <p className="source-note">{source}</p>
        {showStatus && (
          <div className="page-header-status">
            <p className="view-updated" role="status">
              {readingLine(refreshing, loadedAt ?? null)}
            </p>
            {action}
          </div>
        )}
      </div>
    </header>
  )
}
