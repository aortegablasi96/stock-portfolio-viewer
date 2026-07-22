import { useCallback, useEffect, useState } from 'react'

/**
 * Shared loading wrapper for the M3 analytics views (Stories #21–#24). Each view
 * fetches a discriminated result (`ok` / `needs_import`) over `window.api`; this hook
 * adds the `loading` and `error` phases around it so every view handles the same four
 * states without duplicating the boilerplate. The `ok` / `needs_import` branch is left
 * to the view, which switches on `result.status`.
 */
export type AnalyticsState<R> =
  | { phase: 'loading' }
  | { phase: 'loaded'; result: R }
  | { phase: 'error'; message: string }

export function useAnalytics<R>(fetcher: () => Promise<R>): {
  state: AnalyticsState<R>
  reload: () => Promise<void>
} {
  const [state, setState] = useState<AnalyticsState<R>>({ phase: 'loading' })

  const reload = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      setState({ phase: 'loaded', result: await fetcher() })
    } catch (err) {
      setState({
        phase: 'error',
        message: err instanceof Error ? err.message : 'Unexpected error loading analytics.',
      })
    }
  }, [fetcher])

  useEffect(() => {
    void reload()
  }, [reload])

  return { state, reload }
}
