import { boundsFor, type Bounds, type RangeId } from './dateRange'
import { seriesExtent, windowStats, valueAt } from './performanceRange'
import type { PerformanceReport } from '@shared/domain/performance'

/**
 * Every standard period, computed before a question is asked (Story #287, DDR-0103).
 *
 * **The period belongs in the question, so the app cannot know which one it is.** #285 resolved
 * whatever the owner had clicked on a `RangeFilter`; DDR-0102 removed that control on the finding
 * that free text already carries a period and a picker beside it asks for the same fact twice. That
 * reverses the mechanism rather than merely deleting a widget: with no selection to resolve, the
 * grounding cannot be *one* window, so it is **all of them** — and the model reads whichever rows
 * the question names.
 *
 * Precomputing rather than resolving is the decision, and it is what makes the hard case a state
 * instead of a silence. A question about a window this set does not hold — *how did I do between
 * March and July?* — finds nothing, and the honest answer names the periods that do exist. That
 * answer is only available to a model that can see what the set contains, which is exactly what a
 * per-question resolution would not give it: a lookup that misses returns nothing to say about the
 * miss. DDR-0022's result-variant discipline, arriving in prose.
 *
 * ## What it refuses
 *
 * **It never anchors to the clock.** Every window here comes off `extent.to` — the last day the
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
 * **It never re-implements a figure.** The windowing is `dateRange`'s, the endpoints and the
 * chain-linked return are `performanceRange`'s. A second implementation of either would be free to
 * disagree with the chart the owner is looking at, and grounding means a figure in an answer and
 * the same figure on a page are one number.
 */

/** Which family a period belongs to — and therefore what it is compared against. */
export type PeriodKind = 'trailing' | 'year' | 'quarter' | 'all'

/** One window the model may be asked about, with everything the app knows about it. */
export interface StandardPeriod {
  /** Stable identity, never shown: `year:2025`, `quarter:2025Q3`, `trailing:1y`, `all`. */
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
 * Caps for `MAX_LISTED_POSITIONS`' reason — the prompt has a ceiling (`MAX_PROMPT_CHARS`) and a
 * context truncated by the gateway is truncated arbitrarily, the last section simply stopping. Both
 * cut at the *oldest* end and both state how many of how many they hold, so a question about 2011
 * is answered by saying which years are in front of the model rather than by inventing one. Eight
 * quarters is two years, which is as far back as a quarter-on-quarter question reaches in practice.
 */
export const MAX_LISTED_YEARS = 8
export const MAX_LISTED_QUARTERS = 8

/**
 * The trailing windows the set carries, and the words they go by.
 *
 * Deliberately **not** `PERIOD_LABELS`, which is `RANGE_OPTIONS`' own vocabulary (DDR-0085). That
 * vocabulary names a control's buttons, where "Last year" sits beside "1Y" and is unambiguous; here
 * it would sit beside a row named `2025`, and "how did last year go?" would have two rows to land
 * on with nothing to choose between them. Naming the window by its length is what makes a question
 * resolve to a row rather than to an inference — which is this story's whole naming rule, and the
 * reason the two vocabularies are allowed to differ at exactly this point.
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
 * `null` is the report having nothing to window — the same state {@link periodChange} returns it
 * for, and different from a window that holds no day, which is a period in the set with `days` at
 * zero.
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
