import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flexStatementsService } from './flexStatementsService'
import {
  flexReadRepository,
  type StoredStatementRow,
} from '@repositories/flex/flexReadRepository'

vi.mock('@repositories/flex/flexReadRepository', () => ({
  flexReadRepository: {
    getStatements: vi.fn(),
  },
}))

const repo = vi.mocked(flexReadRepository)

/** 2025-04-03 → 2025-12-31 and 2026-01-01 → 2026-07-22, the owner's real two statements. */
const APR_2025 = Date.UTC(2025, 3, 3)
const DEC_2025 = Date.UTC(2025, 11, 31)
const JAN_2026 = Date.UTC(2026, 0, 1)
const JUL_2026 = Date.UTC(2026, 6, 22)

function statement(overrides: Partial<StoredStatementRow>): StoredStatementRow {
  return {
    id: 1,
    accountId: 'U1234567',
    fromDate: APR_2025,
    toDate: DEC_2025,
    period: 'Custom',
    baseCurrency: 'EUR',
    sourceFilename: 'flex.xml',
    importedAt: Date.UTC(2026, 0, 2),
    ...overrides,
  }
}

describe('flexStatementsService.listStatements', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('reports an empty store as an empty list with no coverage', () => {
    repo.getStatements.mockReturnValue([])

    expect(flexStatementsService.listStatements()).toEqual({ statements: [], coverage: null })
  })

  it('returns the stored statements unchanged', () => {
    const rows = [statement({ id: 1 }), statement({ id: 2, fromDate: JAN_2026, toDate: JUL_2026 })]
    repo.getStatements.mockReturnValue(rows)

    expect(flexStatementsService.listStatements().statements).toEqual(rows)
  })

  it('spans coverage from the earliest start to the latest end', () => {
    repo.getStatements.mockReturnValue([
      statement({ id: 1 }),
      statement({ id: 2, fromDate: JAN_2026, toDate: JUL_2026 }),
    ])

    expect(flexStatementsService.listStatements().coverage).toEqual({
      fromDate: APR_2025,
      toDate: JUL_2026,
    })
  })

  it('takes coverage as a min/max, not the first and last row', () => {
    // Statements can be imported out of order, and the newest period is not necessarily
    // the widest — an older statement may still hold the earliest start date.
    repo.getStatements.mockReturnValue([
      statement({ id: 1, fromDate: JAN_2026, toDate: JUL_2026 }),
      statement({ id: 2, fromDate: APR_2025, toDate: DEC_2025 }),
    ])

    expect(flexStatementsService.listStatements().coverage).toEqual({
      fromDate: APR_2025,
      toDate: JUL_2026,
    })
  })

  it('covers a lone statement with its own period', () => {
    repo.getStatements.mockReturnValue([statement({ fromDate: APR_2025, toDate: DEC_2025 })])

    expect(flexStatementsService.listStatements().coverage).toEqual({
      fromDate: APR_2025,
      toDate: DEC_2025,
    })
  })

  it('spans overlapping statements without double-counting the overlap', () => {
    // Overlap is allowed by the store (Bug #103 lived here); coverage is the union span.
    repo.getStatements.mockReturnValue([
      statement({ id: 1, fromDate: APR_2025, toDate: JAN_2026 }),
      statement({ id: 2, fromDate: DEC_2025, toDate: JUL_2026 }),
    ])

    expect(flexStatementsService.listStatements().coverage).toEqual({
      fromDate: APR_2025,
      toDate: JUL_2026,
    })
  })
})
