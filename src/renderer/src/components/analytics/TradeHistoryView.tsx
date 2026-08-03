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
import { datedExtent, filterByRange, windowFor } from '../../lib/dateRange'
import { distinctTypes, filterByTypes } from '../../lib/tableFilter'
import { useTypeSelection } from './useTypeSelection'
import { useAnalytics } from './useAnalytics'
import { NeedsImport } from './NeedsImport'
import { RangeFilter } from './RangeFilter'
import { RefreshBar } from './RefreshBar'
import { StatRow, StatTile } from '../ui/StatTile'
import { statPartClassName, toneClassName, toneOf } from '../../lib/statTileVariants'
import { TypeFilter } from './TypeFilter'
import { useRangeSelection } from './useRangeSelection'
import { Button } from '../ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card'
import { StatePanel } from '../ui/StatePanel'

/**
 * Realized gains & trade history (Milestone M3, Story #24). Lists trades from the
 * imported Flex data and summarises realized P&L per symbol — with short-/long-term
 * split and totals — in the base currency, plus total unrealized P&L for context.
 */
export function TradeHistoryView(): React.JSX.Element {
  const { state, refreshing, loadedAt, reload } = useAnalytics<RealizedGainsResult>(
    window.api.getRealizedGains,
  )

  if (state.phase === 'loading') {
    return <StatePanel variant="loading">Loading trade history…</StatePanel>
  }
  if (state.phase === 'error') {
    return (
      <StatePanel
        variant="error"
        heading="Couldn’t load trade history"
        action={
          <Button variant="primary" disabled={refreshing} onClick={() => void reload()}>
            {refreshing ? 'Retrying…' : 'Retry'}
          </Button>
        }
      >
        {state.message}
      </StatePanel>
    )
  }
  if (state.result.status === 'needs_import') {
    return <NeedsImport />
  }

  const r = state.result.report
  const sc = (v: number): string => formatSignedCurrency(v, r.baseCurrency)

  return (
    <div className="analytics-view">
      <RefreshBar
        label="trades and realized gains"
        loadedAt={loadedAt}
        refreshing={refreshing}
        onRefresh={() => void reload()}
      />

      <StatRow>
        <StatTile label="Realized P&L" value={sc(r.totalRealized)} tone={toneOf(r.totalRealized)} />
        <StatTile label="Short-term" value={sc(r.totalRealizedShortTerm)} tone={toneOf(r.totalRealizedShortTerm)} />
        <StatTile label="Long-term" value={sc(r.totalRealizedLongTerm)} tone={toneOf(r.totalRealizedLongTerm)} />
        <StatTile label="Unrealized P&L" value={sc(r.totalUnrealized)} tone={toneOf(r.totalUnrealized)} />
      </StatRow>

      <Card>
        <CardTitle>Realized gains by Ticker</CardTitle>
        <CardContent>
          {r.bySymbol.length === 0 ? (
            <StatePanel surface="inline">No closed positions with realized P&L yet.</StatePanel>
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
                        <td className={toneClassName(toneOf(s.realizedShortTerm), 'num')}>{sc(s.realizedShortTerm)}</td>
                        <td className={toneClassName(toneOf(s.realizedLongTerm), 'num')}>{sc(s.realizedLongTerm)}</td>
                        <td className={toneClassName(toneOf(s.totalRealized), 'num')}>{sc(s.totalRealized)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <RealizedHighlights bySymbol={r.bySymbol} sc={sc} />
            </div>
          )}
        </CardContent>
      </Card>

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

/**
 * Not a `StatTile` (Story #129): a symbol line sits between the label and the figure, and the
 * figure is deliberately secondary — it annotates the table beside it rather than heading the
 * view. What it does share is the label treatment, which was a byte-identical third copy of
 * `.stat-label`, and the tone.
 */
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
    <Card as="div" variant="nested" size="sm">
      <p className={statPartClassName('label')}>{label}</p>
      <p className="highlight-symbol">
        {item.symbol}
        <span className="flex-import-file">{item.description}</span>
      </p>
      <p className={toneClassName(toneOf(item.totalRealized), 'highlight-value')}>
        {sc(item.totalRealized)}
      </p>
    </Card>
  )
}

/**
 * The trade-history table (Story #33): filterable by trade type (FX / Buy / Sell) and
 * capped to ~5 rows, the rest reached by scrolling within the panel. Holds its own filter
 * state, so it lives as a child rather than lifting hooks above the view's early returns.
 *
 * Story #75 adds a time-range filter composing with the type chips: the period narrows the
 * rows first, the types then narrow those, and the count reports what survives both. A trade
 * IBKR reports without a timestamp drops out while a period is active — it can't be shown to
 * belong to one — and returns under "All". See DDR-0017.
 */
function TradeHistory({
  trades,
  baseCurrency,
}: {
  trades: TradeRow[]
  baseCurrency: string
}): React.JSX.Element {
  const { selected, toggle, clear } = useTypeSelection()
  const { range, setRange, custom, editCustom } = useRangeSelection()
  const sc = (v: number): string => formatSignedCurrency(v, baseCurrency)

  const extent = datedExtent(trades, (t) => t.dateTime)
  const customBounds = custom ?? extent ?? { from: 0, to: 0 }
  const bounds = windowFor(range, extent, customBounds)

  const types = distinctTypes(trades, (t) => t.tradeType)
  const inRange = filterByRange(trades, (t) => t.dateTime, bounds)
  const rows = filterByTypes(inRange, (t) => t.tradeType, selected)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trade history</CardTitle>
        <div className="card-toolbar">
          <RangeFilter
            label="Trade history time range"
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
            total={trades.length}
          />
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <StatePanel surface="inline">No trades match these filters.</StatePanel>
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
                    <td className={toneClassName(toneOf(t.realizedBase), 'num')}>
                      {t.realizedNative !== 0 ? sc(t.realizedBase) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
