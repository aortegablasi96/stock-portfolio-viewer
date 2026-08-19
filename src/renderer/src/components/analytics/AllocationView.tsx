import { useState } from 'react'
import type {
  AllocationPosition,
  AllocationReport,
  AllocationResult,
  AllocationSlice,
} from '@shared/domain/allocation'
import { formatCurrency, formatDate, formatSignedCurrency } from '../../lib/format'
import { SECTOR_SLOT_OFFSET } from '../../lib/pie'
import { CountryMap } from '../charts/CountryMap'
import { AllocationBreakdown } from './AllocationBreakdown'
import { InstrumentName } from './InstrumentName'
import { useAnalytics } from './useAnalytics'
import { AnalyticsShell } from './AnalyticsShell'
import { ClassifySectors } from './ClassifySectors'
import { StatRow, StatTile } from '../ui/StatTile'
import { toneClassName, toneOf } from '../../lib/statTileVariants'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card'
import { ToggleGroup } from '../ui/ToggleGroup'
import { DataTable, type DataColumn } from '../ui/DataTable'

/**
 * Allocation analysis (Milestone M3, Stories #22, #30 and #48). Breaks the latest imported
 * positions down by asset class, sector, issuer country and currency. A tab selector
 * switches between the breakdowns; each renders as a composing-slices table beside its
 * donut (`AllocationBreakdown`). Below, a world map locates the holdings and a positions
 * table lists each holding's base-currency market value, cost basis, and unrealized P&L.
 *
 * **The breakdown comes before the map** (Story #191, DDR-0063), which reverses the order
 * this view shipped in. The map is the tallest card on the page and the only approximate one
 * — it is positioned by issuer country and says so — while the breakdown is the exact answer
 * to the question the view is opened with. Putting a 3:1 map above it meant the figures began
 * below the fold on the window this app opens at.
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
  const analytics = useAnalytics<AllocationResult>(window.api.getAllocation)
  const [tab, setTab] = useState<BreakdownTab>('assetClass')

  // The breakdown tab stays above the shell: it is the view's own state, and the shell holds
  // none, so it survives a tab switch exactly as it did (DDR-0027).
  return (
    <AnalyticsShell<AllocationReport>
      title="Allocation"
      subject="allocation"
      analytics={analytics}
    >
      {(r) => {
        const c = (v: number): string => formatCurrency(v, r.baseCurrency)
        const top = r.positions[0]
        const activeTab = BREAKDOWN_TABS.find((t) => t.id === tab)!

        return (
          <>
            <StatRow>
              <StatTile label="Invested value" value={c(r.totalMarketValueBase)} hint={r.reportDate ? `As of ${formatDate(r.reportDate)}` : undefined} />
              <StatTile label="Positions" value={String(r.positions.length)} />
              {top && <StatTile label="Largest holding" value={top.symbol} hint={`${top.percentOfNav.toFixed(1)}% of NAV`} />}
            </StatRow>

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
                  // Sectors skip the palette's blue, which the map reserves for a country's weight.
                  // The skip has to apply here too, or a sector would wear one hue on the map and
                  // another in its own donut (Story #122).
                  colorOffset={tab === 'sector' ? SECTOR_SLOT_OFFSET : 0}
                  emptyMessage={tab === 'sector' ? 'No sector data yet.' : 'Nothing to plot yet.'}
                />
                {tab === 'sector' && r.unclassifiedCount > 0 && (
                  <ClassifySectors
                    unclassifiedCount={r.unclassifiedCount}
                    onClassified={() => void analytics.reload()}
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>By geography &amp; sector (world map)</CardTitle>
              </CardHeader>
              <CardContent>
                <CountryMap
                  positions={r.positions}
                  bySector={r.bySector}
                  formatValue={c}
                  formatSigned={(v) => formatSignedCurrency(v, r.baseCurrency)}
                  // The map's marks are hover-only — they carry no text a screen reader can reach,
                  // and keyboard operation is a separate story (#93). The map no longer draws
                  // individual holdings at all (DDR-0030), so this label states what it totals and
                  // points at the Positions table below, where one company's figures are read.
                  ariaLabel={`World map of ${r.positions.length} holdings totalling ${c(
                    r.totalMarketValueBase,
                  )}, drawn as a pair of radial charts per issuer country — the country's weight in the portfolio, and one ring per sector — coloured by sector. Every holding is listed individually in the Positions table below.`}
                />
              </CardContent>
            </Card>

            <Card>
              <CardTitle>Positions</CardTitle>
              <CardContent>
                <PositionsTable positions={r.positions} baseCurrency={r.baseCurrency} />
              </CardContent>
            </Card>
          </>
        )
      }}
    </AnalyticsShell>
  )
}

/**
 * The per-holding table below the map. It is where one company is read — the map is positioned
 * by issuer country and is deliberately approximate (DDR-0030) — which is why every column
 * sorts: "which position is losing me the most?" is answered here or nowhere.
 *
 * Country and sector hand the comparator `null` rather than the em dash they render, so an
 * unclassified position sorts as the absence it is instead of alphabetising under "—".
 */
function PositionsTable({
  positions,
  baseCurrency,
}: {
  positions: AllocationPosition[]
  baseCurrency: string
}): React.JSX.Element {
  const c = (v: number): string => formatCurrency(v, baseCurrency)

  const columns: DataColumn<AllocationPosition>[] = [
    {
      key: 'symbol',
      header: 'Ticker',
      rowHeader: true,
      cell: (p) => (
        <>
          {p.symbol}
          <InstrumentName symbol={p.symbol} description={p.description} />
        </>
      ),
      sortValue: (p) => p.symbol,
    },
    {
      key: 'country',
      header: 'Country',
      cell: (p) => p.issuerCountry || '—',
      sortValue: (p) => p.issuerCountry || null,
    },
    {
      key: 'sector',
      header: 'Sector',
      cell: (p) => p.sector || '—',
      sortValue: (p) => p.sector || null,
    },
    {
      key: 'marketValue',
      header: 'Market value',
      numeric: true,
      cell: (p) => c(p.marketValueBase),
      sortValue: (p) => p.marketValueBase,
    },
    {
      key: 'costBasis',
      header: 'Cost basis',
      numeric: true,
      cell: (p) => c(p.costBasisBase),
      sortValue: (p) => p.costBasisBase,
    },
    {
      key: 'unrealized',
      header: 'Unrealized P&L',
      numeric: true,
      cellClassName: (p) => toneClassName(toneOf(p.unrealizedPnlBase)),
      cell: (p) => formatSignedCurrency(p.unrealizedPnlBase, baseCurrency),
      sortValue: (p) => p.unrealizedPnlBase,
    },
    {
      key: 'percentOfNav',
      header: '% of NAV',
      numeric: true,
      cell: (p) => `${p.percentOfNav.toFixed(1)}%`,
      sortValue: (p) => p.percentOfNav,
    },
  ]

  return (
    <DataTable
      caption="Positions"
      columns={columns}
      rows={positions}
      rowKey={(p) => p.conid ?? p.symbol}
    />
  )
}
