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
 *
 * Two of the three carry the hint line the tile has always accepted and this row never used
 * (Story #263). Both state the thing the label alone leaves open and that the paragraph above
 * had to be read to learn: *Holdings plus cash* is the Bug #68 definition — not IBKR's
 * `netliquidationvalue`, which also folds in accruals and so does not reconcile with the two
 * tiles beside it — and *At current market prices* separates this valuation from the cost basis
 * a reader might otherwise assume.
 *
 * **Cash deliberately has none.** The prototype captions it *Available margin*, which this figure
 * is not: `totalCashValue` is the ledger's total cash across currencies and says nothing about
 * buying power. A hint that is not true of the figure above it is worse than the blank space, so
 * the tile keeps the blank space until there is something true to put there.
 */
export function BalancesSummary({
  balances,
}: {
  balances: AccountBalances
}): React.JSX.Element {
  const tiles = [
    {
      label: 'Net liquidation',
      value: formatCurrency(balances.netLiquidation, balances.currency),
      hint: 'Holdings plus cash',
    },
    { label: 'Cash', value: formatCurrency(balances.totalCashValue, balances.currency) },
    {
      label: 'Holdings value',
      value: formatCurrency(balances.stockMarketValue, balances.currency),
      hint: 'At current market prices',
    },
  ]

  return (
    <StatRow as="section" aria-label="Account balances">
      {tiles.map((tile) => (
        <StatTile key={tile.label} label={tile.label} value={tile.value} hint={tile.hint} />
      ))}
    </StatRow>
  )
}
