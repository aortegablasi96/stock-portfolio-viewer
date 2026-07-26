import type {
  RealizedBySymbol,
  RealizedGainsResult,
  TradeRow,
} from '@shared/domain/realizedGains'
import {
  formatCurrency,
  formatDateTime,
  formatQuantity,
  formatSignedCurrency,
} from '../../lib/format'
import { distinctTypes, filterByTypes } from '../../lib/tableFilter'
import { useTypeSelection } from './useTypeSelection'
import { useAnalytics } from './useAnalytics'
import { NeedsImport } from './NeedsImport'
import { StatTile, toneOf } from './StatTile'
import { TypeFilter } from './TypeFilter'

/**
 * Realized gains & trade history (Milestone M3, Story #24). Lists trades from the
 * imported Flex data and summarises realized P&L per symbol — with short-/long-term
 * split and totals — in the base currency, plus total unrealized P&L for context.
 */
export function TradeHistoryView(): React.JSX.Element {
  const { state, reload } = useAnalytics<RealizedGainsResult>(window.api.getRealizedGains)

  if (state.phase === 'loading') {
    return (
      <p className="state-panel" role="status">
        Loading trade history…
      </p>
    )
  }
  if (state.phase === 'error') {
    return (
      <section className="state-panel state-error" role="alert">
        <h2>Couldn’t load trade history</h2>
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
  const sc = (v: number): string => formatSignedCurrency(v, r.baseCurrency)

  return (
    <div className="analytics-view">
      <div className="stat-row">
        <StatTile label="Realized P&L" value={sc(r.totalRealized)} tone={toneOf(r.totalRealized)} />
        <StatTile label="Short-term" value={sc(r.totalRealizedShortTerm)} tone={toneOf(r.totalRealizedShortTerm)} />
        <StatTile label="Long-term" value={sc(r.totalRealizedLongTerm)} tone={toneOf(r.totalRealizedLongTerm)} />
        <StatTile label="Unrealized P&L" value={sc(r.totalUnrealized)} tone={toneOf(r.totalUnrealized)} />
      </div>

      <section className="panel">
        <h2 className="panel-title">Realized gains by Ticker</h2>
        {r.bySymbol.length === 0 ? (
          <p className="snapshot-empty">No closed positions with realized P&L yet.</p>
        ) : (
          <div className="realized-split">
            <div className="table-scroll table-scroll-rows">
              <table className="holdings-table">
                <thead>
                  <tr>
                    <th scope="col">Ticker</th>
                    <th scope="col" className="num">Short-term</th>
                    <th scope="col" className="num">Long-term</th>
                    <th scope="col" className="num">Total realized</th>
                  </tr>
                </thead>
                <tbody>
                  {r.bySymbol.map((s) => (
                    <tr key={s.conid ?? s.symbol}>
                      <th scope="row" className="symbol">
                        {s.symbol}
                        <span className="flex-import-file">{s.description}</span>
                      </th>
                      <td className={`num stat-${toneOf(s.realizedShortTerm)}`}>{sc(s.realizedShortTerm)}</td>
                      <td className={`num stat-${toneOf(s.realizedLongTerm)}`}>{sc(s.realizedLongTerm)}</td>
                      <td className={`num stat-${toneOf(s.totalRealized)}`}>{sc(s.totalRealized)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <RealizedHighlights bySymbol={r.bySymbol} sc={sc} />
          </div>
        )}
      </section>

      <TradeHistory trades={r.trades} baseCurrency={r.baseCurrency} />
    </div>
  )
}

/**
 * Best/worst standout symbols by realized P&L (Story #50), shown beside the capped
 * "Realized gains by symbol" table. `bySymbol` arrives sorted largest total first, so the
 * head is the best and the tail the worst; with a single symbol the two coincide and only
 * "Best" is shown to avoid a duplicate card.
 */
function RealizedHighlights({
  bySymbol,
  sc,
}: {
  bySymbol: RealizedBySymbol[]
  sc: (v: number) => string
}): React.JSX.Element {
  const best = bySymbol[0]
  if (best === undefined) return <></>
  const worst = bySymbol.length > 1 ? bySymbol[bySymbol.length - 1] : undefined
  return (
    <aside className="highlights" aria-label="Standout realized P&L">
      <HighlightCard label="Best" item={best} sc={sc} />
      {worst && <HighlightCard label="Worst" item={worst} sc={sc} />}
    </aside>
  )
}

function HighlightCard({
  label,
  item,
  sc,
}: {
  label: string
  item: RealizedBySymbol
  sc: (v: number) => string
}): React.JSX.Element {
  return (
    <div className="highlight-card">
      <p className="highlight-label">{label}</p>
      <p className="highlight-symbol">
        {item.symbol}
        <span className="flex-import-file">{item.description}</span>
      </p>
      <p className={`highlight-value stat-${toneOf(item.totalRealized)}`}>
        {sc(item.totalRealized)}
      </p>
    </div>
  )
}

/**
 * The trade-history table (Story #33): filterable by trade type (FX / Buy / Sell) and
 * capped to ~5 rows, the rest reached by scrolling within the panel. Holds its own filter
 * state, so it lives as a child rather than lifting hooks above the view's early returns.
 */
function TradeHistory({
  trades,
  baseCurrency,
}: {
  trades: TradeRow[]
  baseCurrency: string
}): React.JSX.Element {
  const { selected, toggle, clear } = useTypeSelection()
  const sc = (v: number): string => formatSignedCurrency(v, baseCurrency)

  const types = distinctTypes(trades, (t) => t.tradeType)
  const rows = filterByTypes(trades, (t) => t.tradeType, selected)

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="panel-title">Trade history</h2>
        <TypeFilter
          label="type"
          types={types}
          selected={selected}
          onToggle={toggle}
          onClear={clear}
          shown={rows.length}
          total={trades.length}
        />
      </div>
      {rows.length === 0 ? (
        <p className="chart-empty">No trades match this filter.</p>
      ) : (
        <div className="table-scroll table-scroll-rows">
          <table className="holdings-table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Ticker</th>
                <th scope="col">Side</th>
                <th scope="col" className="num">Quantity</th>
                <th scope="col" className="num">Price</th>
                <th scope="col" className="num">Proceeds</th>
                <th scope="col" className="num">Commission</th>
                <th scope="col" className="num">Realized P&L</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.tradeKey}>
                  <td>{t.dateTime != null ? formatDateTime(t.dateTime) : '—'}</td>
                  <th scope="row" className="symbol">
                    {t.symbol}
                    <span className="flex-import-file">{t.description}</span>
                  </th>
                  <td>{t.side}</td>
                  <td className="num">{formatQuantity(t.quantity)}</td>
                  <td className="num">{formatCurrency(t.tradePrice, t.currency)}</td>
                  <td className="num">{formatCurrency(t.proceedsNative, t.currency)}</td>
                  <td className="num">{formatCurrency(t.commissionNative, t.currency)}</td>
                  <td className={`num stat-${toneOf(t.realizedBase)}`}>
                    {t.realizedNative !== 0 ? sc(t.realizedBase) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
