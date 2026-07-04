import type { AccountBalances } from '@shared/domain/portfolio'
import { formatCurrency } from '../lib/format'

/**
 * Account balances summary (Story #16): three stat tiles showing the headline
 * figures. Presentational only — the values are computed/fetched upstream.
 * `totalMarketValue` is the rolled-up market value of holdings from the service,
 * shown alongside the account's cash and net-liquidation figures.
 */
export function BalancesSummary({
  balances,
  totalMarketValue,
}: {
  balances: AccountBalances
  totalMarketValue: number
}): React.JSX.Element {
  const tiles = [
    { label: 'Net liquidation', value: formatCurrency(balances.netLiquidation, balances.currency) },
    { label: 'Cash', value: formatCurrency(balances.totalCashValue, balances.currency) },
    { label: 'Holdings value', value: formatCurrency(totalMarketValue, balances.currency) },
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
