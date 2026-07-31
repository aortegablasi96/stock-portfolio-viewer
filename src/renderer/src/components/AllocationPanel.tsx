import type { AllocationSlice } from '@shared/domain/portfolio'
import { formatPercent } from '../lib/format'
import { Card, CardContent, CardTitle } from './ui/Card'

/**
 * Basic allocation view (Story #16): each holding's weight as a labelled bar,
 * ordered from largest to smallest. Weights come from the service (fraction of
 * total holdings market value); this component only presents them.
 */
export function AllocationPanel({
  allocation,
}: {
  allocation: AllocationSlice[]
}): React.JSX.Element {
  const ordered = [...allocation].sort((a, b) => b.weight - a.weight)

  return (
    <Card aria-label="Allocation by holding">
      <CardTitle>Allocation</CardTitle>
      <CardContent>
        <ul className="allocation-list">
          {ordered.map((slice) => (
            <li key={slice.conid} className="allocation-row">
              <div className="allocation-head">
                <span className="allocation-symbol">{slice.symbol}</span>
                <span className="allocation-weight">{formatPercent(slice.weight)}</span>
              </div>
              <div
                className="allocation-track"
                role="meter"
                aria-valuenow={Math.round(slice.weight * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${slice.symbol} allocation`}
              >
                <div
                  className="allocation-bar"
                  style={{ width: `${Math.max(slice.weight * 100, 1)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
