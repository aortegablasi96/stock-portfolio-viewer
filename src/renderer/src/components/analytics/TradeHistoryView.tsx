import type { RealizedGainsResult } from '@shared/domain/realizedGains'
import {
  formatCurrency,
  formatDateTime,
  formatQuantity,
  formatSignedCurrency,
} from '../../lib/format'
import { useAnalytics } from './useAnalytics'
import { NeedsImport } from './NeedsImport'
import { StatTile, toneOf } from './StatTile'

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
        <h2 className="panel-title">Realized gains by symbol</h2>
        {r.bySymbol.length === 0 ? (
          <p className="snapshot-empty">No closed positions with realized P&L yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="holdings-table">
              <thead>
                <tr>
                  <th scope="col">Symbol</th>
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
        )}
      </section>

      <section className="panel">
        <h2 className="panel-title">Trade history</h2>
        <div className="table-scroll">
          <table className="holdings-table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Symbol</th>
                <th scope="col">Side</th>
                <th scope="col" className="num">Quantity</th>
                <th scope="col" className="num">Price</th>
                <th scope="col" className="num">Proceeds</th>
                <th scope="col" className="num">Commission</th>
                <th scope="col" className="num">Realized P&L</th>
              </tr>
            </thead>
            <tbody>
              {r.trades.map((t) => (
                <tr key={t.tradeKey}>
                  <td>{t.dateTime != null ? formatDateTime(t.dateTime) : '—'}</td>
                  <th scope="row" className="symbol">{t.symbol}</th>
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
      </section>
    </div>
  )
}
