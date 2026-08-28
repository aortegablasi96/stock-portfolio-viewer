import type {
  CompositionBand,
  NavPeriod,
  PerformanceReport,
  ValuePoint,
} from '@shared/domain/performance'
import { boundsFor, windowFor, type Bounds, type RangeId } from './dateRange'
import { dailyReturns } from './dailyReturns'
import { seriesExtent, valueAt, windowStats } from './performanceRange'
import { sliceComposition } from './composition'

/**
 * What changed over a period, computed rather than described (Story #285).
 *
 * **"My portfolio went up" and "my portfolio returned" are different sentences, and the app's own
 * curve only answers the second.** The performance series is cumulative time-weighted return
 * (DDR-0013), deliberately unmoved by deposits and withdrawals: a portfolio can be worth 20% more
 * and have returned 2%. An explanation that conflates the two is wrong in the way an owner is
 * least likely to catch, because it flatters. So this module keeps them in **separate fields with
 * separate names** and hands both to the section that phrases them — the model is never given one
 * figure it could mistake for the other.
 *
 * Everything here is arithmetic the app already trusts, re-used rather than re-derived: the window
 * comes from `dateRange`, the endpoints and the chain-linked TWR from `performanceRange`, the
 * per-day steps from `dailyReturns`, the stacked bands from `composition`. That is deliberate — a
 * second implementation of any of them would be free to disagree with the chart the owner is
 * looking at, and the whole point of grounding is that a figure in an answer and the same figure
 * on a page are one number.
 *
 * ## Three things it refuses to do
 *
 * **It never anchors to the clock.** The window comes from `boundsFor`, whose presets all end at
 * `extent.to` — the last day the imported history actually holds (DDR-0085). A history that stops
 * last year still has a "1Y" and a "YTD"; anchored to today both would be empty, and an empty
 * period reads as a flat one.
 *
 * **It never pro-rates a statement period.** Flows, income and costs live on `NavPeriod` rows that
 * are statement-scoped, and a window can cut one in half. Splitting it would mean inventing a
 * number, so instead every row that *overlaps* the window is summed whole and {@link PeriodFlows}
 * reports the span those rows really cover, plus whether it exceeds the window. The explanation
 * then says what it actually measured.
 *
 * **It never carries a value forward into an empty window.** `valueAt` is a carry-forward read, so
 * a custom window landing entirely before the history would return the first point at both ends
 * and report a flat, zero-return period that never happened. {@link PeriodChange.days} counts the
 * real points inside the window, and zero is a state the caller states rather than a period it
 * describes.
 */

/** A period the owner chose, in the app's one range vocabulary (DDR-0085). */
export interface PeriodSelection {
  range: RangeId
  /** The custom window, or `null` before the owner has edited one. */
  custom: Bounds | null
}

/** Flows, income and costs over the statement rows a window touches. */
export interface PeriodFlows {
  /** How many `NavPeriod` rows were summed. */
  count: number
  /** The span those rows really cover, or `null` when none was touched. */
  covered: Bounds | null
  /** Whether that span runs outside the chosen window, so the totals are not exactly its own. */
  partial: boolean
  /** Net deposits (positive) minus withdrawals (negative) — moves value, never return. */
  depositsWithdrawals: number
  dividends: number
  /** As IBKR reports it, which is negative for tax withheld. */
  withholdingTax: number
  interest: number
  commissions: number
  /** Mark-to-market profit and loss, the part of the value change that is not a flow. */
  mtm: number
}

/** How the ride felt, from the daily steps of the return curve. */
export interface PeriodDays {
  count: number
  up: number
  down: number
  flat: number
  best: ValuePoint | null
  worst: ValuePoint | null
}

/** One band's amount at each end of the window, in base currency. */
export interface BandShift {
  band: CompositionBand
  first: number
  last: number
  change: number
}

/** How the portfolio's shape moved across the window. */
export interface PeriodComposition {
  /** Days of composition data inside the window — zero when the optional Flex section is absent. */
  days: number
  /** The first of those days, so the section can say what the two ends really are. */
  firstDate: number | null
  lastDate: number | null
  firstNav: number | null
  lastNav: number | null
  navChange: number | null
  bands: BandShift[]
}

/** Everything the app can say about a chosen period, each figure named for what it is. */
export interface PeriodChange {
  range: RangeId
  /** The preset's own title from `RANGE_OPTIONS` — one vocabulary, never a second one. */
  label: string
  /** The resolved window, anchored to `extent.to`. */
  bounds: Bounds
  /** The whole span the imported history covers. */
  extent: Bounds
  baseCurrency: string
  /** Real value points inside the window. Zero means the period holds no data at all. */
  days: number
  /** Time-weighted return over the window, chain-linked. Flows do not move it. */
  twr: number
  startValue: number
  endValue: number
  /** End minus start. Flows *do* move this. */
  changeAbs: number
  /** The same as a percentage; `null` when the window opens at zero value. */
  changePct: number | null
  flows: PeriodFlows
  daily: PeriodDays
  composition: PeriodComposition
  /** Figures the report only holds for the whole history, never for a window. */
  history: {
    cumulativeTwr: number
    depositsWithdrawals: number
    realizedPnl: number
    unrealizedPnl: number
  }
}

/**
 * The label each preset carries.
 *
 * The same words `RANGE_OPTIONS` puts on the control, so what the owner clicked and what the
 * assistant says it explained are one phrase. Written out rather than read off the array because
 * a `Record<RangeId, string>` makes a new preset a compile error here too — the vocabulary's own
 * rule is that a preset lands in every view or none (DDR-0085), and a lookup with a fallback
 * would let one land in the control and go unnamed in an answer.
 */
export const PERIOD_LABELS: Record<RangeId, string> = {
  '1m': 'Last month',
  '3m': 'Last 3 months',
  '1y': 'Last year',
  ytd: 'Since 1 January',
  all: 'Full history',
  custom: 'Custom date range',
}

/**
 * Resolve a selection against a report, or `null` when the history has no dated value at all.
 *
 * `null` is the report having nothing to window rather than the window being empty — the two are
 * different states and the caller says different things about them. An empty window still returns
 * a `PeriodChange`, with `days` at zero, which is the state the caller reports instead of figures.
 */
export function periodChange(
  report: PerformanceReport,
  selection: PeriodSelection,
): PeriodChange | null {
  const extent = seriesExtent(report.valueSeries)
  if (extent === null) return null

  const bounds = boundsFor(selection.range, extent, selection.custom ?? extent)
  const days = report.valueSeries.filter((p) => p.date >= bounds.from && p.date <= bounds.to).length

  const stats = windowStats(report.valueSeries, report.returnSeries, bounds)

  return {
    range: selection.range,
    label: PERIOD_LABELS[selection.range],
    bounds,
    extent,
    baseCurrency: report.baseCurrency,
    days,
    twr: stats.twr,
    startValue: valueAt(report.valueSeries, bounds.from),
    endValue: stats.endValue,
    changeAbs: stats.changeAbs,
    changePct: stats.changePct,
    flows: periodFlows(report.periods, windowFor(selection.range, extent, selection.custom)),
    // The **unwindowed** series, so the opening bar measures against the day that really preceded
    // it rather than against the synthetic point `sliceSeries` anchors at the edge (DDR-0049).
    daily: periodDays(dailyReturns(report.returnSeries, bounds)),
    composition: periodComposition(report, bounds),
    history: {
      cumulativeTwr: report.cumulativeTwr,
      depositsWithdrawals: report.totalDepositsWithdrawals,
      realizedPnl: report.totalRealizedPnl,
      unrealizedPnl: report.totalUnrealizedPnl,
    },
  }
}

/**
 * Sum the statement rows a window touches, whole, and report what they really cover.
 *
 * `null` bounds is the `all` preset — no restriction, which is what `windowFor` means by it — and
 * every row is summed. Otherwise a row is included when it *overlaps* the window at all, because
 * halving one would mean pro-rating a figure IBKR reported for a whole period, and a pro-rated
 * deposit is a number no report contains.
 */
export function periodFlows(periods: readonly NavPeriod[], bounds: Bounds | null): PeriodFlows {
  const touched =
    bounds === null
      ? [...periods]
      : periods.filter((p) => p.fromDate <= bounds.to && p.toDate >= bounds.from)

  const flows: PeriodFlows = {
    count: touched.length,
    covered: null,
    partial: false,
    depositsWithdrawals: 0,
    dividends: 0,
    withholdingTax: 0,
    interest: 0,
    commissions: 0,
    mtm: 0,
  }

  for (const period of touched) {
    flows.depositsWithdrawals += period.depositsWithdrawals
    flows.dividends += period.dividends
    flows.withholdingTax += period.withholdingTax
    flows.interest += period.interest
    flows.commissions += period.commissions
    flows.mtm += period.mtm
    flows.covered =
      flows.covered === null
        ? { from: period.fromDate, to: period.toDate }
        : {
            from: Math.min(flows.covered.from, period.fromDate),
            to: Math.max(flows.covered.to, period.toDate),
          }
  }

  if (bounds !== null && flows.covered !== null) {
    flows.partial = flows.covered.from < bounds.from || flows.covered.to > bounds.to
  }

  return flows
}

/** Count the days and find the two extremes; a period of no days has neither. */
export function periodDays(returns: readonly ValuePoint[]): PeriodDays {
  const days: PeriodDays = {
    count: returns.length,
    up: 0,
    down: 0,
    flat: 0,
    best: null,
    worst: null,
  }

  for (const point of returns) {
    if (point.value > 0) days.up++
    else if (point.value < 0) days.down++
    else days.flat++
    if (days.best === null || point.value > days.best.value) days.best = point
    if (days.worst === null || point.value < days.worst.value) days.worst = point
  }

  return days
}

/**
 * The shape of the portfolio at each end of the window.
 *
 * Sliced, never carried forward: each composition point is a simultaneous observation of every
 * band, and a carried-forward one would pair one day's stocks with another day's cash (DDR-0052).
 * A window holding one day therefore has a shape whose two ends are the same day — which the
 * section says rather than presenting as a shift — and one holding none, because the optional
 * NAV-in-base Flex section was never exported, has no shape at all (DDR-0050).
 */
export function periodComposition(report: PerformanceReport, bounds: Bounds): PeriodComposition {
  const points = sliceComposition(report.compositionSeries.points, bounds)
  const bands = report.compositionSeries.bands

  if (points.length === 0) {
    return {
      days: 0,
      firstDate: null,
      lastDate: null,
      firstNav: null,
      lastNav: null,
      navChange: null,
      bands: [],
    }
  }

  const first = points[0]!
  const last = points[points.length - 1]!

  return {
    days: points.length,
    firstDate: first.date,
    lastDate: last.date,
    firstNav: first.total,
    lastNav: last.total,
    navChange: last.total - first.total,
    bands: bands.map((band, index) => {
      const from = first.values[index] ?? 0
      const to = last.values[index] ?? 0
      return { band, first: from, last: to, change: to - from }
    }),
  }
}
