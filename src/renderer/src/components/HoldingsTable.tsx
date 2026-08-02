import type { AllocationSlice, Holding } from '@shared/domain/portfolio'
import { formatCurrency, formatPercent, formatQuantity } from '../lib/format'
import { Badge } from './ui/Badge'

/**
 * The current-holdings table (Story #15; display currency added in Story #28).
 * Presentational only: it receives already assembled domain data and renders it.
 * Allocation weights are looked up by `conid` so the % column stays consistent with the
 * allocation panel (Story #16).
 *
 * When `displayCurrency` is set, the Market value column shows the converted value with the
 * position's native amount as a muted chip, so a converted figure is never mistaken for a
 * native quote (DDR-0007). The Price column always stays in the instrument's native
 * currency — a quote is a native-currency fact. A position with no available FX rate
 * (`displayValue === null`) is shown in its native currency and marked.
 */
export function HoldingsTable({
  holdings,
  allocation,
  displayCurrency,
}: {
  holdings: Holding[]
  allocation: AllocationSlice[]
  displayCurrency?: string
}): React.JSX.Element {
  const weightByConid = new Map(allocation.map((a) => [a.conid, a.weight]))
  const hasUnconverted = displayCurrency != null && holdings.some((h) => h.displayValue === null)

  return (
    <div className="table-scroll">
      {hasUnconverted && (
        <p className="table-notice" role="status">
          Some positions have no available exchange rate and are shown in their native
          currency (excluded from the {displayCurrency} total).
        </p>
      )}
      <table className="holdings-table">
        <caption className="sr-only">Current holdings</caption>
        <thead>
          <tr>
            <th scope="col">Ticker</th>
            <th scope="col">Description</th>
            <th scope="col" className="num">
              Quantity
            </th>
            <th scope="col" className="num">
              Price
            </th>
            <th scope="col" className="num">
              Market value{displayCurrency ? ` (${displayCurrency})` : ''}
            </th>
            <th scope="col" className="num">
              Weight
            </th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((h) => {
            const weight = weightByConid.get(h.conid)
            return (
              <tr key={h.conid}>
                <th scope="row" className="symbol">
                  {h.symbol}
                </th>
                <td className="description">{h.description}</td>
                <td className="num">{formatQuantity(h.quantity)}</td>
                <td className="num">
                  {h.marketPrice === null ? '—' : formatCurrency(h.marketPrice, h.currency)}
                </td>
                <td className="num">
                  <MarketValueCell holding={h} displayCurrency={displayCurrency} />
                </td>
                <td className="num">{weight === undefined ? '—' : formatPercent(weight)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** The Market value cell: native when no display currency, else converted + a native chip. */
function MarketValueCell({
  holding,
  displayCurrency,
}: {
  holding: Holding
  displayCurrency?: string
}): React.JSX.Element {
  const native = formatCurrency(holding.marketValue, holding.currency)

  // No conversion requested → plain native value (original behaviour).
  if (!displayCurrency) return <>{native}</>

  // Conversion requested but no rate available → native value + an "unconverted" chip.
  if (holding.displayValue == null) {
    return (
      <>
        {native}
        <Badge size="sm" title="No exchange rate available">
          {holding.currency}
        </Badge>
      </>
    )
  }

  // Converted value, with the native amount retained as a muted chip.
  return (
    <>
      {formatCurrency(holding.displayValue, displayCurrency)}
      {holding.currency !== displayCurrency && <Badge size="sm">{native}</Badge>}
    </>
  )
}
