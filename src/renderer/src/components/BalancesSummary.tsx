import type { AccountBalances } from '@shared/domain/portfolio'
import { formatCurrency } from '../lib/format'

/**
 * Account balances summary (Story #16): three stat tiles showing the headline
 * figures. Presentational only — the values are computed/fetched upstream.
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
    <section className="balances" aria-label="Account balances">
      {tiles.map((tile) => (
        <div key={tile.label} className="balance-tile">
          <p className="balance-label">{tile.label}</p>
          <p className="balance-value">{tile.value}</p>
        </div>
      ))}
    </section>
  )
}
