import type { SnapshotSummary } from '@shared/domain/snapshot'
import { formatCurrency, formatDateTime } from '../lib/format'
import { Badge } from './ui/Badge'
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card'
import { StatePanel } from './ui/StatePanel'

/**
 * Snapshot history list (Milestone M2, Story #19). Presentational: it renders the
 * stored snapshot summaries newest-first. History comes from local storage, so it
 * remains visible even when the Interactive Brokers gateway is disconnected.
 *
 * When a snapshot carries a `displayCurrency` (Bug #44), its total is shown converted into
 * that currency with the stored base amount as a muted chip — consistent with the holdings
 * table (DDR-0007). A snapshot with no available FX rate (`displayValue === null`, e.g. the
 * gateway is disconnected) is shown in its stored base currency and flagged, never
 * silently mis-converted.
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
      <Card aria-labelledby="snapshot-history-heading">
        <CardTitle id="snapshot-history-heading">History</CardTitle>
        <CardContent>
          <StatePanel surface="inline">
            No snapshots captured yet. One is captured automatically when you open the app while
            connected, or capture one now.
          </StatePanel>
        </CardContent>
      </Card>
    )
  }

  // A single display currency is requested across the list; surface a notice when any row
  // couldn't be converted, mirroring the holdings table.
  const displayCurrency = snapshots.find((s) => s.displayCurrency)?.displayCurrency
  const hasUnconverted = displayCurrency != null && snapshots.some((s) => s.displayValue === null)

  return (
    <Card aria-labelledby="snapshot-history-heading">
      <CardHeader align="start">
        <CardTitle id="snapshot-history-heading">History</CardTitle>
        {action}
      </CardHeader>
      <CardContent>
        {hasUnconverted && (
          <p className="table-notice" role="status">
            Some snapshots have no available exchange rate and are shown in their captured
            currency.
          </p>
        )}
        <ol className="snapshot-list">
          {snapshots.map((snapshot) => (
            <li key={snapshot.id} className="snapshot-item">
              <time
                className="snapshot-time"
                dateTime={new Date(snapshot.capturedAt).toISOString()}
              >
                {formatDateTime(snapshot.capturedAt)}
              </time>
              <span className="snapshot-value">
                <SnapshotValue snapshot={snapshot} />
              </span>
              <span className="snapshot-count">
                {snapshot.holdingsCount} {snapshot.holdingsCount === 1 ? 'holding' : 'holdings'}
              </span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}

/**
 * The total portfolio value (holdings + cash, i.e. `netLiquidation`) — the headline figure a
 * history row shows so it reconciles with the Portfolio view's net value (Bug #68). Native
 * when no display currency, else converted + a native chip.
 */
function SnapshotValue({ snapshot }: { snapshot: SnapshotSummary }): React.JSX.Element {
  const native = formatCurrency(snapshot.netLiquidation, snapshot.baseCurrency)

  // No conversion requested → plain stored value (original behaviour).
  if (!snapshot.displayCurrency) return <>{native}</>

  // Conversion requested but no rate available → stored value + an "unconverted" chip.
  if (snapshot.displayValue == null) {
    return (
      <>
        {native}
        <Badge size="sm" title="No exchange rate available">
          {snapshot.baseCurrency}
        </Badge>
      </>
    )
  }

  // Converted value, with the stored base amount retained as a muted chip.
  return (
    <>
      {formatCurrency(snapshot.displayValue, snapshot.displayCurrency)}
      {snapshot.baseCurrency !== snapshot.displayCurrency && <Badge size="sm">{native}</Badge>}
    </>
  )
}
