import { useCallback, useEffect, useRef, useState } from 'react'
import type { Holding, PortfolioOverview } from '@shared/domain/portfolio'
import type { SnapshotSummary } from '@shared/domain/snapshot'
import { HoldingsTable } from './HoldingsTable'
import { BalancesSummary } from './BalancesSummary'
import { AllocationPanel } from './AllocationPanel'
import { SnapshotHistory } from './SnapshotHistory'
import { ConfirmAction } from './ConfirmAction'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { PageHeader } from './ui/PageHeader'
import { StatePanel } from './ui/StatePanel'
import { readingFrom, type GatewayReading } from '../lib/gatewayStatus'
import { LIVE_SOURCE } from '../lib/pageHeader'

/** The currencies this account actually holds, sorted — what the sidebar's selector offers. */
function heldCurrencies(holdings: readonly Holding[]): string[] {
  return [...new Set(holdings.map((h) => h.currency).filter((code) => code !== ''))].sort()
}

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
 *
 * Story #183 moved the display-currency control out of this header and into the sidebar, which
 * makes this view a **reporter as well as a reader** (DDR-0056). It receives the currency to
 * convert into, and it hands back up the two things only a live read can know: which currencies
 * the account holds, and what the gateway did when asked. That reporting is the whole source of
 * truth for the sidebar's status badge — this view already re-reads on every visit, because it
 * is the one tab deliberately excluded from stay-mounted (DDR-0027), so nothing has to poll.
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

export function PortfolioDashboard({
  displayCurrency,
  onCurrenciesFound,
  onGatewayReading,
}: {
  /** The app's display currency, owned by the shell since the control moved to the sidebar. */
  displayCurrency: string
  /** The currencies this account holds, so the sidebar's selector can offer them. */
  onCurrenciesFound: (codes: readonly string[]) => void
  /** What the gateway did, for the sidebar's badge. Reported on every read, success or not. */
  onGatewayReading: (reading: GatewayReading) => void
}): React.JSX.Element {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([])
  const [capture, setCapture] = useState<CaptureState>({ phase: 'idle' })
  const [busy, setBusy] = useState(false)
  const [historyStatus, setHistoryStatus] = useState<string | null>(null)
  /**
   * When the figures on screen were read, for the header's freshness line (Story #185).
   *
   * Set only where `state` is set to `ok`, which is the same rule `useAnalytics` follows for the
   * analytics views: a failed read tells you nothing about how old the last successful one is, and
   * dating an error would age figures that never arrived. The sidebar's gateway badge is the
   * counterpart that *does* report the failures (DDR-0056) — it answers "is the source
   * answering?", where this answers "how old is what I am reading?".
   */
  const [loadedAt, setLoadedAt] = useState<number | null>(null)

  // Latest selected currency for callbacks that fire outside React's render flow (the
  // main→renderer "snapshot captured" event), so an on-open capture reloads history in the
  // currency currently on screen rather than a stale closure's value.
  const displayCurrencyRef = useRef(displayCurrency)
  useEffect(() => {
    displayCurrencyRef.current = displayCurrency
  }, [displayCurrency])

  /**
   * Which overview read is the current one.
   *
   * The selector used to be disabled while a conversion was in flight, which is how two reads
   * were kept from overlapping. It cannot be disabled from the sidebar — it has to stay usable
   * while this tab is not even mounted (DDR-0056) — so the race is handled instead of avoided:
   * a superseded read still reports its gateway reading, because that observation is true
   * whatever the owner has since selected, and then drops its figures on the floor.
   */
  const currentRead = useRef(0)

  // `keepPrevious` keeps the current figures visible while re-converting on a currency
  // change, so switching currency shows a subtle busy hint rather than blanking the view.
  const load = useCallback(
    async (currency: string, keepPrevious = false) => {
      const read = ++currentRead.current
      const isCurrent = (): boolean => currentRead.current === read
      if (!keepPrevious) setState({ phase: 'loading' })
      setBusy(true)
      try {
        const result = await window.api.getPortfolioOverview({ displayCurrency: currency })
        onGatewayReading(readingFrom(result.status, Date.now()))
        if (result.status === 'ok') onCurrenciesFound(heldCurrencies(result.overview.holdings))
        if (!isCurrent()) return
        switch (result.status) {
          case 'ok':
            setState({ phase: 'ok', overview: result.overview })
            setLoadedAt(Date.now())
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
        // The bridge itself failed, which the badge reports the same way the handler's `error`
        // variant is reported: the gateway told us nothing usable.
        onGatewayReading({ status: 'error', at: Date.now() })
        if (!isCurrent()) return
        setState({
          phase: 'error',
          message: err instanceof Error ? err.message : 'Unexpected error loading the portfolio.',
        })
      } finally {
        if (isCurrent()) setBusy(false)
      }
    },
    [onCurrenciesFound, onGatewayReading],
  )

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

  /**
   * Read on mount, and again whenever the app's display currency changes.
   *
   * One effect covers both because they are the same read; what differs is whether there are
   * figures on screen worth keeping. The first pass blanks to a loading state, a currency change
   * keeps the previous figures under the "Converting…" hint — the behaviour the old in-header
   * selector had, now driven from outside the component.
   */
  const hasLoaded = useRef(false)
  useEffect(() => {
    const keepPrevious = hasLoaded.current
    hasLoaded.current = true
    void load(displayCurrency, keepPrevious)
    void loadHistory(displayCurrency)
  }, [displayCurrency, load, loadHistory])

  useEffect(
    // Refresh history when the main process captures a snapshot on open, in the currency
    // currently on screen (the ref avoids re-subscribing on every currency change).
    () => window.api.onSnapshotCaptured(() => void loadHistory(displayCurrencyRef.current)),
    [loadHistory],
  )

  return (
    <main className="dashboard">
      {/* The same header the four analytics views open with (Story #185, DDR-0058). Two things
          this view used to spell out are the shell's now: the provenance sentence, and the reading
          time — which this view had no equivalent of at all, since the `RefreshBar` that carried
          it is an analytics control. The display-currency control used to sit inside this block
          (Story #183); it is a property of the app rather than of this view, so it moved to the
          sidebar's footer. */}
      <PageHeader
        title="Portfolio"
        source={LIVE_SOURCE}
        loadedAt={loadedAt}
        refreshing={busy}
        action={
          <Button onClick={() => void captureNow()} disabled={capture.phase === 'capturing'}>
            {capture.phase === 'capturing' ? 'Capturing…' : 'Capture now'}
          </Button>
        }
      />

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
