import type { AllocationSlice } from '@shared/domain/portfolio'
import { formatPercent } from '../lib/format'
import { weightBars } from '../lib/weightBars'
import { Card, CardContent, CardTitle } from './ui/Card'

/**
 * Allocation weights (Story #16): each holding's weight as a labelled bar, largest first.
 * Weights come from the service (fraction of total holdings market value); this component only
 * presents them, and since Story #189 it presents them in the Portfolio view's 260px right rail
 * rather than in a 20rem column of its own.
 *
 * The bars are scaled by `lib/weightBars` against the set's own maximum with a floor under it —
 * the prototype's hard-coded divisor drew a 4% top holding as a full bar. The `meter` still
 * reports the **weight**, not the fill: what a screen reader is told is the fact, not the drawing.
 */
export function AllocationPanel({
  allocation,
}: {
  allocation: AllocationSlice[]
}): React.JSX.Element {
  const bars = weightBars(allocation)

  return (
    <Card aria-label="Allocation by holding">
      <CardTitle>Allocation</CardTitle>
      <CardContent>
        <ul className="allocation-list">
          {bars.map((bar) => (
            <li key={bar.conid} className="allocation-row">
              <div className="allocation-head">
                <span className="allocation-symbol">{bar.symbol}</span>
                <span className="allocation-weight">{formatPercent(bar.weight)}</span>
              </div>
              <div
                className="weight-track"
                role="meter"
                aria-valuenow={Math.round(bar.weight * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${bar.symbol} allocation`}
              >
                <div className="weight-fill" style={{ width: `${bar.fill}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
