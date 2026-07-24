import {
  flexReadRepository,
  type FifoSummaryRow,
} from '@repositories/flex/flexReadRepository'
import type {
  RealizedBySymbol,
  RealizedGainsResult,
  TradeRow,
} from '@shared/domain/realizedGains'

/**
 * Realized gains & trade-history analytics (Milestone M3, Story #24). The trade list
 * comes from the globally de-duped Flex `Trade` rows (continuous history); the
 * realized-P&L rollup — per symbol, with short-/long-term split and totals — comes
 * from the FIFO performance summaries (already in base currency). Per-trade realized
 * P&L is converted with the trade's Flex `fxRateToBase`. See DDR-0005.
 *
 * Reaches data only through `flexReadRepository`, so it is a pure unit-test target.
 */

function shortTerm(s: FifoSummaryRow): number {
  return s.realizedStProfit + s.realizedStLoss
}
function longTerm(s: FifoSummaryRow): number {
  return s.realizedLtProfit + s.realizedLtLoss
}

/** Aggregate FIFO summaries by instrument (summed across statements), realized activity only. */
function rollupBySymbol(summaries: FifoSummaryRow[]): RealizedBySymbol[] {
  const groups = new Map<string, RealizedBySymbol>()
  for (const s of summaries) {
    const key = s.conid != null ? `c:${s.conid}` : `s:${s.symbol}`
    const group = groups.get(key) ?? {
      conid: s.conid,
      symbol: s.symbol,
      description: s.description,
      realizedShortTerm: 0,
      realizedLongTerm: 0,
      totalRealized: 0,
    }
    group.realizedShortTerm += shortTerm(s)
    group.realizedLongTerm += longTerm(s)
    group.totalRealized += s.totalRealizedPnl
    groups.set(key, group)
  }
  return [...groups.values()]
    .filter((g) => g.totalRealized !== 0 || g.realizedShortTerm !== 0 || g.realizedLongTerm !== 0)
    .sort((a, b) => b.totalRealized - a.totalRealized)
}

export const realizedGainsService = {
  /** Assemble the realized-gains & trade-history report, or signal that no Flex data exists. */
  getRealizedGains(): RealizedGainsResult {
    if (!flexReadRepository.hasStatements()) return { status: 'needs_import' }

    const baseCurrency = flexReadRepository.baseCurrency() ?? 'EUR'
    const summaries = flexReadRepository.getFifoSummaries()

    const trades: TradeRow[] = flexReadRepository.getTrades().map((t) => {
      const realizedNative = t.fifoPnlRealized ?? 0
      const side: 'Buy' | 'Sell' = t.quantity < 0 ? 'Sell' : 'Buy'
      return {
        tradeKey: t.tradeKey,
        dateTime: t.dateTime,
        symbol: t.symbol,
        description: t.description,
        assetCategory: t.assetCategory,
        side,
        // CASH-category trades are IBKR's forex conversions; group them under one 'FX'
        // type so they can be filtered out to reveal the stock trades underneath.
        tradeType: t.assetCategory === 'CASH' ? 'FX' : side,
        quantity: Math.abs(t.quantity),
        tradePrice: t.tradePrice,
        currency: t.currency,
        proceedsNative: t.proceeds ?? 0,
        commissionNative: t.ibCommission ?? 0,
        realizedNative,
        realizedBase: realizedNative * t.fxRateToBase,
        openCloseIndicator: t.openCloseIndicator,
      }
    })

    const bySymbol = rollupBySymbol(summaries)

    return {
      status: 'ok',
      report: {
        baseCurrency,
        totalRealized: summaries.reduce((sum, s) => sum + s.totalRealizedPnl, 0),
        totalRealizedShortTerm: summaries.reduce((sum, s) => sum + shortTerm(s), 0),
        totalRealizedLongTerm: summaries.reduce((sum, s) => sum + longTerm(s), 0),
        totalUnrealized: summaries.reduce((sum, s) => sum + s.totalUnrealizedPnl, 0),
        bySymbol,
        trades,
      },
    }
  },
}
