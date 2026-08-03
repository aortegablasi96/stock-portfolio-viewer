import { useCallback, useEffect, useState } from 'react'
import type { FlexStatementImport, FlexStatementStore } from '@shared/domain/flex'
import { formatDate, formatDateTime } from '../lib/format'
import { flexDataVersion } from '../lib/dataVersion'
import { ConfirmAction } from './ConfirmAction'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card'
import { StatePanel } from './ui/StatePanel'
import { DataTable, type DataColumn } from './ui/DataTable'

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
      <Card aria-labelledby="flex-import-heading">
        <CardHeader align="start">
          <div>
            <CardTitle id="flex-import-heading">Flex Query import</CardTitle>
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
        </CardHeader>

        {/* Rendered only when there is something to report: an empty body would still take the
            header's gap below it, and the idle panel is the header alone. */}
        {state.phase !== 'idle' && state.phase !== 'importing' && (
          <CardContent>
            {state.phase === 'cleared' && (
              <p className="capture-status" role="status">
                {state.removedStatements === 0
                  ? 'No imported statements to clear.'
                  : `Cleared ${state.removedStatements} statement${state.removedStatements === 1 ? '' : 's'}. The analytics views will show their needs-import state until you import again.`}
              </p>
            )}

            {state.phase === 'canceled' && (
              <StatePanel surface="inline">Import canceled — no files were selected.</StatePanel>
            )}

            {(state.phase === 'invalid' || state.phase === 'error') && (
              <p className="capture-status capture-status-error" role="alert">
                {state.phase === 'invalid'
                  ? `That file isn’t a valid Flex Query statement, so nothing was imported. ${state.message}`
                  : state.message}
              </p>
            )}

            {state.phase === 'imported' && <ImportSummary statements={state.statements} />}
          </CardContent>
        )}
      </Card>

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
    <Card aria-labelledby="flex-store-heading">
      <CardTitle id="flex-store-heading">Stored statements</CardTitle>
      <CardContent>
        {store === null ? (
          <StatePanel variant="loading" surface="inline">
            Loading stored statements…
          </StatePanel>
        ) : store.statements.length === 0 ? (
          <StatePanel surface="inline">
            No statements imported yet. Import a Flex Query export above to build the history the
            analytics views read from.
          </StatePanel>
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

            <StoredStatementsTable statements={store.statements} />
          </>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * What the store holds (Story #108). Sorting is worth having here — the statements are imported
 * in whatever order the owner picked the files, so "which period am I missing?" is a question of
 * order — and Period covered sorts on `fromDate` rather than the rendered range.
 */
function StoredStatementsTable({
  statements,
}: {
  statements: FlexStatementStore['statements']
}): React.JSX.Element {
  const columns: DataColumn<FlexStatementStore['statements'][number]>[] = [
    {
      key: 'account',
      header: 'Account',
      rowHeader: true,
      cell: (s) => (
        <>
          {s.accountId}
          <span className="flex-import-file">{s.sourceFilename}</span>
        </>
      ),
      sortValue: (s) => s.accountId,
    },
    {
      key: 'period',
      header: 'Period covered',
      className: 'data-table-note',
      cell: (s) => `${formatDate(s.fromDate)} – ${formatDate(s.toDate)}`,
      sortValue: (s) => s.fromDate,
    },
    {
      key: 'base',
      header: 'Base',
      cell: (s) => s.baseCurrency,
      sortValue: (s) => s.baseCurrency,
    },
    {
      key: 'importedAt',
      header: 'Imported',
      className: 'data-table-note',
      cell: (s) => formatDateTime(s.importedAt),
      sortValue: (s) => s.importedAt,
    },
  ]

  return (
    <DataTable
      caption="Stored statements"
      columns={columns}
      rows={statements}
      rowKey={(s) => s.id}
    />
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

      <DataTable
        caption="Import summary"
        columns={summaryColumns}
        rows={statements}
        rowKey={(s, index) => `${s.accountId}-${s.fromDate}-${s.toDate}-${index}`}
      />
    </div>
  )
}

/** The five record sections a statement carries, in the order the import writes them. */
const RECORD_SECTIONS = [
  { key: 'trades', header: 'Trades' },
  { key: 'cashTransactions', header: 'Cash' },
  { key: 'openPositions', header: 'Positions' },
  { key: 'lots', header: 'Lots' },
  { key: 'securities', header: 'Securities' },
] as const

/**
 * The import summary's columns. Deliberately **not sortable** (Story #134): this table is the
 * receipt for one action, listing the files the owner just picked in the order they picked
 * them. Sorting is opt-in per column precisely so a table with no question to answer doesn't
 * grow controls that answer nothing. The stored-statement list above it is the one that sorts.
 */
const summaryColumns: DataColumn<FlexStatementImport>[] = [
  {
    key: 'account',
    header: 'Account',
    rowHeader: true,
    cell: (s) => (
      <>
        {s.accountId}
        <span className="flex-import-file">{s.filename}</span>
      </>
    ),
  },
  {
    key: 'period',
    header: 'Period',
    className: 'data-table-note',
    cell: (s) => `${formatDate(s.fromDate)} – ${formatDate(s.toDate)}`,
  },
  ...RECORD_SECTIONS.map(
    (section): DataColumn<FlexStatementImport> => ({
      key: section.key,
      header: section.header,
      numeric: true,
      cellClassName: (s) => (s.alreadyImported ? 'flex-import-dim' : ''),
      cell: (s) => <RecordCount count={s.records[section.key]} dim={s.alreadyImported} />,
    }),
  ),
  {
    key: 'status',
    header: 'Status',
    cell: (s) =>
      s.alreadyImported ? (
        <Badge>Already imported</Badge>
      ) : totalInserted(s) === 0 ? (
        <Badge>No new rows</Badge>
      ) : (
        <Badge variant="accent">Imported</Badge>
      ),
  },
]

/** A record count and its duplicate tally — the cell's contents; the cell itself is the table's. */
function RecordCount({
  count,
  dim,
}: {
  count: { inserted: number; skipped: number }
  dim: boolean
}): React.JSX.Element {
  if (dim) return <>—</>
  return (
    <>
      {count.inserted}
      {/* The space is outside the badge on purpose: a badge is an inline-block, and a
          block container strips the white space that starts its first line. */}
      {count.skipped > 0 && (
        <>
          {' '}
          <Badge variant="plain">(+{count.skipped} dup)</Badge>
        </>
      )}
    </>
  )
}
