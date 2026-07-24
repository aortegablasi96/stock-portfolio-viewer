import type { SnapshotSummary } from '@shared/domain/snapshot'
import { formatCurrency, formatDateTime } from '../lib/format'

/**
 * Snapshot history list (Milestone M2, Story #19). Presentational: it renders the
 * stored snapshot summaries newest-first. History comes from local storage, so it
 * remains visible even when the Interactive Brokers gateway is disconnected.
 *
 * `action` is an optional control rendered in the header (Story #43 uses it for the
 * "Clear history" reset); the parent supplies it only when there is history to clear.
 */
export function SnapshotHistory({
  snapshots,
  action,
}: {
  snapshots: SnapshotSummary[]
  action?: React.ReactNode
}): React.JSX.Element {
  if (snapshots.length === 0) {
    return (
      <section className="snapshot-history" aria-labelledby="snapshot-history-heading">
        <h2 id="snapshot-history-heading">History</h2>
        <p className="snapshot-empty">
          No snapshots captured yet. One is captured automatically when you open the app while
          connected, or capture one now.
        </p>
      </section>
    )
  }

  return (
    <section className="snapshot-history" aria-labelledby="snapshot-history-heading">
      <div className="snapshot-history-head">
        <h2 id="snapshot-history-heading">History</h2>
        {action}
      </div>
      <ol className="snapshot-list">
        {snapshots.map((snapshot) => (
          <li key={snapshot.id} className="snapshot-item">
            <time className="snapshot-time" dateTime={new Date(snapshot.capturedAt).toISOString()}>
              {formatDateTime(snapshot.capturedAt)}
            </time>
            <span className="snapshot-value">
              {formatCurrency(snapshot.totalMarketValue, snapshot.baseCurrency)}
            </span>
            <span className="snapshot-count">
              {snapshot.holdingsCount} {snapshot.holdingsCount === 1 ? 'holding' : 'holdings'}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
