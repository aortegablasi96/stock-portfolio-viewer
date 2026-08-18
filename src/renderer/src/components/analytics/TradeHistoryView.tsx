import type {
  RealizedBySymbol,
  RealizedGainsReport,
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
import { AnalyticsShell } from './AnalyticsShell'
import { RangeFilter } from './RangeFilter'
import { StatRow, StatTile } from '../ui/StatTile'
import { statPartClassName, toneClassName, toneOf } from '../../lib/statTileVariants'
import { TypeFilter } from './TypeFilter'
import { useRangeSelection } from './useRangeSelection'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card'
import { StatePanel } from '../ui/StatePanel'
import { DataTable, type DataColumn } from '../ui/DataTable'

/**
 * Realized gains & trade history (Milestone M3, Story #24). Lists trades from the
 * imported Flex data and summarises realized P&L per symbol — with short-/long-term
 * split and totals — in the base currency, plus total unrealized P&L for context.
 */
export function TradeHistoryView(): React.JSX.Element {
  const analytics = useAnalytics<RealizedGainsResult>(window.api.getRealizedGains)

  // This is the view where all three of the shell's nouns disagree, which is why they are three
  // props rather than one: the page is titled "Trades & realized gains", it loads "trade history",
  // and the Refresh action refreshes "trades and realized gains".
  return (
    <AnalyticsShell<RealizedGainsReport>
      title="Trades & realized gains"
      subject="trade history"
      refreshLabel="trades and realized gains"
      analytics={analytics}
    >
      {(r) => {
        const sc = (v: number): string => formatSignedCurrency(v, r.baseCurrency)

        return (
          <>
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
                  <StatePanel surface="inline">
                    No closed positions with realized P&L yet.
                  </StatePanel>
                ) : (
                  <div className="realized-split">
                    <DataTable
                      caption="Realized gains by ticker"
                      columns={realizedColumns(sc)}
                      rows={r.bySymbol}
                      rowKey={(s) => s.conid ?? s.symbol}
                      height="capped"
                    />
                    <RealizedHighlights bySymbol={r.bySymbol} sc={sc} />
                  </div>
                )}
              </CardContent>
            </Card>

            <TradeHistory trades={r.trades} baseCurrency={r.baseCurrency} />
          </>
        )
      }}
    </AnalyticsShell>
  )
}

/**
 * The per-instrument realized-P&L columns. The three figures are signed, so each cell wears its
 * own tone (DDR-0034) — which is what `cellClassName` is for: the table places the class, the
 * row decides what it is.
 */
function realizedColumns(sc: (v: number) => string): DataColumn<RealizedBySymbol>[] {
  return [
    {
      key: 'symbol',
      header: 'Ticker',
      rowHeader: true,
      cell: (s) => (
        <>
          {s.symbol}
          <span className="flex-import-file">{s.description}</span>
        </>
      ),
      sortValue: (s) => s.symbol,
    },
    {
      key: 'shortTerm',
      header: 'Short-term',
      numeric: true,
      cellClassName: (s) => toneClassName(toneOf(s.realizedShortTerm)),
      cell: (s) => sc(s.realizedShortTerm),
      sortValue: (s) => s.realizedShortTerm,
    },
    {
      key: 'longTerm',
      header: 'Long-term',
      numeric: true,
      cellClassName: (s) => toneClassName(toneOf(s.realizedLongTerm)),
      cell: (s) => sc(s.realizedLongTerm),
      sortValue: (s) => s.realizedLongTerm,
    },
    {
      key: 'total',
      header: 'Total realized',
      numeric: true,
      cellClassName: (s) => toneClassName(toneOf(s.totalRealized)),
      cell: (s) => sc(s.totalRealized),
      sortValue: (s) => s.totalRealized,
    },
  ]
}

/**
 * Best/worst standout symbols by realized P&L (Story #50), shown beside the capped
 * "Realized gains by symbol" table. `bySymbol` arrives sorted largest total first, so the
 * head is the best and the tail the worst; with a single symbol the two coincide and only
 * "Best" is shown to avoid a duplicate card.
 *
 * It reads the service's array, not the table's view of it (Story #134), so re-sorting the
 * table by short-term gain does not silently redefine "best".
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
          <DataTable
            caption="Trade history"
            columns={tradeColumns(sc)}
            rows={rows}
            rowKey={(t) => t.tradeKey}
            height="capped"
          />
        )}
      </CardContent>
    </Card>
  )
}

/**
 * The trade columns. Sorting composes with the period and the type chips rather than replacing
 * them (DDR-0017, DDR-0039) — the filters choose the rows, the table chooses the order — so the
 * chips' "N of M shown" count is untouched by it.
 *
 * Realized P&L renders an em dash where a trade closed nothing, and hands the comparator `null`
 * for it: an opening buy has no realized P&L, which is not the same as having realized zero and
 * should not sit between the small gains and the small losses.
 */
function tradeColumns(sc: (v: number) => string): DataColumn<TradeRow>[] {
  return [
    {
      key: 'date',
      header: 'Date',
      cell: (t) => (t.dateTime != null ? formatDateTime(t.dateTime) : '—'),
      sortValue: (t) => t.dateTime,
    },
    {
      key: 'symbol',
      header: 'Ticker',
      rowHeader: true,
      cell: (t) => (
        <>
          {t.symbol}
          <span className="flex-import-file">{t.description}</span>
        </>
      ),
      sortValue: (t) => t.symbol,
    },
    { key: 'side', header: 'Side', cell: (t) => t.side, sortValue: (t) => t.side },
    {
      key: 'quantity',
      header: 'Quantity',
      numeric: true,
      cell: (t) => formatQuantity(t.quantity),
      sortValue: (t) => t.quantity,
    },
    {
      key: 'price',
      header: 'Price',
      numeric: true,
      cell: (t) => formatCurrency(t.tradePrice, t.currency),
      sortValue: (t) => t.tradePrice,
    },
    {
      key: 'proceeds',
      header: 'Proceeds',
      numeric: true,
      cell: (t) => formatCurrency(t.proceedsNative, t.currency),
      sortValue: (t) => t.proceedsNative,
    },
    {
      key: 'commission',
      header: 'Commission',
      numeric: true,
      cell: (t) => formatCurrency(t.commissionNative, t.currency),
      sortValue: (t) => t.commissionNative,
    },
    {
      key: 'realized',
      header: 'Realized P&L',
      numeric: true,
      cellClassName: (t) => toneClassName(toneOf(t.realizedBase)),
      cell: (t) => (t.realizedNative !== 0 ? sc(t.realizedBase) : '—'),
      sortValue: (t) => (t.realizedNative !== 0 ? t.realizedBase : null),
    },
  ]
}
