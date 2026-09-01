import {
  flexReadRepository,
  type CashTransactionRow,
} from '@repositories/flex/flexReadRepository'
import { WITHHOLDING_TYPE } from '@shared/domain/dividendPeriods'
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
 * Story #74 additionally reconstructs the shares held behind each cash event from the
 * imported trade history, since Flex cash transactions carry no quantity (DDR-0016).
 *
 * Reaches data only through `flexReadRepository`, so it is a pure unit-test target.
 */

/**
 * Resolve a clean instrument display name ("GOEASY LTD") by conid, falling back to
 * symbol. Cash-transaction descriptions are verbose transaction strings, so the dividend
 * tables use this to show the instrument name beneath the ticker like the other views.
 */
function makeNameResolver(): (conid: number | null, symbol: string) => string {
  const byConid = new Map<number, string>()
  const bySymbol = new Map<string, string>()
  for (const n of flexReadRepository.getInstrumentNames()) {
    if (n.description === '') continue
    if (n.conid != null && !byConid.has(n.conid)) byConid.set(n.conid, n.description)
    if (n.symbol !== '' && !bySymbol.has(n.symbol)) bySymbol.set(n.symbol, n.description)
  }
  return (conid, symbol) => {
    if (conid != null) {
      const byId = byConid.get(conid)
      if (byId != null) return byId
    }
    return bySymbol.get(symbol) ?? ''
  }
}

/** UTC midnight of the day containing `epochMs` — the cut-off for "still upcoming". */
function startOfUtcDay(epochMs: number): number {
  const d = new Date(epochMs)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/** Identify an instrument by conid when Flex reports one, else by ticker. */
function instrumentKey(conid: number | null, symbol: string): string {
  return conid != null ? `id:${conid}` : `sym:${symbol}`
}

/**
 * Resolve "how many shares did I hold when this dividend was declared?" (Story #74).
 *
 * Flex `CashTransaction` rows carry no quantity, so the position is reconstructed by
 * summing the imported trades for the instrument that settled **before** the ex-date —
 * entitlement requires holding the share the day before the ex-date, so a trade dated on
 * the ex-date itself does not count. Returns `null` rather than a number whenever the
 * trade history cannot honestly account for the position (DDR-0016):
 *
 * - the event has no date to cut at;
 * - the instrument has no trades at all, or has an undated trade that cannot be placed in
 *   time (a position transferred in from another broker looks exactly like this);
 * - the running quantity is zero or negative, which a paid dividend contradicts — proof
 *   the imported statements start after the position was opened.
 */
function makePositionResolver(): (conid: number | null, symbol: string, date: number | null) => number | null {
  const lots = new Map<string, { date: number; quantity: number }[]>()
  const unreliable = new Set<string>()

  for (const t of flexReadRepository.getTrades()) {
    const key = instrumentKey(t.conid, t.symbol)
    if (t.dateTime == null) {
      unreliable.add(key)
      continue
    }
    const existing = lots.get(key)
    if (existing) existing.push({ date: t.dateTime, quantity: t.quantity })
    else lots.set(key, [{ date: t.dateTime, quantity: t.quantity }])
  }

  return (conid, symbol, date) => {
    if (date == null) return null
    const key = instrumentKey(conid, symbol)
    if (unreliable.has(key)) return null
    const trades = lots.get(key)
    if (!trades) return null

    const cutoff = startOfUtcDay(date)
    let held = 0
    for (const t of trades) if (t.date < cutoff) held += t.quantity
    return held > 0 ? held : null
  }
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
    const nameOf = makeNameResolver()
    const sharesHeldOn = makePositionResolver()

    const bySymbol = new Map<string, DividendGroup>()
    const byMonth = new Map<string, DividendGroup>()
    const events: DividendEvent[] = []
    let totalGrossBase = 0
    let totalWithholdingBase = 0

    for (const row of rows) {
      const date = row.exDate ?? row.dateTime
      const amountBase = row.amount * row.fxRateToBase
      const name = nameOf(row.conid, row.symbol)
      const sharesHeld = sharesHeldOn(row.conid, row.symbol, date)

      events.push({
        date,
        symbol: row.symbol,
        description: name,
        type: row.type,
        currency: row.currency,
        amountNative: row.amount,
        amountBase,
        sharesHeld,
        // Divided out of the row's own amount, so the per-share figure always reconciles
        // with the amount and share count shown beside it.
        perShareNative: sharesHeld != null ? row.amount / sharesHeld : null,
      })

      if (row.type === WITHHOLDING_TYPE) totalWithholdingBase += -amountBase
      else totalGrossBase += amountBase

      const symbolKey = row.symbol || '—'
      accumulate(bySymbol, symbolKey, symbolKey, row, amountBase, name)
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
