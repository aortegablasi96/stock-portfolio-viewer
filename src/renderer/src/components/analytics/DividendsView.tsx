import type { DividendEvent, UpcomingDividends, DividendResult } from '@shared/domain/dividends'
import {
  formatCompanyName,
  formatCurrency,
  formatDate,
  formatMonth,
  formatPerShare,
  formatQuantity,
} from '../../lib/format'
import { datedExtent, filterByRange, windowFor } from '../../lib/dateRange'
import { distinctTypes, filterByTypes } from '../../lib/tableFilter'
import { useTypeSelection } from './useTypeSelection'
import { ColumnChart, type StackedColumn } from '../charts/ColumnChart'
import { useAnalytics } from './useAnalytics'
import { NeedsImport } from './NeedsImport'
import { RangeFilter } from './RangeFilter'
import { StatTile } from './StatTile'
import { TypeFilter } from './TypeFilter'
import { useRangeSelection } from './useRangeSelection'

/**
 * Dividend & income tracking (Milestone M3, Stories #23 and #31). Shows gross income,
 * withholding tax, and net income per symbol and per month, in the base currency,
 * read from imported Flex cash transactions. The monthly chart stacks net + withholding
 * so the column height reads as gross while the solid lower segment is what was
 * actually received. Above it, "Upcoming" lists dividends already declared but not yet
 * paid, from the latest statement's open accruals (DDR-0010).
 */

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
    <section className="panel">
      <h2 className="panel-title">Upcoming dividends</h2>
      {!upcoming.sectionPresent ? (
        <p className="chart-empty">
          Your imported statements carry no dividend accruals. Enable the{' '}
          <strong>Open Dividend Accruals</strong> section on your IBKR Flex Query, then re-export
          and import it to see dividends that have been announced but not yet paid.
        </p>
      ) : upcoming.items.length === 0 ? (
        <p className="chart-empty">
          No announced dividends are pending{asOf ? ` as of ${asOf}` : ''}.
        </p>
      ) : (
        <>
          <p className="source-note">
            Announced but not yet paid{asOf ? `, as of ${asOf}` : ''}. Expecting{' '}
            <strong>{c(upcoming.totalNetBase)}</strong> net ({c(upcoming.totalGrossBase)} gross,{' '}
            {c(upcoming.totalWithholdingBase)} expected withholding).
          </p>
          <div className="table-scroll">
            <table className="holdings-table">
              <thead>
                <tr>
                  <th scope="col">Pay date</th>
                  <th scope="col">Ex-date</th>
                  <th scope="col">Ticker</th>
                  <th scope="col" className="num">Quantity</th>
                  <th scope="col" className="num">Per share</th>
                  <th scope="col" className="num">Gross</th>
                  <th scope="col" className="num">Withholding</th>
                  <th scope="col" className="num">Net in {baseCurrency}</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.items.map((i) => (
                  <tr key={`${i.symbol}-${i.payDate ?? 'na'}-${i.exDate ?? 'na'}`}>
                    <td>{i.payDate != null ? formatDate(i.payDate) : '—'}</td>
                    <td>{i.exDate != null ? formatDate(i.exDate) : '—'}</td>
                    <th scope="row" className="symbol">
                      {i.symbol || '—'}
                      {i.description && (
                        <span className="flex-import-file">{formatCompanyName(i.description)}</span>
                      )}
                    </th>
                    <td className="num">{formatQuantity(i.quantity)}</td>
                    <td className="num">
                      {i.grossRate != null ? formatPerShare(i.grossRate, i.currency) : '—'}
                    </td>
                    <td className="num">{c(i.grossBase)}</td>
                    <td className="num">{c(i.withholdingBase)}</td>
                    <td className="num">{c(i.netBase)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
export function DividendsView(): React.JSX.Element {
  const { state, reload } = useAnalytics<DividendResult>(window.api.getDividends)

  if (state.phase === 'loading') {
    return (
      <p className="state-panel" role="status">
        Loading dividends…
      </p>
    )
  }
  if (state.phase === 'error') {
    return (
      <section className="state-panel state-error" role="alert">
        <h2>Couldn’t load dividends</h2>
        <p>{state.message}</p>
        <button type="button" className="retry-button" onClick={() => void reload()}>
          Retry
        </button>
      </section>
    )
  }
  if (state.result.status === 'needs_import') {
    return <NeedsImport onImported={() => void reload()} />
  }

  const r = state.result.report
  const c = (v: number): string => formatCurrency(v, r.baseCurrency)

  // Announced dividends can exist before any has ever been paid, so the "no income yet"
  // state still renders the upcoming panel rather than replacing the whole view.
  if (r.events.length === 0) {
    return (
      <div className="analytics-view">
        <section className="state-panel" role="status">
          <h2>No dividend income recorded</h2>
          <p>The imported statements contain no dividend or payment-in-lieu transactions.</p>
        </section>
        <Upcoming upcoming={r.upcoming} baseCurrency={r.baseCurrency} />
      </div>
    )
  }

  const columns: StackedColumn[] = r.byMonth.map((m) => ({
    key: m.key,
    label: formatMonth(m.key),
    lower: m.netBase,
    upper: m.withholdingBase,
  }))

  return (
    <div className="analytics-view">
      <div className="stat-row">
        <StatTile label="Gross income" value={c(r.totalGrossBase)} />
        <StatTile label="Withholding tax" value={c(r.totalWithholdingBase)} hint="Withheld at source" />
        <StatTile
          label="Net income"
          value={c(r.totalNetBase)}
          hint="Actually received"
          tone="positive"
        />
      </div>

      <Upcoming upcoming={r.upcoming} baseCurrency={r.baseCurrency} />

      <section className="panel">
        <h2 className="panel-title">Income over time</h2>
        <p className="source-note">
          Each column is the month’s net income received, with the tax withheld at source stacked
          on top — so the solid segment is what reached the account and the full height is gross.
          A month where withholding outweighs the dividends dips below the zero line as a net loss.
        </p>
        <ColumnChart
          columns={columns}
          formatValue={c}
          lowerLabel="Net received"
          upperLabel="Withholding tax"
          totalLabel="Gross"
          ariaLabel="Net dividend income by month, with withholding tax stacked to gross"
        />
      </section>

      <section className="panel">
        <h2 className="panel-title">By Ticker</h2>
        <div className="table-scroll">
          <table className="holdings-table">
            <thead>
              <tr>
                <th scope="col">Ticker</th>
                <th scope="col" className="num">Gross</th>
                <th scope="col" className="num">Withholding</th>
                <th scope="col" className="num">Net</th>
              </tr>
            </thead>
            <tbody>
              {r.bySymbol.map((s) => (
                <tr key={s.key}>
                  <th scope="row" className="symbol">
                    {s.label}
                    {s.description && (
                      <span className="flex-import-file">{formatCompanyName(s.description)}</span>
                    )}
                  </th>
                  <td className="num">{c(s.grossBase)}</td>
                  <td className="num">{c(s.withholdingBase)}</td>
                  <td className="num">{c(s.netBase)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Transactions events={r.events} baseCurrency={r.baseCurrency} />
    </div>
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
    <section className="panel">
      <div className="panel-header">
        <h2 className="panel-title">Transactions</h2>
        <div className="panel-toolbar">
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
      </div>
      {rows.length === 0 ? (
        <p className="chart-empty">No transactions match these filters.</p>
      ) : (
        <>
          <p className="source-note">
            Shares held are reconstructed from your imported trade history as of the day before
            the ex-date, and the per-share figure is the row’s own amount divided by them — both
            in the payment’s currency. A row shows “—” when the imported statements don’t reach
            back far enough to account for the position.
          </p>
          <div className="table-scroll table-scroll-rows">
            <table className="holdings-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Ticker</th>
                  <th scope="col">Type</th>
                  <th scope="col" className="num">Shares</th>
                  <th scope="col" className="num">Per share</th>
                  <th scope="col" className="num">Amount</th>
                  <th scope="col" className="num">In {baseCurrency}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e, i) => (
                  <tr key={`${e.symbol}-${e.date ?? 'na'}-${e.type}-${i}`}>
                    <td>{e.date != null ? formatDate(e.date) : '—'}</td>
                    <th scope="row" className="symbol">
                      {e.symbol || '—'}
                      {e.description && (
                        <span className="flex-import-file">{formatCompanyName(e.description)}</span>
                      )}
                    </th>
                    <td>{e.type}</td>
                    <td className="num">
                      {e.sharesHeld != null ? formatQuantity(e.sharesHeld) : '—'}
                    </td>
                    <td className="num">
                      {e.perShareNative != null
                        ? formatPerShare(e.perShareNative, e.currency)
                        : '—'}
                    </td>
                    <td className="num">{formatCurrency(e.amountNative, e.currency)}</td>
                    <td className="num">{c(e.amountBase)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
