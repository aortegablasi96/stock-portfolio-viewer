import { useState } from 'react'
import type { DividendEvent, UpcomingDividends, DividendResult } from '@shared/domain/dividends'
import { formatCurrency, formatDate, formatMonth, formatQuantity } from '../../lib/format'
import { ALL_TYPES, distinctTypes, filterByType } from '../../lib/tableFilter'
import { ColumnChart, type StackedColumn } from '../charts/ColumnChart'
import { useAnalytics } from './useAnalytics'
import { NeedsImport } from './NeedsImport'
import { StatTile } from './StatTile'
import { TypeFilter } from './TypeFilter'

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
                  <th scope="col">Symbol</th>
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
                    <th scope="row" className="symbol">{i.symbol || '—'}</th>
                    <td className="num">{formatQuantity(i.quantity)}</td>
                    <td className="num">
                      {i.grossRate != null ? formatCurrency(i.grossRate, i.currency) : '—'}
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
        <h2 className="panel-title">By symbol</h2>
        <div className="table-scroll">
          <table className="holdings-table">
            <thead>
              <tr>
                <th scope="col">Symbol</th>
                <th scope="col" className="num">Gross</th>
                <th scope="col" className="num">Withholding</th>
                <th scope="col" className="num">Net</th>
              </tr>
            </thead>
            <tbody>
              {r.bySymbol.map((s) => (
                <tr key={s.key}>
                  <th scope="row" className="symbol">{s.label}</th>
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
 */
function Transactions({
  events,
  baseCurrency,
}: {
  events: DividendEvent[]
  baseCurrency: string
}): React.JSX.Element {
  const [type, setType] = useState<string>(ALL_TYPES)
  const c = (v: number): string => formatCurrency(v, baseCurrency)

  const types = distinctTypes(events, (e) => e.type)
  const rows = filterByType(events, (e) => e.type, type)

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="panel-title">Transactions</h2>
        <TypeFilter
          id="dividend-tx-filter"
          label="type"
          types={types}
          value={type}
          onChange={setType}
          shown={rows.length}
          total={events.length}
        />
      </div>
      {rows.length === 0 ? (
        <p className="chart-empty">No transactions match this filter.</p>
      ) : (
        <div className="table-scroll table-scroll-rows">
          <table className="holdings-table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Symbol</th>
                <th scope="col">Type</th>
                <th scope="col" className="num">Amount</th>
                <th scope="col" className="num">In {baseCurrency}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e, i) => (
                <tr key={`${e.symbol}-${e.date ?? 'na'}-${e.type}-${i}`}>
                  <td>{e.date != null ? formatDate(e.date) : '—'}</td>
                  <th scope="row" className="symbol">{e.symbol || '—'}</th>
                  <td>{e.type}</td>
                  <td className="num">{formatCurrency(e.amountNative, e.currency)}</td>
                  <td className="num">{c(e.amountBase)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
