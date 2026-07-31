import { useCallback, useEffect, useState } from 'react'
import type { FlexStatementImport, FlexStatementStore } from '@shared/domain/flex'
import { formatDate, formatDateTime } from '../lib/format'
import { flexDataVersion } from '../lib/dataVersion'
import { ConfirmAction } from './ConfirmAction'
import { Button } from './ui/Button'

/**
 * Flex Query import panel (Milestone M3, Story #20). Lets the owner import IBKR
 * Portfolio Analyst Flex Query XML files and shows what was stored. All work happens
 * in the main process over `window.api.importFlexStatements()`; this component only
 * triggers the import and renders the returned summary or state. The import result is
 * a discriminated union, so each outcome (imported / canceled / invalid / error) is a
 * first-class UI state (ADR-0005).
 *
 * Below it sits the stored-statement list (Story #108), which reads the *store* rather
 * than the last import: it loads on mount, so on launch the owner can see what their
 * analytics are built from and how current it is, and it reloads after an import or a
 * clear so the two never disagree.
 *
 * Both write paths also bump the shared data version (Story #109). The analytics views stay
 * mounted once visited, so importing or clearing here would otherwise leave four views
 * showing history that has just changed — or been deleted — until the owner refreshed each
 * one by hand.
 */
type ImportState =
  | { phase: 'idle' }
  | { phase: 'importing' }
  | { phase: 'imported'; statements: FlexStatementImport[] }
  | { phase: 'canceled' }
  | { phase: 'invalid'; message: string }
  | { phase: 'error'; message: string }
  | { phase: 'cleared'; removedStatements: number }

/** Total rows inserted across every record type in a statement import. */
function totalInserted(statement: FlexStatementImport): number {
  return Object.values(statement.records).reduce((sum, count) => sum + count.inserted, 0)
}

/** The stored-statement list: `null` until the first read resolves (Story #108). */
type StoreState = FlexStatementStore | null

export function FlexImport(): React.JSX.Element {
  const [state, setState] = useState<ImportState>({ phase: 'idle' })
  const [store, setStore] = useState<StoreState>(null)

  // The store is the source of truth for what is held; every write path below re-reads it
  // rather than patching local state from an import summary, so the list can't drift.
  const loadStore = useCallback(async () => {
    try {
      setStore(await window.api.listFlexStatements())
    } catch {
      // A failed read leaves the previous list in place; the panel's own status line
      // reports import/clear failures, and there is nothing the owner can act on here.
    }
  }, [])

  useEffect(() => {
    void loadStore()
  }, [loadStore])

  const runImport = useCallback(async () => {
    setState({ phase: 'importing' })
    try {
      const result = await window.api.importFlexStatements()
      switch (result.status) {
        case 'imported':
          setState({ phase: 'imported', statements: result.summary.statements })
          flexDataVersion.bump()
          await loadStore()
          break
        case 'canceled':
          setState({ phase: 'canceled' })
          break
        case 'invalid':
          setState({ phase: 'invalid', message: result.message })
          break
        case 'error':
          setState({ phase: 'error', message: result.message })
          break
      }
    } catch (err) {
      setState({
        phase: 'error',
        message: err instanceof Error ? err.message : 'Unexpected error importing the statements.',
      })
    }
  }, [loadStore])

  const runClear = useCallback(async () => {
    try {
      const result = await window.api.clearStatements()
      if (result.status === 'cleared') {
        setState({ phase: 'cleared', removedStatements: result.removedStatements })
        flexDataVersion.bump()
        await loadStore()
      } else {
        setState({ phase: 'error', message: result.message })
      }
    } catch (err) {
      setState({
        phase: 'error',
        message: err instanceof Error ? err.message : 'Unexpected error clearing the statements.',
      })
    }
  }, [loadStore])

  return (
    <div className="dashboard">
      <section className="snapshot-history flex-import" aria-labelledby="flex-import-heading">
        <div className="flex-import-head">
          <div>
            <h2 id="flex-import-heading">Flex Query import</h2>
            <p className="flex-import-intro">
              Import IBKR Portfolio Analyst Flex Query statements (.xml) to build your history for
              performance, allocation, dividend, and realized-gains analytics.
            </p>
          </div>
          <div className="flex-import-actions">
            <Button onClick={() => void runImport()} disabled={state.phase === 'importing'}>
              {state.phase === 'importing' ? 'Importing…' : 'Import statements…'}
            </Button>
            <ConfirmAction
              label="Clear statements"
              confirmLabel="Yes, clear all statements"
              busyLabel="Clearing…"
              warning="This permanently removes all imported Flex statement data — trades, positions, dividends and realized gains. Snapshot history is not affected. You can re-import your Flex exports afterwards."
              onConfirm={runClear}
            />
          </div>
        </div>

        {state.phase === 'cleared' && (
          <p className="capture-status" role="status">
            {state.removedStatements === 0
              ? 'No imported statements to clear.'
              : `Cleared ${state.removedStatements} statement${state.removedStatements === 1 ? '' : 's'}. The analytics views will show their needs-import state until you import again.`}
          </p>
        )}

        {state.phase === 'canceled' && (
          <p className="snapshot-empty" role="status">
            Import canceled — no files were selected.
          </p>
        )}

        {(state.phase === 'invalid' || state.phase === 'error') && (
          <p className="capture-status capture-status-error" role="alert">
            {state.phase === 'invalid'
              ? `That file isn’t a valid Flex Query statement, so nothing was imported. ${state.message}`
              : state.message}
          </p>
        )}

        {state.phase === 'imported' && <ImportSummary statements={state.statements} />}
      </section>

      <StoredStatements store={store} />
    </div>
  )
}

/**
 * What the local store currently holds (Story #108) — the answer to "what is my analytics
 * built from, and how current is it?", available on launch with no import required. The
 * coverage line gives the span at a glance; the rows below give each statement's own
 * period, so a gap between two of them, or a newest statement that ends months ago, is
 * visible without arithmetic. Rows arrive newest first, matching the History card above —
 * the first row is the statement the statement-scoped analytics reads treat as latest.
 */
function StoredStatements({ store }: { store: FlexStatementStore | null }): React.JSX.Element {
  return (
    <section className="snapshot-history flex-store" aria-labelledby="flex-store-heading">
      <h2 id="flex-store-heading">Stored statements</h2>

      {store === null ? (
        <p className="snapshot-empty">Loading stored statements…</p>
      ) : store.statements.length === 0 ? (
        <p className="snapshot-empty">
          No statements imported yet. Import a Flex Query export above to build the history the
          analytics views read from.
        </p>
      ) : (
        <>
          {store.coverage && (
            <p className="flex-store-coverage">
              Covering{' '}
              <strong>
                {formatDate(store.coverage.fromDate)} – {formatDate(store.coverage.toDate)}
              </strong>{' '}
              across {store.statements.length}{' '}
              {store.statements.length === 1 ? 'statement' : 'statements'}.
            </p>
          )}

          <div className="table-scroll">
            <table className="holdings-table">
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col">Period covered</th>
                  <th scope="col">Base</th>
                  <th scope="col">Imported</th>
                </tr>
              </thead>
              <tbody>
                {store.statements.map((s) => (
                  <tr key={s.id}>
                    <th scope="row" className="symbol">
                      {s.accountId}
                      <span className="flex-import-file">{s.sourceFilename}</span>
                    </th>
                    <td className="description">
                      {formatDate(s.fromDate)} – {formatDate(s.toDate)}
                    </td>
                    <td>{s.baseCurrency}</td>
                    <td className="description">{formatDateTime(s.importedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

function ImportSummary({ statements }: { statements: FlexStatementImport[] }): React.JSX.Element {
  const newlyImported = statements.filter((s) => !s.alreadyImported)

  return (
    <div className="flex-import-summary">
      <p className="capture-status" role="status">
        {newlyImported.length === 0
          ? 'Everything selected was already imported — no new data added.'
          : `Imported ${newlyImported.length} statement${newlyImported.length === 1 ? '' : 's'}.`}
      </p>

      <div className="table-scroll">
        <table className="holdings-table">
          <thead>
            <tr>
              <th scope="col">Account</th>
              <th scope="col">Period</th>
              <th scope="col" className="num">
                Trades
              </th>
              <th scope="col" className="num">
                Cash
              </th>
              <th scope="col" className="num">
                Positions
              </th>
              <th scope="col" className="num">
                Lots
              </th>
              <th scope="col" className="num">
                Securities
              </th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {statements.map((s, index) => (
              <tr key={`${s.accountId}-${s.fromDate}-${s.toDate}-${index}`}>
                <th scope="row" className="symbol">
                  {s.accountId}
                  <span className="flex-import-file">{s.filename}</span>
                </th>
                <td className="description">
                  {formatDate(s.fromDate)} – {formatDate(s.toDate)}
                </td>
                <RecordCell count={s.records.trades} dim={s.alreadyImported} />
                <RecordCell count={s.records.cashTransactions} dim={s.alreadyImported} />
                <RecordCell count={s.records.openPositions} dim={s.alreadyImported} />
                <RecordCell count={s.records.lots} dim={s.alreadyImported} />
                <RecordCell count={s.records.securities} dim={s.alreadyImported} />
                <td>
                  {s.alreadyImported ? (
                    <span className="flex-import-badge">Already imported</span>
                  ) : totalInserted(s) === 0 ? (
                    <span className="flex-import-badge">No new rows</span>
                  ) : (
                    <span className="flex-import-badge flex-import-badge-new">Imported</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function RecordCell({
  count,
  dim,
}: {
  count: { inserted: number; skipped: number }
  dim: boolean
}): React.JSX.Element {
  if (dim) return <td className="num flex-import-dim">—</td>
  return (
    <td className="num">
      {count.inserted}
      {count.skipped > 0 && <span className="flex-import-dup"> (+{count.skipped} dup)</span>}
    </td>
  )
}
