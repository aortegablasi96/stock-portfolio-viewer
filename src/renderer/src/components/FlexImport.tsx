import { useCallback, useState } from 'react'
import type { FlexStatementImport } from '@shared/domain/flex'
import { formatDate } from '../lib/format'

/**
 * Flex Query import panel (Milestone M3, Story #20). Lets the owner import IBKR
 * Portfolio Analyst Flex Query XML files and shows what was stored. All work happens
 * in the main process over `window.api.importFlexStatements()`; this component only
 * triggers the import and renders the returned summary or state. The import result is
 * a discriminated union, so each outcome (imported / canceled / invalid / error) is a
 * first-class UI state (ADR-0005).
 */
type ImportState =
  | { phase: 'idle' }
  | { phase: 'importing' }
  | { phase: 'imported'; statements: FlexStatementImport[] }
  | { phase: 'canceled' }
  | { phase: 'invalid'; message: string }
  | { phase: 'error'; message: string }

/** Total rows inserted across every record type in a statement import. */
function totalInserted(statement: FlexStatementImport): number {
  return Object.values(statement.records).reduce((sum, count) => sum + count.inserted, 0)
}

export function FlexImport(): React.JSX.Element {
  const [state, setState] = useState<ImportState>({ phase: 'idle' })

  const runImport = useCallback(async () => {
    setState({ phase: 'importing' })
    try {
      const result = await window.api.importFlexStatements()
      switch (result.status) {
        case 'imported':
          setState({ phase: 'imported', statements: result.summary.statements })
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
  }, [])

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
          <button
            type="button"
            className="capture-button"
            onClick={() => void runImport()}
            disabled={state.phase === 'importing'}
          >
            {state.phase === 'importing' ? 'Importing…' : 'Import statements…'}
          </button>
        </div>

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
    </div>
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
