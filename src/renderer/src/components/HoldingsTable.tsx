import type { AllocationSlice, Holding } from '@shared/domain/portfolio'
import { formatCurrency, formatPercent, formatQuantity } from '../lib/format'
import { Badge } from './ui/Badge'
import { DataTable, type DataColumn } from './ui/DataTable'

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
 *
 * It is the one table in the app that stands outside a card, so it is the one that brings its
 * own surface (Story #134). Market value sorts on the figure actually shown, so a position with
 * no rate — the `displayValue === null` case above — is the missing value the comparator parks
 * at the bottom rather than treating as zero.
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
  const valueOf = (h: Holding): number | null =>
    displayCurrency != null ? (h.displayValue ?? null) : h.marketValue

  const columns: DataColumn<Holding>[] = [
    {
      key: 'symbol',
      header: 'Ticker',
      rowHeader: true,
      cell: (h) => h.symbol,
      sortValue: (h) => h.symbol,
    },
    {
      key: 'description',
      header: 'Description',
      className: 'data-table-note',
      cell: (h) => h.description,
      sortValue: (h) => h.description,
    },
    {
      key: 'quantity',
      header: 'Quantity',
      numeric: true,
      cell: (h) => formatQuantity(h.quantity),
      sortValue: (h) => h.quantity,
    },
    {
      key: 'price',
      header: 'Price',
      numeric: true,
      cell: (h) => (h.marketPrice === null ? '—' : formatCurrency(h.marketPrice, h.currency)),
      sortValue: (h) => h.marketPrice,
    },
    {
      key: 'value',
      header: `Market value${displayCurrency ? ` (${displayCurrency})` : ''}`,
      numeric: true,
      cell: (h) => <MarketValueCell holding={h} displayCurrency={displayCurrency} />,
      sortValue: valueOf,
    },
    {
      key: 'weight',
      header: 'Weight',
      numeric: true,
      cell: (h) => {
        const weight = weightByConid.get(h.conid)
        return weight === undefined ? '—' : formatPercent(weight)
      },
      sortValue: (h) => weightByConid.get(h.conid) ?? null,
    },
  ]

  return (
    <DataTable
      caption="Current holdings"
      surface="card"
      columns={columns}
      rows={holdings}
      rowKey={(h) => h.conid}
      notice={
        hasUnconverted && (
          <p className="table-notice" role="status">
            Some positions have no available exchange rate and are shown in their native
            currency (excluded from the {displayCurrency} total).
          </p>
        )
      }
    />
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
