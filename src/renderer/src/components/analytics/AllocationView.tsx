import { useState } from 'react'
import type { AllocationReport, AllocationResult, AllocationSlice } from '@shared/domain/allocation'
import { formatCurrency, formatDate, formatSignedCurrency } from '../../lib/format'
import { SECTOR_SLOT_OFFSET } from '../../lib/pie'
import { CountryMap, type MapColorMode } from '../charts/CountryMap'
import { AllocationBreakdown } from './AllocationBreakdown'
import { useAnalytics } from './useAnalytics'
import { ClassifySectors } from './ClassifySectors'
import { NeedsImport } from './NeedsImport'
import { RefreshBar } from './RefreshBar'
import { StatRow, StatTile } from '../ui/StatTile'
import { toneClassName, toneOf } from '../../lib/statTileVariants'
import { Button } from '../ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card'
import { ToggleGroup } from '../ui/ToggleGroup'

/**
 * Allocation analysis (Milestone M3, Stories #22, #30 and #48). Breaks the latest imported
 * positions down by asset class, sector, issuer country and currency. A tab selector
 * switches between the breakdowns; each renders as a composing-slices table beside its
 * donut (`AllocationBreakdown`). Below, a world map locates the holdings and a positions
 * table lists each holding's base-currency market value, cost basis, and unrealized P&L.
 *
 * Sector is the one dimension not present in Flex statements; it comes from the locally
 * cached IBKR classification, so positions can legitimately be unclassified until the
 * owner runs the (opt-in, gateway-backed) classification action.
 */
const BREAKDOWN_TABS = [
  { id: 'assetClass', label: 'Asset class', title: 'By asset class' },
  { id: 'sector', label: 'Sector', title: 'By sector' },
  { id: 'country', label: 'Country', title: 'By geography (issuer country)' },
  { id: 'currency', label: 'Currency', title: 'By currency' },
] as const
type BreakdownTab = (typeof BREAKDOWN_TABS)[number]['id']

/**
 * What the map's marks encode with colour (Story #95). Sector is the default — the map opens the
 * way it always has, and gain/loss is something the owner asks for. Deliberately not persisted:
 * the question "where am I losing money?" is one you ask, not a mode you live in.
 */
const COLOR_MODES = [
  { id: 'sector', label: 'Sector' },
  { id: 'gainLoss', label: 'Gain/loss' },
] as const satisfies readonly { id: MapColorMode; label: string }[]

function slicesFor(report: AllocationReport, tab: BreakdownTab): AllocationSlice[] {
  switch (tab) {
    case 'assetClass':
      return report.byAssetClass
    case 'sector':
      return report.bySector
    case 'country':
      return report.byCountry
    case 'currency':
      return report.byCurrency
  }
}

export function AllocationView(): React.JSX.Element {
  const { state, refreshing, loadedAt, reload } = useAnalytics<AllocationResult>(
    window.api.getAllocation,
  )
  const [tab, setTab] = useState<BreakdownTab>('assetClass')
  const [colorMode, setColorMode] = useState<MapColorMode>('sector')

  if (state.phase === 'loading') {
    return (
      <Card as="p" size="lg" className="state-panel" role="status">
        Loading allocation…
      </Card>
    )
  }
  if (state.phase === 'error') {
    return (
      <Card size="lg" className="state-panel state-error" role="alert">
        <h2>Couldn’t load allocation</h2>
        <p>{state.message}</p>
        <Button variant="primary" disabled={refreshing} onClick={() => void reload()}>
          {refreshing ? 'Retrying…' : 'Retry'}
        </Button>
      </Card>
    )
  }
  if (state.result.status === 'needs_import') {
    return <NeedsImport />
  }

  const r = state.result.report
  const c = (v: number): string => formatCurrency(v, r.baseCurrency)
  const top = r.positions[0]
  const activeTab = BREAKDOWN_TABS.find((t) => t.id === tab)!

  return (
    <div className="analytics-view">
      <RefreshBar
        label="allocation"
        loadedAt={loadedAt}
        refreshing={refreshing}
        onRefresh={() => void reload()}
      />

      <StatRow>
        <StatTile label="Invested value" value={c(r.totalMarketValueBase)} hint={r.reportDate ? `As of ${formatDate(r.reportDate)}` : undefined} />
        <StatTile label="Positions" value={String(r.positions.length)} />
        {top && <StatTile label="Largest holding" value={top.symbol} hint={`${top.percentOfNav.toFixed(1)}% of NAV`} />}
      </StatRow>

      <Card>
        <CardHeader>
          <CardTitle>By geography &amp; sector (world map)</CardTitle>
          <ToggleGroup
            label="Map colour"
            options={COLOR_MODES}
            value={colorMode}
            onSelect={setColorMode}
          />
        </CardHeader>
        <CardContent>
          <CountryMap
            positions={r.positions}
            bySector={r.bySector}
            formatValue={c}
            formatSigned={(v) => formatSignedCurrency(v, r.baseCurrency)}
            colorMode={colorMode}
            // The map's marks are hover-only — they carry no text a screen reader can reach, and
            // keyboard operation is a separate story (#93). The map no longer draws individual
            // holdings at all (DDR-0030), so this label states what it totals and points at the
            // Positions table below, which is where one company's figures are read.
            ariaLabel={`World map of ${r.positions.length} holdings totalling ${c(
              r.totalMarketValueBase,
            )}, drawn as a pair of radial charts per issuer country — the country's weight in the portfolio, and one ring per sector — coloured by ${
              colorMode === 'sector' ? 'sector' : 'unrealized return'
            }. Every holding is listed individually in the Positions table below.`}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle id="allocation-breakdown-title">{activeTab.title}</CardTitle>
          <ToggleGroup
            label="Allocation breakdown"
            // `title` here is the card's heading, not a tooltip — the shape a `ToggleOption`
            // would otherwise pick up structurally and hang off every button.
            options={BREAKDOWN_TABS.map(({ id, label }) => ({ id, label }))}
            value={tab}
            onSelect={setTab}
          />
        </CardHeader>
        <CardContent>
          <AllocationBreakdown
            key={tab}
            slices={slicesFor(r, tab)}
            formatValue={c}
            ariaLabel={`Allocation ${activeTab.title.toLowerCase()}`}
            // Sectors skip the palette's blue, which the map reserves for a country's weight. The
            // skip has to apply here too, or a sector would wear one hue on the map and another in
            // its own donut (Story #122).
            colorOffset={tab === 'sector' ? SECTOR_SLOT_OFFSET : 0}
            emptyMessage={tab === 'sector' ? 'No sector data yet.' : 'Nothing to plot yet.'}
          />
          {tab === 'sector' && r.unclassifiedCount > 0 && (
            <ClassifySectors unclassifiedCount={r.unclassifiedCount} onClassified={() => void reload()} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardTitle>Positions</CardTitle>
        <CardContent>
          <div className="table-scroll">
            <table className="holdings-table">
              <thead>
                <tr>
                  <th scope="col">Ticker</th>
                  <th scope="col">Country</th>
                  <th scope="col">Sector</th>
                  <th scope="col" className="num">Market value</th>
                  <th scope="col" className="num">Cost basis</th>
                  <th scope="col" className="num">Unrealized P&L</th>
                  <th scope="col" className="num">% of NAV</th>
                </tr>
              </thead>
              <tbody>
                {r.positions.map((p) => (
                  <tr key={p.conid ?? p.symbol}>
                    <th scope="row" className="symbol">
                      {p.symbol}
                      <span className="flex-import-file">{p.description}</span>
                    </th>
                    <td>{p.issuerCountry || '—'}</td>
                    <td>{p.sector || '—'}</td>
                    <td className="num">{c(p.marketValueBase)}</td>
                    <td className="num">{c(p.costBasisBase)}</td>
                    <td className={toneClassName(toneOf(p.unrealizedPnlBase), 'num')}>
                      {formatSignedCurrency(p.unrealizedPnlBase, r.baseCurrency)}
                    </td>
                    <td className="num">{p.percentOfNav.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
