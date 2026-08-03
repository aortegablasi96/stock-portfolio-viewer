import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PortfolioOverview } from '@shared/domain/portfolio'
import type { SnapshotSummary } from '@shared/domain/snapshot'
import { HoldingsTable } from './HoldingsTable'
import { BalancesSummary } from './BalancesSummary'
import { AllocationPanel } from './AllocationPanel'
import { SnapshotHistory } from './SnapshotHistory'
import { CurrencySelector } from './CurrencySelector'
import { ConfirmAction } from './ConfirmAction'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { StatePanel } from './ui/StatePanel'

/** Default display currency on first load: the account base currency (Story #28). */
const DEFAULT_DISPLAY_CURRENCY = 'EUR'

/**
 * The portfolio dashboard. Fetches the live overview from the main process on
 * mount and renders one of five exclusive states, driven by the
 * `PortfolioOverviewResult` discriminated union returned over IPC:
 *
 *   loading · ok · not_connected · not_responding · error
 *
 * `not_connected` and `not_responding` are separate states on purpose (Story #104): the
 * first means the gateway isn't running, the second that it accepted the request and then
 * went quiet — typically an expired session needing a re-login, not a restart. Both offer
 * Retry, because a bounded request that gave up is exactly the case worth retrying.
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
  | { phase: 'not_responding'; message: string }
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

  // Latest selected currency for callbacks that fire outside React's render flow (the
  // main→renderer "snapshot captured" event), so an on-open capture reloads history in the
  // currency currently on screen rather than a stale closure's value.
  const displayCurrencyRef = useRef(displayCurrency)
  useEffect(() => {
    displayCurrencyRef.current = displayCurrency
  }, [displayCurrency])

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
        case 'not_responding':
          setState({ phase: 'not_responding', message: result.message })
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

  // History is read from local storage but converted to the display currency with live
  // gateway FX (Bug #44); it degrades gracefully in the service when disconnected, so it
  // stays visible either way. A failure here shouldn't blank the dashboard.
  const loadHistory = useCallback(async (currency: string) => {
    try {
      setSnapshots(await window.api.listSnapshots({ displayCurrency: currency }))
    } catch {
      setSnapshots([])
    }
  }, [])

  const onCurrencyChange = useCallback(
    (currency: string) => {
      setDisplayCurrency(currency)
      void load(currency, true)
      void loadHistory(currency)
    },
    [load, loadHistory],
  )

  // The currencies the selector offers: the default base plus every currency actually held.
  const currencyOptions = useMemo(() => {
    const codes = new Set<string>([DEFAULT_DISPLAY_CURRENCY, displayCurrency])
    if (state.phase === 'ok') {
      for (const h of state.overview.holdings) if (h.currency) codes.add(h.currency)
    }
    return [...codes].sort()
  }, [state, displayCurrency])

  const captureNow = useCallback(async () => {
    setCapture({ phase: 'capturing' })
    try {
      const result = await window.api.captureSnapshot()
      switch (result.status) {
        case 'captured':
          setCapture({ phase: 'done', message: 'Snapshot captured.' })
          await loadHistory(displayCurrencyRef.current)
          break
        case 'not_connected':
          setCapture({ phase: 'error', message: 'Not connected — connect to capture a snapshot.' })
          break
        case 'not_responding':
          setCapture({
            phase: 'error',
            message: 'Interactive Brokers didn’t respond in time — try again.',
          })
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
    void loadHistory(DEFAULT_DISPLAY_CURRENCY)
    // Refresh history when the main process captures a snapshot on open, in the currency
    // currently on screen (the ref avoids re-subscribing on every currency change).
    return window.api.onSnapshotCaptured(() => void loadHistory(displayCurrencyRef.current))
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
          <Button onClick={() => void captureNow()} disabled={capture.phase === 'capturing'}>
            {capture.phase === 'capturing' ? 'Capturing…' : 'Capture now'}
          </Button>
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

      {state.phase === 'loading' && <StatePanel variant="loading">Loading your portfolio…</StatePanel>}

      {state.phase === 'not_connected' && (
        <StatePanel
          variant="notice"
          heading="Not connected to Interactive Brokers"
          action={
            <Button variant="primary" onClick={() => void load(displayCurrency)}>
              Retry
            </Button>
          }
        >
          {state.message}
        </StatePanel>
      )}

      {/* Distinct from not_connected by its heading and by the fix it names: this gateway is
          running, so a restart is the wrong advice (DDR-0022). */}
      {state.phase === 'not_responding' && (
        <StatePanel
          variant="notice"
          heading="Interactive Brokers isn’t responding"
          hint={
            <>
              The gateway is running but didn’t answer. Its session usually needs re-authenticating
              at <code>https://localhost:5000</code>.
            </>
          }
          action={
            <Button variant="primary" onClick={() => void load(displayCurrency)}>
              Retry
            </Button>
          }
        >
          {state.message}
        </StatePanel>
      )}

      {state.phase === 'error' && (
        <StatePanel
          variant="error"
          heading="Couldn’t load your portfolio"
          action={
            <Button variant="primary" onClick={() => void load(displayCurrency)}>
              Retry
            </Button>
          }
        >
          {state.message}
        </StatePanel>
      )}

      {state.phase === 'ok' && (
        <>
          {/* A refresh, not a state: the figures stay on screen while they are re-converted,
              which is why this is the `converting-note` and not a `StatePanel` (DDR-0027). */}
          {busy && (
            <Card as="p" size="lg" className="converting-note" role="status">
              Converting to {displayCurrency}…
            </Card>
          )}
          <BalancesSummary balances={state.overview.balances} />
          {state.overview.holdings.length === 0 ? (
            <StatePanel variant="empty">No open positions in this account.</StatePanel>
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
