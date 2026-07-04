import type { AllocationSlice, Holding } from '@shared/domain/portfolio'
import { formatCurrency, formatPercent, formatQuantity } from '../lib/format'

/**
 * The current-holdings table (Story #15). Presentational only: it receives already
 * assembled domain data and renders it. Allocation weights are looked up by `conid`
 * so the % column stays consistent with the allocation panel (Story #16).
 */
export function HoldingsTable({
  holdings,
  allocation,
}: {
  holdings: Holding[]
  allocation: AllocationSlice[]
}): React.JSX.Element {
  const weightByConid = new Map(allocation.map((a) => [a.conid, a.weight]))

  return (
    <div className="table-scroll">
      <table className="holdings-table">
        <caption className="sr-only">Current holdings</caption>
        <thead>
          <tr>
            <th scope="col">Symbol</th>
            <th scope="col">Description</th>
            <th scope="col" className="num">
              Quantity
            </th>
            <th scope="col" className="num">
              Price
            </th>
            <th scope="col" className="num">
              Market value
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
                <td className="num">{formatCurrency(h.marketValue, h.currency)}</td>
                <td className="num">{weight === undefined ? '—' : formatPercent(weight)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
