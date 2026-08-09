import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { flexDataVersion } from '../../lib/dataVersion'
import type { AnalyticsLoad, AnalyticsState } from '../../lib/analyticsShell'

/**
 * Shared loading wrapper for the M3 analytics views (Stories #21–#24). Each view
 * fetches a discriminated result (`ok` / `needs_import`) over `window.api`; this hook
 * adds the `loading` and `error` phases around it so every view handles the same four
 * states without duplicating the boilerplate. Rendering those four is `AnalyticsShell`'s
 * job (Story #153) — this hook produces the state, the shell reads it.
 *
 * Story #109 makes a re-read non-destructive. `loading` is now the *first* load only: once
 * a report has arrived, a reload keeps it on screen and reports itself through `refreshing`
 * instead, so an explicit refresh — or the re-read that follows an import — never blanks a
 * view the owner is reading. Two things drive a reload beyond mount: the view's own
 * `reload()` (the `RefreshBar` and the error panel's retry), and a bump of the shared
 * `flexDataVersion`, which is how a view that has been sitting mounted-but-hidden since its
 * last visit learns that the store underneath it changed (see `lib/dataVersion`).
 *
 * The phases and the return shape are declared in `lib/analyticsShell` rather than here, because
 * the shell that renders them is what has to be unit-testable under Node (Story #153). The hook's
 * behaviour is unchanged by that move.
 */
export type { AnalyticsLoad, AnalyticsState } from '../../lib/analyticsShell'

export function useAnalytics<R>(fetcher: () => Promise<R>): AnalyticsLoad<R> {
  const version = useSyncExternalStore(flexDataVersion.subscribe, flexDataVersion.get)
  const [state, setState] = useState<AnalyticsState<R>>({ phase: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [loadedAt, setLoadedAt] = useState<number | null>(null)

  // Only the newest read may write. A refresh started while an import-triggered read is
  // still in flight would otherwise be free to land in either order, and the loser would
  // overwrite the winner with the older report.
  const runIdRef = useRef(0)

  const reload = useCallback(async () => {
    const runId = ++runIdRef.current
    setRefreshing(true)
    try {
      const result = await fetcher()
      if (runId !== runIdRef.current) return
      setState({ phase: 'loaded', result })
      setLoadedAt(Date.now())
    } catch (err) {
      if (runId !== runIdRef.current) return
      setState({
        phase: 'error',
        message: err instanceof Error ? err.message : 'Unexpected error loading analytics.',
      })
    } finally {
      if (runId === runIdRef.current) setRefreshing(false)
    }
  }, [fetcher])

  // `version` is a dependency, not a value this effect reads: a bump means the imported
  // store changed under a view that may have been hidden for minutes.
  useEffect(() => {
    void reload()
  }, [reload, version])

  return { state, refreshing, loadedAt, reload }
}
