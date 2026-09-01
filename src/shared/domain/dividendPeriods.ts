import { standardWindows, type PeriodWindowSet } from './standardPeriods'
import type { DividendEvent, DividendReport } from './dividends'
import type { Bounds } from './performanceWindow'

/**
 * Income over one standard period, out of the dividend history the app already computed (#329).
 *
 * ## Why the windowing is here and not in the tool
 *
 * `get_dividend_income` takes an **enumerated period key** like the four performance tools do
 * (DDR-0102, DDR-0111), and it may reach **one** service method — `dividendService.getDividends`,
 * which returns the whole history and knows nothing about periods. So something has to cut that
 * history into the windows the key names, and the tool layer is the wrong place: it is the layer
 * least covered by the tests that make ADR-0009's grounding rule true. This module is the same
 * answer `standardPeriods` already is for performance — shared, dependency-free arithmetic that both
 * processes can reach — and `performanceReports.ts` calls it exactly as it calls `periodFlows`.
 *
 * ## The extent is the dividend history's own, and that is a fact a report must state
 *
 * The windows are cut from the **first and last dated dividend event**, not from the value series:
 * this module never sees a performance report, and asking for one would be the join DDR-0111 forbids.
 * The consequence is real and is disclosed rather than hidden — an account whose statements run to
 * June but whose last dividend landed in March has a `trailing:1y` here that ends in March. Both
 * reports say which history their windows were cut from, so a key carried from one to the other
 * cannot silently mean two windows.
 *
 * ## Two series, and absent is not zero
 *
 * Gross and withholding are kept apart the whole way through (DDR-0080): they are separate figures
 * about the same events, and a net figure that swallowed the tax would be a third number nobody can
 * take apart again. Withholding is carried as a **positive magnitude**, the way the dividend service
 * and the chart both carry it, and the direction is the *series'* rather than the value's.
 *
 * An **undated** event is in no window at all — not in `all`, which is cut from the extent like every
 * other window. It is counted here so a report can say how many are outside every figure it gives,
 * which is the difference between a figure that is missing something and a figure that is wrong.
 */

/**
 * The Flex cash-transaction type that is tax withheld rather than income (DDR-0080).
 *
 * It lived in `dividendService` and moved here rather than into `dividends.ts` beside the schemas it
 * describes, for `assistantKey.ts`'s reason (DDR-0105): that module imports Zod, and a **value**
 * imported from it pulls the package into any bundle that reaches it. This module is dependency-free
 * on purpose — like `standardPeriods`, which the renderer's libs already re-export — so the constant
 * belongs on this side of that line.
 *
 * One spelling, because two modules split the same events on it: the service, building the whole
 * history, and {@link dividendIncome}, windowing it. A second spelling would file withholding as
 * gross in one report and not the other, with both totals looking entirely plausible.
 */
export const WITHHOLDING_TYPE = 'Withholding Tax'

/** One instrument's income inside a window, in the base currency the dividend report names. */
export interface DividendSymbolIncome {
  symbol: string
  /** The instrument name as the dividend service resolved it; `''` where none is known. */
  description: string
  grossBase: number
  /** Tax withheld, as a positive magnitude. */
  withholdingBase: number
  netBase: number
}

/** What one window holds: the two series, what they net to, and what fell outside it. */
export interface DividendIncome {
  /** Cash events inside the window — gross and withholding rows alike. */
  events: number
  grossBase: number
  /** Tax withheld, as a positive magnitude. */
  withholdingBase: number
  netBase: number
  /** Per instrument, largest net first. Never truncated here; the report states its own cut. */
  bySymbol: DividendSymbolIncome[]
}

/**
 * The span the dividend history covers, or `null` where no event carries a date at all.
 *
 * `null` is the state a report names rather than a window it describes: an imported statement can
 * hold dividend cash rows with no ex-date and no pay date, and windowing those is not a smaller
 * period — it is no period. It is also **not** `needs_import`, which is nothing imported at all, and
 * the two recover differently (DDR-0022).
 */
export function dividendExtent(report: DividendReport): Bounds | null {
  const dates = report.events
    .map((event) => event.date)
    .filter((date): date is number => date !== null)
  if (dates.length === 0) return null
  return { from: Math.min(...dates), to: Math.max(...dates) }
}

/** Every standard window over the dividend history, by the same keys the period set uses. */
export function dividendWindows(report: DividendReport): PeriodWindowSet | null {
  const extent = dividendExtent(report)
  return extent === null ? null : standardWindows(extent)
}

/** How many events carry no date, and so fall outside every window including `all`. */
export function undatedEvents(report: DividendReport): number {
  return report.events.filter((event) => event.date === null).length
}

/**
 * Sum one window's events into the two series and the per-instrument split.
 *
 * A **sum over the events the service already converted**, and nothing else: each event's
 * `amountBase` came out of `dividendService` with that row's own `fxRateToBase` applied (DDR-0005),
 * so no rate is applied here and no figure is derived from another. Net is `gross − withholding` in
 * both the total and every row, which is the one relation the dividend report itself states.
 */
export function dividendIncome(report: DividendReport, bounds: Bounds): DividendIncome {
  const inside = report.events.filter(
    (event) => event.date !== null && event.date >= bounds.from && event.date <= bounds.to,
  )

  const bySymbol = new Map<string, DividendSymbolIncome>()
  let grossBase = 0
  let withholdingBase = 0

  for (const event of inside) {
    const key = event.symbol === '' ? '—' : event.symbol
    const group = bySymbol.get(key) ?? {
      symbol: key,
      description: event.description,
      grossBase: 0,
      withholdingBase: 0,
      netBase: 0,
    }

    if (isWithholding(event)) {
      // The service signs a withholding row negative; both this and the report carry the magnitude,
      // so the two series can be read side by side without a minus sign meaning two things.
      withholdingBase += -event.amountBase
      group.withholdingBase += -event.amountBase
    } else {
      grossBase += event.amountBase
      group.grossBase += event.amountBase
    }

    group.netBase = group.grossBase - group.withholdingBase
    bySymbol.set(key, group)
  }

  return {
    events: inside.length,
    grossBase,
    withholdingBase,
    netBase: grossBase - withholdingBase,
    bySymbol: [...bySymbol.values()].sort((a, b) => b.netBase - a.netBase),
  }
}

/** Whether a cash event is tax withheld rather than income, on the one spelling of the type. */
function isWithholding(event: DividendEvent): boolean {
  return event.type === WITHHOLDING_TYPE
}
