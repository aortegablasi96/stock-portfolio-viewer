import {
  boundsFor,
  dailyReturns,
  seriesExtent,
  sliceComposition,
  valueAt,
  windowStats,
  type Bounds,
  type RangeId,
} from './performanceWindow'
import type {
  CompositionBand,
  NavPeriod,
  PerformanceReport,
  ValuePoint,
} from './performance'

/**
 * Every standard period, and everything the app can say about one (Story #287, #327; DDR-0103).
 *
 * **The period belongs in the question, so the app cannot know which one it is.** #285 resolved
 * whatever the owner had clicked on a `RangeFilter`; DDR-0102 removed that control on the finding
 * that free text already carries a period and a picker beside it asks for the same fact twice. That
 * reverses the mechanism rather than merely deleting a widget: with no selection to resolve, the
 * grounding cannot be *one* window, so it is **all of them** — and the model names the one it wants.
 *
 * Precomputing rather than resolving is the decision, and it is what makes the hard case a state
 * instead of a silence. A question about a window this set does not hold — *how did I do between
 * March and July?* — finds nothing, and the honest answer names the periods that do exist. That
 * answer is only available to a caller that can see what the set contains, which is exactly what a
 * per-question resolution would not give it: a lookup that misses returns nothing to say about the
 * miss. DDR-0022's result-variant discipline, arriving in prose.
 *
 * ## Why it is here rather than in the renderer
 *
 * It **was** `renderer/src/lib/periodSet.ts` and `renderer/src/lib/periodChange.ts`, assembled into
 * a context section that went with every question whatever was asked. Story #327 puts four tools
 * over it and they execute in **main** (DDR-0111, decision 2), so the arithmetic moved to where both
 * processes can reach it — a path change, not a port, on the precedent `@shared/format` set.
 *
 * The two modules merged on the way, because the tools split what they used to join.
 * `periodChange` computed a window's return, value, flows, daily steps and composition in **one**
 * pass over a `RangeId`; four tools each want one of those over an **enumerated key**, so what
 * crossed is the pieces — {@link periodSpan}, {@link periodFlows}, {@link periodDays},
 * {@link periodComposition} — each a function of a {@link StandardPeriod}'s own bounds. The
 * aggregate did not cross: a payload carrying return *and* value *and* composition together is the
 * one shape DDR-0013 says must not exist, because it is how a deposit gets attributed to
 * performance.
 *
 * ## What it refuses
 *
 * **It never anchors to the clock.** Every window comes off `extent.to` — the last day the
 * imported history actually holds (DDR-0085) — so a history ending last year yields *that
 * history's* periods. Anchored to today, every one of them would be empty and an empty period reads
 * as a flat one.
 *
 * **It never derives a comparison the model could be asked for.** Two periods side by side are an
 * *ordering*, which is a reading; "by how much" is subtraction, which is not. So the differences an
 * owner actually asks for are computed into the set — each year against the previous year, each
 * quarter against the previous quarter. That is linear in the number of periods where every pair
 * would be quadratic, and it is the comparison that gets made.
 *
 * **It never presents an empty window as a flat one.** {@link StandardPeriod.days} counts the value
 * points really inside the window, and zero is a state the caller states rather than a period it
 * describes (DDR-0099). `valueAt` is a carry-forward read and would happily report a calm 0% over a
 * gap in the history — a description of nothing, phrased as a description of something.
 *
 * **It never re-implements a figure.** The windowing, the endpoints, the chain-linked return, the
 * per-day steps and the composition slice are all `performanceWindow`'s. A second implementation of
 * any of them would be free to disagree with the chart the owner is looking at, and grounding means
 * a figure in an answer and the same figure on a page are one number.
 *
 * Dependency-free but for type-only imports of the report's own shapes, so no Zod can reach the
 * renderer's bundle through it (DDR-0105, `zodIsolation.test.ts`).
 */

/** Which family a period belongs to — and therefore what it is compared against. */
export type PeriodKind = 'trailing' | 'year' | 'quarter' | 'all'

/** One window the model may ask about, with everything the app knows about it. */
export interface StandardPeriod {
  /**
   * Stable identity: `year:2025`, `quarter:Q3 2025`, `trailing:1y`, `all`.
   *
   * It was *"never shown"* while the set was a list of rows in an assembled context. It is the
   * **enumerated key a tool takes** now (DDR-0111): `get_performance` accepts one of these exactly,
   * and a window the set does not hold is a named state with these listed as the alternatives —
   * never the adjacent row (DDR-0102).
   */
  id: string
  /** The words an owner would use for it. */
  label: string
  /**
   * What kind of window it is, in words rather than in the enum's.
   *
   * Beside the label because a set of twenty rows is read by *scanning*, and "2025" and "Q3 2025"
   * and "Last 3 months" answer different questions about the same history. The enum's own words
   * would not do: `all` next to a date range reads as a stray token, and `ytd` is the one preset
   * anchored to the **calendar** rather than trailing back from the end (DDR-0085), so filing it
   * under "trailing window" would be wrong about the only thing the descriptor says.
   */
  descriptor: string
  kind: PeriodKind
  /** The resolved window, clamped into the imported history. */
  bounds: Bounds
  /** Calendar days it covers, both ends included — what a period's *length* means. */
  calendarDays: number
  /** Value points really inside it. Zero is a state, never a flat period. */
  days: number
  /** Time-weighted return over the window, rebased to its own start. */
  twr: number
  startValue: number
  endValue: number
  /** End minus start. Deposits and withdrawals move this and not the return above. */
  changeAbs: number
  /** The same as a percentage; `null` where the window opens at zero value. */
  changePct: number | null
  /**
   * The same-kind period immediately before this one, and the difference in percentage points.
   *
   * `null` where there is no previous period in the set, or where either period holds no day of
   * data — a difference against a period that did not happen is not a comparison.
   */
  previous: { label: string; points: number } | null
}

/** The whole set, with what each cap left out stated beside it. */
export interface PeriodSet {
  baseCurrency: string
  /** The span the imported history covers, which every window is anchored to. */
  extent: Bounds
  periods: StandardPeriod[]
  /** How many calendar years the history spans, against how many are listed. */
  yearsTotal: number
  yearsListed: number
  /** The same for quarters. */
  quartersTotal: number
  quartersListed: number
}

/**
 * How many calendar years and quarters the set names.
 *
 * Caps for `MAX_LISTED_POSITIONS`' reason — the conversation has a ceiling (`MAX_PROMPT_CHARS`) and
 * one truncated by the gateway is truncated arbitrarily, the last report simply stopping. Both cut
 * at the *oldest* end and both state how many of how many they hold, so a question about 2011 is
 * answered by saying which years are in front of the model rather than by inventing one. Eight
 * quarters is two years, which is as far back as a quarter-on-quarter question reaches in practice.
 */
export const MAX_LISTED_YEARS = 8
export const MAX_LISTED_QUARTERS = 8

/**
 * The trailing windows the set carries, and the words they go by.
 *
 * Deliberately **not** `RANGE_OPTIONS`' own vocabulary (DDR-0085). That vocabulary names a control's
 * buttons, where "Last year" sits beside "1Y" and is unambiguous; here it would sit beside a row
 * named `2025`, and "how did last year go?" would have two rows to land on with nothing to choose
 * between them. Naming the window by its length is what makes a question resolve to a row rather
 * than to an inference — which is this set's whole naming rule, and the reason the two vocabularies
 * are allowed to differ at exactly this point. Both are carried and neither is collapsed into the
 * other: the report that lists these says outright that "last year" has two readings and that a
 * question using the phrase must be answered by naming which one it took.
 *
 * `custom` and `all` are absent: there is no custom window without a control to draw one, and the
 * full history is its own row rather than a trailing one.
 */
export const TRAILING_PERIODS: readonly {
  range: Exclude<RangeId, 'custom' | 'all'>
  label: string
  descriptor: string
}[] = [
  { range: '1m', label: 'Last month', descriptor: 'trailing window' },
  { range: '3m', label: 'Last 3 months', descriptor: 'trailing window' },
  { range: '1y', label: 'Last 12 months', descriptor: 'trailing window' },
  // The one preset anchored to the calendar rather than trailing back from the end (DDR-0085), and
  // filed as such: a reader told it was trailing would date it from the wrong end.
  { range: 'ytd', label: 'Since 1 January', descriptor: 'calendar-anchored window' },
]

const MS_PER_DAY = 86_400_000

/**
 * Every standard period over an imported history, or `null` where there is no dated value at all.
 *
 * `null` is the report having nothing to window — different from a window that holds no day, which
 * is a period in the set with `days` at zero. The two are separate states and a caller says
 * different things about them.
 *
 * The order is the order a question reaches for: the whole history, then the trailing windows, then
 * calendar years newest-first, then quarters newest-first. Newest-first because the oldest is what
 * a cap removes, and a list that runs out at the end reads as complete.
 */
export function standardPeriods(report: PerformanceReport): PeriodSet | null {
  const extent = seriesExtent(report.valueSeries)
  if (extent === null) return null

  const measure = (
    id: string,
    label: string,
    descriptor: string,
    kind: PeriodKind,
    bounds: Bounds,
  ): StandardPeriod => measurePeriod(report, id, label, descriptor, kind, bounds)

  const years = calendarYears(extent)
  const quarters = calendarQuarters(extent)
  const listedYears = years.slice(-MAX_LISTED_YEARS).reverse()
  const listedQuarters = quarters.slice(-MAX_LISTED_QUARTERS).reverse()

  const periods: StandardPeriod[] = [
    measure('all', 'Full history', 'the whole imported history', 'all', boundsFor('all', extent, extent)),
    ...TRAILING_PERIODS.map((trailing) =>
      measure(
        `trailing:${trailing.range}`,
        trailing.label,
        trailing.descriptor,
        'trailing',
        boundsFor(trailing.range, extent, extent),
      ),
    ),
    ...listedYears.map((year) =>
      measure(`year:${year.label}`, year.label, 'calendar year', 'year', year.bounds),
    ),
    ...listedQuarters.map((quarter) =>
      measure(`quarter:${quarter.label}`, quarter.label, 'calendar quarter', 'quarter', quarter.bounds),
    ),
  ]

  return {
    baseCurrency: report.baseCurrency,
    extent,
    periods: withConsecutiveDifferences(periods),
    yearsTotal: years.length,
    yearsListed: listedYears.length,
    quartersTotal: quarters.length,
    quartersListed: listedQuarters.length,
  }
}

/**
 * The period a key names, or `null` where the set does not hold one.
 *
 * **An exact match on the id, and deliberately nothing else** (DDR-0102, DDR-0111). No prefix, no
 * case folding, no nearest-neighbour: every one of those turns *"the app does not hold that
 * window"* into a right-looking figure under the wrong heading, which is the failure the
 * precomputed set exists to make impossible. A caller that misses reports the miss **with the
 * alternatives**, which is why the whole set is in front of it.
 */
export function findPeriod(set: PeriodSet, id: string): StandardPeriod | null {
  return set.periods.find((period) => period.id === id) ?? null
}

/** One window's figures, each named for what it is and none of them derived here. */
function measurePeriod(
  report: PerformanceReport,
  id: string,
  label: string,
  descriptor: string,
  kind: PeriodKind,
  bounds: Bounds,
): StandardPeriod {
  const stats = windowStats(report.valueSeries, report.returnSeries, bounds)
  return {
    id,
    label,
    descriptor,
    kind,
    bounds,
    calendarDays: calendarDays(bounds),
    days: report.valueSeries.filter((p) => p.date >= bounds.from && p.date <= bounds.to).length,
    twr: stats.twr,
    startValue: valueAt(report.valueSeries, bounds.from),
    endValue: stats.endValue,
    changeAbs: stats.changeAbs,
    changePct: stats.changePct,
    previous: null,
  }
}

/**
 * Attach each year's and each quarter's difference against the one before it.
 *
 * **Computed, not derived** — the story's word for the distinction, and the reason this exists:
 * quoting two returns is a reading a model may do, and subtracting them is arithmetic it may not
 * (ADR-0009). Only consecutive same-kind pairs, because every pair would be quadratic in the number
 * of periods and this is the comparison an owner actually makes.
 *
 * A period holding no day of data takes part in no difference, on either side. A return computed
 * over a window with nothing in it is not a smaller return; it is not a return.
 */
function withConsecutiveDifferences(periods: readonly StandardPeriod[]): StandardPeriod[] {
  // The list runs newest-first within each kind, so the period *before* a given one is the next
  // entry of the same kind, not the previous one.
  const byKind = new Map<PeriodKind, StandardPeriod[]>()
  for (const period of periods) {
    const bucket = byKind.get(period.kind) ?? []
    bucket.push(period)
    byKind.set(period.kind, bucket)
  }

  const previousOf = new Map<string, StandardPeriod>()
  for (const kind of ['year', 'quarter'] as const) {
    const bucket = byKind.get(kind) ?? []
    bucket.forEach((period, index) => {
      const earlier = bucket[index + 1]
      if (earlier !== undefined) previousOf.set(period.id, earlier)
    })
  }

  return periods.map((period) => {
    const earlier = previousOf.get(period.id)
    if (earlier === undefined || period.days === 0 || earlier.days === 0) return period
    return { ...period, previous: { label: earlier.label, points: period.twr - earlier.twr } }
  })
}

/** Whole days from one end to the other, both included. Never negative. */
function calendarDays(bounds: Bounds): number {
  return Math.max(0, Math.round((bounds.to - bounds.from) / MS_PER_DAY)) + 1
}

/**
 * Each calendar year the history touches, oldest first, clamped to the history at both ends.
 *
 * A part-year at either end is a real period and is kept: an owner asking about 2026 in March 2026
 * is asking about the part of it that has happened. The clamp is what keeps the year's opening
 * value the last close before it — `valueAt` carries forward, so the first year's return is
 * measured from the history's own first point rather than from a value that predates it.
 */
export function calendarYears(extent: Bounds): { label: string; bounds: Bounds }[] {
  const first = new Date(extent.from).getUTCFullYear()
  const last = new Date(extent.to).getUTCFullYear()
  const years: { label: string; bounds: Bounds }[] = []
  for (let year = first; year <= last; year++) {
    years.push({
      label: String(year),
      bounds: clamp({ from: Date.UTC(year, 0, 1), to: Date.UTC(year, 11, 31) }, extent),
    })
  }
  return years
}

/** Each calendar quarter the history touches, oldest first, clamped the same way. */
export function calendarQuarters(extent: Bounds): { label: string; bounds: Bounds }[] {
  const start = new Date(extent.from)
  const end = new Date(extent.to)
  const quarters: { label: string; bounds: Bounds }[] = []

  let year = start.getUTCFullYear()
  let quarter = Math.floor(start.getUTCMonth() / 3)
  const lastYear = end.getUTCFullYear()
  const lastQuarter = Math.floor(end.getUTCMonth() / 3)

  while (year < lastYear || (year === lastYear && quarter <= lastQuarter)) {
    const from = Date.UTC(year, quarter * 3, 1)
    // Day 0 of the month after the quarter is that quarter's last day, without a leap-year table.
    const to = Date.UTC(year, quarter * 3 + 3, 0)
    quarters.push({ label: `Q${quarter + 1} ${year}`, bounds: clamp({ from, to }, extent) })
    quarter += 1
    if (quarter > 3) {
      quarter = 0
      year += 1
    }
  }

  return quarters
}

/** A calendar window cut to the history it is being measured over. */
function clamp(bounds: Bounds, extent: Bounds): Bounds {
  return {
    from: Math.max(bounds.from, extent.from),
    to: Math.min(bounds.to, extent.to),
  }
}

// ---- what one period is, beyond its return and its value --------------------

/**
 * How long the window and the whole history really are (Story #286).
 *
 * Calendar days rather than trading days, and deliberately so: this measures the *period being
 * described*, which is what a summary has to name where it would otherwise reach for a per-year
 * figure. {@link StandardPeriod.days} already counts the trading days with data in it, and the two
 * answer different questions — "how long was this" and "how much of it did we observe".
 */
export interface PeriodSpan {
  /** Calendar days the chosen window covers, both ends included. */
  periodDays: number
  /** Calendar days the whole imported history covers, both ends included. */
  historyDays: number
  /**
   * Whether the window is itself a year or longer.
   *
   * Never a licence to annualise — the app computes no annualised figure at all, so producing one
   * would be arithmetic the model is forbidden. It is the narrower fact a summary needs: below a
   * year, calling the return "annual" is wrong twice over, and the report says so outright.
   */
  coversAYear: boolean
}

/** How long a period has to be before a yearly figure could describe it at all. */
export const ANNUALISATION_MIN_DAYS = 365

/**
 * How long the window and the history are, in calendar days (Story #286).
 *
 * Both ends are inclusive, so a window opening and closing on the same day is one day rather than
 * none — an off-by-one nobody would notice in a chart and everybody would notice in a sentence
 * that says how long the period was.
 */
export function periodSpan(bounds: Bounds, extent: Bounds): PeriodSpan {
  const periodDays = calendarDays(bounds)
  return {
    periodDays,
    historyDays: calendarDays(extent),
    coversAYear: periodDays >= ANNUALISATION_MIN_DAYS,
  }
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

/**
 * Sum the statement rows a window touches, whole, and report what they really cover.
 *
 * `null` bounds is the whole history — no restriction — and every row is summed. Otherwise a row is
 * included when it *overlaps* the window at all, because halving one would mean pro-rating a figure
 * IBKR reported for a whole period, and a pro-rated deposit is a number no report contains. What
 * the report then does with {@link PeriodFlows.partial} is say which span the totals really belong
 * to, rather than letting them be read as the window's own.
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

/**
 * The statement window a period restricts flows to: the period's own bounds, or `null` for `all`.
 *
 * `null` is "no restriction", which is not the same as "windowed to the full extent": a statement
 * row can start before the first day the value series holds, and the whole history should carry it
 * rather than drop it for landing a day outside a window nobody chose.
 */
export function flowWindow(period: StandardPeriod): Bounds | null {
  return period.kind === 'all' ? null : period.bounds
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
 * The daily returns inside a period, measured against the day that really preceded each.
 *
 * The **unwindowed** series goes in, so the opening step measures against its true predecessor
 * rather than against a synthetic point anchored at the window edge (DDR-0049).
 */
export function periodDailyReturns(
  report: PerformanceReport,
  period: StandardPeriod,
): ValuePoint[] {
  return dailyReturns(report.returnSeries, period.bounds)
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
  /** The first of those days, so a report can say what the two ends really are. */
  firstDate: number | null
  lastDate: number | null
  firstNav: number | null
  lastNav: number | null
  navChange: number | null
  bands: BandShift[]
  /** The days themselves, oldest first — what a history over the period is drawn from. */
  points: readonly { date: number; total: number; values: readonly number[] }[]
}

/**
 * The shape of the portfolio at each end of the window, and the days in between.
 *
 * Sliced, never carried forward: each composition point is a simultaneous observation of every
 * band, and a carried-forward one would pair one day's stocks with another day's cash (DDR-0052).
 * A window holding one day therefore has a shape whose two ends are the same day — which the
 * report says rather than presenting as a shift — and one holding none, because the optional
 * NAV-in-base Flex section was never exported, has no shape at all (DDR-0050).
 */
export function periodComposition(
  report: PerformanceReport,
  bounds: Bounds,
): PeriodComposition {
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
      points: [],
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
    points,
  }
}

/**
 * The value series inside a period, oldest first.
 *
 * Filtered rather than sliced with synthetic endpoints: a history report lists days the app really
 * observed, and an anchored point at the window edge would be a day it did not.
 */
export function periodValueSeries(
  report: PerformanceReport,
  period: StandardPeriod,
): ValuePoint[] {
  return report.valueSeries.filter(
    (point) => point.date >= period.bounds.from && point.date <= period.bounds.to,
  )
}
