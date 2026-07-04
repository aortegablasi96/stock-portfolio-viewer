import { useCallback, useEffect, useState } from 'react'
import type { PortfolioOverview } from '@shared/domain/portfolio'
import { HoldingsTable } from './HoldingsTable'
import { BalancesSummary } from './BalancesSummary'
import { AllocationPanel } from './AllocationPanel'

/**
 * The read-only portfolio dashboard (Milestone M1). Fetches the overview from the
 * main process on mount and renders one of four exclusive states, driven by the
 * `PortfolioOverviewResult` discriminated union returned over IPC:
 *
 *   loading · ok · not_connected · error
 *
 * Story #15 owns this container, the state handling, and the holdings table. The
 * balances tiles and allocation panel (Story #16) render inside the `ok` state.
 * The component holds no business logic — assembly and calculations live in the
 * service (see the M1 Architecture Review / ADR-0004).
 */
type LoadState =
  | { phase: 'loading' }
  | { phase: 'ok'; overview: PortfolioOverview }
  | { phase: 'not_connected'; message: string }
  | { phase: 'error'; message: string }

export function PortfolioDashboard(): React.JSX.Element {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const result = await window.api.getPortfolioOverview()
      switch (result.status) {
        case 'ok':
          setState({ phase: 'ok', overview: result.overview })
          break
        case 'not_connected':
          setState({ phase: 'not_connected', message: result.message })
          break
        case 'error':
          setState({ phase: 'error', message: result.message })
          break
      }
    } catch (err) {
      setState({
        phase: 'error',
        message: err instanceof Error ? err.message : 'Unexpected error loading the portfolio.',
      })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Stock Portfolio Viewer</p>
          <h1>Portfolio</h1>
        </div>
        <p className="source-note">Live from Interactive Brokers</p>
      </header>

      {state.phase === 'loading' && (
        <p className="state-panel" role="status">
          Loading your portfolio…
        </p>
      )}

      {state.phase === 'not_connected' && (
        <section className="state-panel state-notice" role="status">
          <h2>Not connected to Interactive Brokers</h2>
          <p>{state.message}</p>
          <button type="button" className="retry-button" onClick={() => void load()}>
            Retry
          </button>
        </section>
      )}

      {state.phase === 'error' && (
        <section className="state-panel state-error" role="alert">
          <h2>Couldn’t load your portfolio</h2>
          <p>{state.message}</p>
          <button type="button" className="retry-button" onClick={() => void load()}>
            Retry
          </button>
        </section>
      )}

      {state.phase === 'ok' && (
        <>
          <BalancesSummary
            balances={state.overview.balances}
            totalMarketValue={state.overview.totalMarketValue}
          />
          {state.overview.holdings.length === 0 ? (
            <p className="state-panel" role="status">
              No open positions in this account.
            </p>
          ) : (
            <div className="dashboard-columns">
              <div className="col-main">
                <HoldingsTable
                  holdings={state.overview.holdings}
                  allocation={state.overview.allocation}
                />
              </div>
              <aside className="col-side">
                <AllocationPanel allocation={state.overview.allocation} />
              </aside>
            </div>
          )}
        </>
      )}
    </main>
  )
}
