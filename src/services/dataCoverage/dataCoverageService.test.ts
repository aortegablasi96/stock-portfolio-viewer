import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dataCoverageService } from './dataCoverageService'
import { flexStatementsService } from '@services/flex/flexStatementsService'
import { snapshotService } from '@services/snapshots/snapshotService'
import type { FlexStoredStatement } from '@shared/domain/flex'
import type { SnapshotSummary } from '@shared/domain/snapshot'

/**
 * The coverage service: one report over two stores (Story #329, DDR-0111).
 *
 * **It exists because a tool may not span two service methods**, so the join it performs is the
 * whole of its subject — and the properties worth asserting are the ones a tool-layer join would
 * have got wrong quietly: that it always answers, that the spans are a min/max rather than the
 * first row's, and that it reaches no gateway.
 */

vi.mock('@services/flex/flexStatementsService', () => ({
  flexStatementsService: { listStatements: vi.fn() },
}))
vi.mock('@services/snapshots/snapshotService', () => ({
  snapshotService: { getHistory: vi.fn() },
}))

const statements = vi.mocked(flexStatementsService.listStatements)
const history = vi.mocked(snapshotService.getHistory)

const NOW = Date.UTC(2026, 8, 1, 9, 30)

function statement(over: Partial<FlexStoredStatement> = {}): FlexStoredStatement {
  return {
    id: 1,
    accountId: 'U1',
    fromDate: Date.UTC(2025, 0, 1),
    toDate: Date.UTC(2025, 11, 31),
    period: 'Year',
    baseCurrency: 'EUR',
    sourceFilename: 'flex.xml',
    importedAt: Date.UTC(2026, 0, 5),
    ...over,
  }
}

function snapshot(over: Partial<SnapshotSummary> = {}): SnapshotSummary {
  return {
    id: 1,
    capturedAt: Date.UTC(2026, 5, 1),
    source: 'ibkr',
    baseCurrency: 'EUR',
    totalMarketValue: 1_000,
    netLiquidation: 1_200,
    totalCash: 200,
    holdingsCount: 3,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  statements.mockReturnValue({ statements: [], coverage: null })
  history.mockResolvedValue([])
})

describe('dataCoverageService.getCoverage', () => {
  /**
   * **The one report in the app with no `needs_import`.** Nothing imported is not a failure to
   * report coverage — it is the coverage, and a state here would be the empty-report-standing-in-
   * for-a-state failure running backwards.
   */
  it('answers an empty machine rather than signalling a state', async () => {
    const coverage = await dataCoverageService.getCoverage(NOW)

    expect(coverage.flex.statements).toBe(0)
    expect(coverage.flex.from).toBeNull()
    expect(coverage.flex.latestImportedAt).toBeNull()
    expect(coverage.snapshots.captures).toBe(0)
    expect(coverage.readAt).toBe(NOW)
  })

  it('reports the span the statements cover and when the last import ran', async () => {
    statements.mockReturnValue({
      statements: [
        statement({ id: 2, fromDate: Date.UTC(2026, 0, 1), toDate: Date.UTC(2026, 5, 30), importedAt: Date.UTC(2026, 6, 1) }),
        statement({ id: 1, importedAt: Date.UTC(2026, 0, 5) }),
      ],
      coverage: { fromDate: Date.UTC(2025, 0, 1), toDate: Date.UTC(2026, 5, 30) },
    })

    const { flex } = await dataCoverageService.getCoverage(NOW)

    expect(flex.statements).toBe(2)
    expect(flex.from).toBe(Date.UTC(2025, 0, 1))
    expect(flex.to).toBe(Date.UTC(2026, 5, 30))
    // The store's own clock, and the *latest* import rather than the first row's.
    expect(flex.latestImportedAt).toBe(Date.UTC(2026, 6, 1))
    expect(flex.baseCurrencies).toEqual(['EUR'])
  })

  /** Two base currencies is a fact an answer has to carry: two amounts that must never be totalled. */
  it('names every base currency the statements carry, sorted', async () => {
    statements.mockReturnValue({
      statements: [statement({ baseCurrency: 'USD' }), statement({ id: 2 }), statement({ id: 3, baseCurrency: 'USD' })],
      coverage: { fromDate: 1, toDate: 2 },
    })

    expect((await dataCoverageService.getCoverage(NOW)).flex.baseCurrencies).toEqual(['EUR', 'USD'])
  })

  it('reports the first and most recent capture, whatever order they arrive in', async () => {
    history.mockResolvedValue([
      snapshot({ id: 3, capturedAt: Date.UTC(2026, 7, 1) }),
      snapshot({ id: 1, capturedAt: Date.UTC(2026, 1, 1) }),
      snapshot({ id: 2, capturedAt: Date.UTC(2026, 4, 1) }),
    ])

    const { snapshots } = await dataCoverageService.getCoverage(NOW)

    expect(snapshots.captures).toBe(3)
    expect(snapshots.earliest).toBe(Date.UTC(2026, 1, 1))
    expect(snapshots.latest).toBe(Date.UTC(2026, 7, 1))
  })

  /**
   * **No display currency, so no FX read and no gateway.** Coverage carries no money, so it asks
   * for no conversion — and the consequence is the one that matters: *how current is my data* stays
   * answerable with the gateway switched off, which is exactly when an owner asks it.
   */
  it('asks the snapshot history for no conversion, so no gateway is reached', async () => {
    await dataCoverageService.getCoverage(NOW)
    expect(history).toHaveBeenCalledWith()
  })
})
