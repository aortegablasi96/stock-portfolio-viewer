import type {
  DividendEvent,
  DividendGroup,
  DividendReport,
  UpcomingDividend,
  UpcomingDividends,
  DividendResult,
} from '@shared/domain/dividends'
import {
  formatCurrency,
  formatDate,
  formatMonth,
  formatPerShare,
  formatQuantity,
} from '../../lib/format'
import { datedExtent, filterByRange, windowFor } from '../../lib/dateRange'
import { distinctTypes, filterByTypes } from '../../lib/tableFilter'
import { useTypeSelection } from './useTypeSelection'
import { ColumnChart, IncomeLegend, type StackedColumn } from '../charts/ColumnChart'
import { toneClassName, toneOf } from '../../lib/statTileVariants'
import { BADGE_CELL_CLASS } from '../../lib/badgeVariants'
import { Badge } from '../ui/Badge'
import { InstrumentName } from './InstrumentName'
import { useAnalytics } from './useAnalytics'
import { AnalyticsShell } from './AnalyticsShell'
import { RangeFilter } from './RangeFilter'
import { StatRow, StatTile } from '../ui/StatTile'
import { TypeFilter } from './TypeFilter'
import { useRangeSelection } from './useRangeSelection'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card'
import { StatePanel } from '../ui/StatePanel'
import { DataTable, type DataColumn } from '../ui/DataTable'

/**
 * Dividend & income tracking (Milestone M3, Stories #23 and #31). Shows gross income,
 * withholding tax, and net income per symbol and per month, in the base currency,
 * read from imported Flex cash transactions. The monthly chart stacks net + withholding
 * so the column height reads as gross while the solid lower segment is what was
 * actually received. Above it, "Upcoming" lists dividends already declared but not yet
 * paid, from the latest statement's open accruals (DDR-0010).
 */

/**
 * The three parts of the income stack, named once. The hover card and the key in the card header
 * both take these, so the legend cannot come to say something the card does not (Story #192,
 * DDR-0064).
 *
 * **Story #236 renamed them for what the chart measures.** The key said `Net received` and
 * `Withholding tax`, which names the two *segments* and leaves the column's own height — the gross
 * — named nowhere the reader can see. So the key now names the column (`Gross`) and the part
 * stacked at its top (`Withholding tax`), and `Net` joins them as the third row of the hover card:
 * declared, taken, and what actually landed, in that order.
 */
const INCOME_GROSS_LABEL = 'Gross'
const INCOME_TAX_LABEL = 'Withholding tax'
const INCOME_NET_LABEL = 'Net'

/**
 * Declared-but-unpaid dividends. Three distinct empty states matter here: no accruals
 * section in the import at all (the Flex query needs a setting enabled), a section that
 * is present but currently empty (genuinely nothing announced), and the populated table.
 */
function Upcoming({
  upcoming,
  baseCurrency,
}: {
  upcoming: UpcomingDividends
  baseCurrency: string
}): React.JSX.Element {
  const c = (v: number): string => formatCurrency(v, baseCurrency)
  const asOf = upcoming.asOf != null ? formatDate(upcoming.asOf) : null

  return (
    <Card>
      <CardTitle>Upcoming dividends</CardTitle>
      <CardContent>
        {!upcoming.sectionPresent ? (
          <StatePanel surface="inline">
            Your imported statements carry no dividend accruals. Enable the{' '}
            <strong>Open Dividend Accruals</strong> section on your IBKR Flex Query, then re-export
            and import it to see dividends that have been announced but not yet paid.
          </StatePanel>
        ) : upcoming.items.length === 0 ? (
          <StatePanel surface="inline">
            No announced dividends are pending{asOf ? ` as of ${asOf}` : ''}.
          </StatePanel>
        ) : (
          <>
            <p className="source-note">
              Announced but not yet paid{asOf ? `, as of ${asOf}` : ''}. Expecting{' '}
              <strong>{c(upcoming.totalNetBase)}</strong> net ({c(upcoming.totalGrossBase)} gross,{' '}
              {c(upcoming.totalWithholdingBase)} expected withholding).
            </p>
            <UpcomingTable items={upcoming.items} baseCurrency={baseCurrency} />
          </>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * The announced-but-unpaid rows. Pay date and ex-date sort on the epoch-ms number, not the
 * formatted label, and a row IBKR has announced without one of them sorts to the bottom rather
 * than under the em dash it renders.
 */
function UpcomingTable({
  items,
  baseCurrency,
}: {
  items: UpcomingDividend[]
  baseCurrency: string
}): React.JSX.Element {
  const c = (v: number): string => formatCurrency(v, baseCurrency)

  const columns: DataColumn<UpcomingDividend>[] = [
    {
      key: 'payDate',
      header: 'Pay date',
      cell: (i) => (i.payDate != null ? formatDate(i.payDate) : '—'),
      sortValue: (i) => i.payDate,
    },
    {
      key: 'exDate',
      header: 'Ex-date',
      cell: (i) => (i.exDate != null ? formatDate(i.exDate) : '—'),
      sortValue: (i) => i.exDate,
    },
    {
      key: 'symbol',
      header: 'Ticker',
      rowHeader: true,
      cell: (i) => (
        <>
          {i.symbol || '—'}
          <InstrumentName symbol={i.symbol} description={i.description} />
        </>
      ),
      sortValue: (i) => i.symbol || null,
    },
    {
      key: 'quantity',
      header: 'Quantity',
      numeric: true,
      cell: (i) => formatQuantity(i.quantity),
      sortValue: (i) => i.quantity,
    },
    {
      key: 'perShare',
      header: 'Per share',
      numeric: true,
      cell: (i) => (i.grossRate != null ? formatPerShare(i.grossRate, i.currency) : '—'),
      sortValue: (i) => i.grossRate,
    },
    {
      key: 'gross',
      header: 'Gross',
      numeric: true,
      cell: (i) => c(i.grossBase),
      sortValue: (i) => i.grossBase,
    },
    {
      key: 'withholding',
      header: 'Withholding',
      numeric: true,
      cell: (i) => c(i.withholdingBase),
      sortValue: (i) => i.withholdingBase,
    },
    {
      key: 'net',
      header: `Net in ${baseCurrency}`,
      numeric: true,
      cell: (i) => c(i.netBase),
      sortValue: (i) => i.netBase,
    },
  ]

  return (
    <DataTable
      caption="Upcoming dividends"
      columns={columns}
      rows={items}
      rowKey={(i) => `${i.symbol}-${i.payDate ?? 'na'}-${i.exDate ?? 'na'}`}
    />
  )
}

export function DividendsView(): React.JSX.Element {
  const analytics = useAnalytics<DividendResult>(window.api.getDividends)

  return (
    <AnalyticsShell<DividendReport>
      title="Dividends"
      subject="dividends"
      analytics={analytics}
    >
      {(r) => {
        const c = (v: number): string => formatCurrency(v, r.baseCurrency)

        // Announced dividends can exist before any has ever been paid, so the "no income yet"
        // state still renders the upcoming panel rather than replacing the whole view. It is a
        // fifth state of the *report*, not of the read, which is why it composes inside the shell
        // rather than beside it — before Story #153 this path restated the wrapper and the
        // refresh bar, and was the drift starting.
        if (r.events.length === 0) {
          return (
            <>
              <StatePanel variant="empty" heading="No dividend income recorded">
                The imported statements contain no dividend or payment-in-lieu transactions.
              </StatePanel>
              <Upcoming upcoming={r.upcoming} baseCurrency={r.baseCurrency} />
            </>
          )
        }

        const columns: StackedColumn[] = r.byMonth.map((m) => ({
          key: m.key,
          label: formatMonth(m.key),
          lower: m.netBase,
          upper: m.withholdingBase,
        }))

        return (
          <>
            <StatRow>
              <StatTile label="Gross income" value={c(r.totalGrossBase)} />
              <StatTile label="Withholding tax" value={c(r.totalWithholdingBase)} hint="Withheld at source" />
              <StatTile
                label="Net income"
                value={c(r.totalNetBase)}
                hint="Actually received"
                tone="positive"
              />
            </StatRow>

            <Upcoming upcoming={r.upcoming} baseCurrency={r.baseCurrency} />

            <Card>
              <CardHeader className="chart-card-header">
                <CardTitle>Income over time</CardTitle>
                <IncomeLegend columnLabel={INCOME_GROSS_LABEL} upperLabel={INCOME_TAX_LABEL} />
              </CardHeader>
              <CardContent>
                <p className="source-note">
                  Each column’s height is the month’s gross income, with the withholding tax
                  stacked at its top; what is left below it is the net that reached the account.
                  Point at a month for all three. A month whose withholding outweighs its dividends
                  dips below the zero line, and its withholding is reported rather than drawn.
                </p>
                <ColumnChart
                  columns={columns}
                  formatValue={c}
                  lowerLabel={INCOME_NET_LABEL}
                  upperLabel={INCOME_TAX_LABEL}
                  totalLabel={INCOME_GROSS_LABEL}
                  ariaLabel="Gross dividend income by month, with withholding tax stacked at the top of each column"
                />
              </CardContent>
            </Card>

            <Card>
              <CardTitle>By Ticker</CardTitle>
              <CardContent>
                <BySymbolTable groups={r.bySymbol} baseCurrency={r.baseCurrency} />
              </CardContent>
            </Card>

            <Transactions events={r.events} baseCurrency={r.baseCurrency} />
          </>
        )
      }}
    </AnalyticsShell>
  )
}

/** Dividend income totalled per instrument. Sorting is what answers "who pays me the most?". */
function BySymbolTable({
  groups,
  baseCurrency,
}: {
  groups: DividendGroup[]
  baseCurrency: string
}): React.JSX.Element {
  const c = (v: number): string => formatCurrency(v, baseCurrency)

  const columns: DataColumn<DividendGroup>[] = [
    {
      key: 'symbol',
      header: 'Ticker',
      rowHeader: true,
      cell: (s) => (
        <>
          {s.label}
          <InstrumentName symbol={s.label} description={s.description ?? ''} />
        </>
      ),
      sortValue: (s) => s.label,
    },
    {
      key: 'gross',
      header: 'Gross',
      numeric: true,
      cell: (s) => c(s.grossBase),
      sortValue: (s) => s.grossBase,
    },
    {
      key: 'withholding',
      header: 'Withholding',
      numeric: true,
      cell: (s) => c(s.withholdingBase),
      sortValue: (s) => s.withholdingBase,
    },
    {
      key: 'net',
      header: 'Net',
      numeric: true,
      cell: (s) => c(s.netBase),
      sortValue: (s) => s.netBase,
    },
  ]

  return (
    <DataTable
      caption="Dividend income by ticker"
      columns={columns}
      rows={groups}
      rowKey={(s) => s.key}
    />
  )
}

/**
 * The dividend cash-transactions table (Story #32): filterable by transaction type and
 * capped to ~5 rows, the rest reached by scrolling within the panel. Holds its own filter
 * state, so it lives as a child rather than lifting hooks above the view's early returns.
 *
 * Story #74 adds the shares held behind each payment and the amount per share. Both are
 * derived (Flex cash rows carry no quantity) and both are shown in the payment's own
 * currency, matching the Amount column and the Upcoming table's rate — the base-currency
 * conversion of the row stays in the final column. See DDR-0016.
 *
 * Story #75 adds a time-range filter composing with the type chips: the period narrows the
 * rows first, the types then narrow those, and the count reports what survives both. The type
 * chips stay derived from *all* events, so narrowing the period never makes a chip disappear
 * mid-selection. See DDR-0017.
 */
function Transactions({
  events,
  baseCurrency,
}: {
  events: DividendEvent[]
  baseCurrency: string
}): React.JSX.Element {
  const { selected, toggle, clear } = useTypeSelection()
  const { range, setRange, custom, editCustom } = useRangeSelection()
  const c = (v: number): string => formatCurrency(v, baseCurrency)

  const extent = datedExtent(events, (e) => e.date)
  const customBounds = custom ?? extent ?? { from: 0, to: 0 }
  const bounds = windowFor(range, extent, customBounds)

  const types = distinctTypes(events, (e) => e.type)
  const inRange = filterByRange(events, (e) => e.date, bounds)
  const rows = filterByTypes(inRange, (e) => e.type, selected)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Transactions</CardTitle>
        <div className="card-toolbar">
          <RangeFilter
            label="Transactions time range"
            range={range}
            onSelect={setRange}
            extent={extent}
            custom={customBounds}
            onEditCustom={(edge, value) => editCustom(edge, value, customBounds)}
          />
          <TypeFilter
            label="type"
            types={types}
            selected={selected}
            onToggle={toggle}
            onClear={clear}
            shown={rows.length}
            total={events.length}
          />
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <StatePanel surface="inline">No transactions match these filters.</StatePanel>
        ) : (
          <>
            <p className="source-note">
              Shares held are reconstructed from your imported trade history as of the day before
              the ex-date, and the per-share figure is the row’s own amount divided by them — both
              in the payment’s currency. A row shows “—” when the imported statements don’t reach
              back far enough to account for the position.
            </p>
            <DataTable
              caption="Dividend transactions"
              columns={transactionColumns(baseCurrency, c)}
              rows={rows}
              rowKey={(e, i) => `${e.symbol}-${e.date ?? 'na'}-${e.type}-${i}`}
              height="capped"
            />
          </>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * The transaction columns. Sorting composes with the two filters above rather than replacing
 * them (DDR-0017, DDR-0039): the period narrows the rows, the type chips narrow those, and the
 * table reorders whatever survives — which is why the chips' "N of M shown" count is unaffected.
 *
 * Shares and per-share are reconstructed and can legitimately be absent for a payment the
 * imported statements don't reach back far enough to account for; those rows sort to the bottom
 * instead of reading as zero holdings.
 *
 * Story #192 badges the type and tones the base-currency column, and both take their polarity
 * from **the row's own signed amount** rather than from a list of type strings (DDR-0064). The
 * three types the service builds this table from are `Dividends`, `Payment In Lieu Of Dividends`
 * and `Withholding Tax`, and matching on those names would put two of them in one branch by
 * coincidence and leave a fourth — a reversal, a fee IBKR renames — falling into the gain tone
 * silently. The amount already answers the question the tone is asking: money in, or money out.
 *
 * The badge's text is still the type's own name, so the tone is a second channel rather than the
 * only one, and the column still sorts on `e.type` — a badge is what the cell *renders*, not
 * what it holds.
 */
function transactionColumns(
  baseCurrency: string,
  c: (v: number) => string,
): DataColumn<DividendEvent>[] {
  return [
    {
      key: 'date',
      header: 'Date',
      cell: (e) => (e.date != null ? formatDate(e.date) : '—'),
      sortValue: (e) => e.date,
    },
    {
      key: 'symbol',
      header: 'Ticker',
      rowHeader: true,
      cell: (e) => (
        <>
          {e.symbol || '—'}
          <InstrumentName symbol={e.symbol} description={e.description} />
        </>
      ),
      sortValue: (e) => e.symbol || null,
    },
    {
      key: 'type',
      header: 'Type',
      cell: (e) => (
        <Badge variant={toneOf(e.amountBase)} size="sm" className={BADGE_CELL_CLASS}>
          {e.type}
        </Badge>
      ),
      sortValue: (e) => e.type,
    },
    {
      key: 'shares',
      header: 'Shares',
      numeric: true,
      cell: (e) => (e.sharesHeld != null ? formatQuantity(e.sharesHeld) : '—'),
      sortValue: (e) => e.sharesHeld,
    },
    {
      key: 'perShare',
      header: 'Per share',
      numeric: true,
      cell: (e) => (e.perShareNative != null ? formatPerShare(e.perShareNative, e.currency) : '—'),
      sortValue: (e) => e.perShareNative,
    },
    {
      key: 'amount',
      header: 'Amount',
      numeric: true,
      cell: (e) => formatCurrency(e.amountNative, e.currency),
      sortValue: (e) => e.amountNative,
    },
    {
      key: 'amountBase',
      header: `In ${baseCurrency}`,
      numeric: true,
      cell: (e) => c(e.amountBase),
      cellClassName: (e) => toneClassName(toneOf(e.amountBase)),
      sortValue: (e) => e.amountBase,
    },
  ]
}
