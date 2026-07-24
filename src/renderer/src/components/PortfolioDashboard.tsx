import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PortfolioOverview } from '@shared/domain/portfolio'
import type { SnapshotSummary } from '@shared/domain/snapshot'
import { HoldingsTable } from './HoldingsTable'
import { BalancesSummary } from './BalancesSummary'
import { AllocationPanel } from './AllocationPanel'
import { SnapshotHistory } from './SnapshotHistory'
import { CurrencySelector } from './CurrencySelector'
import { ConfirmAction } from './ConfirmAction'

/** Default display currency on first load: the account base currency (Story #28). */
const DEFAULT_DISPLAY_CURRENCY = 'EUR'

/**
 * The portfolio dashboard. Fetches the live overview from the main process on
 * mount and renders one of four exclusive states, driven by the
 * `PortfolioOverviewResult` discriminated union returned over IPC:
 *
 *   loading · ok · not_connected · error
 *
 * Milestone M2 adds snapshot history (Story #19) and a manual "Capture now"
 * action (Story #18). History is read from local storage independently of the
 * gateway, so it renders even when the live overview is not_connected/error.
 * The component holds no business logic — assembly, calculations, and the capture
 * policy live in the services (see the M2 Architecture Review / DDR-0003).
 */
type LoadState =
  | { phase: 'loading' }
  | { phase: 'ok'; overview: PortfolioOverview }
  | { phase: 'not_connected'; message: string }
  | { phase: 'error'; message: string }

type CaptureState =
  | { phase: 'idle' }
  | { phase: 'capturing' }
  | { phase: 'done'; message: string }
  | { phase: 'error'; message: string }

export function PortfolioDashboard(): React.JSX.Element {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([])
  const [capture, setCapture] = useState<CaptureState>({ phase: 'idle' })
  const [displayCurrency, setDisplayCurrency] = useState(DEFAULT_DISPLAY_CURRENCY)
  const [busy, setBusy] = useState(false)
  const [historyStatus, setHistoryStatus] = useState<string | null>(null)

  // `keepPrevious` keeps the current figures visible while re-converting on a currency
  // change, so switching currency shows a subtle busy hint rather than blanking the view.
  const load = useCallback(async (currency: string, keepPrevious = false) => {
    if (!keepPrevious) setState({ phase: 'loading' })
    setBusy(true)
    try {
      const result = await window.api.getPortfolioOverview({ displayCurrency: currency })
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
    } finally {
      setBusy(false)
    }
  }, [])

  const onCurrencyChange = useCallback(
    (currency: string) => {
      setDisplayCurrency(currency)
      void load(currency, true)
    },
    [load],
  )

  // The currencies the selector offers: the default base plus every currency actually held.
  const currencyOptions = useMemo(() => {
    const codes = new Set<string>([DEFAULT_DISPLAY_CURRENCY, displayCurrency])
    if (state.phase === 'ok') {
      for (const h of state.overview.holdings) if (h.currency) codes.add(h.currency)
    }
    return [...codes].sort()
  }, [state, displayCurrency])

  const loadHistory = useCallback(async () => {
    try {
      setSnapshots(await window.api.listSnapshots())
    } catch {
      // History is a secondary panel; a failure here shouldn't blank the dashboard.
      setSnapshots([])
    }
  }, [])

  const captureNow = useCallback(async () => {
    setCapture({ phase: 'capturing' })
    try {
      const result = await window.api.captureSnapshot()
      switch (result.status) {
        case 'captured':
          setCapture({ phase: 'done', message: 'Snapshot captured.' })
          await loadHistory()
          break
        case 'not_connected':
          setCapture({ phase: 'error', message: 'Not connected — connect to capture a snapshot.' })
          break
        case 'error':
          setCapture({ phase: 'error', message: result.message })
          break
      }
    } catch (err) {
      setCapture({
        phase: 'error',
        message: err instanceof Error ? err.message : 'Unexpected error capturing the snapshot.',
      })
    }
  }, [loadHistory])

  const clearHistory = useCallback(async () => {
    setHistoryStatus(null)
    try {
      const result = await window.api.clearHistory()
      if (result.status === 'cleared') {
        setSnapshots([])
        setHistoryStatus(
          `Cleared ${result.removedSnapshots} snapshot${result.removedSnapshots === 1 ? '' : 's'}.`,
        )
      } else {
        setHistoryStatus(result.message)
      }
    } catch (err) {
      setHistoryStatus(
        err instanceof Error ? err.message : 'Unexpected error clearing the history.',
      )
    }
  }, [])

  useEffect(() => {
    void load(DEFAULT_DISPLAY_CURRENCY)
    void loadHistory()
    // Refresh history when the main process captures a snapshot on open.
    return window.api.onSnapshotCaptured(() => void loadHistory())
  }, [load, loadHistory])

  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Stock Portfolio Viewer</p>
          <h1>Portfolio</h1>
        </div>
        <div className="dashboard-actions">
          <p className="source-note">Live from Interactive Brokers</p>
          <CurrencySelector
            value={displayCurrency}
            options={currencyOptions}
            disabled={busy}
            onChange={onCurrencyChange}
          />
          <button
            type="button"
            className="capture-button"
            onClick={() => void captureNow()}
            disabled={capture.phase === 'capturing'}
          >
            {capture.phase === 'capturing' ? 'Capturing…' : 'Capture now'}
          </button>
        </div>
      </header>

      {(capture.phase === 'done' || capture.phase === 'error') && (
        <p
          className={`capture-status ${capture.phase === 'error' ? 'capture-status-error' : ''}`}
          role="status"
        >
          {capture.message}
        </p>
      )}

      {state.phase === 'loading' && (
        <p className="state-panel" role="status">
          Loading your portfolio…
        </p>
      )}

      {state.phase === 'not_connected' && (
        <section className="state-panel state-notice" role="status">
          <h2>Not connected to Interactive Brokers</h2>
          <p>{state.message}</p>
          <button type="button" className="retry-button" onClick={() => void load(displayCurrency)}>
            Retry
          </button>
        </section>
      )}

      {state.phase === 'error' && (
        <section className="state-panel state-error" role="alert">
          <h2>Couldn’t load your portfolio</h2>
          <p>{state.message}</p>
          <button type="button" className="retry-button" onClick={() => void load(displayCurrency)}>
            Retry
          </button>
        </section>
      )}

      {state.phase === 'ok' && (
        <>
          {busy && (
            <p className="state-panel converting-note" role="status">
              Converting to {displayCurrency}…
            </p>
          )}
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
                  displayCurrency={state.overview.displayCurrency}
                />
              </div>
              <aside className="col-side">
                <AllocationPanel allocation={state.overview.allocation} />
              </aside>
            </div>
          )}
        </>
      )}

      {historyStatus && (
        <p className="capture-status" role="status">
          {historyStatus}
        </p>
      )}

      <SnapshotHistory
        snapshots={snapshots}
        action={
          snapshots.length > 0 ? (
            <ConfirmAction
              label="Clear history"
              confirmLabel="Yes, clear all history"
              busyLabel="Clearing…"
              warning="This permanently removes all captured portfolio snapshots. Imported Flex statements are not affected. New snapshots are captured when you next open the app or capture on demand."
              onConfirm={clearHistory}
            />
          ) : undefined
        }
      />
    </main>
  )
}
