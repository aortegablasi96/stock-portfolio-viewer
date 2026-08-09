/**
 * The branch selection and wording behind the analytics views' shared shell (Story #153,
 * DDR-0043).
 *
 * Every analytics view answers the same four states, and until this story each of the four
 * spelled the whole guard out — differing only in one noun. The guard itself is what lives here:
 * two nested discriminants (the hook's `phase`, then the result's `status`) flatten to one, and
 * the three strings a view was restating are derived from the noun.
 *
 * It is a pure module because Vitest runs Node-only (DDR-0029) — nothing inside a component is
 * testable, so the part worth pinning is the part that is not inside one. What is pinned here is
 * the mapping and the exact wording, including the typographic apostrophe in "Couldn't", which is
 * the sort of thing four hand-written copies drift on first.
 */

/**
 * The `ok | needs_import` shape every analytics channel returns (`shared/domain/*.ts`), stated
 * structurally so the shell is generic over the four reports rather than knowing any of them.
 */
export type AnalyticsReportResult<Report> =
  | { status: 'ok'; report: Report }
  | { status: 'needs_import' }

/** What `useAnalytics` holds: the result, wrapped in the phases it adds around the fetch. */
export type AnalyticsState<R> =
  | { phase: 'loading' }
  | { phase: 'loaded'; result: R }
  | { phase: 'error'; message: string }

/** Everything `useAnalytics` returns — the shell takes it whole rather than four loose props. */
export type AnalyticsLoad<R> = {
  state: AnalyticsState<R>
  /** A re-read is in flight over data that is already on screen (never the first load). */
  refreshing: boolean
  /** When the report on screen was read, or `null` before the first one arrives. */
  loadedAt: number | null
  reload: () => Promise<void>
}

/**
 * The four states a view renders, flattened. `loading` is still the *first* load only — a
 * refresh keeps the loaded branch and reports itself through `refreshing` (DDR-0027), so this
 * mapping never sends a refreshing view back to the loading panel.
 */
export type AnalyticsBranch<Report> =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'needs_import' }
  | { kind: 'loaded'; report: Report }

/** Collapse the hook's phase and the result's status into the one branch the shell renders. */
export function analyticsBranch<Report>(
  state: AnalyticsState<AnalyticsReportResult<Report>>,
): AnalyticsBranch<Report> {
  switch (state.phase) {
    case 'loading':
      return { kind: 'loading' }
    case 'error':
      return { kind: 'error', message: state.message }
    case 'loaded':
      return state.result.status === 'needs_import'
        ? { kind: 'needs_import' }
        : { kind: 'loaded', report: state.result.report }
  }
}

/** The one-line loading state, e.g. "Loading performance…". */
export function loadingMessage(subject: string): string {
  return `Loading ${subject}…`
}

/** The error panel's heading, e.g. "Couldn’t load allocation". */
export function errorHeading(subject: string): string {
  return `Couldn’t load ${subject}`
}

/** The retry button's label, which reports the re-read it started. */
export function retryLabel(refreshing: boolean): string {
  return refreshing ? 'Retrying…' : 'Retry'
}
