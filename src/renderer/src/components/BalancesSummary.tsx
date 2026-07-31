import type { AccountBalances } from '@shared/domain/portfolio'
import { formatCurrency } from '../lib/format'
import { StatRow, StatTile } from './ui/StatTile'

/**
 * Account balances summary (Story #16): three stat tiles showing the headline
 * figures. Presentational only — the values are computed/fetched upstream.
 *
 * The tiles are the shared `StatTile` since Story #129; the hand-written copy this file
 * carried was the same component with a larger figure, no tone and no hint line.
 *
 * All three tiles use base-ledger figures (converted to the display currency) so they
 * reconcile: Holdings value is `stockMarketValue` (IBKR's own valuation), and Net = Holdings
 * + Cash exactly (Bug #68). Note the per-position rows in the holdings table convert at live
 * spot FX and so sum a hair below this ledger value — expected, not a discrepancy to fix.
 */
export function BalancesSummary({
  balances,
}: {
  balances: AccountBalances
}): React.JSX.Element {
  const tiles = [
    { label: 'Net liquidation', value: formatCurrency(balances.netLiquidation, balances.currency) },
    { label: 'Cash', value: formatCurrency(balances.totalCashValue, balances.currency) },
    {
      label: 'Holdings value',
      value: formatCurrency(balances.stockMarketValue, balances.currency),
    },
  ]

  return (
    <StatRow as="section" aria-label="Account balances">
      {tiles.map((tile) => (
        <StatTile key={tile.label} label={tile.label} value={tile.value} />
      ))}
    </StatRow>
  )
}
