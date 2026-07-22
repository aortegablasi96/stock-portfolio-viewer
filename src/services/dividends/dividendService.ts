import {
  flexReadRepository,
  type CashTransactionRow,
} from '@repositories/flex/flexReadRepository'
import type { DividendEvent, DividendGroup, DividendResult } from '@shared/domain/dividends'

/**
 * Dividend & income analytics (Milestone M3, Story #23). Turns the imported Flex
 * dividend / payment-in-lieu / withholding cash transactions into per-symbol and
 * per-month gross / withholding / net income, converted to the base currency using
 * each row's Flex `fxRateToBase`. See DDR-0005.
 *
 * Reaches data only through `flexReadRepository`, so it is a pure unit-test target.
 */

const WITHHOLDING_TYPE = 'Withholding Tax'

/** Calendar month key ('YYYY-MM', UTC) for an epoch-ms date, or 'Unknown' when absent. */
function monthKey(epochMs: number | null): string {
  if (epochMs == null) return 'Unknown'
  const d = new Date(epochMs)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Accumulate gross / withholding / net for a grouping key. Withholding is stored as a magnitude. */
function accumulate(
  groups: Map<string, DividendGroup>,
  key: string,
  label: string,
  row: CashTransactionRow,
  amountBase: number,
): void {
  const group = groups.get(key) ?? { key, label, grossBase: 0, withholdingBase: 0, netBase: 0 }
  if (row.type === WITHHOLDING_TYPE) {
    group.withholdingBase += -amountBase // amount is negative; store the magnitude withheld
  } else {
    group.grossBase += amountBase
  }
  group.netBase = group.grossBase - group.withholdingBase
  groups.set(key, group)
}

export const dividendService = {
  /** Assemble the dividends report, or signal that no Flex data has been imported. */
  getDividends(): DividendResult {
    if (!flexReadRepository.hasStatements()) return { status: 'needs_import' }

    const baseCurrency = flexReadRepository.baseCurrency() ?? 'EUR'
    const rows = flexReadRepository.getDividendCashTransactions()

    const bySymbol = new Map<string, DividendGroup>()
    const byMonth = new Map<string, DividendGroup>()
    const events: DividendEvent[] = []
    let totalGrossBase = 0
    let totalWithholdingBase = 0

    for (const row of rows) {
      const date = row.exDate ?? row.dateTime
      const amountBase = row.amount * row.fxRateToBase

      events.push({
        date,
        symbol: row.symbol,
        description: row.description,
        type: row.type,
        currency: row.currency,
        amountNative: row.amount,
        amountBase,
      })

      if (row.type === WITHHOLDING_TYPE) totalWithholdingBase += -amountBase
      else totalGrossBase += amountBase

      const symbolKey = row.symbol || '—'
      accumulate(bySymbol, symbolKey, symbolKey, row, amountBase)
      const mKey = monthKey(date)
      accumulate(byMonth, mKey, mKey, row, amountBase)
    }

    events.sort((a, b) => (b.date ?? 0) - (a.date ?? 0))

    return {
      status: 'ok',
      report: {
        baseCurrency,
        totalGrossBase,
        totalWithholdingBase,
        totalNetBase: totalGrossBase - totalWithholdingBase,
        bySymbol: [...bySymbol.values()].sort((a, b) => b.netBase - a.netBase),
        byMonth: [...byMonth.values()].sort((a, b) => a.key.localeCompare(b.key)),
        events,
      },
    }
  },
}
