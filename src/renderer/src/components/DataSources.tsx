import { useCallback, useEffect, useState } from 'react'
import type { FlexStatementImport, FlexStatementStore } from '@shared/domain/flex'
import { formatDate, formatDateTime } from '@shared/format'
import { flexDataVersion } from '../lib/dataVersion'
import { ConfirmAction } from './ConfirmAction'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Card, CardContent, CardTitle } from './ui/Card'
import { StatePanel } from './ui/StatePanel'
import { DataTable, type DataColumn } from './ui/DataTable'

/**
 * Where the imported history comes from (Milestone M3, Story #20; restructured by Story #189).
 *
 * The owner imports IBKR Portfolio Analyst Flex Query XML here, and this is the only place that
 * says what the local store holds. All work happens in the main process over
 * `window.api.importFlexStatements()`; nothing here holds business logic. The import result is a
 * discriminated union, so each outcome (imported / canceled / invalid / error) is a first-class UI
 * state (ADR-0005), and the stored-statement list below reads the *store* rather than the last
 * import — it loads on mount, so on launch the owner sees what their analytics are built from
 * without importing anything (Story #108).
 *
 * **Both write paths bump the shared data version** (Story #109). The analytics views stay mounted
 * once visited, so importing or clearing here would otherwise leave four views showing history
 * that has just changed — or been deleted — until the owner refreshed each one by hand (DDR-0027).
 * That is why the bump sits in {@link useFlexSources} rather than in a component: Story #189 split
 * this panel across three places on the page, and a bump that lived in the card would have moved
 * with whichever fragment happened to keep the button.
 *
 * ## Why this module is a hook plus three components
 *
 * Story #189 puts the import controls in the Portfolio view's 260px right rail and the stored
 * statements full-width below it, which are two different cells of the page's grid. One component
 * cannot render into both, and hoisting the state into `PortfolioDashboard` would have put the
 * import's four outcomes into a component that already owns five live-read states. So the state is
 * a hook the view calls once, and the three fragments are presentational and take what it returns:
 *
 *   - {@link DataSourcesCard} — the rail card: coverage in a sentence, Import, Clear.
 *   - {@link ImportReceipt} — the per-file summary of the import that just ran, full width because
 *     it is a seven-column table and a 260px rail cannot hold one.
 *   - {@link StoredStatementsCard} — what the store holds, full width, below the pair.
 */

/** The outcome of the import or clear the owner last ran, or `idle` before either. */
type ImportState =
  | { phase: 'idle' }
  | { phase: 'importing' }
  | { phase: 'imported'; statements: FlexStatementImport[] }
  | { phase: 'canceled' }
  | { phase: 'invalid'; message: string }
  | { phase: 'error'; message: string }
  | { phase: 'cleared'; removedStatements: number }

/** What {@link useFlexSources} owns, and what the three fragments below are handed. */
export interface FlexSources {
  /** The stored-statement list: `null` until the first read resolves (Story #108). */
  store: FlexStatementStore | null
  state: ImportState
  runImport: () => void
  runClear: () => Promise<void>
}

/** Total rows inserted across every record type in a statement import. */
function totalInserted(statement: FlexStatementImport): number {
  return Object.values(statement.records).reduce((sum, count) => sum + count.inserted, 0)
}

/**
 * The import/clear state and the store behind it. Called once, by the view that places the three
 * fragments; calling it twice would give the page two disagreeing copies of the store.
 */
export function useFlexSources(): FlexSources {
  const [state, setState] = useState<ImportState>({ phase: 'idle' })
  const [store, setStore] = useState<FlexStatementStore | null>(null)

  // The store is the source of truth for what is held; every write path below re-reads it
  // rather than patching local state from an import summary, so the list can't drift.
  const loadStore = useCallback(async () => {
    try {
      setStore(await window.api.listFlexStatements())
    } catch {
      // A failed read leaves the previous list in place; the card's own status line reports
      // import/clear failures, and there is nothing the owner can act on here.
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

  const startImport = useCallback(() => void runImport(), [runImport])

  return { store, state, runImport: startImport, runClear }
}

/**
 * The rail card (Story #189): what the imported history covers, and the two things that change
 * it. Everything in it stacks, because it is 260px wide.
 *
 * `Clear statements` stays a {@link ConfirmAction} — an expand-in-place warning with Confirm and
 * Cancel, never a modal and never `window.confirm` (DDR-0012), over the sanctioned whole-store
 * reset (ADR-0006). The redesign draws a bare red button there; a bare button on a destructive
 * action is the thing that decision exists to prevent. Its loss tone comes from `.btn-danger`,
 * which colours **text** with `--neg-text` — `--neg` is the fill token, and picking the wrong one
 * is silent (DDR-0046).
 */
export function DataSourcesCard({ sources }: { sources: FlexSources }): React.JSX.Element {
  const { store, state } = sources

  return (
    <Card aria-labelledby="flex-sources-heading">
      <CardTitle id="flex-sources-heading">Data sources</CardTitle>
      <CardContent>
        <p className="flex-store-coverage">
          <Coverage store={store} />
        </p>

        <div className="flex-import-actions">
          <Button onClick={sources.runImport} disabled={state.phase === 'importing'}>
            {state.phase === 'importing' ? 'Importing…' : 'Import statements…'}
          </Button>
          <ConfirmAction
            label="Clear statements"
            confirmLabel="Yes, clear all statements"
            busyLabel="Clearing…"
            warning="This permanently removes all imported Flex statement data — trades, positions, dividends and realized gains. Snapshot history is not affected. You can re-import your Flex exports afterwards."
            onConfirm={sources.runClear}
          />
        </div>

        <ImportOutcome state={state} />
      </CardContent>
    </Card>
  )
}

/**
 * The coverage sentence. Coverage is a **min/max across every stored statement**, computed in the
 * service because statements overlap and arrive out of order (DDR-0026) — so this reads it and
 * never derives it from the rows. An empty store is an empty list, not a result variant, which is
 * why there are three plain outcomes here and no error branch.
 */
function Coverage({ store }: { store: FlexStatementStore | null }): React.JSX.Element {
  if (store === null) return <>Reading the local store…</>
  if (store.coverage === null || store.statements.length === 0) {
    // Deliberately not the wording the stored-statements panel below uses. Both say the store is
    // empty, and two elements matching the same sentence is a page a test cannot address one half
    // of — the empty state that the suite asserts on is the panel's.
    return <>Nothing imported yet — a Flex Query export is what builds your history.</>
  }

  return (
    <>
      Covering{' '}
      <strong>
        {formatDate(store.coverage.fromDate)} – {formatDate(store.coverage.toDate)}
      </strong>{' '}
      across {store.statements.length}{' '}
      {store.statements.length === 1 ? 'statement' : 'statements'}.
    </>
  )
}

/** What the last import or clear did, in one line. Absent while idle and while importing. */
function ImportOutcome({ state }: { state: ImportState }): React.JSX.Element | null {
  if (state.phase === 'cleared') {
    return (
      <p className="capture-status" role="status">
        {state.removedStatements === 0
          ? 'No imported statements to clear.'
          : `Cleared ${state.removedStatements} statement${state.removedStatements === 1 ? '' : 's'}. The analytics views will show their needs-import state until you import again.`}
      </p>
    )
  }

  if (state.phase === 'canceled') {
    return <StatePanel surface="inline">Import canceled — no files were selected.</StatePanel>
  }

  if (state.phase === 'invalid' || state.phase === 'error') {
    return (
      <p className="capture-status capture-status-error" role="alert">
        {state.phase === 'invalid'
          ? `That file isn’t a valid Flex Query statement, so nothing was imported. ${state.message}`
          : state.message}
      </p>
    )
  }

  if (state.phase === 'imported') {
    const newlyImported = state.statements.filter((s) => !s.alreadyImported)
    return (
      <p className="capture-status" role="status">
        {newlyImported.length === 0
          ? 'Everything selected was already imported — no new data added.'
          : `Imported ${newlyImported.length} statement${newlyImported.length === 1 ? '' : 's'}.`}
      </p>
    )
  }

  return null
}

/**
 * The receipt for the import that just ran: one row per file the owner picked, in the order they
 * picked them. Full width and its own card, because the rail card announces the outcome in a
 * sentence and this is the seven-column detail behind it. Absent until an import lands.
 */
export function ImportReceipt({ sources }: { sources: FlexSources }): React.JSX.Element | null {
  if (sources.state.phase !== 'imported') return null

  return (
    <Card aria-labelledby="flex-receipt-heading">
      <CardTitle id="flex-receipt-heading">Last import</CardTitle>
      <CardContent>
        <DataTable
          caption="Import summary"
          columns={summaryColumns}
          rows={sources.state.statements}
          rowKey={(s, index) => `${s.accountId}-${s.fromDate}-${s.toDate}-${index}`}
        />
      </CardContent>
    </Card>
  )
}

/**
 * What the local store currently holds (Story #108) — the answer to "what is my analytics built
 * from, and how current is it?", available on launch with no import required. Each row gives one
 * statement's own period, so a gap between two of them, or a newest statement that ends months
 * ago, is visible without arithmetic. Rows arrive newest first: the first row is the statement the
 * statement-scoped analytics reads treat as latest.
 *
 * The coverage line that used to sit above these rows now opens the rail card instead — it is the
 * one-sentence answer, and the rail is where the owner is looking when they ask (Story #189).
 */
export function StoredStatementsCard({ sources }: { sources: FlexSources }): React.JSX.Element {
  const { store } = sources

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
            No statements imported yet. Import a Flex Query export from the Data sources card to
            build the history the analytics views read from.
          </StatePanel>
        ) : (
          <StoredStatementsTable statements={store.statements} />
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Sorting is worth having here — the statements are imported in whatever order the owner picked
 * the files, so "which period am I missing?" is a question of order — and Period covered sorts on
 * `fromDate` rather than the rendered range.
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

/** The five record sections a statement carries, in the order the import writes them. */
const RECORD_SECTIONS = [
  { key: 'trades', header: 'Trades' },
  { key: 'cashTransactions', header: 'Cash' },
  { key: 'openPositions', header: 'Positions' },
  { key: 'lots', header: 'Lots' },
  { key: 'securities', header: 'Securities' },
] as const

/**
 * The receipt's columns. Deliberately **not sortable** (Story #134): this table is the receipt for
 * one action, listing the files the owner just picked in the order they picked them. Sorting is
 * opt-in per column precisely so a table with no question to answer doesn't grow controls that
 * answer nothing. The stored-statement list is the one that sorts.
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
      cellClassName: (s) => (s.alreadyImported ? 'data-table-dim' : ''),
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
