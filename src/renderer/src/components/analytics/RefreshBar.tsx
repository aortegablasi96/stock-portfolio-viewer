import { formatUpdatedAt } from '../../lib/format'
import { Button } from '../ui/Button'

/**
 * The freshness line and explicit re-read shared by the four analytics views (Story #109).
 *
 * The views now keep what they loaded across tab switches, which is what makes this control
 * necessary: data that persists is data that can go stale, and "when was this read?" stops
 * being answerable from "the view just mounted". The timestamp answers it, and the button
 * makes a re-read a deliberate action rather than a side effect of navigating away and back.
 *
 * A refresh is non-destructive — the figures stay on screen while the read runs (`useAnalytics`
 * keeps the loaded phase), so this row is the *only* thing that changes. The status line is a
 * live region so a screen reader hears the refresh finish without the content shifting under it.
 */
export function RefreshBar({
  label,
  loadedAt,
  refreshing,
  onRefresh,
}: {
  /** What is being refreshed, for the button's accessible name, e.g. "performance". */
  label: string
  loadedAt: number | null
  refreshing: boolean
  onRefresh: () => void
}): React.JSX.Element {
  return (
    <div className="view-toolbar">
      <p className="view-updated" role="status">
        {refreshing
          ? 'Refreshing…'
          : loadedAt === null
            ? ''
            : `Updated ${formatUpdatedAt(loadedAt)}`}
      </p>
      <Button
        variant="secondary"
        size="sm"
        aria-label={`Refresh ${label}`}
        disabled={refreshing}
        onClick={onRefresh}
      >
        Refresh
      </Button>
    </div>
  )
}
