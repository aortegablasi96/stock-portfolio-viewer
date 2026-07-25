import { classificationRepository } from '@repositories/classification/classificationRepository'
import {
  flexReadRepository,
  type OpenPositionRow,
  type SecurityRow,
} from '@repositories/flex/flexReadRepository'
import type { AllocationPosition, AllocationResult, AllocationSlice } from '@shared/domain/allocation'

/**
 * Allocation analytics (Milestone M3, Stories #22 and #30). Values the latest imported
 * statement's open positions in the base currency and breaks the portfolio down by
 * asset class, currency, issuer country, sector, and individual position. See DDR-0005.
 *
 * Base-currency conversion uses each position's Flex `fxRateToBase`; the weight of a
 * position uses the Flex-provided `percentOfNav` (share of NAV, which includes cash),
 * so grouped weights sum those percentages.
 *
 * Uninvested cash is added to the asset-class breakdown only (Story #47): the positions'
 * NAV weights sum to less than 100% exactly when cash is held, and that shortfall becomes a
 * 'Cash' slice — so the asset-class breakdown reflects the full portfolio. See `withCash`.
 *
 * Everything except sector comes from `flexReadRepository`. Flex carries no sector field,
 * so sector is joined in from the locally cached IBKR classification — a plain cache read,
 * never a network call, so this stays synchronous and works with the gateway closed
 * (DDR-0009). Positions with no cached sector fall into an 'Unclassified' slice.
 */

const ASSET_CLASS_LABELS: Record<string, string> = {
  STK: 'Stocks',
  ETF: 'ETFs',
  FUND: 'Funds',
  BOND: 'Bonds',
  OPT: 'Options',
  FOP: 'Futures Options',
  FUT: 'Futures',
  CASH: 'Cash / FX',
  WAR: 'Warrants',
}

function assetClassLabel(code: string): string {
  return ASSET_CLASS_LABELS[code] ?? (code || 'Other')
}

/**
 * Asset-class key for uninvested cash (Story #47). Deliberately distinct from the Flex
 * `CASH` asset category (forex/FX *positions*, labelled 'Cash / FX') so the two never merge.
 */
const CASH_ASSET_KEY = '__cash__'

/**
 * A gap under this many NAV percentage points is treated as rounding noise, not cash, so a
 * fully-invested portfolio shows no cash slice. Flex reports `percentOfNAV` to two decimals,
 * so summing N positions can drift by ~N × 0.005; 0.1 comfortably absorbs that.
 */
const CASH_MIN_PERCENT = 0.1

/**
 * Uninvested cash as its own asset-class slice, derived from the NAV weights the positions
 * already carry (Story #47). IBKR's `percentOfNAV` is share of NAV — which *includes* cash —
 * so any shortfall of the positions' summed weights below 100% is cash. Its base value scales
 * the invested total by that shortfall, keeping cash consistent with the percentages shown
 * without reading a separate NAV figure. Returns the list unchanged when the portfolio is
 * fully invested (or over-weighted by rounding), so a zero/negative cash slice never appears.
 */
function withCash(
  byAssetClass: AllocationSlice[],
  positions: AllocationPosition[],
  totalMarketValueBase: number,
): AllocationSlice[] {
  const investedPercent = positions.reduce((sum, p) => sum + p.percentOfNav, 0)
  const cashPercent = 100 - investedPercent
  if (investedPercent <= 0 || cashPercent < CASH_MIN_PERCENT) return byAssetClass

  const cashValueBase = (totalMarketValueBase * cashPercent) / investedPercent
  const cash: AllocationSlice = {
    key: CASH_ASSET_KEY,
    label: 'Cash',
    marketValueBase: cashValueBase,
    percentOfNav: cashPercent,
  }
  return [...byAssetClass, cash].sort((a, b) => b.marketValueBase - a.marketValueBase)
}

/** Market value of a position in its native currency: mark price when present, else cost + unrealized. */
function nativeMarketValue(p: OpenPositionRow): number {
  if (p.markPrice != null) return p.position * p.markPrice
  return (p.costBasisMoney ?? 0) + (p.fifoPnlUnrealized ?? 0)
}

/** Group positions by a key, summing base market value and NAV weight; largest value first. */
function groupBy(
  positions: AllocationPosition[],
  keyOf: (p: AllocationPosition) => string,
  labelOf: (key: string) => string,
): AllocationSlice[] {
  const groups = new Map<string, AllocationSlice>()
  for (const p of positions) {
    const key = keyOf(p)
    const slice = groups.get(key) ?? { key, label: labelOf(key), marketValueBase: 0, percentOfNav: 0 }
    slice.marketValueBase += p.marketValueBase
    slice.percentOfNav += p.percentOfNav
    groups.set(key, slice)
  }
  return [...groups.values()].sort((a, b) => b.marketValueBase - a.marketValueBase)
}

export const allocationService = {
  /** Assemble the allocation report, or signal that no Flex data has been imported. */
  getAllocation(): AllocationResult {
    const latest = flexReadRepository.getLatestOpenPositions()
    if (!latest) return { status: 'needs_import' }

    // Issuer country lookup: prefer conid, fall back to symbol (some rows carry no conid).
    const countryByConid = new Map<number, string>()
    const countryBySymbol = new Map<string, string>()
    for (const s of latest.securities as SecurityRow[]) {
      if (s.conid != null) countryByConid.set(s.conid, s.issuerCountryCode)
      if (s.symbol) countryBySymbol.set(s.symbol, s.issuerCountryCode)
    }
    const countryOf = (p: OpenPositionRow): string => {
      const code = (p.conid != null ? countryByConid.get(p.conid) : undefined) ?? countryBySymbol.get(p.symbol)
      return code ?? ''
    }

    // Sector lookup: same conid-then-symbol fallback as country, over the local cache.
    const classifications = classificationRepository.getAll()
    const classByConid = new Map(classifications.map((c) => [c.conid, c]))
    const classBySymbol = new Map(classifications.filter((c) => c.symbol).map((c) => [c.symbol, c]))
    const classOf = (p: OpenPositionRow): { sector: string; industry: string } => {
      const match = (p.conid != null ? classByConid.get(p.conid) : undefined) ?? classBySymbol.get(p.symbol)
      return { sector: match?.sector ?? '', industry: match?.industry ?? '' }
    }

    const positions: AllocationPosition[] = latest.positions
      .map((p) => ({
        conid: p.conid,
        symbol: p.symbol,
        description: p.description,
        assetCategory: p.assetCategory,
        currency: p.currency,
        issuerCountry: countryOf(p),
        ...classOf(p),
        marketValueBase: nativeMarketValue(p) * p.fxRateToBase,
        costBasisBase: (p.costBasisMoney ?? 0) * p.fxRateToBase,
        unrealizedPnlBase: (p.fifoPnlUnrealized ?? 0) * p.fxRateToBase,
        percentOfNav: p.percentOfNav ?? 0,
      }))
      .sort((a, b) => b.marketValueBase - a.marketValueBase)

    const totalMarketValueBase = positions.reduce((sum, p) => sum + p.marketValueBase, 0)

    return {
      status: 'ok',
      report: {
        baseCurrency: latest.baseCurrency,
        reportDate: latest.reportDate,
        totalMarketValueBase,
        positions,
        byAssetClass: withCash(
          groupBy(positions, (p) => p.assetCategory, assetClassLabel),
          positions,
          totalMarketValueBase,
        ),
        byCurrency: groupBy(positions, (p) => p.currency, (c) => c || 'Unknown'),
        byCountry: groupBy(positions, (p) => p.issuerCountry, (c) => c || 'Unknown'),
        bySector: groupBy(positions, (p) => p.sector, (s) => s || 'Unclassified'),
        unclassifiedCount: positions.filter((p) => !p.sector).length,
      },
    }
  },
}
