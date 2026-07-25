import {
  flexReadRepository,
  type CashTransactionRow,
} from '@repositories/flex/flexReadRepository'
import type {
  DividendEvent,
  DividendGroup,
  DividendResult,
  UpcomingDividend,
  UpcomingDividends,
} from '@shared/domain/dividends'

/**
 * Dividend & income analytics (Milestone M3, Stories #23 and #31). Turns the imported
 * Flex dividend / payment-in-lieu / withholding cash transactions into per-symbol and
 * per-month gross / withholding / net income, converted to the base currency using
 * each row's Flex `fxRateToBase` (DDR-0005), and pairs that history with the
 * declared-but-unpaid dividends from the latest statement's accruals (DDR-0010).
 *
 * Reaches data only through `flexReadRepository`, so it is a pure unit-test target.
 */

const WITHHOLDING_TYPE = 'Withholding Tax'

/** UTC midnight of the day containing `epochMs` — the cut-off for "still upcoming". */
function startOfUtcDay(epochMs: number): number {
  const d = new Date(epochMs)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

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
  description?: string,
): void {
  const group =
    groups.get(key) ?? { key, label, description, grossBase: 0, withholdingBase: 0, netBase: 0 }
  if (row.type === WITHHOLDING_TYPE) {
    group.withholdingBase += -amountBase // amount is negative; store the magnitude withheld
  } else {
    group.grossBase += amountBase
  }
  group.netBase = group.grossBase - group.withholdingBase
  groups.set(key, group)
}

/**
 * Build the upcoming-dividends panel from the latest statement's open accruals
 * (Story #31). Accruals whose pay date has already passed are dropped — an import can
 * be weeks old, and by then those dividends have been paid and are already counted in
 * the cash history, so listing them would both mislead and double-count. Undated
 * accruals are kept, since IBKR sometimes declares before setting a pay date.
 */
function buildUpcoming(now: number): UpcomingDividends {
  const latest = flexReadRepository.getLatestOpenDividendAccruals()
  const empty: UpcomingDividends = {
    asOf: latest?.asOf ?? null,
    sectionPresent: (latest?.accruals.length ?? 0) > 0,
    totalGrossBase: 0,
    totalWithholdingBase: 0,
    totalNetBase: 0,
    items: [],
  }
  if (!latest) return empty

  const cutoff = startOfUtcDay(now)
  const items: UpcomingDividend[] = []
  for (const a of latest.accruals) {
    if (a.payDate != null && a.payDate < cutoff) continue

    const grossBase = a.grossAmount * a.fxRateToBase
    const netBase = a.netAmount * a.fxRateToBase
    items.push({
      symbol: a.symbol,
      description: a.description,
      currency: a.currency,
      exDate: a.exDate,
      payDate: a.payDate,
      quantity: a.quantity,
      grossRate: a.grossRate,
      netNative: a.netAmount,
      grossBase,
      // Derived rather than read from the Flex `tax` field, whose sign IBKR does not
      // guarantee; `netAmount` is already net of tax and fees.
      withholdingBase: grossBase - netBase,
      netBase,
    })
  }

  // Soonest pay date first; undated accruals sort last (nothing to schedule them by).
  items.sort((a, b) => (a.payDate ?? Number.MAX_SAFE_INTEGER) - (b.payDate ?? Number.MAX_SAFE_INTEGER))

  return {
    ...empty,
    totalGrossBase: items.reduce((sum, i) => sum + i.grossBase, 0),
    totalWithholdingBase: items.reduce((sum, i) => sum + i.withholdingBase, 0),
    totalNetBase: items.reduce((sum, i) => sum + i.netBase, 0),
    items,
  }
}

export const dividendService = {
  /**
   * Assemble the dividends report, or signal that no Flex data has been imported.
   * `now` is injectable so the "already paid" cut-off for upcoming dividends is
   * deterministic under test.
   */
  getDividends(now: number = Date.now()): DividendResult {
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
      accumulate(bySymbol, symbolKey, symbolKey, row, amountBase, row.description)
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
        upcoming: buildUpcoming(now),
      },
    }
  },
}
