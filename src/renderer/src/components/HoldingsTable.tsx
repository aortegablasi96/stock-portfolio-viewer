import type { AllocationSlice, Holding } from '@shared/domain/portfolio'
import {
  formatCurrency,
  formatPercent,
  formatQuantity,
  formatSignedCurrency,
  holdingName,
} from '../lib/format'
import { unrealizedPnlOf, unrealizedPnlTone } from '../lib/holdingPnl'
import { toneClassName } from '../lib/statTileVariants'
import { weightBarFill, weightBarScale } from '../lib/weightBars'
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
 *
 * Story #263 finishes the table to the redesign's drawing of it, and each of the three changes
 * answers a question the six-column version left open:
 *
 *   - **A seventh column, Unrealized P&L.** Story #189 drew the layout and put "new columns in
 *     the holdings table" out of scope; this is that column. It is the one figure on the page
 *     that says whether a position has *done* anything, and everything it needs was already
 *     arriving in the positions payload the overview reads — so it costs nothing at the wire
 *     (DDR-0024). Converted in the service on `displayValue`'s terms, never here (DDR-0007).
 *   - **The card states its name.** The table's `caption` is `sr-only`, so this was the one
 *     table card in the app a reader could not name — the strip is the same `.card-header` the
 *     other fifteen wear, not a second treatment (DDR-0059).
 *   - **The second column names the company.** It rendered the raw description, which on the live
 *     gateway is the ticker a second time; it now takes the name imported Flex history knows the
 *     instrument by, shortened through the app's one `instrumentName`. See the column below.
 *
 * Story #189 draws a micro-bar under each Weight figure — the same fact the rail's allocation
 * list draws, on the same scale, because both go through `lib/weightBars`. It is keyed by
 * `conid` rather than by row order: this table sorts, so its rows and the rail's have no reason
 * to agree (the same rule the Allocation breakdown's donut link follows, DDR-0040). The bar is a
 * second channel on a figure that is already there, never the only one — a row whose weight is
 * unknown shows the em dash it always did and no track at all.
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
  // One scale for the whole column, derived from the allocation rather than from the rows on
  // screen: filtering or re-sorting the table must not silently rescale the bars.
  const barScale = weightBarScale(allocation.map((a) => a.weight))
  const hasUnconverted = displayCurrency != null && holdings.some((h) => h.displayValue === null)
  const valueOf = (h: Holding): number | null =>
    displayCurrency != null ? (h.displayValue ?? null) : h.marketValue
  const nameOf = (h: Holding): string | null => holdingName(h.symbol, h.description, h.companyName)

  const columns: DataColumn<Holding>[] = [
    {
      key: 'symbol',
      header: 'Ticker',
      rowHeader: true,
      cell: (h) => h.symbol,
      sortValue: (h) => h.symbol,
    },
    {
      // The app's standing rule, applied to the one table that had not been (Story #263):
      // **a description that repeats the symbol is not a name** (DDR-0066/0067). This column
      // rendered `description` raw, and on the live gateway that is the ticker a second time —
      // Build 10.46.2d sends no `ticker` field at all and puts the symbol in `contractDesc`, so
      // `portfolioRepository`'s fallback resolves both fields to the same string and every row
      // read `IBKR · IBKR`.
      //
      // Going through `instrumentName` alone emptied the column, which was honest but useless:
      // the same instrument is named on Allocation, from imported Flex history. So the service
      // now resolves that name by conid and `holdingName` prefers it, which is what lets the
      // header say **Company** — a claim the gateway's description could not support.
      key: 'description',
      header: 'Company',
      className: 'data-table-note',
      cellClassName: (h) => (nameOf(h) === null ? 'data-table-dim' : ''),
      cell: (h) => nameOf(h) ?? '—',
      // Sorts on the resolved name, so the rows with no name are the missing values the
      // comparator parks at the bottom in both directions rather than a run of identical tickers.
      sortValue: (h) => nameOf(h),
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
        if (weight === undefined) return '—'
        return (
          <>
            {formatPercent(weight)}
            <span className="weight-track weight-track-micro" aria-hidden="true">
              <span
                className="weight-fill"
                style={{ width: `${weightBarFill(weight, barScale)}%` }}
              />
            </span>
          </>
        )
      },
      sortValue: (h) => weightByConid.get(h.conid) ?? null,
    },
    {
      // The seventh column, and the one the prototype drew that this table did not have
      // (Story #263). It is a bare toned figure rather than a `Badge`: what a badge adds is the
      // box, and the box is what separates a *label* from the figures around it (DDR-0086) — this
      // is one of those figures. The tone follows the same `cellClassName` route the realized-gains
      // table's three signed columns take, so the table places the class and the column decides it.
      key: 'unrealizedPnl',
      header: 'Unrealized P&L',
      numeric: true,
      cellClassName: (h) => toneClassName(unrealizedPnlTone(unrealizedPnlOf(h, displayCurrency))),
      cell: (h) => {
        const pnl = unrealizedPnlOf(h, displayCurrency)
        return pnl.value === null ? '—' : formatSignedCurrency(pnl.value, pnl.currency)
      },
      sortValue: (h) => unrealizedPnlOf(h, displayCurrency).value,
    },
  ]

  return (
    <DataTable
      caption="Current holdings"
      title="Holdings"
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
