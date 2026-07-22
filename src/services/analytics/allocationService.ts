import {
  flexReadRepository,
  type OpenPositionRow,
  type SecurityRow,
} from '@repositories/flex/flexReadRepository'
import type { AllocationPosition, AllocationResult, AllocationSlice } from '@shared/domain/allocation'

/**
 * Allocation analytics (Milestone M3, Story #22). Values the latest imported
 * statement's open positions in the base currency and breaks the portfolio down by
 * asset class, currency, issuer country, and individual position. See DDR-0005.
 *
 * Base-currency conversion uses each position's Flex `fxRateToBase`; the weight of a
 * position uses the Flex-provided `percentOfNav` (share of NAV, which includes cash),
 * so grouped weights sum those percentages. Reaches data only through
 * `flexReadRepository`.
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

    const positions: AllocationPosition[] = latest.positions
      .map((p) => ({
        conid: p.conid,
        symbol: p.symbol,
        description: p.description,
        assetCategory: p.assetCategory,
        currency: p.currency,
        issuerCountry: countryOf(p),
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
        byAssetClass: groupBy(positions, (p) => p.assetCategory, assetClassLabel),
        byCurrency: groupBy(positions, (p) => p.currency, (c) => c || 'Unknown'),
        byCountry: groupBy(positions, (p) => p.issuerCountry, (c) => c || 'Unknown'),
      },
    }
  },
}
